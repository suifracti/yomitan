#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Sense-aware summaries and explicit learner difficulty events; no automatic cards."""
import json
import pathlib
import re
import time

from study_library import entry_id, paragraph, text, source_url
from study_sync import CARD_STAGES

MISS_KINDS = ('newSense', 'collocation', 'structure', 'recall')
MATURE = {'familiar', 'known'}
MONTH = 30 * 86400


def canonical(entry):
    return (entry.get('lemma') or entry['word']).strip().casefold()


def sense_key(entry):
    return entry.get('sense', {}).get('key') or canonical(entry) + '#1'


def gloss(entry):
    value = entry.get('sense', {}).get('gloss') or entry.get('meaning', '')
    value = re.sub(r'^词典简释[^：]*：|^本句含义[：:]?', '', value).strip().split('\n')[0]
    # Hover payloads never include an English sentence or a note/source excerpt.
    if not re.search(r'[\u3400-\u9fff]', value) or re.search(r'https?://|[。！？!?]', value):
        return ''
    return value[:40]


def normalize_action(p):
    action = p['action']
    if action == 'libraryWordSenses' and set(p) <= {'action', 'word'}:
        return {**p, 'word': text(p.get('word'), 128, True)}
    allowed = {'action', 'word', 'lemma', 'kind', 'senseKey', 'sentence', 'url', 'videoTime'}
    if action != 'libraryContextMiss' or set(p) - allowed or not {'word', 'kind'} <= set(p) or p['kind'] not in MISS_KINDS:
        raise ValueError('义项或卡点请求无效。')
    result = {**p, 'word': text(p['word'], 128, True)}
    for key, limit in [('lemma', 128), ('senseKey', 180), ('sentence', 2400)]:
        if key in p:
            result[key] = text(p[key], limit)
    if 'url' in p:
        result['url'] = source_url(p['url'])
    if 'videoTime' in p and (isinstance(p['videoTime'], bool) or not isinstance(p['videoTime'], (int, float)) or not 0 <= p['videoTime'] <= 604800):
        raise ValueError('视频时间无效。')
    return result


def note_ids(record):
    return {n for n in [record.get('noteId'), *[c.get('noteId') for c in record.get('cards', []) if c.get('state') != 'missing']] if type(n) is int}


def refresh_metrics(anki, records, old, now):
    """Called only by the existing auto-sync pass. Failed reads retain the prior snapshot."""
    ids = sorted({n for _lib, _path, row in records.values() for n in note_ids(row)})
    if not ids:
        return {'notes': {}, 'again': [], 'at': now}
    notes, all_cards = {}, {}
    owned_notes = set(ids)
    try:
        for offset in range(0, len(ids), 100):
            info = anki('notesInfo', {'notes': ids[offset:offset + 100]})
            if not isinstance(info, list):
                raise ValueError('复习关联读取未完成。')
            for row in info:
                ident = row.get('noteId')
                if ident in owned_notes and isinstance(row.get('cards'), list):
                    notes[str(ident)] = []
                    for card in row['cards']:
                        if type(card) is int:
                            all_cards[card] = str(ident)
        cards = sorted(all_cards)
        for offset in range(0, len(cards), 100):
            info = anki('cardsInfo', {'cards': cards[offset:offset + 100]})
            if not isinstance(info, list):
                raise ValueError('复习阶段读取未完成。')
            for row in info:
                ident = row.get('cardId')
                iv, lapses = row.get('interval'), row.get('lapses')
                if ident in all_cards and type(iv) in (int, float) and type(lapses) is int and lapses >= 0:
                    notes[all_cards[ident]].append({'id': ident, 'iv': max(0, iv), 'lapses': lapses})
        # Documented Anki search: Again within the last 30 days, not lifetime lapse totals.
        again = anki('findCards', {'query': '(tag:english_study OR tag:japanese_study) rated:30:1'})
        if not isinstance(again, list):
            raise ValueError('最近复习记录读取未完成。')
        from collections import Counter
        counts = Counter(all_cards.values())
        incomplete = [n for n, values in notes.items() if len(values) != counts[n]]
        return {'notes': notes, 'incomplete': incomplete, 'again': [c for c in again if c in all_cards], 'at': now}
    except Exception:
        return old


def metrics(library):
    try:
        path = pathlib.Path(library.cache_dir) / 'auto-sync-state.json'
        state = json.loads(path.read_text())
        value = state.get('mastery', {}) if isinstance(state, dict) else {}
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def status_for(records, snapshot, now):
    cards = {c['id']: c for row in records for n in note_ids(row) for c in snapshot.get('notes', {}).get(str(n), [])}
    have_cards = any(row.get('cards') or row.get('noteId') for row in records)
    recent = snapshot.get('again', []) if now - snapshot.get('at', 0) <= MONTH else []
    missed = any(e.get('kind') == 'recall' and now - e.get('at', 0) < MONTH
                 for row in records for e in row.get('contextMiss', []))
    known_notes = snapshot.get('notes', {})
    complete = all(known_notes.get(str(n)) and str(n) not in snapshot.get('incomplete', []) for row in records for n in note_ids(row)) and all(
        type(c.get('noteId')) is int for row in records for c in row.get('cards', []) if c.get('state') != 'missing')
    if missed or any(ident in recent for ident in cards):
        state = 'shaky'
    elif not have_cards:
        state = 'new'
    elif not cards or not complete or min(c['iv'] for c in cards.values()) < 21:
        state = 'learning'
    else:
        stage3 = any(CARD_STAGES.get(c.get('kind')) == 3 for row in records for c in row.get('cards', []))
        state = 'known' if stage3 else 'familiar'
    stats = {'iv': min(c['iv'] for c in cards.values()), 'lapses': sum(c['lapses'] for c in cards.values())} if cards and complete else {}
    return state, stats


def groups(records):
    result = {}
    for row in records:
        result.setdefault(sense_key(row['entry']), []).append(row)
    return result


def word_rows(library, word):
    key = word.casefold()
    return [row for _lib, _path, row in library.indexed()[1].values()
            if key in {canonical(row['entry']), row['entry']['word'].casefold(), row['entry'].get('baseWord', '').casefold()}]


def senses(library, word, now=None):
    now = time.time() if now is None else now
    rows, snapshot = word_rows(library, word), metrics(library)
    ordinary = [r for r in rows if r['entry'].get('kind') != 'expression']
    result, phrases = [], []
    for key, contexts in groups(ordinary).items():
        state, _stats = status_for(contexts, snapshot, now)
        result.append({'key': key, 'gloss': next((gloss(r['entry']) for r in contexts if gloss(r['entry'])), ''),
                       's': state, 'contexts': len(contexts), 'cards': sum(len(r.get('cards', [])) + bool(r.get('noteId')) for r in contexts),
                       'recordIds': [r['id'] for r in contexts]})
    for row in rows:
        if row['entry'].get('kind') == 'expression':
            phrases.append({'text': row['entry']['word'], 'gloss': gloss(row['entry']),
                            's': status_for([row], snapshot, now)[0], 'recordId': row['id']})
    return {'senses': result, 'phrases': phrases,
            'misses': {kind: sum(e.get('kind') == kind for r in rows for e in r.get('contextMiss', [])) for kind in MISS_KINDS}}


def word_status(library, now=None):
    now = time.time() if now is None else now
    snapshot, by_word, phrases = metrics(library), {}, {}
    for _lib, _path, row in library.indexed()[1].values():
        entry = row['entry']
        if entry.get('kind') == 'expression':
            phrases.setdefault(entry['word'].casefold(), []).append(row)
        else:
            by_word.setdefault(canonical(entry), []).append(row)
    words, phrase_values = {}, {}
    for _key, rows in by_word.items():
        states = [status_for(contexts, snapshot, now)[0] for contexts in groups(rows).values()]
        state = 'partial' if any(s in MATURE for s in states) and any(s not in MATURE for s in states) else (
            'known' if 'known' in states and all(s in MATURE for s in states) else 'shaky' if 'shaky' in states else
            'new' if all(s == 'new' for s in states) else 'familiar' if all(s in MATURE for s in states) else 'learning')
        value = {'s': state, **status_for(rows, snapshot, now)[1], 'senses': len(groups(rows)),
                 'gloss': '；'.join(dict.fromkeys(gloss(r['entry']) for r in rows if gloss(r['entry'])))[:40]}
        if any(e.get('kind') == 'newSense' for r in rows for e in r.get('contextMiss', [])):
            value['newSense'] = True
        for row in rows:
            for alias in {row['entry']['word'].casefold(), canonical(row['entry'])}:
                words[alias] = value
    for word, rows in phrases.items():
        phrase_values[word] = {'s': status_for(rows, snapshot, now)[0], 'gloss': gloss(rows[0]['entry'])}
    return {'version': 2, 'words': words, 'phrases': phrase_values}


def assign_entry(library, entry):
    requested = entry.get('sense')
    if not requested:
        return entry
    rows = word_rows(library, canonical(entry))
    base = lambda e: entry_id({k: v for k, v in e.items() if k != 'sense'})
    old = next((row for row in rows if base(row['entry']) == base(entry) and
                row['entry'].get('sense', {}).get('gloss') == requested['gloss']), None)
    key = requested['key']
    if key == 'new':
        key = old['entry']['sense']['key'] if old and old['entry'].get('sense') else None
        if not key:
            used = {sense_key(row['entry']) for row in rows if row['entry'].get('kind') != 'expression'}
            n = 2  # #1 stays reserved for unclassified legacy/ordinary contexts.
            while canonical(entry) + '#' + str(n) in used:
                n += 1
            key = canonical(entry) + '#' + str(n)
    elif not any(sense_key(row['entry']) == key for row in rows):
        raise ValueError('义项编号尚不存在；新意思请选 new。')
    return {**entry, 'sense': {'key': key, 'gloss': requested['gloss']}}


def add_miss(library, p, now=None):
    now = time.time() if now is None else now
    rows = word_rows(library, p.get('lemma') or p['word'])
    rows = [row for row in rows if row['entry'].get('kind') != 'expression' and
            (not p.get('senseKey') or sense_key(row['entry']) == p['senseKey'])]
    if not rows:
        raise ValueError('请先保存这个词或选择已有义项，再记录卡点；未另建笔记。')
    row = next((r for r in rows if r['entry']['sentence'] == p.get('sentence') and r['entry']['url'] == p.get('url')), rows[0])
    lib = library.locate(row['id'])
    with lib.locked():
        record, body, version = lib.read(row['id'])
        event = {'at': now, 'kind': p['kind'], 'recordId': row['id'], 'senseKey': p.get('senseKey') or sense_key(row['entry'])}
        record.setdefault('contextMiss', []).append(event)
        body += '\n### 语境卡点\n\n' + paragraph(p['kind'] + ' · ' + event['senseKey']) + '\n'
        lib.write(record, body, version)
    return {'ok': True}


def normalize_match(p):
    from study_translator import normalize_config
    if set(p) != {'action', 'word', 'sentence', 'contextMeaning', 'config'}:
        raise ValueError('义项比对只接受明确选择的词、句子和模型设置。')
    return {**p, 'word': text(p['word'], 128, True), 'sentence': text(p['sentence'], 2400, True),
            'contextMeaning': text(p['contextMeaning'], 5000), 'config': normalize_config(p['config'])}


def validate_match(result, candidates):
    import math
    if (not isinstance(result, dict) or set(result) != {'match', 'confidence'} or
            not isinstance(result['match'], str) or result['match'] not in {'new', *[s['key'] for s in candidates]} or
            type(result['confidence']) not in (int, float) or not math.isfinite(result['confidence']) or
            not 0 <= result['confidence'] <= 1):
        raise ValueError('义项比对没有返回有效的已有义项或 new。')
    return result


def match_sense(library, request, translate):
    import hashlib
    import os
    import tempfile
    candidates = [{'key': s['key'], 'gloss': s['gloss']} for s in senses(library, request['word'])['senses']][:100]
    if not candidates:
        return {'match': 'new', 'confidence': 1}
    payload = {**request, 'senses': candidates}
    signature = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    key = hashlib.sha256(json.dumps([request['word'].casefold(), request['sentence']], ensure_ascii=False).encode()).hexdigest()
    path = pathlib.Path(library.cache_dir) / 'sense-match.json'
    try:
        cache = json.loads(path.read_text())
    except (OSError, ValueError):
        cache = {}
    cache = cache if isinstance(cache, dict) else {}
    cached = cache.get(key, {})
    if cached.get('signature') == signature and time.time() - cached.get('at', 0) < MONTH:
        return validate_match(cached['result'], candidates)
    result = validate_match(translate(payload), candidates)
    cache[key] = {'signature': signature, 'at': time.time(), 'result': result}
    cache = dict(sorted(cache.items(), key=lambda item: item[1]['at'])[-1000:])
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.sense-match-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(cache, stream, ensure_ascii=False)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    return result
