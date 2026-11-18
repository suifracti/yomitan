#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit, content-addressed study attachments; no URL fetching or arbitrary paths."""
import base64
import hashlib
import html
import json
import math
import re

MAX_ASSET = 2_000_000
MAX_VIDEO = 8_000_000
FORMATS = {'image/png': ('image', 'png'), 'image/jpeg': ('image', 'jpg'), 'video/webm': ('video', 'webm'),
           'audio/webm': ('audio', 'webm'), 'audio/ogg': ('audio', 'ogg'),
           'audio/mpeg': ('audio', 'mp3'), 'audio/wav': ('audio', 'wav')}
OLD_CONTEXT = '原句或来源已改，旧附件仍在原笔记。请回到对应的字幕重新采集，或选文字卡。'


def context_key(entry):
    identity = (entry['sentence'].strip(), entry['url'].strip(), entry.get('videoTime'))
    return hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()


def context_matches(record, ref, entry):
    if 'contextKey' in ref:
        return context_key(entry) == ref['contextKey']
    # A legacy attachment has no snapshot, but an edited identity isn't a safe match.
    from study_library_core import entry_id
    source = entry.get('subtitleSource')
    if source and (entry['sentence'].strip() != source['text'].strip() or entry['url'] != source['url']):
        return False
    return entry_id(entry) == record['id']


def with_audio_context(row):
    ref = row.get('media', {}).get('audio')
    return {**row, 'audioContextChanged': True} if ref and not context_matches(row, ref, row['entry']) else row


def require_audio(record, values):
    ref = record.get('media', {}).get('audio')
    if not ref:
        raise ValueError('这条记录尚未附带真实音频；请先附加原声，或选文字学习卡。')
    if not context_matches(record, ref, {**record['entry'], **values}):
        raise ValueError(OLD_CONTEXT)
    return ref


def decode(asset):
    if not isinstance(asset, dict) or set(asset) != {'kind', 'mime', 'data'}:
        raise ValueError('媒体只接受类型和 base64 内容，不接受文件路径或网址。')
    kind, ext = FORMATS.get(asset['mime'], ('', ''))
    limit = MAX_VIDEO if kind == 'video' else MAX_ASSET
    if not kind or asset['kind'] != kind or not isinstance(asset['data'], str) or len(asset['data']) > (limit * 4 + 2) // 3 + 4:
        raise ValueError('媒体类型不支持或超过大小限制（原声和截图 2MB，视频片段 8MB）。')
    try:
        data = base64.b64decode(asset['data'], validate=True)
    except Exception as e:
        raise ValueError('媒体 base64 无效。') from e
    valid = {'png': data.startswith(b'\x89PNG\r\n\x1a\n'), 'jpg': data.startswith(b'\xff\xd8\xff'),
             'webm': data.startswith(b'\x1aE\xdf\xa3'), 'ogg': data.startswith(b'OggS'),
             'mp3': data.startswith(b'ID3') or len(data) > 1 and data[0] == 255 and data[1] & 224 == 224,
             'wav': data.startswith(b'RIFF') and data[8:12] == b'WAVE'}
    if not 1 <= len(data) <= limit or not valid[ext]:
        raise ValueError('媒体内容与类型不符或为空；未保存附件。')
    return data, ext


def validate(p):
    if set(p) != {'action', 'id', 'version', 'assets', 'start', 'end', 'origin'}:
        raise ValueError('媒体关联参数无效。')
    if not isinstance(p['id'], str) or not re.fullmatch('[a-f0-9]{32}', p['id']) or not isinstance(p['version'], str) or not re.fullmatch('[a-f0-9]{64}', p['version']):
        raise ValueError('媒体必须关联已保存记录及其版本。')
    if p['origin'] not in ('capture', 'import') or not isinstance(p['assets'], list) or not 1 <= len(p['assets']) <= 3:
        raise ValueError('一次接受原声、截图和视频片段各一个。')
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
    from study_sync import local_fields
    r, body, version = library.read(p['id'])
    entry = {**r['entry'], **local_fields(r, body)}
    key = context_key(entry)
    if version != p['version']:
        same = True
        for asset in p['assets']:
            data, ext = decode(asset)
            digest = hashlib.sha256(data).hexdigest()
            name = f'study-media-{r["id"]}-{digest}.{ext}'
            ref = r.get('media', {}).get(asset['kind'], {})
            path = library.vault / name
            library.check_path(path)
            if (ref.get('name'), ref.get('start'), ref.get('end'), ref.get('origin')) != (name, p['start'], p['end'], p['origin']) or not context_matches(r, ref, entry) or not path.is_file() or path.read_bytes() != data:
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
               'start': p['start'], 'end': p['end'], 'origin': p['origin'], 'contextKey': key}
        if media.get(asset['kind']) != ref:
            changed = True
            media[asset['kind']] = ref
            label = {'audio': '原声', 'image': '画面', 'video': '视频片段'}[asset['kind']]
            body += f'\n## 场景媒体 · {label}\n\n'
            body += f'{"手动导入，内容对应由本人确认" if p["origin"] == "import" else "用户指定片段采集"}：{p["start"]}–{p["end"]} 秒。\n\n![[{name}]]\n'
    if changed:
        library.write(r, body, version)
    return library.result(r['id'])


def attachment(library, record, kind, ref):
    name = ref.get('name', '')
    if kind not in ('audio', 'image', 'video') or not re.fullmatch('study-media-' + record['id'] + r'-[a-f0-9]{64}\.(png|jpg|webm|ogg|mp3|wav)', name):
        raise ValueError('附件引用无效；不读取任意文件。')
    path = library.vault / name
    library.check_path(path)
    if not path.is_file() or path.stat().st_size > (MAX_VIDEO if kind == 'video' else MAX_ASSET):
        raise ValueError('场景附件缺失或过大；请检查原笔记的附件。')
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != ref['sha256']:
        raise ValueError('附件内容已变化，请重新确认。')
    return name, data


def read_audio(library, ident):
    from study_sync import local_fields
    record, body, _version = library.read(ident)
    ref = require_audio(record, local_fields(record, body))
    if FORMATS.get(ref.get('mime'), ('', ''))[0] != 'audio':
        raise ValueError('这条笔记没有已存原声。')
    _name, data = attachment(library, record, 'audio', ref)
    encoded = base64.b64encode(data).decode()
    # Keep each base64 part independently decodable and safely below the native frame limit.
    return {'mime': ref['mime'], 'parts': [encoded[i:i + 400000] for i in range(0, len(encoded), 400000)]}


def anki_fields(library, record, values, *, audio_required=False):
    fields = {'Audio': '', 'Image': ''}
    if audio_required:
        require_audio(record, values)
    entry = {**record['entry'], **values}
    media = {kind: ref for kind, ref in record.get('media', {}).items() if context_matches(record, ref, entry)}
    if 'audio' in media and 'video' in media and any(media['audio'].get(k) != media['video'].get(k) for k in ('start', 'end', 'origin')):
        del media['video']
    for kind, ref in media.items():
        name, data = attachment(library, record, kind, ref)
        actual = library.anki('storeMediaFile', {'filename': name, 'data': base64.b64encode(data).decode()})
        if actual != name:
            raise ValueError('Anki 未确认原附件名称。')
        if kind == 'image':
            fields['Image'] = f'<img src="{html.escape(name, quote=True)}">'
        elif kind == 'video' or 'video' not in media:
            # Anki plays a WebM clip from a sound tag; the clip already carries the audio.
            fields['Audio'] = f'[sound:{name}]'
    return fields
