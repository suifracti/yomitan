#!/usr/bin/env python3
"""Bounded subtitle archive. No Anki actions, arbitrary paths, network or media download."""
import contextlib
import datetime
import fcntl
import hashlib
import json
import math
import os
import pathlib
import re
import tempfile
import urllib.parse
from study_library import text, source_url, safe_markdown, paragraph

ROOT = pathlib.Path('02-个人与生活/阅读与观影/观影/视频记录')
PROMPT_VERSION = 1
ID = re.compile(r'[a-f0-9]{32}')
BEGIN = '<!-- study-video-generated:start -->'
END = '<!-- study-video-generated:end -->'
SUMMARY_BEGIN = '<!-- study-video-summary:start -->'
SUMMARY_END = '<!-- study-video-summary:end -->'


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:32]


def canonical_url(value):
    if not value:
        raise ValueError('视频来源地址不能为空。')
    u = urllib.parse.urlsplit(source_url(value))
    host = (u.hostname or '').lower()
    q = urllib.parse.parse_qs(u.query)
    if host in ('youtu.be', 'www.youtube.com', 'youtube.com', 'm.youtube.com'):
        ident = u.path.strip('/').split('/')[-1] if host == 'youtu.be' or u.path.startswith(('/shorts/', '/embed/')) else q.get('v', [''])[0]
        if re.fullmatch(r'[A-Za-z0-9_-]{1,80}', ident):
            return 'https://www.youtube.com/watch?v=' + ident
    if host in ('www.bilibili.com', 'bilibili.com') and re.fullmatch(r'/video/[A-Za-z0-9]+/?', u.path):
        part = q.get('p', ['1'])[0]
        if not part.isdigit():
            raise ValueError('B站分P编号无效。')
        return 'https://www.bilibili.com' + u.path.rstrip('/') + '?p=' + part
    clean = [(k, v) for k, values in q.items() for v in values if not k.startswith('utm_') and k not in ('t', 'start', 'fbclid')]
    return urllib.parse.urlunsplit((u.scheme, u.netloc, u.path, urllib.parse.urlencode(sorted(clean)), ''))


def number(x, maximum):
    if isinstance(x, bool) or not isinstance(x, (float, int)) or not math.isfinite(x) or not 0 <= x <= maximum:
        raise ValueError('字幕或播放时间无效。')
    return x


def normalize_request(p):
    if not isinstance(p, dict):
        raise ValueError('视频请求必须是对象。')
    action = p.get('action')
    if action == 'videoSave' and set(p) == {'action', 'url', 'title', 'language', 'track', 'config', 'subtitles'}:
        from study_translator import normalize_config
        if p['language'] not in ('en', 'ja'):
            raise ValueError('请选择英语或日语字幕，不自动猜测。')
        rows = p['subtitles']
        if not isinstance(rows, list) or not 1 <= len(rows) <= 5000:
            raise ValueError('支持1–5000条文字字幕；不裁剪超限或图片字幕。')
        result = {**p, 'url': canonical_url(p['url']), 'title': text(p['title'], 300, True), 'track': text(p['track'], 300, True), 'config': normalize_config(p['config'])}
        total = 0
        for row in rows:
            if not isinstance(row, dict) or set(row) != {'start', 'end', 'text'}:
                raise ValueError('字幕字段无效。')
            number(row['start'], 604800000); number(row['end'], 604800000)
            if row['end'] < row['start']:
                raise ValueError('字幕结束早于开始。')
            text(row['text'], 2000, True)
            total += len(row['text'].encode())
        if total > 750000:
            raise ValueError('字幕文本超过750KB；没有截断或发送。')
        return result
    if action in ('videoRead', 'videoTranslate', 'videoContinue') and set(p) == {'action', 'id'} and isinstance(p['id'], str) and ID.fullmatch(p['id']):
        return p
    if action == 'videoPage' and set(p) == {'action', 'id', 'offset'} and isinstance(p['id'], str) and ID.fullmatch(p['id']) and type(p['offset']) is int and 0 <= p['offset'] <= 5000:
        return p
    if action == 'videoEvent' and set(p) == {'action', 'id', 'eventId', 'at', 'kind', 'position'}:
        if not isinstance(p['id'], str) or not ID.fullmatch(p['id']) or not isinstance(p['eventId'], str) or not ID.fullmatch(p['eventId']) or p['kind'] not in ('loaded', 'play', 'pause', 'position'):
            raise ValueError('观看事件编号或类型无效。')
        number(p['position'], 604800); number(p['at'], (datetime.datetime.now().timestamp()+300)*1000)
        if p['at'] < (datetime.datetime.now().timestamp()-180*86400)*1000:
            raise ValueError('待补交事件超过180天，请手工核对。')
        return p
    raise ValueError('不支持的视频请求或字段。')


class VideoLibrary:
    def __init__(self, vault):
        self.vault = pathlib.Path(vault)
        if not self.vault.is_absolute() or not self.vault.is_dir():
            raise ValueError('未连接可用的 Obsidian Vault。')
        self.base = self.vault / ROOT

    def check(self, p):
        for q in [p, *p.parents]:
            if q.is_symlink():
                raise ValueError('视频记录路径含符号链接，停止读写。')
            if q == self.vault:
                return
        raise ValueError('路径超出 Vault。')

    @contextlib.contextmanager
    def lock(self):
        self.check(self.base)
        self.base.mkdir(parents=True, exist_ok=True)
        with os.fdopen(os.open(self.base/'.video.lock', os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW, 0o600), 'w') as f:
            try:
                fcntl.flock(f, fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError('视频任务正在写入或翻译；稍后重试，不会并发重复请求。')
            yield

    def write(self, p, content, expected=None):
        self.check(p); p.parent.mkdir(parents=True, exist_ok=True)
        actual = p.read_text() if p.exists() else None
        if actual != expected:
            raise ValueError('笔记被同时修改，请重试；没有覆盖新内容。')
        fd, name = tempfile.mkstemp(prefix='.video-', dir=p.parent)
        try:
            with os.fdopen(fd, 'w') as f:
                f.write(content);f.flush();os.fsync(f.fileno())
            self.check(p)
            if (p.read_text() if p.exists() else None) != expected:
                raise ValueError('检测到并发修改，停止写入。')
            os.replace(name, p)
            if p.read_text() != content:
                raise ValueError('视频笔记读回不一致。')
        finally:
            if os.path.exists(name):os.unlink(name)

    def state_path(self, ident):
        if not ID.fullmatch(ident):raise ValueError('编号无效。')
        p = self.base/'.state'/(ident+'.json');self.check(p)
        return p

    def read(self, ident):
        p=self.state_path(ident)
        if not p.is_file():raise ValueError('未找到视频字幕记录。')
        r=json.loads(p.read_text())
        if r.get('id') != ident:raise ValueError('视频状态编号不符。')
        return r

    def persist(self, r):
        p=self.state_path(r['id']);old=p.read_text() if p.exists() else None
        self.write(p, json.dumps(r, ensure_ascii=False), old)

    def note_path(self, r):
        return self.base/r['videoName']/(r['language']+'字幕--'+r['id']+'.md')

    def render(self, r):
        p=self.note_path(r);self.check(p)
        old=p.read_text() if p.exists() else None
        body = [BEGIN, '## 原字幕与 AI 辅助中文', '', f"来源：[视频]({r['url']}) · 轨道：{safe_markdown(r['track'])} · 语言：{r['language']}", f"模型：{r['config']['model']} / {r['config']['effort']} · 译文 {len(r['translations'])}/{len(r['subtitles'])}（不代表看完）", '']
        for i,s in enumerate(r['subtitles']):
            body += [f"### {i+1} · {s['start']/1000:.3f}–{s['end']/1000:.3f} 秒", paragraph(s['text']), '', 'AI 辅助中文：', paragraph(r['translations'].get(str(i), '（待翻译）')), '']
        body += [END]
        generated='\n'.join(body)
        if old is None:
            content=f"# {safe_markdown(r['title'])} · 字幕\n\n[[{ROOT.as_posix()}/{r['videoName']}|返回视频记录]]\n\n{generated}\n\n## 我的笔记\n"
        else:
            if old.count(BEGIN)!=1 or old.count(END)!=1 or old.index(BEGIN)>old.index(END):
                raise ValueError('自动字幕区标记已修改，停止覆盖；译文状态已保留。')
            content=old[:old.index(BEGIN)]+generated+old[old.index(END)+len(END):]
        self.write(p,content,old)
        index=self.base/(r['videoName']+'.md');self.check(index)
        old=index.read_text() if index.exists() else None
        marker=f'<!-- track:{r["id"]} -->'
        if old is None:old_index=f"# {safe_markdown(r['title'])}\n\n来源：[打开视频]({r['url']})\n\n## 字幕版本\n"
        else:old_index=old
        if marker not in old_index:
            line=f"\n- [[{ROOT.as_posix()}/{r['videoName']}/{r['language']}字幕--{r['id']}|{safe_markdown(r['track'])} · {r['language']} · {r['id'][:8]}]] {marker}\n"
            self.write(index,old_index+line,old)

    def result(self, r):
        return {'id':r['id'],'videoId':r['videoId'],'indexPath':str(ROOT/(r['videoName']+'.md')),'path':str(self.note_path(r).relative_to(self.vault)), 'url':r['url'], 'done':len(r['translations']),'total':len(r['subtitles']), 'requests':r['requests'], 'interrupted':r['inflight'], 'openUrl':'obsidian://open?'+urllib.parse.urlencode({'vault':self.vault.name,'file':str(self.note_path(r).relative_to(self.vault))})}

    def event(self,r,p):
        config_path=self.vault/'.obsidian/daily-notes.json';self.check(config_path)
        cfg=json.loads(config_path.read_text())
        if cfg.get('folder')!='04-日记' or cfg.get('format')!='YYYY/MM/YYYY-MM-DD':
            raise ValueError('日记配置已变化；请核对目录后再接入，不擅自选择路径。')
        when=datetime.datetime.fromtimestamp(p['at']/1000).astimezone()
        dest=self.vault/'04-日记'/when.strftime('%Y/%m/%Y-%m-%d.md');self.check(dest)
        old=dest.read_text() if dest.exists() else None
        event_id=digest([r['videoId'],when.strftime('%Y-%m-%d'),p['kind']])
        marker=f'<!-- video-event:{event_id} -->'
        existing=None
        if old:
            lines=[line for line in old.splitlines() if marker in line]
            if len(lines)>1:raise ValueError('日记自动事件标记重复，请核对后再补交。')
            if lines:
                existing=lines[0]
                stamp=re.search(r'<!-- at:([0-9.]+) -->',existing)
                if not stamp:raise ValueError('日记事件标记被修改，停止覆盖本人内容。')
                if float(stamp.group(1))>=p['at']:return
        labels={'loaded':'载入字幕','play':'开始播放','pause':'暂停播放','position':'播放位置'}
        line=f"\n- {when.strftime('%H:%M')} {labels[p['kind']]}：[[{ROOT.as_posix()}/{r['videoName']}|{safe_markdown(r['title'])}]]，位置 {p['position']:.0f} 秒。{marker}<!-- at:{p['at']} -->\n"
        if old is None:
            # Match the existing daily template, without filling any personal claims.
            content=f"# {when.strftime('%Y-%m-%d')}\n\n[[开始|开始]]\n\n## 今天想做\n\n## 今天学了什么\n\n## 今天做了什么\n\n## 想法与心情\n\n## 别忘了\n\n## 视频活动（自动记录）\n"
        else:content=old
        if '## 视频活动（自动记录）' not in content:content+='\n\n## 视频活动（自动记录）\n'
        # Only replace our tagged event line. Each video/day has at most four compact entries.
        if existing is not None:
            content=content.replace(existing,line.strip(),1)
        else:
            content+=line
        self.write(dest,content,old)

    def handle(self,p):
        p=normalize_request(p)
        if p['action'] in ('videoRead', 'videoPage', 'videoEvent'):
            r=self.read(p['id'])
            if p['action']=='videoPage':
                start=p['offset'];return {'translations':{str(i):r['translations'][str(i)] for i in range(start,min(start+30,len(r['subtitles']))) if str(i) in r['translations']}}
            if p['action']=='videoEvent':
                self.event(r,p)
            return self.result(r)
        with self.lock():
            if p['action']=='videoSave':
                video=digest(p['url']);ident=digest({**p,'action':None,'title':None,'promptVersion':PROMPT_VERSION})
                if self.state_path(ident).exists():r=self.read(ident)
                else:
                    name=re.sub(r'[\\/:*?"<>|\[\]#^\x00-\x1f]', '-', p['title']).strip(' .')[:65] or '视频'
                    existing=list(self.base.glob('*--'+video+'.md'))
                    if len(existing)>1:raise ValueError('视频主记录重复，请先核对。')
                    video_name=existing[0].stem if existing else name+'--'+video
                    r={**p,'id':ident,'videoId':video,'videoName':video_name,'translations':{},'requests':0,'inflight':False,'promptVersion':PROMPT_VERSION}
                    self.persist(r)
                self.render(r)
            else:
                r=self.read(p['id'])
                if p['action']=='videoContinue':
                    r['requests']=0;r['inflight']=False;self.persist(r)
                elif p['action']=='videoPage':
                    start=p['offset'];return {'translations':{str(i):r['translations'][str(i)] for i in range(start,min(start+30,len(r['subtitles']))) if str(i) in r['translations']}}
                elif p['action']=='videoEvent':self.event(r,p)
                elif p['action']!='videoRead':raise ValueError('该动作需要翻译执行器。')
            return self.result(r)

    def write_summary(self, url, title, rows, links=None, now=None):
        """Writes (or refreshes) one marked study-summary block in the video note.
        Only the block between the markers is ours; everything else in the note is kept."""
        from study_library_core import time_link
        from study_sync import MASTERY_LABELS, STAGE_NAMES
        url = canonical_url(url)
        title = text(title or '视频', 300, True)
        video = digest(url)
        links = links or {}
        when = (now or datetime.datetime.now().astimezone()).strftime('%Y-%m-%d %H:%M')
        cards = sum(r.get('cards', 0) for r in rows)
        lines = [SUMMARY_BEGIN, f'## 学习小结（{when} 更新）', '',
                 f'在这个视频里记住了 {len(rows)} 个词，做了 {cards} 张卡。点时间回到原句。', '']
        for r in rows:
            moment = time_link(url, r['videoTime']) if isinstance(r.get('videoTime'), (int, float)) else '—'
            facts = [MASTERY_LABELS.get(r.get('mastery', ''), '')]
            facts.append(f"{r['cards']} 张卡" + (f"（到{STAGE_NAMES.get(r.get('stage'), '')}）" if r.get('stage') in STAGE_NAMES else '') if r.get('cards') else '只记了笔记')
            note = f" · [[{links[r['id']]}|笔记]]" if r.get('id') in links else ''
            lines.append(f"- {moment} **{safe_markdown(r['word'])}** · {' · '.join(x for x in facts if x)}{note}")
            if r.get('sentence'):
                lines.append('  > ' + safe_markdown(' '.join(r['sentence'].split()))[:300])
        lines.append(SUMMARY_END)
        block = '\n'.join(lines)
        with self.lock():
            existing = list(self.base.glob('*--' + video + '.md'))
            if len(existing) > 1:
                raise ValueError('视频主记录重复，请先核对。')
            if existing:
                path = existing[0]
            else:
                name = re.sub(r'[\\/:*?"<>|\[\]#^\x00-\x1f]', '-', title).strip(' .')[:65] or '视频'
                path = self.base / (name + '--' + video + '.md')
            self.check(path)
            old = path.read_text() if path.exists() else None
            if old is None:
                content = f"# {safe_markdown(title)}\n\n来源：[打开视频]({url})\n\n{block}\n"
            elif old.count(SUMMARY_BEGIN) == 0 and old.count(SUMMARY_END) == 0:
                content = old.rstrip('\n') + '\n\n' + block + '\n'
            elif old.count(SUMMARY_BEGIN) == 1 and old.count(SUMMARY_END) == 1 and old.index(SUMMARY_BEGIN) < old.index(SUMMARY_END):
                content = old[:old.index(SUMMARY_BEGIN)] + block + old[old.index(SUMMARY_END) + len(SUMMARY_END):]
            else:
                raise ValueError('学习小结的标记被改动，停止覆盖；请检查视频笔记。')
            self.write(path, content, old)
        relative = str(path.relative_to(self.vault))
        return {'path': relative, 'words': len(rows), 'cards': cards,
                'openUrl': 'obsidian://open?' + urllib.parse.urlencode({'vault': self.vault.name, 'file': relative})}

    def translate_next(self,ident,model):
        with self.lock():
            r=self.read(ident)
            if len(r['translations'])==len(r['subtitles']):
                self.render(r);return self.result(r)
            if r['inflight']:raise ValueError('上次请求结果不确定。请明确点击继续/重试，可能重新消耗该批额度。')
            if r['requests']>=60:raise ValueError('已到本次60请求上限。原文/译文已保存；明确点击继续才追加额度。')
            items=[];size=0
            for i,s in enumerate(r['subtitles']):
                if str(i) in r['translations']:continue
                if items and (len(items)>=30 or size+len(s['text'])>6000):break
                items.append({'id':str(i),'text':s['text']});size+=len(s['text'])
            first=int(items[0]['id']);last=int(items[-1]['id'])
            context='\n'.join(x['text'] for x in r['subtitles'][max(0,first-2):first]+r['subtitles'][last+1:last+3])[:4000]
            payload={'action':'subtitles','language':r['language'],'items':items,'context':context,'title':r['title'],'config':r['config']}
            r['inflight']=True;r['requests']+=1;self.persist(r)
            try:
                answer=model(payload)
                from study_translator import parse_answer
                answer=parse_answer(json.dumps(answer),payload)
                r['translations'].update({x['id']:x['translation'] for x in answer['items']})
            finally:
                r['inflight']=False;self.persist(r)
            self.render(r)
            return self.result(r)
