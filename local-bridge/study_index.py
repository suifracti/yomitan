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
        from study_library_core import media_key_of
        from study_sync import CARD_STAGES
        lib = self.library
        content = lib.file_content(path)
        if re.search(r'--w[a-f0-9]{32}\.md$', path.name):
            contexts = [(ident, *value[:3]) for ident, value in lib.word_contexts(content).items()]
        else:
            ids = lib.file_ids(path)
            contexts = [(ident, *lib.read_file(path, ident, content)) for ident in ids]
        rows = []
        for ident, record, body, version in contexts:
            result = lib.result_from(record, body, version, path)
            entry = result['entry']
            rows.append({'id': ident, 'targetId': record.get('targetId'), 'word': entry['word'],
                         'lemma': entry.get('lemma', ''), 'media_key': media_key_of(entry.get('url')),
                         'videoTime': entry.get('videoTime'), 'mastery': record.get('mastery', ''),
                         'cards': [{**c, 'stage': CARD_STAGES.get(c.get('kind'), 0)} for c in record.get('cards', [])],
                         'noteId': record.get('noteId'), 'sense_key': entry.get('sense', {}).get('key'), 'result': result})
        return rows
