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
import time

from study_cards import card_receipts, linked_note_ids, with_card_progress
from study_sources import page_source_key, source_search_key, with_article_href
from study_media import has_current_audio, with_audio_context

PAGE_SIZE = 10


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


def saved_record(row):
    return row.get('vaultSaved') and row.get('learningState') != 'favorite-only'


def has_saved_translation(entry):
    return bool(entry.get('sentence') and entry.get('language', 'en') == 'en' and entry.get('translation', '').strip())


def indexed_sources(rows, query, offset, link_source):
    from study_senses import recent_recall
    now = time.time()
    groups = {}
    matched = set()
    for row in rows:
        entry = row['entry']
        url = entry['url']
        if not url or not saved_record(row): continue
        key = page_source_key(url)
        if link_source and key != link_source: continue
        group = groups.setdefault(key, {'url': url, 'title': '', 'records': 0, 'audio': 0, 'recall': 0, 'translated': set(), 'created': ''})
        group['records'] += 1
        group['audio'] += bool(entry['sentence'] and has_current_audio(row))
        group['recall'] += bool(recent_recall(row, now))
        if has_saved_translation(entry):
            group['translated'].add(entry['sentence'])
        if row['created'] > group['created']:
            group.update(url=url, title=entry['title'] or group['title'], created=row['created'])
        if not group['title']: group['title'] = entry['title']
        if key not in matched and (not query or search_hit(row, query)):
            matched.add(key)
    found = sorted((group for key, group in groups.items() if key in matched), key=lambda g: (g['created'], g['url']), reverse=True)
    return {'sources': [{k: (len(v) if k == 'translated' else v) for k, v in group.items() if k != 'created'}
                        for group in found[offset:offset + PAGE_SIZE]],
            'total': len(found), 'canSearch': True}


def indexed_page(rows, p, *, complete=True):
    scope = p.get('scope', 'source')
    practice = p.get('practice')
    dictation = practice == 'dictation'
    translating = practice == 'translation'
    cloze = practice == 'cloze'
    recalling = practice == 'recall'
    excluded = set(p.get('exclude', []))
    source = page_source_key(p['url']) if scope == 'source' else ''
    raw_query = p.get('query', '')
    link_source = source_search_key(raw_query)
    query = '' if link_source else ' '.join(raw_query.casefold().split())
    offset = p.get('offset', 0)
    if scope == 'sources':
        return indexed_sources(rows, query, offset, link_source)
    if scope == 'word':
        from study_senses import canonical, practice_material, word_aliases
        rows = [row for row in rows if saved_record(row) and row['entry'].get('kind') != 'sentence'
                and row['entry'].get('language', 'en') == p.get('language', 'en') and row['entry']['sentence']]
        word = p['word'].casefold()
        head = word_aliases(row['entry'] for row in rows).get(word) or word
        rows = [row for row in rows if canonical(row['entry']) == head]
    matches = []
    source_recall = scope == 'source' and bool(source) and not offset and not practice
    recent_only = scope == 'recent-recall' or recalling
    if recent_only or source_recall:
        from study_senses import recall_round, recent_recall
        now = time.time()
    for row in rows:
        e = row['entry']
        if row['id'] in excluded: continue
        if link_source and page_source_key(e.get('url', '')) != link_source: continue
        if scope == 'source' and (page_source_key(e['url']) != source or (not source and e['title'] != p['title'])): continue
        if scope == 'pending' and not needs_attention(row): continue
        if scope == 'anki-only' and row.get('syncState') != 'anki-only': continue
        if scope == 'manual-known' and not row.get('manualKnown'): continue
        if scope == 'favorites' and not row.get('favorite'): continue
        if (scope == 'saved' or practice) and not saved_record(row): continue
        if scope == 'linked' and row.get('ankiState') != 'linked' and not linked_note_ids((row,)): continue
        order = recent_recall(row, now) if recent_only else row['created']
        if recent_only and not order: continue
        if dictation and (not e['sentence'] or not has_current_audio(row)): continue
        if translating and not has_saved_translation(e): continue
        # Only prefilter candidates. The same browser masking rule used by cards decides if a blank is valid.
        if cloze and (e.get('kind') == 'sentence' or e.get('language', 'en').split('-', 1)[0].lower() != 'en'
                      or e['word'].casefold() not in e['sentence'].casefold()): continue
        rank = 0
        if query:
            match = search_hit(row, query)
            if not match: continue
            rank, hit = match
            row = {**row, 'searchHit': hit}
        matches.append((rank, order, row))
    matches.sort(key=lambda x: x[:2], reverse=True)
    if not recalling and (link_source or (scope == 'source' and not query)):
        # For a single source, follow its video timeline when it has one.
        # The existing recency order still breaks ties and orders untimed notes.
        matches.sort(key=lambda match: match[2]['entry'].get('videoTime', float('inf')))
    focus_ids = set()
    focus = p.get('focus')
    if focus and scope == 'word':
        origin = page_source_key(p['url']) if p['url'] else ''
        sentence = ' '.join(focus['sentence'].casefold().split())
        for _, _, row in matches:
            e = row['entry']
            same_source = page_source_key(e['url']) == origin if origin else not e['url'] and bool(p['title']) and e['title'] == p['title']
            if (sentence and same_source and e['word'].casefold() == focus['word'].casefold()
                    and ' '.join(e['sentence'].casefold().split()) == sentence and e.get('videoTime') == focus.get('videoTime')):
                focus_ids.add(row['id'])
    if focus:
        matches.sort(key=lambda match: (match[2]['id'] != focus.get('id'), match[2]['id'] not in focus_ids))
    translation_matches = matches if translating else ()
    if practice and not recalling:
        unique = {}
        for match in matches:
            entry = match[2]['entry']
            key = (entry['word'].casefold(), entry['sentence']) if cloze else entry['sentence']
            # Keep the explicit sentence note's translation and its actual position in the list.
            if (translating and key in unique and entry.get('kind') == 'sentence'
                    and unique[key][2]['entry'].get('kind') != 'sentence'):
                del unique[key]
            unique.setdefault(key, match)
        matches = list(unique.values())
    extras = practice_material([row for _, _, row in matches], head) if scope == 'word' and not offset and not practice and not focus and p.get('language', 'en') == 'en' else {}
    page = [row for _, _, row in matches[offset:offset + PAGE_SIZE]]
    primary_translations = {row['entry']['sentence']: row['entry']['translation'].strip() for row in page} if translating else {}
    alternates = {sentence: {} for sentence in primary_translations}
    for _, _, row in translation_matches:
        entry = row['entry']
        sentence = entry['sentence']
        if sentence in alternates and len(alternates[sentence]) < 3:
            text = entry['translation'].strip()
            if text != primary_translations[sentence]:
                alternates[sentence].setdefault(text, {'text': text, 'title': entry['title']})
    if focus and scope == 'word':
        extras.update(focusIds=[row['id'] for row in page if row['id'] in focus_ids], focusTotal=len(focus_ids),
                      focusComplete=complete,
                      ankiNoteIds=sorted({ident for row in page for ident, _ in card_receipts(row) if ident is not None}))

    def list_item(row):
        item = with_article_href(with_card_progress(with_audio_context(row)))
        if alternatives := alternates.get(row['entry']['sentence']):
            item = {**item, 'translationAlternates': list(alternatives.values())}
        return item

    if recalling or (scope == 'recent-recall' and not offset) or source_recall:
        ranked = matches
        if source_recall:
            ranked = [(rank, at, row) for rank, _, row in matches if (at := recent_recall(row, now))]
            ranked.sort(key=lambda match: match[:2], reverse=True)
        chosen = recall_round(row for _, at, row in ranked if at)
        if recalling:
            return {'items': [list_item(row) for row in chosen], 'total': len(ranked)}
        extras['recallRound'] = [list_item(row) for row in chosen]
        extras['recallTotal'] = len(ranked)
    return {'items': [list_item(row) for row in page], 'total': len(matches), 'canSearch': True, 'canFindCloze': True, **extras}


class IndexUnavailable(ValueError):
    """The disposable cache cannot be used; note identity has not been checked."""


class RecordIndex:
    def __init__(self, library):
        self.library = library
        self.root = pathlib.Path(library.cache_dir) if library.cache_dir else None
        if self.root and self.root.resolve().is_relative_to(library.vault.resolve()):
            raise IndexUnavailable('记录索引必须位于桥缓存目录，不能放入 Vault。')
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
                    if not file.name.endswith('.md') or not (file.is_file(follow_symlinks=False) or file.is_symlink()):
                        continue
                    stamp = file.stat(follow_symlinks=False)
                    old = previous.get(file.name, {})
                    if (isinstance(old, dict) and old.get('mtime') == stamp.st_mtime_ns and old.get('ctime') == stamp.st_ctime_ns and
                            old.get('size') == stamp.st_size and isinstance(old.get('rows'), list)
                            and ('complete' in old or old['rows'])):
                        files[file.name] = old
                        continue
                    changed = True
                    path = pathlib.Path(file.path)
                    complete = True
                    try:
                        rows = self.parse(path)
                    except (OSError, ValueError, KeyError, TypeError):
                        rows = []  # An invalid changed note must not leave stale learning data behind.
                        complete = False
                    files[file.name] = {'mtime': stamp.st_mtime_ns, 'ctime': stamp.st_ctime_ns, 'size': stamp.st_size, 'rows': rows, 'complete': complete}
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
