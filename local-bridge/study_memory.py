#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded, rebuildable local evidence. No model, vector service or background daemon."""
import hashlib
import html
import json
import pathlib
import re
import sqlite3
import time
import unicodedata


def plain(value):
    return ' '.join(unicodedata.normalize('NFKC', html.unescape(re.sub('<[^>]+>', ' ', str(value)))).split())


def norm(value):
    return plain(value).casefold()


def point_id(lib, entry, front, back):
    # Exact knowledge identity, NOT semantic equivalence. Context is evidence, not identity.
    values = [lib.language, norm(entry.get('lemma') or entry['word']), norm(front), norm(back)]
    if lib.language == 'ja': values.append(norm(entry.get('reading', '')))
    return hashlib.sha256(json.dumps(values, ensure_ascii=False).encode()).hexdigest()[:32]


def quote(value):
    # Literal Anki search term, not a caller-controlled query/operator.
    return '"' + re.sub(r'([\\"*_:])', r'\\\1', value) + '"'


def scope(lib):
    return '("note:' + lib.model + '" or "deck:' + lib.deck + '")'


class MemoryIndex:
    def __init__(self, lib):
        self.lib = lib
        path = ':memory:'
        if lib.cache_dir is not None:
            directory = pathlib.Path(lib.cache_dir)
            if any(p.is_symlink() for p in [directory, *directory.parents]):
                raise ValueError('学习缓存路径异常。')
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            key = hashlib.sha256((str(lib.vault) + '\n' + lib.language).encode()).hexdigest()[:20]
            path = directory / ('learning-' + key + '.sqlite3')
            if path.is_symlink(): raise ValueError('学习索引路径异常。')
        self.db = sqlite3.connect(path, timeout=0.15)
        if path != ':memory:': path.chmod(0o600)
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, path TEXT, stamp TEXT, word TEXT, lemma TEXT, content TEXT, updated TEXT);
            CREATE INDEX IF NOT EXISTS record_word ON records(word);
            CREATE INDEX IF NOT EXISTS record_lemma ON records(lemma);
            CREATE TABLE IF NOT EXISTS anki(query TEXT PRIMARY KEY, at REAL, data TEXT);
            CREATE TABLE IF NOT EXISTS progress(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS points(record TEXT, point TEXT, note INTEGER, PRIMARY KEY(record,point,note));
            CREATE INDEX IF NOT EXISTS point_key ON points(point);
        ''')

        if not self.db.execute("SELECT value FROM progress WHERE key='pointsSchema'").fetchone():
            # Rebuild old associations incrementally; do not assume the new empty table is complete.
            self.db.execute("UPDATE records SET stamp=''")
            self.db.execute("INSERT OR REPLACE INTO progress VALUES('pointsSchema','1')")
            self.db.execute("INSERT OR REPLACE INTO progress VALUES('cursor','')")
            self.db.commit()

    def close(self): self.db.close()

    def refresh(self, budget=0.18):
        start = time.monotonic(); changed = 0; complete = True
        self.lib.check_path(self.lib.records)
        state = dict(self.db.execute('SELECT key,value FROM progress').fetchall())
        cursor = state.get('cursor', '')
        failed = int(state.get('errors', '0')) if cursor else 0
        as_of = float(state.get('asOf', time.time())) if cursor else time.time()
        # Names only first. Resume metadata/content work after the last processed name.
        # Cold libraries do not repeatedly spend the budget on the same prefix.
        paths = sorted(self.lib.records.glob('*.md'), key=lambda p:p.name)
        identities = {}
        file_ids = {}
        for p in paths:
            try:
                file_ids[p.name] = self.lib.file_ids(p)
            except (OSError, ValueError, KeyError):
                file_ids[p.name] = []
            for ident in file_ids[p.name]:
                identities.setdefault(ident, []).append(p.name)
        self.db.executemany('DELETE FROM records WHERE id=?', [(r[0],) for r in self.db.execute('SELECT id FROM records').fetchall() if len(identities.get(r[0], [])) != 1])
        self.db.execute('DELETE FROM points WHERE record NOT IN (SELECT id FROM records)')
        for p in paths:
            if cursor and p.name <= cursor: continue
            if time.monotonic() - start >= budget:
                complete = False; break
            cursor = p.name
            ids = file_ids[p.name]
            if not ids:
                failed += 1; continue
            try:
                if p.is_symlink(): raise ValueError('学习记录不能是符号链接')
                stat = p.stat(); stamp = f'{stat.st_mtime_ns}:{stat.st_ctime_ns}:{stat.st_size}'
                file_changed = False
                for ident in ids:
                    if len(identities.get(ident, [])) != 1:
                        failed += 1; continue
                    old = self.db.execute('SELECT path,stamp FROM records WHERE id=?', (ident,)).fetchone()
                    if old == (p.name, stamp): continue
                    r, body, _ = self.lib.read_file(p, ident)
                    content = norm(body[:3000] + '\n' + body[-3000:])
                    self.db.execute('INSERT OR REPLACE INTO records VALUES(?,?,?,?,?,?,?)',
                        (ident, p.name, stamp, norm(r['entry']['word']), norm(r['entry'].get('lemma', '')), content, r.get('updated', r['created'])))
                    self.db.execute('DELETE FROM points WHERE record=?', (ident,))
                    for card in r.get('cards', []):
                        if type(card.get('noteId')) is int:
                            self.db.execute('INSERT OR IGNORE INTO points VALUES(?,?,?)',
                                (ident, point_id(self.lib, r['entry'], card['front'], card['back']), card['noteId']))
                    file_changed = True
                changed += int(file_changed)
            except (OSError, ValueError, KeyError):
                failed += 1
                for ident in ids:
                    self.db.execute('DELETE FROM records WHERE id=?', (ident,)); self.db.execute('DELETE FROM points WHERE record=?', (ident,))
        self.db.executemany('INSERT OR REPLACE INTO progress VALUES(?,?)',
            [('cursor', '' if complete else cursor), ('errors', str(failed)), ('asOf', str(as_of))])
        self.db.commit()
        return {'status': 'complete' if complete and not failed else 'partial', 'changedFiles': changed,
                'unreadableFiles': failed, 'scope': '当前语言的语境词库记录；字面相关召回，非全Vault/语义查重',
                'elapsedMs': round((time.monotonic()-start)*1000), 'asOf': as_of}

    def find(self, word, lemma=''):
        terms = list(dict.fromkeys(filter(None, [norm(word), norm(lemma)])))
        exact = ' OR '.join('(word=? OR lemma=?)' for _ in terms)
        params = [t for t in terms for _ in range(2)]
        rows = self.db.execute(f'SELECT id FROM records WHERE {exact} ORDER BY updated DESC LIMIT 4', params).fetchall()
        # At most three snippets. Count exact matches; related prose never means same knowledge.
        total = self.db.execute(f'SELECT count(*) FROM records WHERE {exact}', params).fetchone()[0]
        if len(rows) < 3:
            patterns = ['%' + t.replace('\\','\\\\').replace('%','\\%').replace('_','\\_') + '%' for t in terms]
            related = self.db.execute("SELECT id FROM records WHERE " + ' OR '.join("content LIKE ? ESCAPE '\\'" for _ in terms) + ' ORDER BY updated DESC LIMIT 6', patterns).fetchall()
            rows += [r for r in related if r not in rows]
        return [r[0] for r in rows[:3]], total

    def anki(self, word, lemma='', fresh=False):
        terms = list(dict.fromkeys(filter(None, [plain(word), plain(lemma)])))
        query = scope(self.lib) + ' (' + ' or '.join(quote(t) for t in terms) + ')'
        old = self.db.execute('SELECT at,data FROM anki WHERE query=?', (query,)).fetchone()
        if not fresh and old and 0 <= time.time()-old[0] < (5 if json.loads(old[1]).get('status') == 'unavailable' else 30):
            return {**json.loads(old[1]), 'cached': True, 'ageSeconds': round(time.time()-old[0], 1)}
        unavailable = self.db.execute("SELECT at,data FROM anki WHERE query='__unavailable__'").fetchone()
        if not fresh and unavailable and 0 <= time.time()-unavailable[0] < 5:
            return {**json.loads(unavailable[1]), 'cached': True, 'ageSeconds': round(time.time()-unavailable[0], 1)}
        result = related_anki(self.lib, query)
        if result['status'] == 'unavailable' and 'total' not in result:
            self.db.execute('INSERT OR REPLACE INTO anki VALUES(?,?,?)', ('__unavailable__', time.time(), json.dumps(result,ensure_ascii=False)))
        elif result['status'] == 'complete':
            self.db.execute("DELETE FROM anki WHERE query='__unavailable__'")
        self.db.execute('INSERT OR REPLACE INTO anki VALUES(?,?,?)', (query, time.time(), json.dumps(result, ensure_ascii=False)))
        self.db.execute('DELETE FROM anki WHERE query NOT IN (SELECT query FROM anki ORDER BY at DESC LIMIT 100)')
        self.db.commit()
        return result


def bounded_api(lib, budget=1.2):
    from study_library import anki_call
    deadline = min(time.monotonic() + budget, getattr(lib, 'memory_deadline', float('inf')))
    def call(action, params):
        left = deadline - time.monotonic()
        if left <= 0: raise TimeoutError('学习历史查询已达到时间预算')
        return anki_call(action, params, timeout=left) if lib.anki is anki_call else lib.anki(action, params)
    return call


def related_anki(lib, query):
    api = bounded_api(lib)
    result = {'status':'unavailable', 'items':[], 'scope':lib.deck + '及相同笔记类型', 'cached':False, 'asOf':time.time()}
    try:
        ids = api('findNotes', {'query':query})
        if not isinstance(ids,list) or any(type(n) is not int for n in ids): raise ValueError('invalid IDs')
        ids = list(dict.fromkeys(ids)); result['total'] = len(ids)
        if not ids: return {**result, 'status':'complete'}
        selected = ids[:6]; notes = api('notesInfo', {'notes':selected})
        if not isinstance(notes,list) or len(notes)!=len(selected) or any(n.get('noteId')!=i for n,i in zip(notes,selected)): raise ValueError('incomplete notes')
        card_ids=[]
        for n in notes:
            fields={k:plain(v.get('value',''))[:600] for k,v in n.get('fields',{}).items() if k in ('Word','Expression','Question','Sentence','Definition','Front','Back','Text')}
            own_cards=n.get('cards',[])
            if not isinstance(own_cards,list) or any(type(i) is not int for i in own_cards): raise ValueError('invalid cards')
            card_ids += own_cards[:3]
            result['items'].append({'noteId':n['noteId'], 'fields':fields, 'reviews':[], 'reviewStatus':'unknown',
                                    'truncated': not fields or any(len(plain(v.get('value','')))>600 for k,v in n.get('fields',{}).items() if k in fields)})
        reviews=api('cardsInfo',{'cards':card_ids}) if card_ids else []
        if not isinstance(reviews,list) or len(reviews)!=len(card_ids) or any(c.get('cardId')!=i for c,i in zip(reviews,card_ids)): raise ValueError('incomplete reviews')
        for row in result['items']:
            row['reviews']=[{k:c[k] for k in ('cardId','reps','lapses','interval','queue') if k in c} for c in reviews if c.get('note')==row['noteId']]
            row['reviewStatus']='reported' if row['reviews'] else 'unknown'
        result['status']='partial' if len(ids)>6 or any(len(n.get('cards',[]))>3 for n in notes) or any(n['truncated'] for n in result['items']) else 'complete'
    except Exception:
        result['status']='partial' if result['items'] else 'unavailable'
        result['warning']='本次未完整读到Anki，不能推断没有卡片或尚未学习。'
    return result


def memory(lib, word, lemma='', fresh=False):
    try:
        index=MemoryIndex(lib)
        try:
            coverage=index.refresh()
            ids,total=index.find(word,lemma)
            items=[]
            for ident in ids:
                try: items.append(lib.material(ident))
                except (OSError,ValueError): coverage['status']='partial'
            return {'items':items,'total':total,'coverage':coverage,'anki':index.anki(word,lemma,fresh),
                    'warning':'未召回不等于没学过；相关不等于重复；已有卡和复习次数不证明掌握。'}
        finally: index.close()
    except (OSError,ValueError,sqlite3.Error):
        return {'items':[], 'coverage':{'status':'unavailable'}, 'anki':{'status':'unavailable','items':[]},
                'warning':'学习历史暂未核对；不是零记录。'}


def duplicate(lib, fields, entry=None):
    """Fresh exact word/question + answer + sentence only; never merge different senses."""
    api=bounded_api(lib)
    front=plain(fields.get('Question') if lib.language=='ja' else fields['Word'])
    field='Question' if lib.language=='ja' else 'Word'
    # A literal prefix retrieves candidates; verify all three fields before linking.
    literal=re.sub(r'([\\"*_:])',r'\\\1',front[:48])
    ids=api('findNotes',{'query':scope(lib)+' (tag:'+exact_tag(lib, fields)+' or "'+field+':*'+literal+'*")'})
    if not isinstance(ids,list) or len(ids)>12 or any(type(n) is not int for n in ids):
        raise ValueError('相关卡片过多或结果不完整，已保留草稿；未新增卡。')
    if not ids: return None
    notes=api('notesInfo',{'notes':ids})
    if not isinstance(notes,list) or len(notes)!=len(ids) or any(n.get('noteId')!=i for n,i in zip(notes,ids)):
        raise ValueError('Anki查重读回不完整，已保留草稿；未新增卡。')
    keys=('Word','Sentence','Definition','Expression','Question','Reading') if lib.language=='ja' else ('Word','Sentence','Definition')
    for n in notes:
        if entry is not None and any(t.startswith(('studycard_', 'studypoint_')) for t in n.get('tags', [])):
            # Managed Q/A can be generic: use its Ob subject association instead.
            continue
        if n.get('modelName')==lib.model and all(norm(n.get('fields',{}).get(k,{}).get('value',''))==norm(fields.get(k,'')) for k in keys):
            return n['noteId']
    return None


def duplicate_point(lib, entry, front, back, fields):
    """Link only a proven subject + exact Q/A; fresh readback, never overwrite an old card."""
    point = point_id(lib, entry, front, back)
    index = MemoryIndex(lib)
    try:
        coverage = index.refresh()
        associations = index.db.execute('SELECT record,note FROM points WHERE point=? LIMIT 13', (point,)).fetchall()
        if len(associations) > 12: raise ValueError('同学习点关联过多，已保留记录；请核对旧卡。')
        known = set()
        for record_id, note in associations:
            record = lib.result(record_id)  # Cache is not authoritative.
            if any(c.get('noteId') == note and point_id(lib, record['entry'], c['front'], c['back']) == point for c in record.get('cards', [])):
                known.add(note)
    finally: index.close()
    api = bounded_api(lib)
    tagged = api('findNotes', {'query': scope(lib) + ' tag:studypoint_' + point})
    if not isinstance(tagged, list) or any(type(n) is not int for n in tagged) or len(tagged) > 12:
        raise ValueError('学习点核对不完整；未新增卡。')
    ids = sorted(known.union(tagged))
    if len(ids) > 12: raise ValueError('学习点关联过多；未新增卡。')
    if ids:
        notes = api('notesInfo', {'notes': ids})
        keys = ('Word', 'Definition', 'Expression', 'Question', 'Reading') if lib.language == 'ja' else ('Word', 'Definition')
        if not isinstance(notes, list) or len(notes) != len(ids) or any(n.get('noteId') != ident or n.get('modelName') != lib.model or any(norm(n.get('fields', {}).get(k, {}).get('value', '')) != norm(fields.get(k, '')) for k in keys) for n, ident in zip(notes, ids)):
            raise ValueError('关联学习点的旧卡已变化或被删除；不覆盖、不重建。')
        return ids[0]
    if coverage['status'] != 'complete':
        raise ValueError('本机学习索引仍在核对；记录已保留，稍后继续补齐。')
    return None


def compact(evidence):
    anki = evidence.get('anki', {})
    lines=['相关学习证据（有限召回，不是全库/全部语义查重）：',
           'Obsidian范围/状态：'+json.dumps(evidence.get('coverage',{}),ensure_ascii=False),
           'Anki范围/状态：'+json.dumps({k:v for k,v in anki.items() if k!='items'},ensure_ascii=False)]
    for row in anki.get('items',[])[:3]:
        fields=row['fields']
        question=fields.get('Question') or fields.get('Word') or fields.get('Front') or fields.get('Expression','')
        answer=fields.get('Definition') or fields.get('Back') or fields.get('Text','')
        lines.append('Anki '+str(row['noteId'])+'：'+question[:140]+' → '+answer[:140]+                     '；复习='+json.dumps(row['reviews'],ensure_ascii=False)[:180])
    for row in evidence.get('items',[])[:3]:
        lines.append('笔记 '+row['id']+' '+row['word']+'：'+row['text'][-200:])
    lines.append('摘要仅部分原文/最多3张相关卡；未找到不等于未学过，复习次数不等于掌握。不明确时保留核对意见，不重复出相同学习点。')
    text='\n'.join(lines)
    return text if len(text)<=2400 else text[:2320]+'\n[证据摘要截断，不能声称已完整核对；未找到不等于未学过]'


def exact_tag(lib, fields):
    keys=('Word','Sentence','Definition','Expression','Question','Reading') if lib.language=='ja' else ('Word','Sentence','Definition')
    return 'studyexact_'+hashlib.sha256(json.dumps([lib.language]+[norm(fields.get(k,'')) for k in keys],ensure_ascii=False).encode()).hexdigest()[:32]


def invalidate_anki(lib):
    try:
        index=MemoryIndex(lib)
        try:
            index.db.execute('DELETE FROM anki'); index.db.commit()
        finally: index.close()
    except (OSError, ValueError, sqlite3.Error):
        pass  # Cache is never used to authorize Anki writes.
