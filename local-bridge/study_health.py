#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only bridge health; error summaries never contain learner material."""
import json
import os
import pathlib
import platform
import tempfile
import time

from bridge_files import hashes, runtime_sources
from study_library import anki_call


def read_json(path, fallback):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return fallback


def record_error(runtime, action, error):
    if not isinstance(action, str) or not action.replace('_', '').isalnum() or len(action) > 60:
        action = 'request'
    message = '请求或本机状态校验未通过。' if isinstance(error, ValueError) else '本机操作未完成。'
    if isinstance(error, TimeoutError):
        message = '本机请求超时。'
    path = pathlib.Path(runtime) / 'learning-cache' / 'bridge-errors.json'
    try:
        rows = read_json(path, [])
        rows = rows if isinstance(rows, list) else []
        rows = [*rows[-19:], {'at': int(time.time() * 1000), 'action': action, 'message': message}]
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix='.bridge-errors-', dir=path.parent)
        try:
            with os.fdopen(fd, 'w') as stream:
                json.dump(rows, stream, ensure_ascii=False)
            os.replace(name, path)
        finally:
            if os.path.exists(name):
                os.unlink(name)
    except OSError:
        pass  # Diagnostics must not change the outcome of a learning operation.


def health(runtime, anki=anki_call):
    root = pathlib.Path(runtime)
    config = read_json(root / 'bridge-config.json', {})
    vault = pathlib.Path(config.get('vault', ''))
    files = runtime_sources(root)
    apple = root / 'apple-translate'
    if apple.is_file():
        files['apple-translate'] = apple.read_bytes()
    try:
        version = anki('version', {})
        connected = {'ok': type(version) is int, **({'version': version} if type(version) is int else {})}
    except Exception:
        connected = {'ok': False}
    state = read_json(root / 'learning-cache' / 'auto-sync-state.json', {})
    errors = read_json(root / 'learning-cache' / 'bridge-errors.json', [])
    return {'files': hashes(files), 'python': platform.python_version(),
            'vault': {'ok': vault.is_absolute() and vault.is_dir() and not vault.is_symlink()},
            'anki': connected, 'appleTranslate': apple.is_file() and os.access(apple, os.X_OK),
            'autoSync': {key: state.get(key, 0) for key in ('at', 'synced', 'conflicts')},
            'errors': errors[-20:] if isinstance(errors, list) else []}
