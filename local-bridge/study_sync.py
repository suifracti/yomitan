#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Small, note-local manual favorite/card and two-way Anki sync helpers."""
import copy
import datetime
import hashlib
import html
import json
import re

SYNC_KEYS = ('sentence', 'meaning', 'translation', 'title', 'url')
BLOCK_START = '<!-- study-sync-fields:start -->'
BLOCK_END = '<!-- study-sync-fields:end -->'
BLOCK_RE = re.compile(re.escape(BLOCK_START) + r'\n(.*?)\n' + re.escape(BLOCK_END), re.S)
ANNOTATION = re.compile(r'<!-- study-sync-v1:(.*?) -->', re.S)


def _compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('>', '\\u003e')


def _record_cards(record):
    if record.get('cards'):
        return [{'id': c['id'], 'front': c['front'], 'back': c['back'], **({'kind': c['kind']} if c.get('kind') else {})} for c in record['cards']]
    if record.get('noteId'):
        legacy = record.get('legacyCard', {})
        entry = record['entry']
        back = legacy.get('back', '\n'.join(filter(None, (entry.get('meaning', ''), entry.get('translation', '')))))
        return [{'id': 'legacy', 'front': legacy.get('front', entry['word']), 'back': back}]
    return []


def _unquote(value):
    if value.strip() == '（未填写）': return ''
    value = '\n'.join(line[2:] if line.startswith('> ') else line for line in value.strip().splitlines())
    return html.unescape(re.sub(r'\\([\\`*_{}\[\]()#!|])', r'\1', value)).strip()


FIELD_LABELS = {'sentence':'原句', 'meaning':'本句含义', 'translation':'原句译文', 'title':'来源标题', 'url':'来源网址'}


def _read_block(content):
    if content.startswith('```study-sync-json\n'):
        return json.loads(content[len('```study-sync-json\n'):-len('\n```')])
    values = {}
    for key, label in FIELD_LABELS.items():
        match = re.search(r'^#### ' + label + r'\n\n(.*?)(?=^#### |^<!-- study-sync-card:|\Z)', content, re.M | re.S)
        if not match: raise ValueError('同步内容缺少“' + label + '”段落；未自动覆盖。')
        values[key] = _unquote(match[1])
    favorite = re.search(r'^#### 收藏\n\n(.*?)(?=^#### |^<!-- study-sync-card:|\Z)', content, re.M | re.S)
    if favorite:
        star = _unquote(favorite[1])
        if star not in ('是', '否'): raise ValueError('收藏请填写“是”或“否”。')
        values['favorite'] = star == '是'
    cards = []
    for match in re.finditer(r'<!-- study-sync-card:([a-f0-9]{32}|legacy) -->\n(.*?)(?=^<!-- study-sync-card:|\Z)', content, re.M | re.S):
        card = {'id': match[1]}
        for key, label in [('front','问题'), ('back','答案')]:
            text = re.search(r'^##### ' + label + r'\n\n(.*?)(?=^##### |\Z)', match[2], re.M | re.S)
            if not text: raise ValueError('复习卡缺少问题或答案段落。')
            card[key] = _unquote(text[1])
        cards.append(card)
    values['cards'] = cards
    return values


def local_fields(record, body):
    values = {k: record['entry'].get(k, '') for k in SYNC_KEYS}
    values['favorite'] = bool(record.get('favorite', False))
    values['mastery'] = record.get('mastery', '')
    cards = _record_cards(record)
    match = BLOCK_RE.search(body)
    if body.count(BLOCK_START) != (1 if match else 0) or body.count(BLOCK_END) != (1 if match else 0):
        raise ValueError('同步内容区域重复或不完整；未覆盖。')
    if match:
        parsed = _read_block(match[1])
        if not isinstance(parsed, dict) or set(parsed) - set(SYNC_KEYS) - {'cards','favorite'} or any(not isinstance(parsed.get(k), str) for k in SYNC_KEYS):
            raise ValueError('同步内容字段无效；未覆盖。')
        values.update({k: parsed[k] for k in SYNC_KEYS})
        values['favorite'] = parsed.get('favorite', values['favorite'])
        edited = parsed.get('cards', [])
        if not isinstance(edited, list): raise ValueError('复习卡内容无效。')
        by_id = {}
        for card in edited:
            if not isinstance(card, dict) or set(card) != {'id','front','back'} or not all(isinstance(card.get(k),str) for k in card) or card['id'] in by_id:
                raise ValueError('复习卡同步内容无效。')
            by_id[card['id']] = card
        if set(by_id) - {c['id'] for c in cards}: raise ValueError('发现未知复习卡；新增卡片请用“再加一张”。')
        for card in cards:
            if card['id'] in by_id: card.update(by_id[card['id']])
    values['cards'] = cards
    return values


def with_local_fields(body, values):
    from study_library import paragraph
    content = '### 同步内容\n\n修改下列内容会更新关联卡片；上方保留保存时的学习过程。\n\n'
    for key, label in FIELD_LABELS.items():
        content += '#### ' + label + '\n\n' + paragraph(values.get(key, '')) + '\n\n'
    content += '#### 收藏\n\n> ' + ('是' if values.get('favorite') else '否') + '\n\n'
    if values.get('mastery') in MASTERY_LABELS:
        content += '#### 掌握程度\n\n> ' + MASTERY_LABELS[values['mastery']] + '（制卡时自评；在这里修改不会同步）\n\n'
    for index, card in enumerate(values.get('cards', []), 1):
        kind = card.get('kind', '')
        label = ' · ' + KIND_LABELS[kind] + '（' + STAGE_NAMES[CARD_STAGES[kind]] + '）' if kind in KIND_LABELS and kind in CARD_STAGES else ''
        content += '<!-- study-sync-card:' + card['id'] + ' -->\n#### 复习卡 ' + str(index) + label + '\n\n'
        for key, label in [('front','问题'),('back','答案')]:
            content += '##### ' + label + '\n\n' + paragraph(card[key]) + '\n\n'
    block = BLOCK_START + '\n' + content.rstrip() + '\n' + BLOCK_END
    matches = list(BLOCK_RE.finditer(body))
    if len(matches) > 1 or body.count(BLOCK_START) != len(matches) or body.count(BLOCK_END) != len(matches):
        raise ValueError('同步内容区域不完整；未覆盖。')
    return body[:matches[0].start()] + block + body[matches[0].end():] if matches else body.rstrip() + '\n\n' + block + '\n'


def definition_field(answer, values):
    sections = [('answer', '', answer), ('meaning', '本句含义', values.get('meaning','')), ('translation','原句译文',values.get('translation',''))]
    return ''.join('<div data-study-sync="' + key + '">' + (label + '<br>' if label else '') + _field_html(value) + '</div>' for key,label,value in sections if value or key == 'answer')


def parse_definition(value, fallback):
    sections = {}
    for key, label in [('answer',''),('meaning','本句含义'),('translation','原句译文')]:
        match = re.search(r'<div\s+data-study-sync=[\"\x27]' + key + r'[\"\x27]\s*>(.*?)</div>', value or '', re.I | re.S)
        if match:
            text = _plain(match[1])
            if label and text.startswith(label): text = text[len(label):].lstrip('\n :：')
            sections[key] = text
    if not sections: return {'answer': _plain(value), **{k:fallback.get(k,'') for k in ('meaning','translation')}}
    return {'answer': sections.get('answer',''), **{k:sections.get(k,fallback.get(k,'')) for k in ('meaning','translation')}}


def _field_html(value):
    return html.escape(value or '').replace('\n', '<br>')


def _plain(value):
    value = re.sub(r'(?i)<br\s*/?>', '\n', value or '')
    value = re.sub(r'<!--.*?-->', '', value, flags=re.S)
    return html.unescape(re.sub(r'<[^>]*>', '', value)).strip()


def source_field(lib, record, values):
    source = _field_html(values.get('title', ''))
    source += '<br><a href="' + html.escape(lib.open_url(record['id']), quote=True) + '">学习过程笔记</a>'
    if 'videoTime' in record['entry']:
        source += f'<br>视频位置：{record["entry"]["videoTime"]} 秒'
    return source


def parse_source(value, fallback):
    match = ANNOTATION.search(value or '')
    meta = {}
    if match:
        try:
            meta = json.loads(match.group(1))
        except json.JSONDecodeError:
            raise ValueError('Anki 来源字段的同步标记损坏；未覆盖。') from None
        if not isinstance(meta, dict) or set(meta) != {'meaning', 'translation'} or any(not isinstance(v, str) for v in meta.values()):
            raise ValueError('Anki 来源字段的同步标记无效；未覆盖。')
    no_link = re.sub(r'(?is)<a\b[^>]*>.*?</a>', '', value or '')
    no_link = ANNOTATION.sub('', no_link)
    title = _plain(no_link).split('\n')[0]
    return {'title': title,
            'meaning': meta.get('meaning', fallback.get('meaning', '')),
            'translation': meta.get('translation', fallback.get('translation', ''))}


def default_card_kind(entry):
    return 'context' if entry.get('sentence','').strip().casefold() != entry.get('word','').strip().casefold() and entry.get('sentence') else 'meaning'


def card_target(lib, card):
    target = lib.target_details()
    decks = getattr(lib, 'deck_by_kind', {})
    active = getattr(lib, 'new_card_defaults', {})
    decks = active.get('deckByKind', decks)
    requested = card.get('deck') or decks.get(card.get('kind')) or active.get('deck') or lib.deck
    target['deck'] = requested
    target['targetId'] = lib.target_id
    return target


def _actual_deck(lib, note_info, fallback):
    ids = note_info.get('cards', []) if isinstance(note_info, dict) else []
    if not isinstance(ids, list) or not ids:
        return fallback
    info = lib.anki('cardsInfo', {'cards': ids})
    if not isinstance(info, list) or not info or any(not isinstance(x, dict) or not isinstance(x.get('deckName'), str) for x in info):
        raise ValueError('Anki 卡片牌组读回无效；没有移动卡片。')
    decks = {item['deckName'] for item in info}
    return next(iter(decks)) if len(decks) == 1 else '多个实际牌组'


def favorite(lib, p):
    if p.get('entry') and p['entry'].get('language', 'en') != lib.language:
        raise ValueError('收藏请求的语言与目的地不同。')
    ident = p.get('id') or __import__('study_library').entry_id(p['entry'])
    existing = True
    try:
        r, body, version = lib.read(ident)
    except FileNotFoundError:
        existing = False
        if not p.get('favorite') and p.get('entry'):
            # A cancelled offline favorite may never have reached this library. Acknowledge
            # the absent state without creating a placeholder note or touching Anki.
            return {'id': ident, 'entry': p['entry'], 'favorite': False,
                    'learningState': 'favorite-only', 'syncState': 'missing',
                    'version': '', 'path': '', 'openUrl': '', 'vaultSaved': False,
                    'ankiState': 'saved', 'noteId': None}
        if not p.get('favorite') or not p.get('entry'):
            raise ValueError('找不到要取消收藏的学习记录。') from None
        e = p['entry']
        if e.get('subtitleSource'):
            raise ValueError('字幕记录暂不支持收藏改写。')
        if e.get('language', lib.language) != lib.language:
            raise ValueError('语言与保存目的地不同。')
        grouped = lib.group_words
        heading = '###' if grouped else '##'
        r = {'id': ident, 'entry': e, 'ankiState': 'saved', 'noteId': None,
             'created': datetime.datetime.now().astimezone().isoformat(),
             'learningState': 'favorite-only'}
        if lib.target_id:
            r['targetId'] = lib.target_id
            r['savedTarget'] = lib.target_details()
        body = (f'\n## 语境 · {__import__("study_library").safe_markdown(e["title"] or e["sentence"][:80])}\n' if grouped
                else f'\n# {__import__("study_library").safe_markdown(e["word"])}\n')
        body += '\n[[' + str(lib.relative) + '/语境词库|语境词库]]\n\n'
        body += f'{heading} 原句\n\n{__import__("study_library").paragraph(e["sentence"])}\n\n'
        for label, key in [('含义（保存时的解释）','meaning'), ('译文','translation'), ('补充语境','context'), ('来源标题','title'), ('来源网址','url')]:
            if e.get(key): body += f'{heading} {label}\n\n{__import__("study_library").paragraph(e[key])}\n\n'
        body += f'{heading} 收藏\n\n仅收藏语境，尚未确认复习卡。\n'
    if r['entry'].get('subtitleSource'):
        raise ValueError('字幕记录暂不支持收藏改写。')
    if p.get('targetId') and r.get('targetId', lib.target_id) != p['targetId']:
        raise ValueError('记录目标与请求目标不同；未改投。')
    r['favorite'] = p['favorite']
    values = local_fields(r, body)
    values['favorite'] = p['favorite']
    body = with_local_fields(body, values)
    if not existing and p['favorite']:
        r['learningState'] = 'favorite-only'
    # Unstarring is metadata-only and never removes the note.
    lib.write(r, body, version if existing else None)
    return lib.result(ident)


def update(lib, p):
    r, body, version = lib.read(p['id'])
    proposed_word = p.get('entry', {}).get('word', r['entry']['word'])
    if proposed_word.casefold() != r['entry']['word'].casefold():
        raise ValueError('另一个单词必须保存为自己的学习记录；未替换原对象。')
    if r['entry'].get('subtitleSource'):
        raise ValueError('字幕记录暂不支持编辑。')
    if p.get('targetId') and r.get('targetId', lib.target_id) != p['targetId']:
        raise ValueError('记录目标与请求目标不同；未改投。')
    changes = {k: v for k, v in p.get('entry', {}).items() if v != r['entry'].get(k)}
    r['entry'].update(changes)
    if set(changes) & set(SYNC_KEYS):
        values = local_fields(r, body)
        values.update({k:r['entry'].get(k, '') for k in SYNC_KEYS if k in changes})
        body = with_local_fields(body, values)
    other_changes = {k:v for k,v in changes.items() if k not in SYNC_KEYS and v}
    if other_changes:
        body += '\n## 后续学习补充\n\n'
        for key, value in other_changes.items():
            body += key + '：\n\n' + __import__('study_library').paragraph(value) + '\n\n'
    seen = r.setdefault('turnIds', [])
    added_turn = False
    heading = '###' if lib.group_words else '##'
    for turn in p.get('turns', []):
        if turn['id'] in seen: continue
        seen.append(turn['id'])
        added_turn = True
        label = '理解反馈' if turn.get('kind') == 'feedback' else ('翻译过程' if turn.get('mode') == 'translate' else '学习过程')
        body += f'\n{heading} {label} · {__import__("study_library").safe_markdown(turn["at"])}\n\n轮次 ID：{__import__("study_library").safe_markdown(turn.get("relatedTurnId", turn["id"]))}\n\n'
        for title, key in [('我的问题','question'),('原句翻译','translation'),('这里的含义','meaning'),('学习记录','notes')]:
            if turn.get(key): body += f'{title}：\n\n{__import__("study_library").paragraph(turn[key])}\n\n'
        usage = turn.get('usage', {})
        if usage:
            body += '\n用量：' + ('缓存命中，本轮无模型调用' if usage.get('status') == 'cached' else str(usage.get('totalTokens', '未报告')) + ' tokens') + '\n'
        body += {'unconfirmed':'尚未确认理解','understood':'本人反馈：这次解释我懂了','unclear':'本人反馈：仍然不懂'}[turn['feedback']] + '\n'
    remember = p.get('remember', False)
    state_changed = remember and r.get('learningState') != 'saved'
    if changes or added_turn or state_changed:
        if remember or r.get('learningState') != 'favorite-only':
            r['learningState'] = 'saved'
        r['updated'] = datetime.datetime.now().astimezone().isoformat()
        lib.write(r, body, version)
    return lib.result(r['id'])


def add_cards(lib, p):
    if not lib.anki_enabled:
        raise ValueError('Anki 复习已关闭；笔记保留，未添加新卡。')
    r, body, version = lib.read(p['id'])
    if r['entry'].get('subtitleSource'):
        raise ValueError('字幕来源暂不支持 Anki 卡片。')
    if p.get('targetId') and r.get('targetId', lib.target_id) != p['targetId']:
        raise ValueError('记录目标与请求目标不同；未改投。')
    cards = r.setdefault('cards', [])
    if p.get('mastery') in MASTERY_LABELS and r.get('mastery') != p['mastery']:
        r['mastery'] = p['mastery']
        body += '\n## 掌握程度\n\n' + MASTERY_LABELS[p['mastery']] + '（制卡时自评，不代表已掌握）\n'
    for proposed in p['cards']:
        cid = hashlib.sha256((r['id'] + '\n' + proposed['front']).encode()).hexdigest()[:32]
        old = next((c for c in cards if c['id'] == cid), None)
        if old:
            if old['back'] != proposed['back']:
                raise ValueError('同一问题已有不同答案；请用冲突界面核对，未新增或覆盖。')
            continue
        kind = proposed.get('kind') or default_card_kind(r['entry'])
        if kind in AUDIO_KINDS and not r.get('media', {}).get('audio'):
            raise ValueError('这条记录尚未附带真实音频；请先附加原声，或选文字学习卡。')
        target = card_target(lib, {**proposed, 'kind': kind})
        card = {'id': cid, 'front': proposed['front'], 'back': proposed['back'], 'kind': kind,
                'state': 'pending', 'noteId': None, 'deck': target['deck'], 'target': target}
        cards.append(card)
        body += '\n## 已确认复习卡\n\n' + __import__('study_library').paragraph(card['front']) + '\n\n' + __import__('study_library').paragraph(card['back']) + '\n'
    r['ankiState'] = 'pending'
    r['learningState'] = 'saved'
    baseline = r.setdefault('syncBaseline', {})
    values = {k: r['entry'].get(k, '') for k in SYNC_KEYS}
    for key, value in values.items(): baseline.setdefault(key, value)
    for card in cards:
        baseline.setdefault('card.' + card['id'] + '.front', card['front'])
        baseline.setdefault('card.' + card['id'] + '.back', card['back'])
    body = with_local_fields(body, local_fields(r, body))
    lib.write(r, body, version)
    return lib.sync(r['id'])


def _merge(key, local, remote, baseline, resolutions, conflicts):
    if remote is None: return local, local
    if local == remote: return local, local
    choice = resolutions.get(key)
    if choice == 'local': return local, local
    if choice == 'remote': return remote, remote
    if baseline is None:
        if not any(item['key'] == key for item in conflicts): conflicts.append({'key':key, 'local':local, 'remote':remote})
        return local, local
    if local == baseline: return remote, remote
    if remote == baseline: return local, local
    if not any(item['key'] == key for item in conflicts): conflicts.append({'key':key, 'local':local, 'remote':remote})
    return local, baseline


def _note_values(lib, note_id, record, fields, review_only=False):
    info = lib.anki('notesInfo', {'notes':[note_id]})
    if not isinstance(info, list) or len(info) != 1 or info[0].get('noteId') != note_id:
        raise ValueError('Anki 笔记读回无效。')
    row = info[0]
    required = ('Word', 'Definition') if review_only else ('Word', 'Definition', 'Sentence', 'Source', 'URL')
    if any(not isinstance(row.get('fields', {}).get(key, {}).get('value'), str) for key in required):
        raise ValueError('关联卡的字段或模板已变化；未覆盖，请在学习设置中检查。')
    remote = {}
    for name in ('Sentence','Definition','Source','URL','Word'):
        obj = row.get('fields', {}).get(name, {})
        remote[name] = obj.get('value') if isinstance(obj, dict) else None
    return row, remote


def reconcile(lib, p):
    ident = p['id']
    r, body, version = lib.read(ident)
    if r['entry'].get('subtitleSource'):
        raise ValueError('字幕记录暂不支持与 Anki 双向同步。')
    if not r.get('cards') and not r.get('noteId'):
        return {**lib.result(ident), 'syncState':'local-only', 'conflicts':[]}
    if not lib.anki_enabled:
        return {**lib.result(ident), 'syncState':'paused', 'conflicts':[]}
    if any(not c.get('noteId') for c in r.get('cards', [])):
        synced = lib.sync(ident)
        r, body, version = lib.read(ident)
        if any(not c.get('noteId') for c in r.get('cards', [])):
            return {**synced, 'syncState':'paused', 'conflicts':[]}
    fields = local_fields(r, body)
    local_cards = {c['id']: c for c in fields.get('cards', [])}
    baseline = r.setdefault('syncBaseline', {})
    resolutions = p.get('resolutions', {})
    conflicts = []
    card_updates = []
    remote_by_card = {key: [] for key in SYNC_KEYS}
    cards = r.get('cards') or [{'id':'legacy', 'front':r['entry']['word'], 'back':'', 'noteId':r['noteId']}]
    for card in cards:
        note_id = card.get('noteId')
        tag = 'study_' + ident if card['id'] == 'legacy' else 'studycard_' + card['id']
        found = lib.anki('findNotes', {'query':'tag:' + tag})
        if card.get('linkedExisting') and note_id:
            found = [note_id]
        if not isinstance(found, list) or len(found) != 1 or (note_id and note_id not in found):
            r['ankiState'] = 'pending'
            r['syncState'] = 'missing'
            r['error'] = 'Anki 笔记缺失或关联不唯一；未重建。'
            lib.write(r, body, version)
            return {**lib.result(ident), 'conflicts':[]}
        note_id = found[0]
        review_only = card.get('linkedExisting') or (card['id'] == 'legacy' and r.get('linkedExisting'))
        card['reviewOnly'] = bool(review_only)
        row, raw = _note_values(lib, note_id, r, fields, review_only)
        actual_deck = _actual_deck(lib, row, (card.get('target') or {}).get('deck', card.get('deck', lib.deck)))
        if card['id'] != 'legacy':
            target = copy.deepcopy(card.get('target') or lib.target_details())
            target.update({'deck':actual_deck,'model':row.get('modelName',target.get('model',lib.model))})
            card['target'] = target
            card['deck'] = actual_deck
        title_meta = parse_source(raw.get('Source') or '', fields)
        explanation = parse_definition(raw.get('Definition') or '', title_meta)
        title_meta.update({k: explanation[k] for k in ('meaning','translation')})
        common = {'sentence': _plain(raw.get('Sentence') or ''), 'title':title_meta['title'], 'url':_plain(raw.get('URL') or ''),
                  'meaning':title_meta['meaning'], 'translation':title_meta['translation']}
        review_only = card.get('linkedExisting') or (card['id'] == 'legacy' and r.get('linkedExisting'))
        card['reviewOnly'] = bool(review_only)
        if not review_only:
            for key, value in common.items():
                remote_by_card[key].append((card, value))
        local_card = local_cards.get(card['id'], {'front':card['front'], 'back':card.get('back', '')})
        front = _plain(raw.get('Word') or '')
        back = explanation['answer']
        card_updates.append((card, note_id, raw, common, front, back, actual_deck, local_card))
    merged = dict(fields)
    base_after = dict(baseline)
    for key in SYNC_KEYS:
        values = remote_by_card[key]
        if not values: continue
        if len({value for _, value in values}) == 1:
            value, base = _merge(key, fields.get(key,''), values[0][1], baseline.get(key), resolutions, conflicts)
            merged[key] = value
            base_after[key] = base
        else:
            base = baseline.get(key)
            edits = {remote for card, remote in values if remote != baseline.get(key + ':' + card['id'], base)}
            if base is not None and len(edits) <= 1:
                effective = next(iter(edits)) if edits else base
                merged[key], base_after[key] = _merge(key, fields.get(key,''), effective, base, resolutions, conflicts)
            elif resolutions.get(key) == 'local':
                merged[key] = fields.get(key,'')
                base_after[key] = merged[key]
            else:
                choices = []
                for card, remote in values:
                    card_key = key + ':' + card['id']
                    choice = resolutions.get(card_key)
                    if not choice:
                        conflicts.append({'key':card_key,'local':fields.get(key,''),'remote':remote})
                    choices.append(fields.get(key,'') if choice == 'local' else remote)
                remote_choices = {remote for card, remote in values if resolutions.get(key + ':' + card['id']) == 'remote'}
                complete = all(key + ':' + c['id'] in resolutions for c,_ in values)
                if complete and len(remote_choices) <= 1:
                    merged[key] = next(iter(remote_choices)) if remote_choices else fields.get(key,'')
                    base_after[key] = merged[key]
                elif complete:
                    for card, remote in values:
                        conflicts.append({'key': key + ':' + card['id'], 'local': fields.get(key,''), 'remote': remote})
    merged_cards = {}
    for card, note_id, raw, common, front, back, actual_deck, local_card in card_updates:
        for key, local, remote in [('front', local_card['front'], front), ('back', local_card['back'], back)]:
            baseline_key = 'card.' + card['id'] + '.' + key
            value, base = _merge(baseline_key, local, remote, baseline.get(baseline_key), resolutions, conflicts)
            merged_cards[(card['id'], key)] = value
            base_after[baseline_key] = base
    if conflicts:
        r['syncState'] = 'conflict'
        lib.write(r, body, version)
        return {**lib.result(ident), 'syncState':'conflict', 'conflicts':conflicts}
    # Update all linked Anki notes only after every conflict has a user choice.
    for card, note_id, raw, common, front, back, actual_deck, local_card in card_updates:
        wanted = {'Word':_field_html(merged_cards[(card['id'], 'front')]),
                  'Definition':definition_field(merged_cards[(card['id'], 'back')], common if card.get('reviewOnly') else merged),
                  'Sentence':_field_html(merged['sentence']),
                  'Source':source_field(lib, r, merged), 'URL':html.escape(merged['url'])}
        if card.get('reviewOnly'):
            wanted = {k:v for k,v in wanted.items() if k in ('Word', 'Definition')}
        changed = {k:v for k,v in wanted.items() if raw.get(k) != v}
        if changed:
            lib.anki('updateNoteFields', {'note':{'id':note_id,'fields':changed}})
            row, raw_after = _note_values(lib, note_id, r, merged, card.get('reviewOnly', False))
            if any(raw_after.get(k) != v for k,v in changed.items()):
                raise ValueError('Anki 编辑后读回不同；已保留 Obsidian 记录供人工核对。')
        card['noteId'] = note_id
        if card['id'] == 'legacy':
            r['legacyCard'] = {'front':merged_cards[(card['id'], 'front')], 'back':merged_cards[(card['id'], 'back')]}
        else:
            card['front'] = merged_cards[(card['id'], 'front')]
            card['back'] = merged_cards[(card['id'], 'back')]
            card['state'] = 'synced'
            target = copy.deepcopy(card.get('target') or lib.target_details())
            target.update({'deck':actual_deck,'model':row.get('modelName',target.get('model',lib.model))})
            card['target'] = target
            card['deck'] = actual_deck
    r['favorite'] = merged.get('favorite', r.get('favorite', False))
    for key in SYNC_KEYS:
        r['entry'][key] = merged[key]
    merged['cards'] = [{'id':card_id, 'front':merged_cards[(card_id, 'front')], 'back':merged_cards[(card_id, 'back')]}
                       for card_id in local_cards if (card_id, 'front') in merged_cards]
    baseline.clear(); baseline.update(base_after)
    body = with_local_fields(body, merged)
    r['syncState'] = 'synced'
    if r.get('cards'): r['ankiState'] = 'synced' if all(c.get('state') == 'synced' for c in r['cards']) else 'pending'
    lib.write(r, body, version)
    return {**lib.result(ident), 'syncState':'synced', 'conflicts':[]}


def handle(lib, p):
    action = p['action']
    if action == 'libraryFavorite': return favorite(lib, p)
    if action == 'libraryUpdate': return update(lib, p)
    if action == 'libraryCardsAdd': return add_cards(lib, p)
    if action == 'libraryReconcile':
        try:
            return reconcile(lib, p)
        except (OSError, TimeoutError):
            return {**lib.result(p['id']), 'syncState':'pending', 'conflicts':[], 'error':'Anki 未连接；更新仍待同步。'}
    raise ValueError('不支持的同步操作。')


def comparable_field(key, value):
    return parse_definition(value, {})['answer'] if key == 'Definition' else value


def require_deck(lib, deck):
    decks = lib.anki('deckNames', {})
    if not isinstance(decks, list) or deck not in decks:
        raise ValueError('目标牌组不存在；请在学习与保存设置中明确创建，不自动补建。')


# Learning stage of each card kind: 1 recognise, 2 understand in context, 3 use.
CARD_STAGES = {'meaning': 1, 'listen-meaning': 1, 'form-recognize': 1,
               'context': 2, 'sentence': 2, 'listening': 2, 'grammar': 2,
               'produce': 3, 'cloze': 3, 'form-produce': 3, 'make-sentence': 3, 'expression': 3, 'spelling': 3}
AUDIO_KINDS = ('listening', 'listen-meaning', 'spelling')
STAGE_NAMES = {1: '① 认得', 2: '② 理解', 3: '③ 会用'}
KIND_LABELS = {'meaning': '单词→中文义', 'listen-meaning': '听原声→意思', 'form-recognize': '词形识别',
               'context': '原句中的意思', 'sentence': '句子英→中', 'listening': '视频声音字幕', 'grammar': '语法',
               'produce': '中→英', 'cloze': '挖空填词', 'form-produce': '词形变化', 'make-sentence': '用词造句',
               'expression': '搭配/表达', 'spelling': '听音拼写'}
MASTERY_LABELS = {'none': '完全不会', 'vague': '有印象/模糊', 'known': '认识但不会用'}


def card_tags(record, kind):
    entry = record['entry']
    source = 'subtitles' if entry.get('subtitleSource') else 'video' if entry.get('videoTime') is not None else 'web' if entry.get('url') else 'dictionary'
    tags = ['study_kind::' + kind, 'study_source::' + source] + ['study_media::' + key for key in ('audio','image') if record.get('media', {}).get(key)]
    if kind in CARD_STAGES:
        tags.append('study_stage::' + str(CARD_STAGES[kind]))
    if record.get('mastery') in MASTERY_LABELS:
        tags.append('study_mastery::' + record['mastery'])
    return tags


def schedule_new_card(lib, record, card, note_info):
    """A learner who already recognises the word sees stage-1 cards a few days later.

    Only cards created in this request are touched; existing schedules never change.
    """
    if record.get('mastery') != 'known' or CARD_STAGES.get(card.get('kind')) != 1:
        return None
    cards = note_info.get('cards', []) if isinstance(note_info, dict) else []
    if not isinstance(cards, list) or not cards:
        return None
    try:
        lib.anki('setDueDate', {'cards': cards, 'days': '3-7'})
        return '已按“认识但不会用”延后 3–7 天'
    except Exception:
        return '卡片已建好；延后排程未成功，可在 Anki 里手动调整'
