# SPDX-License-Identifier: GPL-3.0-or-later
"""Local, content-free usage ledger. Provider snapshots replace, never accumulate twice."""
import contextlib
import datetime
import json
import pathlib
import sqlite3
import uuid

FIELDS = ('inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'reasoningOutputTokens')

def normalize_usage(value):
    if not isinstance(value, dict):
        raise ValueError('Token 用量格式无效。')
    result = {}
    for key in FIELDS:
        v = value.get(key)
        if type(v) is not int or not 0 <= v <= 10**12:
            raise ValueError('Token 用量格式无效。')
        result[key] = v
    return result

class Ledger:
    def __init__(self, path=None):
        self.path = pathlib.Path(path or pathlib.Path(__file__).with_name('usage.sqlite3'))

    @contextlib.contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        self.path.chmod(0o600)
        db.execute('CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, at TEXT NOT NULL, action TEXT, model TEXT, status TEXT, usage TEXT)')
        try:
            with db:
                yield db
        finally:
            db.close()

    def start(self, action, model):
        ident = uuid.uuid4().hex
        with self.connect() as db:
            db.execute('INSERT INTO requests VALUES (?,?,?,?,?,NULL)', (ident, datetime.datetime.now().astimezone().isoformat(), action, model, 'running'))
        return ident

    def update(self, ident, usage, status):
        if usage is not None:
            usage = normalize_usage(usage)
        with self.connect() as db:
            db.execute('UPDATE requests SET status=?, usage=COALESCE(?,usage) WHERE id=?', (status, json.dumps(usage) if usage is not None else None, ident))

    def get(self, ident):
        with self.connect() as db:
            row = db.execute('SELECT status,usage FROM requests WHERE id=?', (ident,)).fetchone()
        if row is None:
            return {'status': 'unknown'}
        return {'requestId': ident, 'status': row[0], **(json.loads(row[1]) if row[1] else {})}

    def stats(self):
        result = {'since': None, 'requests': 0, 'unknown': 0, 'inputTokens': 0, 'outputTokens': 0, 'totalTokens': 0}
        if not self.path.exists():
            return result
        with self.connect() as db:
            for at, status, value in db.execute('SELECT at,status,usage FROM requests ORDER BY at'):
                result['since'] = result['since'] or at
                result['requests'] += 1
                if value is None or status != 'completed':
                    result['unknown'] += 1
                if value is not None:
                    usage = json.loads(value)
                    for key in ('inputTokens', 'outputTokens', 'totalTokens'):
                        result[key] += usage[key]
        return result
