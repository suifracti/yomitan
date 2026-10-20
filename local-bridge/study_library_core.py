#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Fixed-directory study records. No model, shell, arbitrary paths or collection access."""
import contextlib
import datetime
import fcntl
import hashlib
import html
import json
import math
import os
import pathlib
import re
import tempfile
import time
import urllib.parse
import urllib.request

RELATIVE = pathlib.Path('01-高考2027/05-英语（Larry）/语境词库')
JAPANESE_RELATIVE = pathlib.Path('02-个人与生活/语言学习/日语/语境词库')

def language(value='en'):
    if value not in ('en', 'ja'):
        raise ValueError('仅支持明确的英语 en 或日语 ja；不会自动写入英语库。')
    return value

ID_RE = re.compile(r'[a-f0-9]{32}')
FIELDS = {'word': 128, 'sentence': 2400, 'context': 1200, 'meaning': 5000,
          'translation': 5000, 'notes': 5000, 'url': 2000, 'title': 300, 'explanationSource': 40}


def is_valid_reading(reading, entry, lang):
    if not reading or not isinstance(reading, str) or not reading.strip():
        return False
    if lang == 'ja':
        return True
    r = reading.strip().lower()
    w = entry.get('word', '').strip().lower()
    l = entry.get('lemma', '').strip().lower()
    return bool(r and r != w and r != l)



def text(value, limit, required=False):
    if not isinstance(value, str) or len(value) > limit or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', value) or (required and not value.strip()):
        raise ValueError('学习记录字段为空、格式错误或超过长度限制。')
    return value.strip()


def source_url(value):
    value = text(value, 2000)
    if value:
        parsed = urllib.parse.urlsplit(value)
        if parsed.scheme not in ('https', 'http') or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError('来源只允许无凭据的 http/https 地址。')
    return value


def normalize_subtitle(value, entry, lang):
    fields = {'version', 'url', 'language', 'trackIndex', 'trackName', 'text', 'originalStartMs',
              'originalEndMs', 'subtitleOffsetMs', 'selectionStart', 'selectionEnd', 'word', 'provenance'}
    def invalid():
        raise ValueError('字幕来源身份或字段无效；未降级为网页记录，请重新确认或恢复保存。')
    if not isinstance(value, dict) or set(value) != fields or type(value['version']) is not int or value['version'] != 1:
        invalid()
    v = value.copy()
    if v['language'] not in ('en', 'ja') or v['language'] != lang:
        invalid()
    for k in ('trackIndex', 'originalStartMs', 'originalEndMs', 'subtitleOffsetMs', 'selectionStart', 'selectionEnd'):
        if type(v[k]) is not int or abs(v[k]) > 604800000:
            invalid()
    if v['trackIndex'] < 0 or v['originalStartMs'] < 0 or v['originalEndMs'] <= v['originalStartMs']:
        invalid()
    for k, n in [('trackName', 300), ('text', 2400), ('word', 128)]:
        controls = r'[\x00-\x08\x0b\x0c\x0e-\x1f]' if k == 'text' else r'[\x00-\x1f]'
        if not isinstance(v[k], str) or len(v[k]) > n or not v[k].strip() or re.search(controls, v[k]):
            invalid()
    if v['word'] != v['word'].strip():
        invalid()
    # Browser Range offsets are UTF-16 code units, not Python Unicode code points.
    try:
        raw = v['text'].encode('utf-16-le')
        selected = raw[v['selectionStart'] * 2:v['selectionEnd'] * 2].decode('utf-16-le')
    except (UnicodeError, TypeError):
        invalid()
    if not 0 <= v['selectionStart'] < v['selectionEnd'] <= len(raw) // 2 or selected != v['word']:
        invalid()
    if entry['sentence'] != v['text'].strip() or entry['word'] != v['word'] or entry['url'] != v['url'] or 'videoTime' in entry:
        invalid()
    try:
        parsed = urllib.parse.urlsplit(v['url'])
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
            invalid()
        host = parsed.hostname.encode('idna').decode().lower()
        if ':' in host:
            host = '[' + host + ']'
        port = parsed.port
        authority = host + (':' + str(port) if port and port != (443 if parsed.scheme == 'https' else 80) else '')
        canonical = urllib.parse.urlunsplit((parsed.scheme.lower(), authority, parsed.path or '/', parsed.query, ''))
        if canonical != v['url']:
            invalid()
    except (ValueError, TypeError, UnicodeError):
        invalid()
    provenance = v['provenance']
    if not isinstance(provenance, dict) or set(provenance) != {'queryId', 'sourceRevision', 'cueIndex', 'tabId', 'frameId', 'documentId'}:
        invalid()
    for k in ('queryId', 'sourceRevision', 'documentId'):
        if not isinstance(provenance[k], str) or not provenance[k].strip() or len(provenance[k]) > 100:
            invalid()
    if not re.fullmatch(r'[a-zA-Z0-9-]{1,100}', provenance['queryId']):
        invalid()
    if any(type(provenance[k]) is not int or provenance[k] < 0 for k in ('cueIndex', 'tabId', 'frameId')) or provenance['frameId'] != 0:
        invalid()
    return v


def subtitle_identity(v):
    return ['r2', v['version'], v['url'], v['language'], v['trackIndex'], v['trackName'], v['text'],
            v['originalStartMs'], v['originalEndMs'], v['selectionStart'], v['selectionEnd'], v['word']]


def normalize_entry(value):
    if not isinstance(value, dict) or set(value) - (set(FIELDS) | {'videoTime', 'language', 'lemma', 'reading', 'dictionaryNotes', 'dictionaryTranslation', 'subtitleSource'}):
        raise ValueError('学习记录不接受额外字段或文件路径。')
    result = {k: text(value.get(k, ''), n, k in ('word', 'sentence')) for k, n in FIELDS.items()}
    lang = language(value.get('language', 'en'))
    if lang == 'ja':
        result['language'] = lang
    for key, limit in [('lemma', 128), ('reading', 128), ('dictionaryNotes', 4000), ('dictionaryTranslation', 4000)]:
        if key in value:
            result[key] = text(value[key], limit)
    result['url'] = source_url(result['url'])
    t = value.get('videoTime')
    if t is not None:
        if isinstance(t, bool) or not isinstance(t, (int, float)) or not math.isfinite(t) or not 0 <= t <= 604800:
            raise ValueError('视频时间无效。')
        result['videoTime'] = int(t)
    if 'subtitleSource' in value:
        result['subtitleSource'] = normalize_subtitle(value['subtitleSource'], result, lang)
    return result


def normalize_request(p):
    if isinstance(p, dict) and 'language' in p:
        lang = language(p['language'])
        return {**normalize_request({k: v for k, v in p.items() if k != 'language'}), 'language': lang}
    return _normalize_request(p)

def _normalize_request(p):
    if not isinstance(p, dict):
        raise ValueError('学习库请求无效。')
    action = p.get('action')
    if action in ('librarySettingsGet', 'librarySettingsSave', 'librarySettingsCheck', 'librarySettingsPrepare', 'librarySettingsOpen', 'libraryTargetResolve', 'librarySettingsDetect', 'librarySettingsPick'):
        from study_settings import normalize_settings_request
        return normalize_settings_request(p)
    if 'targetId' in p:
        if action not in ('librarySave', 'libraryCardsAdd', 'libraryReconcile', 'libraryUpdate', 'libraryFavorite') or not isinstance(p['targetId'], str) or not ID_RE.fullmatch(p['targetId']):
            raise ValueError('保存目的地编号无效。')
        return {**normalize_request({k: v for k, v in p.items() if k != 'targetId'}), 'targetId': p['targetId']}
    if 'cueAuthorization' in p:
        grant = p['cueAuthorization']
        if action not in ('libraryRead', 'libraryDraftSave', 'libraryDraftDiscard', 'libraryDraftCommit', 'librarySync') or not isinstance(grant, dict) or set(grant) != {'id', 'source'} or not ID_RE.fullmatch(str(grant['id'])) or not isinstance(grant['source'], dict):
            raise ValueError('字幕内部动作授权无效。')
        return {**normalize_request({k: v for k, v in p.items() if k != 'cueAuthorization'}), 'cueAuthorization': grant}
    if action == 'libraryPrepareJapanese' and set(p) == {'action'}:
        return p
    if action == 'libraryMedia':
        from study_media import validate
        return validate(p)
    if action == 'librarySave' and {'action', 'entry', 'makeCard'} <= set(p) and not set(p) - {'action', 'entry', 'makeCard', 'turns'} and isinstance(p['makeCard'], bool):
        turns = p.get('turns', [])
        if not isinstance(turns, list) or len(turns) > 20:
            raise ValueError('每批最多保存 20 轮问答。')
        for t in turns:
            if not isinstance(t, dict) or not {'id', 'at', 'question', 'translation', 'meaning', 'notes', 'feedback'} <= set(t) or set(t) - {'id', 'at', 'question', 'translation', 'meaning', 'notes', 'feedback', 'kind', 'relatedTurnId', 'usage', 'mode'}:
                raise ValueError('学习过程格式无效。')
            if t.get('mode') not in (None, 'translate', 'explain'):
                raise ValueError('学习过程模式无效。')
            if 'kind' in t and t['kind'] != 'feedback':
                raise ValueError('未知学习事件。')
            if t.get('kind') == 'feedback':
                if not isinstance(t.get('relatedTurnId'), str) or not re.fullmatch(r'[a-zA-Z0-9_-]{6,80}', t['relatedTurnId']) or any(t[k] for k in ('translation', 'meaning', 'notes')):
                    raise ValueError('反馈须关联原轮次，不重复答案。')
            elif 'relatedTurnId' in t:
                raise ValueError('反馈关联格式无效。')
            if 'usage' in t:
                u = t['usage']
                if not isinstance(u, dict) or set(u) - {'requestId','status','inputTokens','outputTokens','totalTokens','cachedInputTokens','reasoningOutputTokens'} or u.get('status') not in ('unknown','cached','completed','running','incomplete'):
                    raise ValueError('用量格式无效。')
                if 'requestId' in u and (not isinstance(u['requestId'], str) or not re.fullmatch('[a-f0-9]{32}',u['requestId'])):
                    raise ValueError('用量编号无效。')
                for k in ('inputTokens','outputTokens','totalTokens','cachedInputTokens','reasoningOutputTokens'):
                    if k in u and (type(u[k]) is not int or not 0 <= u[k] <= 10**12):
                        raise ValueError('用量数字无效。')
            for key, limit in [('id', 80), ('at', 40), ('question', 500), ('translation', 5000), ('meaning', 5000), ('notes', 5000)]:
                text(t[key], limit, key in ('id', 'at'))
            if not re.fullmatch(r'[a-zA-Z0-9_-]{6,80}', t['id']) or t['feedback'] not in ('unconfirmed', 'understood', 'unclear'):
                raise ValueError('理解状态只能来自明确的本人反馈。')
        return {**p, 'entry': normalize_entry(p['entry']), 'turns': turns}
    if action == 'libraryMemory' and {'action', 'word'} <= set(p) and not set(p) - {'action', 'word', 'lemma', 'fresh'}:
        if 'fresh' in p and type(p['fresh']) is not bool:
            raise ValueError('历史核对刷新标志无效。')
        return {**p, 'word': text(p['word'], 128, True), **({'lemma': text(p['lemma'], 128, True)} if 'lemma' in p else {})}
    if action == 'libraryFavorite':
        if type(p.get('favorite')) is not bool or set(p) not in ({'action', 'entry', 'favorite'}, {'action', 'id', 'favorite'}):
            raise ValueError('收藏请求无效。')
        if 'entry' in p:
            return {**p, 'entry': normalize_entry(p['entry'])}
        if not isinstance(p['id'], str) or not ID_RE.fullmatch(p['id']):
            raise ValueError('学习记录编号无效。')
        return p
    if action == 'libraryVideoWords':
        if set(p) != {'action', 'videoId'} or not isinstance(p['videoId'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{11}', p['videoId']):
            raise ValueError('视频编号无效。')
        return p
    if action == 'libraryCardsAdd' and set(p) in ({'action', 'id', 'cards'}, {'action', 'id', 'cards', 'mastery'}):
        if 'mastery' in p and p['mastery'] not in ('none', 'vague', 'known'):
            raise ValueError('掌握程度无效。')
        if not isinstance(p['id'], str) or not ID_RE.fullmatch(p['id']) or not isinstance(p['cards'], list) or not 1 <= len(p['cards']) <= 10:
            raise ValueError('手动卡片请求无效。')
        seen = set()
        for card in p['cards']:
            if not isinstance(card, dict) or set(card) - {'front', 'back', 'kind', 'deck'} or not {'front', 'back'} <= set(card):
                raise ValueError('手动卡片字段无效。')
            front, back = text(card['front'], 1000, True), text(card['back'], 2400, True)
            kind = text(card.get('kind', 'manual'), 40, True)
            deck = text(card.get('deck', ''), 300)
            if not re.fullmatch(r'[a-zA-Z0-9_-]{1,40}', kind):
                raise ValueError('卡片类型无效。')
            if front in seen:
                raise ValueError('同批卡片问题重复，请修改问题后再提交。')
            seen.add(front)
            card.update({'front': front, 'back': back, 'kind': kind, 'deck': deck})
        return p
    if action == 'libraryReconcile' and set(p) in ({'action', 'id'}, {'action', 'id', 'resolutions'}):
        if not isinstance(p['id'], str) or not ID_RE.fullmatch(p['id']):
            raise ValueError('学习记录编号无效。')
        resolutions = p.get('resolutions', {})
        if not isinstance(resolutions, dict) or len(resolutions) > 100 or any(not isinstance(k, str) or v not in ('local', 'remote') for k, v in resolutions.items()):
            raise ValueError('字段冲突选择无效。')
        return {**p, 'resolutions': resolutions}
    if action == 'libraryUpdate' and set(p) <= {'action', 'id', 'entry', 'turns', 'remember'} and {'action', 'id'} <= set(p) and ('entry' in p or 'turns' in p):
        if not isinstance(p['id'], str) or not ID_RE.fullmatch(p['id']):
            raise ValueError('学习记录编号无效。')
        if 'remember' in p and type(p['remember']) is not bool:
            raise ValueError('明确记住标志无效。')
        entry = p.get('entry', {})
        allowed = set(FIELDS) | {'videoTime', 'language', 'lemma', 'reading', 'dictionaryNotes', 'dictionaryTranslation'}
        if not isinstance(entry, dict) or set(entry) - allowed:
            raise ValueError('学习补充字段无效。')
        partial = {}
        for key, limit in FIELDS.items():
            if key in entry:
                partial[key] = source_url(text(entry[key], limit)) if key == 'url' else text(entry[key], limit)
        for key, limit in [('lemma',128),('reading',128),('dictionaryNotes',4000),('dictionaryTranslation',4000)]:
            if key in entry: partial[key] = text(entry[key], limit)
        if 'videoTime' in entry:
            value = entry['videoTime']
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 604800:
                raise ValueError('视频时间无效。')
            partial['videoTime'] = int(value)
        turns = p.get('turns', [])
        if not isinstance(turns, list) or len(turns) > 20:
            raise ValueError('每次最多补充20轮。')
        for turn in turns:
            if not isinstance(turn, dict) or not {'id','at','question','translation','meaning','notes','feedback'} <= set(turn) or set(turn) - {'id','at','question','translation','meaning','notes','feedback','kind','relatedTurnId','usage','mode'}:
                raise ValueError('学习过程格式无效。')
            if turn.get('mode') not in (None, 'translate', 'explain'):
                raise ValueError('学习过程模式无效。')
            for key, limit in [('id',80),('at',40),('question',500),('translation',5000),('meaning',5000),('notes',5000)]: text(turn[key], limit, key in ('id','at'))
            if not re.fullmatch(r'[a-zA-Z0-9_-]{6,80}', turn['id']) or turn['feedback'] not in ('unconfirmed','understood','unclear'):
                raise ValueError('学习过程编号或反馈无效。')
            if turn.get('kind') == 'feedback' and (not isinstance(turn.get('relatedTurnId'), str) or any(turn[k] for k in ('translation','meaning','notes'))):
                raise ValueError('反馈须关联原学习轮次，不重复答案。')
        return {**p, 'entry': partial, 'turns': turns}
    if action in ('libraryDraftSave', 'libraryDraftDiscard', 'libraryDraftCommit'):
        if set(p) != {'action', 'items'} or not isinstance(p['items'], list) or not 1 <= len(p['items']) <= 10:
            raise ValueError('每次处理1–10条明确选中的草稿。')
        seen = set()
        for row in p['items']:
            keys = {'id', 'version'} | ({'reason', 'cards'} if action == 'libraryDraftSave' else {'draftId'} if action == 'libraryDraftCommit' else set())
            if not isinstance(row, dict) or set(row) != keys or not isinstance(row.get('id'), str) or not ID_RE.fullmatch(row['id']) or row['id'] in seen or not isinstance(row.get('version'), str) or not re.fullmatch('[a-f0-9]{64}', row['version']):
                raise ValueError('草稿编号、版本或字段无效。')
            seen.add(row['id'])
            if action == 'libraryDraftCommit' and (not isinstance(row['draftId'], str) or not ID_RE.fullmatch(row['draftId'])):
                raise ValueError('草稿身份无效。')
            if action == 'libraryDraftSave':
                text(row['reason'], 1200, True)
                if not isinstance(row['cards'], list) or len(row['cards']) > 4:
                    raise ValueError('每条记录最多4张复习建议。')
                for card in row['cards']:
                    if not isinstance(card, dict) or set(card) - {'front', 'back', 'selected', 'kind'} or not {'front', 'back', 'selected'} <= set(card) or type(card['selected']) is not bool:
                        raise ValueError('草稿问题、答案或选择无效。')
                    text(card['front'], 1000, True); text(card['back'], 2400, True)
                    if 'kind' in card and not re.fullmatch(r'[a-zA-Z0-9_-]{1,40}', text(card['kind'], 40, True)):
                        raise ValueError('卡片类型无效。')
        return p
    if action == 'libraryCards' and set(p) == {'action', 'items'} and isinstance(p['items'], list) and 1 <= len(p['items']) <= 10:
        seen = set()
        for row in p['items']:
            if not isinstance(row, dict) or set(row) != {'id', 'version', 'cards'} or not isinstance(row['id'], str) or not ID_RE.fullmatch(row['id']) or row['id'] in seen or not isinstance(row['version'], str) or not re.fullmatch('[a-f0-9]{64}', row['version']):
                raise ValueError('制卡草稿编号或版本无效。')
            seen.add(row['id'])
            if not isinstance(row['cards'], list) or not 1 <= len(row['cards']) <= 4:
                raise ValueError('每条记录确认 1–4 张卡。')
            for card in row['cards']:
                if not isinstance(card, dict) or set(card) - {'front', 'back', 'kind'} or not {'front', 'back'} <= set(card):
                    raise ValueError('卡片字段无效。')
                text(card['front'], 1000, True)
                text(card['back'], 2400, True)
                if 'kind' in card and not re.fullmatch(r'[a-zA-Z0-9_-]{1,40}', text(card['kind'], 40, True)):
                    raise ValueError('卡片类型无效。')
        return p
    if action == 'libraryList' and 'action' in p and not set(p) - {'action', 'url', 'title', 'offset', 'scope'}:
        scope = p.get('scope', 'source')
        if (scope != 'all' and not {'url', 'title'} <= set(p)) or type(p.get('offset', 0)) is not int or not 0 <= p.get('offset', 0) <= 100000 or scope not in ('source', 'pending', 'all'):
            raise ValueError('学习列表范围无效。')
        return {**p, 'url': source_url(p.get('url', '')), 'title': text(p.get('title', ''), 300)}
    if action in ('librarySync', 'libraryRead') and set(p) == {'action', 'ids'} and isinstance(p['ids'], list) and 1 <= len(p['ids']) <= 10:
        if len(set(p['ids'])) != len(p['ids']) or any(not isinstance(i, str) or not ID_RE.fullmatch(i) for i in p['ids']):
            raise ValueError('学习记录编号无效。')
        return p
    if action == 'libraryEnrich' and set(p) == {'action', 'items'} and isinstance(p['items'], list) and 1 <= len(p['items']) <= 10:
        seen = set()
        for row in p['items']:
            if not isinstance(row, dict) or set(row) != {'id', 'version', 'text'} or not isinstance(row['id'], str) or not ID_RE.fullmatch(row['id']) or row['id'] in seen or not isinstance(row['version'], str) or not re.fullmatch('[a-f0-9]{64}', row['version']):
                raise ValueError('整理结果编号或版本无效。')
            seen.add(row['id'])
            text(row['text'], 5000, True)
        return p
    raise ValueError('不支持的学习库操作或字段。')


def entry_id(e):
    identity = [e['word'].casefold(), e['sentence'], e['url'], e['title'] if not e['url'] else '', e.get('videoTime')]
    if e.get('subtitleSource'):
        identity = subtitle_identity(e['subtitleSource'])
    elif e.get('language', 'en') != 'en':
        identity.insert(0, e['language'])
    return hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()[:32]


def anki_call(action, params, timeout=5):
    data = json.dumps({'action': action, 'version': 6, 'params': params}).encode()
    request = urllib.request.Request('http://127.0.0.1:8766', data=data, headers={'Content-Type': 'application/json'})
    # Never use environment proxy settings for a loopback write.
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=timeout) as response:
        result = json.loads(response.read(200000))
    if not isinstance(result, dict) or result.get('error') or 'result' not in result:
        raise ValueError('Anki 未接受请求；笔记已保留，可稍后补交。')
    return result['result']


def safe_markdown(s):
    # Keep source material literal, not executable HTML, wikilinks or Markdown embeds.
    s = html.escape(s, quote=False)
    return re.sub(r'([\\`*_{}\[\]()#!|])', r'\\\1', s)


def paragraph(s):
    return '\n'.join('> ' + safe_markdown(line) for line in s.splitlines()) if s else '（未填写）'


class StudyLibrary:
    def __init__(self, vault, anki=anki_call, lang='en', cache_dir=None, target=None, group_words=False):
        self.cache_dir = cache_dir
        self.vault = pathlib.Path(vault)
        if not self.vault.is_absolute() or not self.vault.is_dir():
            raise ValueError('未配置可用的 Obsidian Vault；请重新运行安装脚本并指定 --vault。')
        self.language = language(lang)
        # Yomitan English opts in; existing IINA and Japanese callers keep their format.
        self.group_words = group_words and self.language == 'en'
        self.relative = JAPANESE_RELATIVE if self.language == 'ja' else RELATIVE
        self.deck = '外语::日语语境' if self.language == 'ja' else '外语::英语语境'
        self.model = '日语语境卡' if self.language == 'ja' else '外语语境卡'
        self.target_id = target['targetId'] if target else None
        self.anki_enabled = target.get('ankiEnabled', True) if target else True
        if target and self.language == 'en':
            self.relative = pathlib.Path(target['directory'])
            self.deck, self.model = target['deck'], target['model']
            self.deck_by_kind = target.get('deckByKind', {})
        else:
            self.deck_by_kind = {}
        self.base = self.vault / self.relative
        self.records = self.base / '记录'
        self.anki = anki

    def check_path(self, p):
        for q in [p, *p.parents]:
            if q.is_symlink():
                raise ValueError('学习目录包含符号链接，停止读写。')
            if q == self.vault:
                return
        raise ValueError('学习路径超出已配置 Vault。')

    @contextlib.contextmanager
    def locked(self):
        self.check_path(self.records)
        self.records.mkdir(parents=True, exist_ok=True)
        p = self.base / '.study.lock'
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield

    def path(self, ident, entry=None):
        if not isinstance(ident, str) or not ID_RE.fullmatch(ident):
            raise ValueError('学习记录编号无效。')
        self.check_path(self.records)
        matches = list(self.records.glob('*--' + ident + '.md'))
        legacy = self.records / ('s-' + ident + '.md')
        if legacy.exists() or legacy.is_symlink():
            matches.append(legacy)
        for p in self.records.glob('*--w*.md'):
            try:
                ids = self.file_ids(p) if re.search(r'--w[a-f0-9]{32}\.md$', p.name) else []
            except (OSError, ValueError, KeyError):
                # A damaged unrelated word must not disable healthy records.
                # Saving that word still resolves its hash below and refuses overwrite.
                continue
            if ident in ids:
                matches.append(p)
        if len(matches) > 1:
            raise ValueError('同一学习编号存在多份记录，停止自动修改。')
        if matches:
            p = matches[0]
        elif entry and self.group_words:
            word_id = self.word_id(entry)
            grouped = list(self.records.glob('*--w' + word_id + '.md'))
            if len(grouped) > 1:
                raise ValueError('同一个单词存在多篇文档，请先人工确认。')
            label = re.sub(r'[\\/:*?"<>|\x00-\x1f]', ' ', entry['word'].casefold()[:48]).strip(' .') or '学习记录'
            p = grouped[0] if grouped else self.records / (label + '--w' + word_id + '.md')
        elif entry:
            label = ' · '.join(filter(None, [entry['word'][:24], entry['title'][:24]]))
            label = re.sub(r'[\\/:*?"<>|\x00-\x1f]', ' ', label).strip(' .') or '学习记录'
            p = self.records / (label + '--' + ident + '.md')
        else:
            p = legacy
        self.check_path(p)
        return p

    def word_id(self, entry):
        return hashlib.sha256(json.dumps([self.language, entry['word'].casefold()], ensure_ascii=False).encode()).hexdigest()[:32]

    def metadata(self, record):
        return json.dumps(record, ensure_ascii=True, separators=(',', ':')).replace('<', '\\u003c').replace('>', '\\u003e')

    def word_header(self, entry):
        metadata = {'word': entry['word'], 'language': self.language}
        return (f'---\ntype: english-study-word\nword: {json.dumps(entry["word"], ensure_ascii=False)}\n'
                f'language: {self.language}\nword_id: {self.word_id(entry)}\n---\n'
                f'<!-- english-study-word-v1:{self.metadata(metadata)} -->\n\n# {safe_markdown(entry["word"])}\n\n')

    def context_block(self, record, body):
        return (f'<!-- english-study-context-v1:{self.metadata(record)} -->\n' + body +
                f'\n<!-- english-study-context-end:{record["id"]} -->\n')

    def word_contexts(self, content):
        document = re.search(r'^<!-- english-study-word-v1:(.+) -->$', content, re.M)
        if not document:
            raise ValueError('已有同名文件不是单词文档，不会覆盖。')
        metadata = json.loads(document[1])
        if metadata.get('language') != self.language or not isinstance(metadata.get('word'), str):
            raise ValueError('单词文档的语言或词面无效。')
        pattern = r'^<!-- english-study-context-v1:([^\n]+) -->\n(.*?)\n<!-- english-study-context-end:([a-f0-9]{32}) -->\n'
        contexts = {}
        for match in re.finditer(pattern, content, re.M | re.S):
            record = json.loads(match[1])
            ident = record['id']
            if (ident != match[3] or ident in contexts or record['entry']['word'].casefold() != metadata['word'].casefold()
                    or record['entry'].get('language', 'en') != self.language or match[1] != self.metadata(record)):
                raise ValueError('语境元数据不一致，停止自动覆盖。')
            contexts[ident] = (record, match[2], hashlib.sha256(match[0].encode()).hexdigest(), match.span())
        if (not contexts or content.count('<!-- english-study-context-v1:') != len(contexts)
                or content.count('<!-- english-study-context-end:') != len(contexts)):
            raise ValueError('单词文档语境分节不完整，停止自动覆盖。')
        return contexts

    def file_content(self, p):
        self.check_path(p)
        if p.stat().st_size > 2000000:
            raise ValueError('学习记录过大，停止自动处理。')
        return p.read_text()

    def file_ids(self, p):
        if re.search(r'--w[a-f0-9]{32}\.md$', p.name):
            return list(self.word_contexts(self.file_content(p)))
        ident = p.stem.split('--')[-1] if '--' in p.stem else p.stem[2:] if p.stem.startswith('s-') else ''
        return [ident] if ID_RE.fullmatch(ident) else []

    def record_files(self):
        for p in sorted(self.records.glob('*.md')):
            try:
                ids = self.file_ids(p)
            except (OSError, ValueError, KeyError):
                continue
            for ident in ids:
                yield p, ident

    def header(self, record):
        metadata = self.metadata(record)
        return (f'---\ntype: {"japanese-study" if self.language == "ja" else "english-study"}\nword: {json.dumps(record["entry"]["word"], ensure_ascii=False)}\n'
                f'source_title: {json.dumps(record["entry"]["title"], ensure_ascii=False)}\n'
                f'study_id: {record["id"]}\nanki_state: {record["ankiState"]}\n'
                f'anki_note_id: {json.dumps(record.get("noteId"))}\n---\n<!-- english-study-v1:{metadata} -->\n')

    def read(self, ident):
        return self.read_file(self.path(ident), ident)

    def read_file(self, p, ident):
        content = self.file_content(p)
        if re.search(r'--w[a-f0-9]{32}\.md$', p.name):
            contexts = self.word_contexts(content)
            if ident not in contexts:
                raise FileNotFoundError('单词文档尚无该语境。')
            return contexts[ident][:3]
        match = re.search(r'^<!-- english-study-v1:(.+) -->$', content, re.M)
        if not match:
            raise ValueError('已有同名文件不是本程序记录，不会覆盖。')
        record = json.loads(match[1])
        header = self.header(record)
        if record['id'] != ident or not content.startswith(header):
            raise ValueError('记录元数据已修改，停止自动覆盖。')
        return record, content[len(header):], hashlib.sha256(content.encode()).hexdigest()

    def write(self, record, body, expected=None):
        p = self.path(record['id'], record['entry'])
        value = self.header(record) + body
        if re.search(r'--w[a-f0-9]{32}\.md$', p.name):
            block = self.context_block(record, body)
            if p.exists():
                content = self.file_content(p)
                contexts = self.word_contexts(content)
                if next(iter(contexts.values()))[0]['entry']['word'].casefold() != record['entry']['word'].casefold():
                    raise ValueError('已有同名单词文档的词面不同，不会覆盖。')
                context = contexts.get(record['id'])
                if expected is None:
                    if context:
                        raise ValueError('语境已存在，请重新读取；未重复写入。')
                    value = content + '\n' + block
                else:
                    if not context or context[2] != expected:
                        raise ValueError('笔记已发生变化，请刷新后再操作；没有覆盖你的修改。')
                    start, end = context[3]
                    value = content[:start] + block + content[end:]
                # Context versions are independent; atomic replacement still checks the whole file.
                expected = hashlib.sha256(content.encode()).hexdigest()
            else:
                if expected is not None:
                    raise ValueError('原单词文档已不存在，停止自动重建。')
                value = self.word_header(record['entry']) + block
        if len(value.encode()) > 2000000:
            raise ValueError('单条学习笔记超过 2MB，停止写入；原文保留，请拆分材料后继续。')
        if expected is None:
            fd, temporary = tempfile.mkstemp(prefix='.study-', dir=self.records)
            try:
                with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                    fd = -1
                    stream.write(value)
                    stream.flush()
                    os.fsync(stream.fileno())
                self.check_path(p)
                # link publishes the complete file atomically and fails if a path appeared meanwhile.
                os.link(temporary, p)
                directory_fd = os.open(self.records, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            finally:
                if fd >= 0:
                    os.close(fd)
                if os.path.exists(temporary):
                    os.unlink(temporary)
        else:
            if hashlib.sha256(p.read_bytes()).hexdigest() != expected:
                raise ValueError('笔记已发生变化，请刷新后再操作；没有覆盖你的修改。')
            fd, temporary = tempfile.mkstemp(prefix='.study-', dir=self.records)
            try:
                with os.fdopen(fd, 'w') as stream:
                    stream.write(value)
                    stream.flush()
                    os.fsync(stream.fileno())
                self.check_path(p)
                if hashlib.sha256(p.read_bytes()).hexdigest() != expected:
                    raise ValueError('笔记并发修改，停止覆盖。')
                os.replace(temporary, p)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        if p.read_text() != value:
            raise ValueError('笔记写入后读回不一致。')

    def draft_block(self, draft, record=None):
        content = '\n<!-- study-review-draft:start -->\n## 复习草稿（候选，未选内容不会送入 Anki）\n\n' + paragraph(draft['reason']) + '\n'
        if not draft['cards']:
            content += '\n本次无需新增复习卡（正常零卡）。\n'
        confirmed_cards = (record.get('cards', []) if record else [])
        for card in draft['cards']:
            confirmed = next((c for c in confirmed_cards if c['front'].strip() == card['front'].strip() and c['back'].strip() == card['back'].strip()), None)
            if confirmed:
                state_desc = 'Anki 已同步' if confirmed.get('state') == 'synced' else '等待送入 Anki'
                label = f'候选已确认（{state_desc}）'
            elif card.get('selected'):
                label = '候选已勾选'
            else:
                label = '候选未勾选'
            content += '\n' + label + '\n\n' + paragraph(card['front']) + '\n\n' + paragraph(card['back']) + '\n'
        return content + '\n<!-- study-review-draft:end -->\n'

    def without_draft(self, record, body):
        if record.get('reviewDraft'):
            block = self.draft_block(record['reviewDraft'], record)
            if body.count(block) == 1:
                return body.replace(block, '', 1)
            legacy_block = self.draft_block(record['reviewDraft'])
            if body.count(legacy_block) == 1:
                return body.replace(legacy_block, '', 1)
            m = re.search(r'\n<!-- study-review-draft:start -->\n.*?<!-- study-review-draft:end -->\n', body, re.S)
            if m:
                candidate_body = body[:m.start()] + body[m.end():]
                if hashlib.sha256(candidate_body.encode()).hexdigest() == record['reviewDraft'].get('sourceHash'):
                    return candidate_body
            if body.count(block) != 1:
                raise ValueError('草稿自动区被手动修改，请先核对；不会覆盖你的内容。')
            return body.replace(block, '', 1)
        if '<!-- study-review-draft:' in body:
            raise ValueError('草稿区域与元数据不一致，停止覆盖。')
        return body

    def set_draft(self, record, body, draft):
        body = self.without_draft(record, body)
        if draft is None:
            record.pop('reviewDraft', None)
        else:
            draft = {**draft, 'sourceHash': hashlib.sha256(body.encode()).hexdigest()}
            record['reviewDraft'] = draft
            body += self.draft_block(draft, record)
        return body

    def target_details(self):
        details = {'deck': self.deck, 'model': self.model}
        if self.deck_by_kind:
            details['deckByKind'] = self.deck_by_kind.copy()
        if self.target_id:
            details.update({'targetId': self.target_id, 'vault': str(self.vault), 'directory': str(self.relative), 'ankiEnabled': self.anki_enabled})
        return details

    def result(self, ident):
        r, body, version = self.read(ident)
        import study_sync
        latest = study_sync.local_fields(r, body)
        r = {**r, 'entry': {**r['entry'], **{k: latest[k] for k in study_sync.SYNC_KEYS}}, 'favorite': latest.get('favorite', r.get('favorite', False))}
        stale = bool(r.get('reviewDraft')) and r['reviewDraft']['sourceHash'] != hashlib.sha256(self.without_draft(r, body).encode()).hexdigest()
        return {**r, 'favorite': bool(r.get('favorite', False)),
                'learningState': r.get('learningState', 'saved'), 'syncState': r.get('syncState', r.get('ankiState', 'saved')),
                'version': version, 'path': str(self.path(ident).relative_to(self.vault)),
                'target': self.target_details(), 'draftStale': stale,
                **({'targetId': self.target_id, 'ankiEnabled': self.anki_enabled} if self.target_id else {}),
                'vaultSaved': True, 'openUrl': self.open_url(ident)}

    def open_url(self, ident):
        return 'obsidian://open?' + urllib.parse.urlencode({'vault': self.vault.name, 'file': str(self.path(ident).relative_to(self.vault))})

    def language_fields(self, fields, entry, question=None):
        if self.language == 'ja':
            fields.update({'Word': html.escape(entry['word']), 'Expression': html.escape(entry.get('lemma') or entry['word']),
                           'Reading': html.escape(entry.get('reading', '')),
                           'Question': html.escape(question or ('这句话中的 ' + entry['word'] + ' 怎么理解？')).replace('\n', '<br>'),
                           'DictionaryNotes': html.escape(entry.get('dictionaryNotes', '')).replace('\n', '<br>')})
        return fields

    def sync(self, ident):
        if not self.anki_enabled:
            return self.result(ident)
        r, body, version = self.read(ident)
        if r.get('noteId') and not r['entry'].get('subtitleSource'):
            import study_sync
            return study_sync.reconcile(self, {'id': ident})
        if r.get('cards'):
            return self.sync_cards(r, body, version)
        r['ankiState'] = 'pending'
        r.pop('error', None)
        try:
            from study_memory import duplicate, exact_tag, invalidate_anki, norm
            import study_sync
            e = r['entry']
            local = study_sync.local_fields(r, body)
            legacy = {c['id']:c for c in local.get('cards', [])}.get('legacy', {})
            fields = {k: '' for k in ('Word', 'Sentence', 'Definition', 'Source', 'URL', 'Audio', 'Image')}
            for k, value in {'Word': legacy.get('front', e['word']), 'Sentence': local['sentence'],
                             'Definition': legacy.get('back', '\n'.join(filter(None, [local['meaning'], local['translation']]))),
                             'Source': local['title']}.items():
                fields[k] = html.escape(value).replace('\n', '<br>')
            if not fields['Definition']:
                raise ValueError('已保存原句；请先补充含义再制卡。')
            fields['URL'] = html.escape(local['url'])
            fields['Source'] = study_sync.source_field(self, r, local)
            fields['Definition'] = study_sync.definition_field(legacy.get('back', '\n'.join(filter(None, [local['meaning'], local['translation']]))), local)
            self.language_fields(fields, e)
            found = self.anki('findNotes', {'query': 'tag:study_' + ident})
            if r.get('linkedExisting') and r.get('noteId'):
                found = [r['noteId']]
            if not isinstance(found, list) or len(found) > 1 or (r.get('noteId') and r['noteId'] not in found):
                raise ValueError('原关联卡已删除或异常，请人工确认，不自动重建。')
            if not found:
                existing = duplicate(self, fields)
                if existing is not None:
                    found = [existing]
                    r['linkedExisting'] = True
            if not found:
                study_sync.require_deck(self, self.deck)
                from study_media import anki_fields
                fields.update(anki_fields(self, r))
            note_id = found[0] if found else self.anki('addNote', {'note': {
                'deckName': self.deck, 'modelName': self.model, 'fields': fields,
                'tags': ['study_' + ident, exact_tag(self, fields), 'japanese_study' if self.language == 'ja' else 'english_study'],
                'options': {'allowDuplicate': True}}})
            if type(note_id) is not int:
                raise ValueError('Anki 未返回有效编号。')
            r['noteId'] = note_id
            info = self.anki('notesInfo', {'notes': [note_id]})
            equal = (lambda a, b: norm(a) == norm(b)) if r.get('linkedExisting') else (lambda a, b: a == b)
            keys = ('Word', 'Sentence', 'Definition', 'Expression', 'Question', 'Reading') if self.language == 'ja' else ('Word', 'Sentence', 'Definition')
            if not isinstance(info, list) or len(info) != 1 or info[0].get('noteId') != note_id or any(not equal(study_sync.comparable_field(k,info[0].get('fields', {}).get(k, {}).get('value')), study_sync.comparable_field(k,fields[k])) for k in keys):
                raise ValueError('关联卡内容读回不同，请人工确认；不覆盖或重建已有卡。')
            if not found and any(info[0]['fields'].get(k, {}).get('value') != fields[k] for k in ('Audio', 'Image')):
                raise ValueError('Anki 媒体字段读回不一致，保留待核验；未覆盖。')
            r['ankiState'] = 'synced'
            baseline = r.setdefault('syncBaseline', {})
            for key in study_sync.SYNC_KEYS:
                baseline.setdefault(key, local.get(key, ''))
            legacy_fields = next((c for c in local.get('cards', []) if c['id'] == 'legacy'),
                                 {'front':e['word'], 'back':'\n'.join(filter(None, (e['meaning'], e['translation'])))})
            baseline.setdefault('card.legacy.front', legacy_fields['front'])
            baseline.setdefault('card.legacy.back', legacy_fields['back'])
            body = study_sync.with_local_fields(body, study_sync.local_fields(r, body))
            invalidate_anki(self)
        except Exception as error:
            r['ankiState'] = 'pending'
            r['error'] = str(error)[:200] if isinstance(error, ValueError) else 'Anki 未连接或响应不确定；笔记已保存，可稍后补交。'
        self.write(r, body, version)
        return self.result(ident)

    def material(self, ident):
        r, body, version = self.read(ident)
        body = self.without_draft(r, body)
        confirmed = '已确认复习卡（本记录，非全Anki库）：\n' + '\n'.join(c['front'] + ' → ' + c['back'] + ' [' + c['state'] + ']' for c in r.get('cards', [])[-8:])
        if r.get('noteId') and not r.get('cards'):
            confirmed += '\n旧词句卡：' + r['entry']['word'] + ' → ' + r['entry']['meaning'] + ' [' + r['ankiState'] + ']'
        confirmed = re.sub(r'(?:https?://|obsidian://)\S+|\[\[.*?\]\]', '[来源省略]', confirmed)
        confirmed = confirmed[:2400] + ('\n[历史卡摘要截断]' if len(confirmed) > 2400 else '')
        # Send learning prose, including user edits, but not metadata, source URLs or vault paths.
        body = re.sub(r'^#{2,3} 来源\n.*?(?=^#{2,3} |\Z)', '', body, flags=re.M | re.S)
        body = re.sub(r'\[\[.*?\]\]', '', body)
        body = re.sub(r'(?:https?://|obsidian://)\S+', '[来源链接省略]', body)
        truncated = len(body) > 6000
        if truncated:
            body = body[:1000] + '\n[中间较早内容未送入本次模型，完整记录仍在笔记]\n' + body[-5000:]
        return {'id': ident, 'version': version, 'word': r['entry']['word'], 'language': self.language, 'text': body,
                'truncated': truncated, 'confirmedCards': confirmed, 'updated': r.get('updated', r['created'])}

    def sync_cards(self, r, body, version):
        if not self.anki_enabled:
            return self.result(r['id'])
        if r.get('cards') and all(c.get('noteId') for c in r['cards']) and not r['entry'].get('subtitleSource'):
            import study_sync
            return study_sync.reconcile(self, {'id': r['id']})
        for card in r['cards']:
            card['state'] = 'pending'
            card.pop('error', None)
            try:
                import study_sync
                card.setdefault('kind', study_sync.default_card_kind(r['entry']))
                card.setdefault('target', study_sync.card_target(self, card))
                tag = 'studycard_' + card['id']
                found = self.anki('findNotes', {'query': 'tag:' + tag})
                if card.get('linkedExisting') and card.get('noteId'):
                    found = [card['noteId']]
                if not isinstance(found, list) or len(found) > 1 or (card.get('noteId') and card['noteId'] not in found):
                    raise ValueError('关联卡异常或被删除，请人工检查；不覆盖或自动重建。')
                source_values = study_sync.local_fields(r, body)
                fields = {'Word': html.escape(card['front']).replace('\n', '<br>'),
                          'Sentence': html.escape(source_values['sentence']).replace('\n', '<br>'),
                          'Definition': study_sync.definition_field(card['back'], source_values),
                          'Source': study_sync.source_field(self, r, source_values),
                          'URL': html.escape(source_values['url']), 'Audio': '', 'Image': ''}
                self.language_fields(fields, r['entry'], card['front'])
                if not found:
                    from study_memory import duplicate
                    existing = duplicate(self, fields, r['entry'])
                    if existing is not None:
                        found = [existing]
                        card['linkedExisting'] = True
                if not found:
                    from study_memory import duplicate_point
                    existing = duplicate_point(self, r['entry'], card['front'], card['back'], fields)
                    if existing is not None:
                        found = [existing]
                        card['linkedExisting'] = True
                        card['linkedByPoint'] = True
                if not found:
                    study_sync.require_deck(self, card.get('target', {}).get('deck', self.deck))
                    from study_media import anki_fields
                    fields.update(anki_fields(self, r))
                self.language_fields(fields, r['entry'], card['front'])
                from study_memory import exact_tag, point_id
                note_id = found[0] if found else self.anki('addNote', {'note': {
                    'deckName': card.get('target', {}).get('deck', self.deck), 'modelName': self.model, 'fields': fields,
                    'tags': study_sync.card_tags(r, card['kind']) + [tag, exact_tag(self, fields), 'studypoint_' + point_id(self, r['entry'], card['front'], card['back']), 'japanese_study' if self.language == 'ja' else 'english_study'], 'options': {'allowDuplicate': True}}})
                if type(note_id) is not int:
                    raise ValueError('Anki 未返回有效编号。')
                card['noteId'] = note_id
                info = self.anki('notesInfo', {'notes': [note_id]})
                from study_memory import norm
                equal = (lambda a, b: norm(a) == norm(b)) if card.get('linkedExisting') else (lambda a, b: a == b)
                keys = ('Word', 'Sentence', 'Definition', 'Question', 'Expression', 'Reading') if self.language == 'ja' else ('Word', 'Sentence', 'Definition')
                if card.get('linkedByPoint'): keys = tuple(k for k in keys if k != 'Sentence')
                if not isinstance(info, list) or len(info) != 1 or info[0].get('noteId') != note_id or any(not equal(study_sync.comparable_field(k,info[0].get('fields', {}).get(k, {}).get('value')), study_sync.comparable_field(k,fields[k])) for k in keys):
                    raise ValueError('卡片读回不同，请人工确认，不覆盖已有卡。')
                if not found and any(info[0]['fields'].get(k, {}).get('value') != fields[k] for k in ('Audio', 'Image')):
                    raise ValueError('Anki 媒体字段读回不同，请人工确认。')
                if not found:
                    note = study_sync.schedule_new_card(self, r, card, info[0])
                    if note:
                        card['schedule'] = note
                actual_deck = study_sync._actual_deck(self, info[0], card['target'].get('deck', self.deck))
                card['target']['deck'] = actual_deck
                card['deck'] = actual_deck
                if self.target_id:
                    card['target']['targetId'] = self.target_id
                card['state'] = 'synced'
            except Exception as error:
                card['error'] = str(error)[:200] if isinstance(error, ValueError) else 'Anki 未连接或结果不确定，草稿已保存，可补交。'
        from study_memory import invalidate_anki
        invalidate_anki(self)
        r['ankiState'] = 'synced' if all(c['state'] == 'synced' for c in r['cards']) else 'pending'
        baseline = r.setdefault('syncBaseline', {})
        for key in study_sync.SYNC_KEYS:
            baseline.setdefault(key, r['entry'].get(key, ''))
        for card in r['cards']:
            baseline.setdefault('card.' + card['id'] + '.front', card['front'])
            baseline.setdefault('card.' + card['id'] + '.back', card['back'])
        r.pop('error', None)
        if r['ankiState'] == 'pending':
            r['error'] = '部分已确认卡片待补交；保存的草稿不会丢失。'
        body = study_sync.with_local_fields(body, study_sync.local_fields(r, body))
        if r.get('reviewDraft'):
            body = self.set_draft(r, body, r['reviewDraft'])
        self.write(r, body, version)
        return self.result(r['id'])

    def handle(self, payload):
        p = normalize_request(payload)
        lang = language(p.get('language', p.get('entry', {}).get('language', 'en')))
        if p.get('action') == 'librarySave' and lang != p['entry'].get('language', 'en'):
            raise ValueError('保存请求与条目语言不同。')
        if lang != self.language:
            return StudyLibrary(self.vault, self.anki, lang, self.cache_dir).handle(p)
        if p['action'] == 'libraryPrepareJapanese':
            if self.language != 'ja':
                raise ValueError('此操作仅准备独立日语牌组。')
            from study_japanese import prepare
            return prepare(self.anki)
        if p['action'] == 'libraryMemory':
            from study_memory import memory
            return memory(self, p['word'], p.get('lemma', ''), p.get('fresh', False))
        if not self.anki_enabled and p['action'] in ('libraryCards', 'libraryDraftCommit', 'librarySync'):
            ids = p.get('ids', []) or [x['id'] for x in p.get('items', [])]
            return {'items': [self.result(i) for i in ids], 'ankiEnabled': False}
        if p['action'] == 'libraryList' and not self.records.exists():
            self.check_path(self.records)
            return {'items': [], 'total': 0, 'target': {'deck': self.deck, 'model': self.model}}
        with self.locked():
            # R2 is a record-only contract. No ID-based card/AI/media route may bypass it.
            if p['action'] in ('libraryCards', 'libraryCardsAdd', 'libraryUpdate', 'libraryReconcile', 'libraryFavorite', 'libraryDraftSave', 'libraryDraftDiscard', 'libraryDraftCommit', 'librarySync', 'libraryEnrich', 'libraryMedia'):
                ids = p.get('ids', []) + [x['id'] for x in p.get('items', [])]
                if p.get('id'):
                    ids.append(p['id'])
                for ident in ids:
                    source = self.read(ident)[0]['entry'].get('subtitleSource')
                    if source:
                        grant = p.get('cueAuthorization')
                        if not grant or grant['id'] != ident or grant['source'] != source or p['action'] in ('libraryCards', 'libraryCardsAdd', 'libraryUpdate', 'libraryFavorite', 'libraryReconcile', 'libraryEnrich', 'libraryMedia'):
                            raise ValueError('字幕学习记录必须由私有可信记住动作授权。')
                        if p['action'] == 'libraryDraftSave' and any(len(x['cards']) > 1 for x in p['items']):
                            raise ValueError('字幕每次只允许必要的0或1张卡。')
            if p['action'] == 'libraryMedia':
                from study_media import attach
                return attach(self, {k: v for k, v in p.items() if k != 'language'})
            if p['action'] == 'libraryRead':
                from study_memory import memory, compact
                self.memory_deadline = time.monotonic() + 1.2
                try:
                    items = []
                    for i in p['ids']:
                        record = self.result(i)
                        e = record['entry']
                        evidence = {'unavailable': True} if e.get('subtitleSource') or not self.anki_enabled else memory(self, e['word'], e.get('lemma', ''))
                        items.append({**self.material(i), 'record': record, 'relatedMemory': compact(evidence)})
                    return {'items': items, **({'ankiEnabled': self.anki_enabled} if self.target_id else {})}
                finally:
                    del self.memory_deadline
            if p['action'] in ('libraryCardsAdd', 'libraryUpdate', 'libraryFavorite', 'libraryReconcile'):
                import study_sync
                return study_sync.handle(self, p)
            if p['action'] in ('libraryDraftSave', 'libraryDraftDiscard'):
                staged = []
                for item in p['items']:
                    r, body, version = self.read(item['id'])
                    if version != item['version']:
                        raise ValueError('笔记已变化，请重新读取草稿；没有覆盖或制卡。')
                    draft = None
                    if p['action'] == 'libraryDraftSave':
                        if r.get('reviewDraft') and self.result(r['id'])['draftStale']:
                            raise ValueError('学习内容已有更新，请先放弃旧草稿，再根据新内容生成。')
                        draft = {'id': r.get('reviewDraft', {}).get('id') or hashlib.sha256((r['id'] + version).encode()).hexdigest()[:32],
                                 'reason': item['reason'], 'cards': [{**c, 'selected': c['selected'] and not any(old['front'] == c['front'] and old['back'] == c['back'] for old in r.get('cards', []))} for c in item['cards']]}
                    previous = r.get('reviewDraft') if p['action'] == 'libraryDraftDiscard' else None
                    body = self.set_draft(r, body, draft)
                    if previous:
                        body += '\n## 以前的复习建议（历史保留，不作为当前选卡）\n\n' + paragraph(previous['reason']) + '\n'
                        for card in previous['cards']:
                            body += '\n' + paragraph(card['front']) + '\n' + paragraph(card['back']) + '\n'
                    staged.append((r, body, version))
                for args in staged:
                    self.write(*args)
                return {'items': [self.result(r['id']) for r, _, _ in staged]}
            if p['action'] in ('libraryCards', 'libraryDraftCommit'):
                staged = []
                for item in p['items']:
                    r, body, version = self.read(item['id'])
                    if version != item['version']:
                        raise ValueError('笔记在预览后已变化，请重新生成草稿；没有覆盖或制卡。')
                    draft = r.get('reviewDraft')
                    if p['action'] == 'libraryDraftCommit':
                        if not draft or draft['id'] != item['draftId'] or self.result(r['id'])['draftStale']:
                            raise ValueError('草稿已变化或学习内容更新，请重新读取；未制卡。')
                        candidates = [{k:c[k] for k in ('front', 'back', 'kind') if k in c} for c in draft['cards'] if c['selected']]
                        if not candidates:
                            raise ValueError('请先选择并保存至少一张草稿。')
                    else:
                        candidates = item['cards']
                    cards = r.setdefault('cards', [])
                    for c in candidates:
                        card_id = hashlib.sha256((r['id'] + '\n' + c['front'].strip()).encode()).hexdigest()[:32]
                        old = next((x for x in cards if x['id'] == card_id), None)
                        if old:
                            if old['back'] != c['back'].strip():
                                raise ValueError('相同问题已有不同答案的草稿，请人工核对；不重复或覆盖旧卡。')
                            continue
                        card = {**c, 'front': c['front'].strip(), 'back': c['back'].strip(), 'id': card_id, 'state': 'pending', 'noteId': None}
                        cards.append(card)
                        body += '\n## 已确认复习卡\n\n' + paragraph(card['front']) + '\n\n' + paragraph(card['back']) + '\n'
                    r['ankiState'] = 'pending'
                    if p['action'] == 'libraryDraftCommit':
                        body = self.set_draft(r, body, {**draft, 'cards': [{**c, 'selected': False} for c in draft['cards']]})
                    staged.append((r, body, version))
                # Persist every confirmed draft before making any external Anki request.
                for args in staged:
                    self.write(*args)
                return {'items': [self.sync(r['id']) for r, _, _ in staged]}
            if p['action'] == 'librarySave':
                e = p['entry']
                if e.get('subtitleSource') and p['makeCard']:
                    raise ValueError('字幕契约尚未开放 Anki；记录未保存。')
                ident = entry_id(e)
                target = self.path(ident, e)
                grouped = bool(re.search(r'--w[a-f0-9]{32}\.md$', target.name))
                heading = '###' if grouped else '##'
                if not target.exists() or ident not in self.file_ids(target):
                    r = {'id': ident, 'entry': e, 'ankiState': 'saved', 'noteId': None,
                         'created': datetime.datetime.now().astimezone().isoformat()}
                    if self.target_id:
                        r['targetId'] = self.target_id
                        r['savedTarget'] = self.target_details()
                    body = (f'\n## 语境 · {safe_markdown(e["title"] or e["sentence"][:80])}\n' if grouped
                            else f'\n# {safe_markdown(e["word"])}\n')
                    body += f'\n[[{self.relative}/语境词库|语境词库]]\n\n'
                    body += '解释来源：' + safe_markdown(e['explanationSource'] or '保存时的解释，来源未标明') + '。\n\n'
                    for label, key in [('原句', 'sentence'), ('补充语境', 'context'), ('含义（保存时的解释）', 'meaning'), ('译文', 'translation'), ('学习提示', 'notes'), ('词典原形', 'lemma'), ('假名读音' if self.language == 'ja' else '词典读音', 'reading'), ('词典形态与读音资料（非 AI）', 'dictionaryNotes'), ('词典原文与 AI 辅助中文（非语境解释）', 'dictionaryTranslation')]:
                        if e.get(key):
                            if key == 'reading' and not is_valid_reading(e[key], e, self.language):
                                continue
                            body += f'{heading} {label}\n\n{paragraph(e[key])}\n\n'
                    body += f'{heading} 来源\n\n{paragraph(e["title"])}\n\n{paragraph(e["url"])}\n'
                    if 'videoTime' in e:
                        body += f'\n视频位置：{e["videoTime"]} 秒\n'
                    if e.get('subtitleSource'):
                        c = e['subtitleSource']
                        body += ('\n字幕原始时间（ms）：' + str(c['originalStartMs']) + '–' + str(c['originalEndMs']) +
                                 '；偏移（ms，仅回源加一次）：' + str(c['subtitleOffsetMs']) +
                                 '；轨道：' + safe_markdown(c['trackName']) + ' [' + str(c['trackIndex']) + ']；语言：' + c['language'] + '\n')
                    if p['turns']:
                        body += f'\n{heading} 我的理解与问题\n\n'
                    else:
                        body += f'\n{heading} 学习记录\n\n> 本次未进行 AI 语境消歧（直接以词典泛义保存）。\n\n'
                    self.write(r, body)
                old, body, version = self.read(ident)
                changed = {k: e[k] for k in ('meaning', 'translation', 'notes', 'context', 'explanationSource', 'lemma', 'reading', 'dictionaryNotes', 'dictionaryTranslation')
                           if e.get(k) and e[k] != old['entry'].get(k) and not (k == 'reading' and not is_valid_reading(e[k], e, self.language))}
                if changed:
                    old['entry'].update(changed)
                    body += f'\n{heading} 后续学习补充（再次主动保存）\n\n' + paragraph('\n'.join(changed.values())) + '\n'
                seen = old.setdefault('turnIds', [])
                added = False
                if e.get('url'):
                    from study_video import ROOT as video_root, canonical_url, digest
                    video_id = digest(canonical_url(e['url']))
                    video_base = self.vault / video_root
                    self.check_path(video_base)
                    video_paths = list(video_base.glob('*--' + video_id + '.md'))
                    if len(video_paths) > 1:
                        raise ValueError('视频主记录重复，请先核对来源。')
                    video_path = video_paths[0] if video_paths else None
                    if video_path is not None:
                        self.check_path(video_path)
                    video_link = f'[[{video_root}/{video_path.stem}|视频材料与完整字幕]]' if video_path else ''
                    if video_path and video_path.is_file() and video_link not in body:
                        body += '\n关联材料：' + video_link + '\n'
                        added = True
                for turn in p['turns']:
                    if turn['id'] in seen:
                        continue
                    if f'{heading} 我的理解与问题' not in body:
                        body += f'\n{heading} 我的理解与问题\n\n'
                    added = True
                    seen.append(turn['id'])
                    feedback = {'unconfirmed': '尚未确认理解', 'understood': '本人反馈：这次解释我懂了', 'unclear': '本人反馈：仍然不懂'}[turn['feedback']]
                    turn_label = '理解反馈' if turn.get('kind') == 'feedback' else ('翻译过程' if turn.get('mode') == 'translate' else '学习过程')
                    body += '\n' + heading + ' ' + turn_label + ' · ' + safe_markdown(turn['at']) + '\n\n'
                    body += '轮次 ID：' + safe_markdown(turn.get('relatedTurnId', turn['id'])) + '\n\n'
                    for label, key in [('我的问题', 'question'), ('原句翻译', 'translation'), ('这里的含义', 'meaning'), ('AI 的解释（非权威原文）', 'notes')]:
                        if turn[key]:
                            body += label + '：\n\n' + paragraph(turn[key]) + '\n\n'
                    body += feedback + '\n'
                    if 'usage' in turn:
                        u = turn['usage']
                        body += '\nToken：' + ('缓存命中，本次未调用模型' if u['status'] == 'cached' else ('已报告 ' + str(u['totalTokens']) + '（输入 ' + str(u.get('inputTokens', '?')) + ' / 输出 ' + str(u.get('outputTokens', '?')) + '）' if 'totalTokens' in u else '未报告，不能视为 0')) + ('；请求未完整结束' if u['status'] in ('running','incomplete') else '') + '\n'

                if old.get('learningState') != 'saved':
                    old['learningState'] = 'saved'
                    added = True
                if changed or added:
                    old['updated'] = datetime.datetime.now().astimezone().isoformat()
                    self.write(old, body, version)
                return self.sync(ident) if p['makeCard'] else self.result(ident)
            if p['action'] == 'libraryList':
                rows = []
                for f, ident in self.record_files():
                    r = self.result(ident)
                    e = r['entry']
                    match = True if p.get('scope') == 'all' else (r['ankiState'] == 'pending' if p.get('scope') == 'pending' else e['url'] == p['url'] and (p['url'] or e['title'] == p['title']))
                    if match:
                        rows.append(r)
                rows.sort(key=lambda r: r['created'], reverse=True)
                offset = p.get('offset', 0)
                return {'items': rows[offset:offset + 10], 'total': len(rows), 'target': {'deck': self.deck, 'model': self.model}}
            if p['action'] == 'librarySync':
                return {'items': [self.sync(i) for i in p['ids']]}
            staged = []
            for item in p['items']:
                r, body, version = self.read(item['id'])
                if version != item['version']:
                    raise ValueError('笔记已变化，请重新整理；未覆盖人工修改。')
                addition = '\n## AI 整理（已确认保存，非词典原文）\n\n' + paragraph(item['text']) + '\n'
                if addition not in body:
                    body += addition
                staged.append((r, body, version))
            for args in staged:
                self.write(*args)
            return {'items': [self.result(r['id']) for r, _, _ in staged]}
