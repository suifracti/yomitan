/*
 * Copyright (C) 2023-2026  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/*
 * Read-only YouTube caption list beside the video. Nothing loads until the user clicks.
 * Captions are ordinary page text here: the existing Yomitan scanner opens the word card,
 * and nothing pretends to be the protected ASB cue (no data-asb-study-cue).
 * Explicit translation uses the existing Native path; row metadata feeds the original word card.
 */
import {SubtitleSession, cuesFromTimedText, timeLabel} from './subtitle-session.js';
import {TranslationQueue} from './translation-queue.js';
import {studyCall} from './study-client.js';
import {youtubeStudyContext} from './youtube-study-context.js';
import {captionUrl, youtubeVideoId} from './vendor/kiss/youtube-caption-source.js';

const ROOT_ID = 'study-yt-reader';
const STYLE_ID = 'study-yt-reader-style';
const WAIT_MS = 10000;

const STYLE = `
#${ROOT_ID}{--r-fg:var(--yt-spec-text-primary,#0f0f0f);--r-muted:var(--yt-spec-text-secondary,#606060);--r-line:var(--yt-spec-10-percent-layer,#e5e5e5);--r-hi:var(--yt-spec-badge-chip-background,#f2f2f2);
margin:0 0 16px;border:1px solid var(--r-line);border-radius:12px;color:var(--r-fg);font:14px/1.5 Roboto,Arial,sans-serif;overflow:hidden}
#${ROOT_ID} .r-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px}
#${ROOT_ID} .r-title{font-weight:500}
#${ROOT_ID} .r-status{flex:1;min-width:0;color:var(--r-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#${ROOT_ID} button.r-btn{font:inherit;font-size:12px;color:var(--r-fg);background:var(--r-hi);border:0;border-radius:16px;padding:4px 12px;cursor:pointer}
#${ROOT_ID} button.r-btn[hidden]{display:none}
#${ROOT_ID} .r-list{position:relative;max-height:min(60vh,520px);overflow:auto;overscroll-behavior:contain;border-top:1px solid var(--r-line)}
#${ROOT_ID} .r-list:empty{display:none}
#${ROOT_ID} .r-cue{display:grid;grid-template-columns:48px minmax(0,1fr);gap:4px;padding:6px 12px 6px 4px}
#${ROOT_ID} .r-cue.is-current{background:var(--r-hi)}
#${ROOT_ID} .r-time{border:0;background:none;padding:0 4px;color:var(--r-muted);font:12px/22px Roboto,Arial,sans-serif;font-variant-numeric:tabular-nums;cursor:pointer;text-align:right;align-self:start}
#${ROOT_ID} .r-time::before{content:attr(data-time)}
#${ROOT_ID} .r-time:hover{color:var(--r-fg)}
#${ROOT_ID} .r-translation{grid-column:2;margin:2px 0;color:var(--r-muted);white-space:pre-wrap;overflow-wrap:anywhere}
#${ROOT_ID} .r-translation:empty{display:none}
#${ROOT_ID} .r-text{margin:0;white-space:pre-line;overflow-wrap:anywhere;user-select:text}
`;

/**
 * @typedef {{root: HTMLElement, status: HTMLElement, load: HTMLButtonElement, follow: HTMLButtonElement, list: HTMLElement, translate: HTMLButtonElement, cancel: HTMLButtonElement, retry: HTMLButtonElement}} ReaderView
 */

export class YoutubeReader {
    /** @param {{call?: typeof studyCall}} [options] */
    constructor({call = studyCall} = {}) {
        /** @type {typeof studyCall} */
        this._call = call;
        /** @type {string} */
        this._translateRun = '';
        /** @type {boolean} */
        this._translating = false;
        /** @type {Set<string>} */
        this._failed = new Set();
        /** @type {TranslationQueue} */
        this._queue = new TranslationQueue(async ({items, config, signal}) => {
            const requestId = this._translateRun;
            const cancel = () => { void this._call('subtitleCancel', {requestId}).catch(() => {}); };
            signal.addEventListener('abort', cancel, {once: true});
            try {
                if (signal.aborted) { throw new Error('已取消'); }
                const result = /** @type {{items: {id: string, translation: string}[]}} */ (await this._call('subtitleTranslate', {requestId,
                    items,
                    config,
                    language: this._session?.source.language || 'en',
                    title: document.title.slice(0, 300)}));
                return result.items;
            } finally { signal.removeEventListener('abort', cancel); }
        });
        /** @type {string|null} */
        this._videoId = null;
        /** @type {ReaderView|null} */
        this._view = null;
        /** @type {SubtitleSession|null} */
        this._session = null;
        /** @type {Map<string, HTMLElement>} */
        this._rows = new Map();
        /** @type {string} */
        this._active = '';
        /** @type {boolean} */
        this._follow = true;
        /** @type {HTMLVideoElement|null} */
        this._video = null;
        /** @type {number} */
        this._generation = 0;
        /** @type {string[]} Caption requests made by the player itself (they carry its own tokens). */
        this._seen = [];
        /** @type {() => void} */
        this._timeListener = () => this._onTime();
    }

    /** */
    start() {
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) { this.rememberRequest(entry.name); }
            });
            observer.observe({type: 'resource', buffered: true});
        } catch { /* Without resource timing the user still gets an explicit failure message. */ }
        document.addEventListener('yt-navigate-finish', () => this._sync());
        window.addEventListener('popstate', () => this._sync());
        window.addEventListener('resize', () => this._place());
        this._sync();
    }

    /**
     * The right column is hidden in YouTube's narrow layout; fall back to below the video.
     * @returns {Element|null}
     */
    _host() {
        const candidates = ['#secondary-inner', '#secondary', '#below'].map((s) => document.querySelector(s)).filter((e) => e !== null);
        return candidates.find((e) => e instanceof HTMLElement && e.offsetWidth > 0) ?? candidates[0] ?? null;
    }

    /** */
    _place() {
        const root = this._view?.root;
        const host = root ? this._host() : null;
        if (root && host && root.parentElement !== host) { host.prepend(root); }
    }

    /**
     * @param {string} name
     */
    rememberRequest(name) {
        if (!name.includes('/api/timedtext')) { return; }
        this._seen.push(name);
        if (this._seen.length > 50) { this._seen.shift(); }
    }

    /** */
    _sync() {
        const id = location.pathname === '/watch' ? youtubeVideoId(location.href) : null;
        if (id === this._videoId && (id === null || this._view?.root.isConnected)) { return; }
        this._reset();
        this._videoId = id;
        if (id !== null) { void this._mount(++this._generation); }
    }

    /** */
    _reset() {
        ++this._generation;
        this._translateRun = '';
        this._queue.cancel();
        this._translating = false;
        this._failed.clear();
        youtubeStudyContext.reset();
        this._video?.removeEventListener('timeupdate', this._timeListener);
        this._video = null;
        this._session = null;
        this._rows.clear();
        this._active = '';
        this._follow = true;
        this._view?.root.remove();
        this._view = null;
    }

    /**
     * @param {number} generation
     */
    async _mount(generation) {
        const deadline = Date.now() + WAIT_MS;
        /** @type {Element|null} */
        let host = null;
        while (generation === this._generation && Date.now() < deadline) {
            host = this._host();
            if (host) { break; }
            await new Promise((resolve) => { setTimeout(resolve, 300); });
        }
        if (!host || generation !== this._generation) { return; }
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = STYLE;
            document.head.append(style);
        }
        document.getElementById(ROOT_ID)?.remove();
        const root = document.createElement('section');
        root.id = ROOT_ID;
        root.lang = 'zh-CN';
        const head = document.createElement('div');
        head.className = 'r-head';
        const title = document.createElement('span');
        title.className = 'r-title';
        title.textContent = '字幕学习';
        const status = document.createElement('span');
        status.className = 'r-status';
        status.setAttribute('role', 'status');
        status.textContent = '载入原文后选词学习；翻译需手动点击。';
        const follow = this._button('跟随播放', () => this._resumeFollow());
        follow.hidden = true;
        const load = this._button('载入字幕', () => { void this._load(generation); });
        const translate = this._button('翻译接下来8句', () => { void this._translate(false); });
        translate.classList.add('r-translate'); translate.hidden = true;
        const retry = this._button('重试失败', () => { void this._translate(true); });
        retry.hidden = true;
        const cancel = this._button('取消翻译', () => {
            this._translateRun = '';
            this._queue.cancel();
            this._status('已取消；原文和已完成译文保留。');
        });
        cancel.hidden = true;
        head.append(title, status, translate, retry, cancel, follow, load);
        const list = document.createElement('div');
        list.className = 'r-list';
        list.setAttribute('role', 'list');
        const pause = () => this._pauseFollow();
        list.addEventListener('wheel', pause, {passive: true});
        list.addEventListener('touchmove', pause, {passive: true});
        root.append(head, list);
        host.prepend(root);
        this._view = {root, status, load, follow, list, translate, cancel, retry};
    }

    /**
     * @param {string} text
     * @param {() => void} onClick
     * @returns {HTMLButtonElement}
     */
    _button(text, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'r-btn';
        button.textContent = text;
        button.addEventListener('click', onClick);
        return button;
    }

    /**
     * @param {string} text
     */
    _status(text) {
        if (this._view) { this._view.status.textContent = text; }
    }

    /**
     * @param {number} generation
     */
    async _load(generation) {
        const view = this._view;
        const videoId = this._videoId;
        if (!view || !videoId) { return; }
        view.load.disabled = true;
        try {
            const url = await this._findCaptionUrl(videoId, generation);
            if (generation !== this._generation) { return; }
            if (!url) {
                this._status('没拿到播放器字幕：请在播放器里打开 CC 字幕后再点载入。');
                return;
            }
            // Original language only: a player auto-translation (tlang) is not the source text.
            url.searchParams.delete('tlang');
            url.searchParams.set('fmt', 'json3');
            this._status('正在读取字幕…');
            const response = await fetch(url.href, {credentials: 'include'});
            const text = response.ok ? await response.text() : '';
            if (generation !== this._generation) { return; }
            if (!text.trim()) {
                this._status(`YouTube 没有返回字幕内容（HTTP ${response.status}）；可关掉 CC 再打开后重试。`);
                return;
            }
            const language = url.searchParams.get('lang') ?? '';
            const kind = url.searchParams.get('kind') ?? '';
            const session = new SubtitleSession({
                mediaKey: `youtube:${videoId}`,
                trackKey: `${language}|${kind}`,
                revision: `${language}|${kind}|${url.searchParams.get('name') ?? ''}`,
                language: language || 'und',
                acquisition: 'provider',
                url: `https://www.youtube.com/watch?v=${videoId}`,
                trackName: kind === 'asr' ? `${language} 自动字幕` : language,
            }, cuesFromTimedText(text));
            this._render(session);
        } catch (error) {
            if (generation === this._generation) { this._status(`字幕读取失败：${error instanceof Error ? error.message : String(error)}`); }
        } finally {
            view.load.disabled = false;
        }
    }

    /**
     * Uses the caption request the player already made. If none yet, turns on the player's CC once and waits.
     * @param {string} videoId
     * @param {number} generation
     * @returns {Promise<URL|null>}
     */
    async _findCaptionUrl(videoId, generation) {
        const find = () => {
            for (let i = this._seen.length - 1; i >= 0; --i) {
                const url = captionUrl(this._seen[i], videoId, location.href);
                if (url) { return url; }
            }
            return null;
        };
        let url = find();
        if (url) { return url; }
        const cc = document.querySelector('#movie_player .ytp-subtitles-button');
        if (!(cc instanceof HTMLElement)) { return null; }
        this._status('正在打开播放器字幕…');
        if (cc.getAttribute('aria-pressed') === 'true') {
            // Captions already on but their request was missed: turn off and on so the player asks again.
            cc.click();
            await new Promise((resolve) => { setTimeout(resolve, 300); });
        }
        cc.click();
        const deadline = Date.now() + WAIT_MS;
        while (!url && generation === this._generation && Date.now() < deadline) {
            await new Promise((resolve) => { setTimeout(resolve, 250); });
            url = find();
        }
        return url;
    }

    /**
     * @param {SubtitleSession} session
     */
    _render(session) {
        const view = this._view;
        if (!view) { return; }
        this._queue.cancel();
        youtubeStudyContext.reset();
        this._failed.clear();
        this._video?.removeEventListener('timeupdate', this._timeListener);
        this._session = session;
        this._rows.clear();
        /** @type {HTMLElement[]} */
        const rows = [];
        for (const [index, cue] of session.cues.entries()) {
            const row = document.createElement('div');
            row.className = 'r-cue';
            row.setAttribute('role', 'listitem');
            const time = document.createElement('button');
            time.type = 'button';
            time.className = 'r-time';
            // Pseudo-element text keeps timestamps out of the scanned sentence.
            time.dataset.time = timeLabel(cue.startMs);
            time.setAttribute('aria-label', `回听 ${timeLabel(cue.startMs)}`);
            time.addEventListener('click', () => this._seek(cue.id));
            const text = document.createElement('p');
            text.className = 'r-text';
            text.lang = session.source.language;
            // The newline (pre-line) ends Yomitan's sentence at this caption instead of running into the next row.
            // Line breaks inside one caption are display wrapping, not sentence ends.
            text.textContent = `${cue.text.replaceAll(/\s*\n\s*/g, ' ')}\n`;
            const translated = document.createElement('p');
            translated.className = 'r-translation scan-disable';
            translated.lang = 'zh-CN';
            const sourceUrl = new URL(session.source.url || location.href);
            const start = session.seekSeconds(cue.id);
            sourceUrl.searchParams.set('t', `${start}s`);
            youtubeStudyContext.register(text, {
                text: text.textContent.trimEnd(),
                context: this._context(session, index),
                start,
                end: (cue.endMs + session.offsetMs) / 1000,
                url: sourceUrl.href,
                translation: () => session.translation(cue.id),
                video: () => this._video,
                isCurrent: () => this._session === session && this._videoId === youtubeVideoId(location.href),
            });
            row.append(time, text, translated);
            rows.push(row);
            this._rows.set(cue.id, row);
        }
        view.list.replaceChildren(...rows);
        view.load.textContent = '重新载入';
        view.translate.hidden = false;
        view.retry.hidden = true;
        this._status(`${session.source.trackName ?? session.source.language} · ${session.cues.length} 句；选词用现有词卡`);
        const video = document.querySelector('#movie_player video');
        if (video instanceof HTMLVideoElement) {
            this._video = video;
            video.addEventListener('timeupdate', this._timeListener);
            this._onTime();
        }
    }

    /**
     * @param {SubtitleSession} session
     * @param {number} index
     * @returns {string}
     */
    _context(session, index) {
        return [session.cues[index - 1]?.text, session.cues[index + 1]?.text].filter(Boolean).join('\n').slice(0, 1200);
    }

    /** @param {boolean} retryOnly */
    async _translate(retryOnly) {
        const session = this._session;
        const view = this._view;
        if (!session || !view || this._translating) { return; }
        const active = session.active((this._video?.currentTime || 0) * 1000)[0];
        const index = active ? session.cues.indexOf(active) : 0;
        const selected = (retryOnly ? session.cues.filter((c) => this._failed.has(c.id)) : session.cues.slice(index).filter((c) => !session.translation(c.id))).slice(0, 8);
        const items = [];
        let chars = 0;
        for (const cue of selected) {
            const text = cue.text.replaceAll(/\s*\n\s*/g, ' ');
            if (chars + text.length > 6000) { break; }
            chars += text.length;
            items.push({id: cue.id, text, context: this._context(session, session.cues.indexOf(cue))});
        }
        if (items.length === 0) {
            this._status('这段已翻译；可定位下一段再继续。');
            return;
        }
        this._translating = true;
        this._translateRun = crypto.randomUUID();
        const runId = this._translateRun;
        view.translate.disabled = true;
        view.retry.disabled = true;
        view.load.disabled = true;
        view.cancel.hidden = false;
        this._status(`正在翻译 ${items.length} 句…`);
        try {
            const config = /** @type {import('study').StudyConfig} */ (await this._call('subtitleSettings'));
            if (this._session !== session || this._translateRun !== runId) { return; }
            const result = await this._queue.translate(items, {...config,
                // The service owns cache language, expiry and clearing; do not bypass it with a second memo.
                cacheEnabled: false,
                onItem: (row) => {
                    if (this._session !== session) { return; }
                    const target = this._rows.get(row.id)?.querySelector('.r-translation');
                    if (row.translation) {
                        session.acceptTranslation(row.id, row.translation);
                        this._failed.delete(row.id);
                        if (target) { target.textContent = row.translation; }
                    } else {
                        this._failed.add(row.id);
                        if (target) { target.textContent = `翻译未完成：${row.error || '可重试'}`; }
                    }
                }});
            if (this._session === session && !result.cancelled) {
                this._status(`译文 ${session.progress().translated}/${session.cues.length}${this._failed.size > 0 ? ' · 有失败，可重试' : ''}`);
            }
        } catch (error) {
            if (this._session === session) { this._status(error instanceof Error ? error.message : String(error)); }
        } finally {
            if (this._session === session) {
                this._translating = false;
                view.translate.disabled = false;
                view.retry.disabled = false;
                view.load.disabled = false;
                view.cancel.hidden = true;
                view.retry.hidden = this._failed.size === 0;
            }
        }
    }

    /**
     * @param {string} id
     */
    _seek(id) {
        if (!this._session || !this._video) { return; }
        try {
            this._video.currentTime = this._session.seekSeconds(id);
            this._resumeFollow();
        } catch (error) {
            this._status(error instanceof Error ? error.message : String(error));
        }
    }

    /** */
    _onTime() {
        const session = this._session;
        const video = this._video;
        if (!session || !video || !this._view) { return; }
        const active = session.active(video.currentTime * 1000).map((c) => c.id);
        const key = active.join('|');
        if (key === this._active) { return; }
        this._active = key;
        for (const [id, row] of this._rows) { row.classList.toggle('is-current', active.includes(id)); }
        const first = active.length > 0 ? this._rows.get(active[0]) : void 0;
        if (this._follow && first) {
            const list = this._view.list;
            list.scrollTop = Math.max(0, first.offsetTop - list.clientHeight / 3);
        }
    }

    /** */
    _pauseFollow() {
        this._follow = false;
        if (this._view && this._session) { this._view.follow.hidden = false; }
    }

    /** */
    _resumeFollow() {
        this._follow = true;
        if (this._view) { this._view.follow.hidden = true; }
        this._active = '';
        this._onTime();
    }
}

/**
 * Starts the reader once per top-level YouTube page.
 * @returns {YoutubeReader}
 */
export function startYoutubeReader() {
    const reader = new YoutubeReader();
    reader.start();
    return reader;
}
