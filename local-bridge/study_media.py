#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit, content-addressed study attachments; no URL fetching or arbitrary paths."""
import base64
import hashlib
import html
import math
import re

MAX_ASSET = 2_000_000
FORMATS = {'image/png': ('image', 'png'), 'image/jpeg': ('image', 'jpg'),
           'audio/webm': ('audio', 'webm'), 'audio/ogg': ('audio', 'ogg'),
           'audio/mpeg': ('audio', 'mp3'), 'audio/wav': ('audio', 'wav')}


def decode(asset):
    if not isinstance(asset, dict) or set(asset) != {'kind', 'mime', 'data'}:
        raise ValueError('媒体只接受类型和 base64 内容，不接受文件路径或网址。')
    kind, ext = FORMATS.get(asset['mime'], ('', ''))
    if not kind or asset['kind'] != kind or not isinstance(asset['data'], str) or len(asset['data']) > 2_666_668:
        raise ValueError('媒体类型不支持或超过每个 2MB。')
    try:
        data = base64.b64decode(asset['data'], validate=True)
    except Exception as e:
        raise ValueError('媒体 base64 无效。') from e
    valid = {'png': data.startswith(b'\x89PNG\r\n\x1a\n'), 'jpg': data.startswith(b'\xff\xd8\xff'),
             'webm': data.startswith(b'\x1aE\xdf\xa3'), 'ogg': data.startswith(b'OggS'),
             'mp3': data.startswith(b'ID3') or len(data) > 1 and data[0] == 255 and data[1] & 224 == 224,
             'wav': data.startswith(b'RIFF') and data[8:12] == b'WAVE'}
    if not 1 <= len(data) <= MAX_ASSET or not valid[ext]:
        raise ValueError('媒体内容与类型不符或为空；未保存附件。')
    return data, ext


def validate(p):
    if set(p) != {'action', 'id', 'version', 'assets', 'start', 'end', 'origin'}:
        raise ValueError('媒体关联参数无效。')
    if not isinstance(p['id'], str) or not re.fullmatch('[a-f0-9]{32}', p['id']) or not isinstance(p['version'], str) or not re.fullmatch('[a-f0-9]{64}', p['version']):
        raise ValueError('媒体必须关联已保存记录及其版本。')
    if p['origin'] not in ('capture', 'import') or not isinstance(p['assets'], list) or not 1 <= len(p['assets']) <= 2:
        raise ValueError('一次接受原声和画面各一个。')
    start, end = p['start'], p['end']
    if any(type(v) not in (int, float) or not math.isfinite(v) for v in (start, end)) or not 0 <= start < end <= 604800 or end - start > 30:
        raise ValueError('媒体片段须为 0–604800 秒中的最多 30 秒。')
    kinds = set()
    for asset in p['assets']:
        decode(asset)
        if asset['kind'] in kinds:
            raise ValueError('同类媒体重复。')
        kinds.add(asset['kind'])
    return p


def attach(library, p):
    r, body, version = library.read(p['id'])
    if version != p['version']:
        same = True
        for asset in p['assets']:
            data, ext = decode(asset)
            digest = hashlib.sha256(data).hexdigest()
            name = f'study-media-{r["id"]}-{digest}.{ext}'
            ref = r.get('media', {}).get(asset['kind'], {})
            path = library.vault / name
            library.check_path(path)
            if (ref.get('name'), ref.get('start'), ref.get('end'), ref.get('origin')) != (name, p['start'], p['end'], p['origin']) or not path.is_file() or path.read_bytes() != data:
                same = False
        if same:
            return library.result(r['id'])
        raise ValueError('笔记在采集期间已变化，请重新保存后再关联；文字笔记未覆盖。')
    media = r.setdefault('media', {})
    changed = False
    for asset in p['assets']:
        data, ext = decode(asset)
        digest = hashlib.sha256(data).hexdigest()
        name = f'study-media-{r["id"]}-{digest}.{ext}'
        path = library.vault / name
        library.check_path(path)
        if path.exists():
            if path.read_bytes() != data:
                raise ValueError('已有媒体文件不匹配，停止覆盖。')
        else:
            with path.open('xb') as stream:
                stream.write(data)
            if path.read_bytes() != data:
                raise ValueError('媒体写入后读回不同。')
        ref = {'name': name, 'sha256': digest, 'size': len(data), 'mime': asset['mime'],
               'start': p['start'], 'end': p['end'], 'origin': p['origin']}
        if media.get(asset['kind']) != ref:
            changed = True
            media[asset['kind']] = ref
            body += f'\n## 场景媒体 · {"原声" if asset["kind"] == "audio" else "画面"}\n\n'
            body += f'{"手动导入，内容对应由本人确认" if p["origin"] == "import" else "用户指定片段采集"}：{p["start"]}–{p["end"]} 秒。\n\n![[{name}]]\n'
    if changed:
        library.write(r, body, version)
    return library.result(r['id'])


def anki_fields(library, record):
    fields = {'Audio': '', 'Image': ''}
    for kind, ref in record.get('media', {}).items():
        name = ref.get('name', '')
        if kind not in ('audio', 'image') or not re.fullmatch('study-media-' + record['id'] + r'-[a-f0-9]{64}\.(png|jpg|webm|ogg|mp3|wav)', name):
            raise ValueError('附件引用无效；不读取任意文件。')
        path = library.vault / name
        library.check_path(path)
        if not path.is_file() or path.stat().st_size > MAX_ASSET:
            raise ValueError('场景附件缺失或过大；卡片暂不发送，请恢复附件。')
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != ref['sha256']:
            raise ValueError('附件内容已变化，请重新确认。')
        actual = library.anki('storeMediaFile', {'filename': name, 'data': base64.b64encode(data).decode()})
        if actual != name:
            raise ValueError('Anki 未确认原附件名称。')
        fields['Audio' if kind == 'audio' else 'Image'] = f'[sound:{name}]' if kind == 'audio' else f'<img src="{html.escape(name, quote=True)}">'
    return fields
