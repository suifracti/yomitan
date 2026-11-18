#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Sense-aware summaries and explicit learner difficulty events; no automatic cards."""
import json
import pathlib
import re
import time

from study_library import entry_id, entry_lemma as canonical, paragraph, text, source_url
from study_cards import CARD_STAGES, card_receipts
from study_sources import with_article_href

MISS_KINDS = ('newSense', 'collocation', 'structure', 'recall')
MATURE = {'familiar', 'known'}
MATURE_DAYS = 21
MONTH = 30 * 86400


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
    notes = {str(n): [] for n in ids}
    all_cards = {}
    owned_notes = set(ids)
    try:
        cards = anki('findCards', {'query': 'nid:' + ','.join(str(n) for n in ids)})
        # mod is in whole seconds. A card edited during the last snapshot needs one fresh read.
        cached = {c['id']: (n, c) for n, rows in old.get('notes', {}).items() if n in notes for c in rows
                  if type(c.get('mod')) is int and c['mod'] < int(old.get('at', 0))}
        eligible = [c for c in cards if c in cached]
        for offset in range(0, len(eligible), 1000):
            try:
                times = anki('cardsModTime', {'cards': eligible[offset:offset + 1000]})
            except ValueError:  # Older AnkiConnect: read the details as before.
                break
            for stamp in times:
                ident = stamp.get('cardId')
                if ident in cached and cached[ident][1]['mod'] == stamp.get('mod'):
                    n, row = cached[ident]
                    all_cards[ident] = n
                    notes[n].append(row)
        changed = [c for c in cards if c not in all_cards]
        seen = set(all_cards)
        for offset in range(0, len(changed), 100):
            info = anki('cardsInfo', {'cards': changed[offset:offset + 100]})
            if not isinstance(info, list):
                raise ValueError('复习阶段读取未完成。')
            for row in info:
                ident, note_id = row.get('cardId'), row.get('note')
                iv, lapses = row.get('interval'), row.get('lapses')
                if type(note_id) is int and type(iv) in (int, float) and type(lapses) is int and lapses >= 0:
                    seen.add(ident)
                    if note_id in owned_notes:
                        all_cards[ident] = str(note_id)
                        card = {'id': ident, 'iv': max(0, iv), 'lapses': lapses}
                        if type(row.get('mod')) is int:
                            card['mod'] = row['mod']
                        notes[str(note_id)].append(card)
        # Documented Anki search: Again within the last 30 days, not lifetime lapse totals.
        again = anki('findCards', {'query': '(tag:english_study OR tag:japanese_study) rated:30:1'})
        if not isinstance(again, list):
            raise ValueError('最近复习记录读取未完成。')
        incomplete = list(notes) if len(seen) != len(cards) else []
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


def upgrade_words(anki, records, snapshot):
    mature = {int(n) for n, cards in snapshot['notes'].items() if any(c['iv'] >= MATURE_DAYS for c in cards)}
    ready, legacy = set(), {}
    for ident, (_, _, row) in records.items():
        if row.get('syncState') == 'conflict' or any(CARD_STAGES.get(c.get('kind')) == 3 for c in row.get('cards', [])):
            continue
        for n, stage in card_receipts(row):
            if n in mature:
                if stage in (1, 2):
                    ready.add(ident)
                elif not stage:
                    legacy.setdefault(n, []).append(ident)
    if legacy:
        query = 'nid:' + ','.join(map(str, legacy)) + ' (tag:study_stage::1 OR tag:study_stage::2)'
        for n in anki('findNotes', {'query': query}):
            ready.update(legacy[n])
    return [{'id': i, 'word': records[i][2]['entry']['word']} for i in sorted(ready)[:200]]


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
    elif not cards or not complete or min(c['iv'] for c in cards.values()) < MATURE_DAYS:
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


def word_aliases(entries):
    """Only join spellings that the learner's entries actually linked to a lemma."""
    aliases, heads = {}, set()
    for entry in entries:
        if entry.get('kind') in ('expression', 'sentence'):
            continue
        form, head = entry['word'].casefold(), canonical(entry)
        heads.add(head)
        aliases[form] = head if aliases.get(form, head) == head else None
    aliases.update((head, head) for head in heads)
    return aliases


def word_rows(library, word):
    rows = [row for _, _, row in library.indexed()[1].values() if row['entry'].get('kind') != 'sentence']
    aliases = word_aliases(row['entry'] for row in rows)
    key = aliases.get(word.casefold()) or word.casefold()
    forms = {form for form, lemma in aliases.items() if lemma == key} | {key}
    return [row for row in rows if canonical(row['entry']) == key or
            (row['entry'].get('kind') == 'expression' and row['entry'].get('baseWord', '').casefold() in forms)]


def practice_pair(rows, word):
    head = word_aliases(row['entry'] for row in rows).get(word.strip().casefold())
    if not head:
        return []
    by_sentence = {}
    for row in sorted(rows, key=lambda r: r['created'], reverse=True):
        e = row['entry']
        if e.get('kind') in ('expression', 'sentence') or canonical(e) != head or not e.get('sense'):
            continue
        sentence = ' '.join(e.get('sentence', '').casefold().split())
        if (' ' not in sentence or not gloss(e) or
                not re.search(r'(?<!\w)' + re.escape(e['word']) + r'(?!\w)', e['sentence'], re.I)):
            continue
        by_sentence.setdefault(sentence, {}).setdefault(sense_key(e), row)
    pair, seen_senses, seen_glosses = [], set(), set()
    for senses in by_sentence.values():
        if len(senses) != 1:
            continue  # The learner saved more than one reading of this exact sentence.
        row = next(iter(senses.values()))
        e = row['entry']
        key, short = sense_key(e), gloss(e)
        if key in seen_senses or short in seen_glosses:
            continue
        seen_senses.add(key)
        seen_glosses.add(short)
        fields = ('word', 'sentence', 'sense', 'context', 'url', 'title', 'videoTime', 'language')
        pair.append(with_article_href({'id': row['id'], 'entry': {k: e[k] for k in fields if k in e}}))
        if len(pair) == 2:
            return pair
    return []


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


def known_words(library, patch=None):
    import fcntl
    import os
    import tempfile
    path = pathlib.Path(library.config_path).parent / 'known-words.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        values = json.loads(path.read_text()) if path.exists() else {'known': [], 'ignored': []}
        if patch and any(key in patch for key in ('known', 'ignored')):
            for key in ('known', 'ignored'):
                change = patch.get(key, {})
                current = set(values[key]) - set(change.get('remove', []))
                current.update(change.get('add', []))
                values[key] = sorted(current)
                other = 'ignored' if key == 'known' else 'known'
                values[other] = sorted(set(values[other]) - set(change.get('add', [])))
            fd, name = tempfile.mkstemp(prefix='.known-words-', dir=path.parent)
            try:
                with os.fdopen(fd, 'w') as stream: json.dump(values, stream, ensure_ascii=False)
                os.replace(name, path)
            finally:
                if os.path.exists(name): os.unlink(name)
        return values


def mark_known(library, word, known):
    records = list(library.indexed()[1].values())
    wanted = word.strip().casefold()
    aliases = word_aliases(row['entry'] for _, _, row in records)
    head = aliases.get(wanted) or wanted
    forms = sorted({form for form, lemma in aliases.items() if lemma == head} | {wanted})
    updated = set()
    for lib, path, row in records:
        if row['entry'].get('kind') == 'sentence' or canonical(row['entry']) != head or path in updated:
            continue
        record, body, version = lib.read(row['id'])
        if re.search(r'--w[a-f0-9]{32}\.md$', path.name):
            lib.write(record, body, expected=version, word_known=known)
        else:
            record['manualKnown'] = known
            lib.write(record, body, expected=version)
        updated.add(path)
    # Remove old per-spelling marks on this explicit change, not when reading/opening a page.
    known_words(library, {'known': {'add': [head] if known else [], 'remove': forms},
                          **({'ignored': {'remove': forms}} if known else {})})
    return {'word': word, 'manualKnown': known, 'updated': len(updated)}


def word_status(library, now=None):
    now = time.time() if now is None else now
    snapshot, by_word, phrases = metrics(library), {}, {}
    for _lib, _path, row in library.indexed()[1].values():
        entry = row['entry']
        if entry.get('kind') == 'sentence':
            continue
        if entry.get('kind') == 'expression':
            phrases.setdefault(entry['word'].casefold(), []).append(row)
        else:
            by_word.setdefault(canonical(entry), []).append(row)
    words, phrase_values = {}, {}
    aliases = word_aliases(r['entry'] for rows in by_word.values() for r in rows)
    for head, rows in by_word.items():
        meanings = list(groups(rows).values())
        states = [status_for(contexts, snapshot, now)[0] for contexts in meanings]
        state = 'partial' if any(s in MATURE for s in states) and any(s not in MATURE for s in states) else (
            'known' if 'known' in states and all(s in MATURE for s in states) else 'shaky' if 'shaky' in states else
            'new' if all(s == 'new' for s in states) else 'familiar' if all(s in MATURE for s in states) else 'learning')
        manual = any(r.get('manualKnown') is True for r in rows)
        display_rows = rows
        if state == 'partial':
            display_rows = [r for _, contexts in sorted(zip(states, meanings), key=lambda pair: pair[0] in MATURE) for r in contexts]
        value = {'s': 'known' if manual else state, 'manualKnown': manual, **status_for(rows, snapshot, now)[1], 'senses': len(meanings),
                 'gloss': '；'.join(dict.fromkeys(short for r in display_rows if (short := gloss(r['entry']))))[:40]}
        if any(e.get('kind') == 'newSense' for r in rows for e in r.get('contextMiss', [])):
            value['newSense'] = True
        words[head] = value
    for form, head in aliases.items():
        if head and form != head:
            words[head]['lemma'] = head
            words[form] = words[head]
    for word, rows in phrases.items():
        phrase_values[word] = {'s': 'known' if any(r.get('manualKnown') for r in rows) else status_for(rows, snapshot, now)[0],
                               'manualKnown': any(r.get('manualKnown') for r in rows), 'gloss': gloss(rows[0]['entry'])}
    manual = known_words(library)
    for word in manual['known']:
        words.setdefault(word, {}).update(s='known', manualKnown=True)
    for word in manual['ignored']:
        words.setdefault(word, {}).update(s='ignored')
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
