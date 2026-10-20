# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit optional practice feedback. Appends to the selected note, never touches Anki."""
import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import re
import tempfile
import time

from study_library import ID_RE, paragraph, text
from study_sync import local_fields


def normalize_practice(p):
    from study_translator import normalize_config
    if (set(p) != {'action', 'id', 'kind', 'prompt', 'answer', 'config'} or
            not isinstance(p['id'], str) or not ID_RE.fullmatch(p['id']) or
            p['kind'] not in ('make-sentence', 'produce')):
        raise ValueError('练习请求须指定已保存记录、题目、答案及模型设置。')
    return {**p, 'prompt': text(p['prompt'], 2400, True), 'answer': text(p['answer'], 2400, True),
            'config': normalize_config(p['config'])}


def validate_result(result):
    if (not isinstance(result, dict) or set(result) != {'verdict', 'corrected', 'reason'} or
            result['verdict'] not in ('good', 'almost', 'wrong')):
        raise ValueError('批改结果格式无效，未写入笔记。')
    text(result['corrected'], 2400)
    text(result['reason'], 1000, True)
    return dict(result)


def cache_read(path):
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def cache_result(path, key, result):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        rows = cache_read(path)
        rows = {k: v for k, v in rows.items() if isinstance(v, dict) and type(v.get('at')) in (int, float)
                and time.time() - v['at'] < 30 * 86400}
        rows[key] = {'at': time.time(), 'result': result}
        rows = dict(sorted(rows.items(), key=lambda item: item[1]['at'])[-100:])
        fd, name = tempfile.mkstemp(prefix='.practice-', dir=path.parent)
        try:
            with os.fdopen(fd, 'w') as stream:
                json.dump(rows, stream, ensure_ascii=False)
            os.replace(name, path)
        finally:
            if os.path.exists(name): os.unlink(name)


def check_practice(library, request, translate):
    lib = library.locate(request['id'])
    if lib is None:
        raise ValueError('原学习记录已不存在；未调用模型或重建笔记。')
    record, body, _version = lib.read(request['id'])
    entry = {**record['entry'], **local_fields(record, body)}
    material = {k: entry.get(k, '') for k in ('word', 'sentence', 'meaning', 'translation')}
    material['language'] = entry.get('language', 'en')
    payload = {k: v for k, v in request.items() if k != 'id'}
    payload['material'] = material
    key = hashlib.sha256(json.dumps({'id': request['id'], **payload}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    previous = next((e for e in record.get('practice', []) if e.get('key') == key), None)
    if previous:
        return validate_result(previous['result'])
    cache = pathlib.Path(library.cache_dir or library.config_path.parent / 'learning-cache') / 'practice-results.json'
    cached = cache_read(cache).get(key, {})
    if isinstance(cached, dict) and type(cached.get('at')) in (int, float) and time.time() - cached['at'] < 30 * 86400:
        result = validate_result(cached.get('result'))
    else:
        result = validate_result(translate(payload))
    cache_ok = True
    try:
        cache_result(cache, key, result)
    except (OSError, ValueError):
        cache_ok = False  # Still attempt the note; a finished paid answer must remain visible.
    try:
        with lib.locked():
            record, body, version = lib.read(request['id'])
            if any(e.get('key') == key for e in record.get('practice', [])):
                return result
            at = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
            event = {'key': key, 'at': at, 'kind': request['kind'], 'prompt': request['prompt'], 'answer': request['answer'],
                     'material': material, 'result': result}
            record.setdefault('practice', []).append(event)
            block = '\n' + paragraph(at + ' · ' + request['kind']) + '\n'
            for label, value in [('题目', request['prompt']), ('我的回答', request['answer']), ('结果', result['verdict']),
                                 ('修改参考', result['corrected']), ('说明', result['reason'])]:
                if value: block += '\n' + label + '\n\n' + paragraph(value) + '\n'
            heading = re.search(r'^### 练习\n', body, re.M)
            if heading:
                following = re.search(r'^#{1,3} ', body[heading.end():], re.M)
                end = heading.end() + following.start() if following else len(body)
                body = body[:end] + block + '\n' + body[end:]
            else:
                body += '\n### 练习\n' + block
            lib.write(record, body, version)
    except (OSError, ValueError):
        error = '批改已完成，笔记未写入；可重试同一答案以补写，不会再次调用模型。' if cache_ok else '批改已完成，但笔记和临时缓存均未写入；请保留本次结果，不要重复调用。'
        return {**result, 'saved': False, 'error': error}
    return result
