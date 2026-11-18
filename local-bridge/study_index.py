#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Disposable note index in the bridge cache. Notes remain the only source of truth."""
import fcntl
import hashlib
import json
import os
import pathlib
import re
import tempfile

from study_cards import linked_note_ids, with_card_progress
from study_sources import page_source_key, with_article_href
from study_media import with_audio_context


def needs_attention(row):
    return row.get('syncState') in ('pending', 'missing', 'ambiguous', 'conflict', 'error', 'failed', 'anki-only') or row.get('ankiState') == 'pending'


def search_hit(row, query):
    e = row['entry']
    title, context = e.get('title', ''), e.get('context', '')
    if context.lstrip().startswith('{'):
        try:
            locator = json.loads(context)
        except ValueError:
            locator = None
        if isinstance(locator, dict) and locator.get('kind') == 'article' and {'position', 'locator'} <= locator.keys():
            title, context = title or locator.get('title', ''), ''
    fields = [('单词', e.get('word')), ('原形', e.get('lemma')), ('词义', e.get('sense', {}).get('gloss')),
              ('词义', e.get('meaning')), ('原句', e.get('sentence')), ('译文', e.get('translation')), ('来源', title),
              ('语境', context), ('来源', e.get('url', '').partition('?')[0].partition('#')[0]), ('笔记路径', row.get('path'))]
    remaining = set(query.split())
    match = None
    for label, value in fields:
        value = ' '.join((value or '').split())
        folded = value.casefold()
        if query in folded:
            rank = 2 if query in ((e.get('word') or '').casefold(), (e.get('lemma') or '').casefold()) else 1
            match = (rank, label, value, folded.index(query), len(query))
            break
        if ' ' in query and remaining:
            found = [part for part in remaining if part in folded]
            if found:
                part = min(found, key=folded.index)
                match = (0, label, value, folded.index(part), len(part))
                remaining.difference_update(found)
    if match is None or (not match[0] and remaining):
        return None
    rank, label, value, at, length = match
    start, end = max(0, at - 28), at + length + 54
    return rank, {'label': label, 'text': ('…' if start else '') + value[start:end] + ('…' if end < len(value) else '')}


def indexed_page(rows, p):
    scope = p.get('scope', 'source')
    source = page_source_key(p['url']) if scope == 'source' else ''
    query = ' '.join(p.get('query', '').casefold().split())
    matches = []
    if scope == 'recent-recall':
        import time
        from study_senses import recent_recall
        now = time.time()
    for row in rows:
        e = row['entry']
        if scope == 'source' and (page_source_key(e['url']) != source or (not source and e['title'] != p['title'])): continue
        if scope == 'pending' and not needs_attention(row): continue
        if scope == 'anki-only' and row.get('syncState') != 'anki-only': continue
        if scope == 'manual-known' and not row.get('manualKnown'): continue
        if scope == 'favorites' and not row.get('favorite'): continue
        if scope == 'saved' and (not row.get('vaultSaved') or row.get('learningState') == 'favorite-only'): continue
        if scope == 'linked' and row.get('ankiState') != 'linked' and not linked_note_ids((row,)): continue
        order = recent_recall(row, now) if scope == 'recent-recall' else row['created']
        if scope == 'recent-recall' and not order: continue
        rank = 0
        if query:
            match = search_hit(row, query)
            if not match: continue
            rank, hit = match
            row = {**row, 'searchHit': hit}
        matches.append((rank, order, row))
    matches.sort(key=lambda x: x[:2], reverse=True)
    offset = p.get('offset', 0)
    return {'items': [with_article_href(with_card_progress(with_audio_context(row))) for _, _, row in matches[offset:offset + 10]], 'total': len(matches), 'canSearch': True}


class RecordIndex:
    def __init__(self, library):
        self.library = library
        self.root = pathlib.Path(library.cache_dir) if library.cache_dir else None
        if self.root and self.root.resolve().is_relative_to(library.vault.resolve()):
            raise ValueError('记录索引必须位于桥缓存目录，不能放入 Vault。')
        self.key = hashlib.sha256(json.dumps([str(library.vault), str(library.relative), library.language]).encode()).hexdigest()

    def refresh(self):
        if self.root is None:
            return self.scan({})[0]
        self.root.mkdir(parents=True, exist_ok=True)
        path = self.root / '.study-index.json'
        with (self.root / '.study-index.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                document = json.loads(path.read_text())
                if document.get('version') != 1 or not isinstance(document.get('libraries'), dict):
                    document = {}
            except (OSError, ValueError, AttributeError):
                document = {}
            libraries = document.setdefault('libraries', {})
            previous = libraries.get(self.key, {})
            files, changed = self.scan(previous if isinstance(previous, dict) else {})
            if changed or self.key not in libraries:
                libraries[self.key] = files
                document['version'] = 1
                fd, name = tempfile.mkstemp(prefix='.study-index-', dir=self.root)
                try:
                    with os.fdopen(fd, 'w') as stream:
                        json.dump(document, stream, ensure_ascii=False, separators=(',', ':'))
                    os.replace(name, path)
                finally:
                    if os.path.exists(name):
                        os.unlink(name)
            return files

    def scan(self, previous):
        lib = self.library
        lib.check_path(lib.records)
        files, changed = {}, False
        if lib.records.is_dir():
            with os.scandir(lib.records) as entries:
                for file in entries:
                    if not file.name.endswith('.md') or not file.is_file(follow_symlinks=False):
                        continue
                    stamp = file.stat(follow_symlinks=False)
                    old = previous.get(file.name, {})
                    if (isinstance(old, dict) and old.get('mtime') == stamp.st_mtime_ns and
                            old.get('size') == stamp.st_size and isinstance(old.get('rows'), list)):
                        files[file.name] = old
                        continue
                    changed = True
                    path = pathlib.Path(file.path)
                    try:
                        rows = self.parse(path)
                    except (OSError, ValueError, KeyError, TypeError):
                        rows = []  # An invalid changed note must not leave stale learning data behind.
                    files[file.name] = {'mtime': stamp.st_mtime_ns, 'size': stamp.st_size, 'rows': rows}
        return files, changed or files.keys() != previous.keys()

    def parse(self, path):
        from study_library_core import entry_lemma
        from study_sources import media_key_of
        from study_sync import CARD_STAGES
        lib = self.library
        content = lib.file_content(path)
        if re.search(r'--w[a-f0-9]{32}\.md$', path.name):
            contexts = [(ident, *value[:3]) for ident, value in lib.word_contexts(content).items()]
        else:
            ids = lib.file_ids(path)
            contexts = [(ident, *lib.read_file(path, ident, content)) for ident in ids]
        root = re.search(r'^<!-- english-study-word-v1:(.+) -->$', content, re.M)
        root_metadata = json.loads(root[1]) if root else {}
        rows = []
        for ident, record, body, version in contexts:
            result = lib.result_from(record, body, version, path)
            entry = result['entry']
            default_known = root_metadata.get('manualKnown', record.get('manualKnown', False))
            result['manualKnown'] = root_metadata.get('manualKnownByLemma', {}).get(entry_lemma(entry), default_known) is True
            rows.append({'id': ident, 'targetId': record.get('targetId'), 'word': entry['word'],
                         'lemma': entry.get('lemma', ''), 'media_key': media_key_of(entry.get('url')),
                         'videoTime': entry.get('videoTime'), 'mastery': record.get('mastery', ''),
                         'cards': [{**c, 'stage': CARD_STAGES.get(c.get('kind'), 0)} for c in record.get('cards', [])],
                         'noteId': record.get('noteId'), 'sense_key': entry.get('sense', {}).get('key'), 'result': result})
        return rows
