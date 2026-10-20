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
 * The caption reader on any other site with a video. The page decides nothing:
 * we look for the largest visible <video>, offer its own text tracks, subtitle files
 * the page already downloaded, or a file the learner picks. Our UI stays out of the
 * way until asked: a small launcher appears only while the pointer is over the video,
 * and the caption list lives in a floating panel that is closed by default.
 */
import {mediaKeyOf} from './media-key.js';
import {SUBTITLE_URL, cuesFromRows, guessLanguage, parseSubtitles} from './subtitle-formats.js';

const DOCK_ID = 'study-web-dock';
const LAYER_ID = 'study-web-layer';
const STYLE_ID = 'study-web-style';

export const WEB_CAPTIONS_CLASS = 'study-web-captions-on';

const MIN_WIDTH = 200;
const MIN_HEIGHT = 112;
const FETCH_LIMIT = 4_000_000;

// Caption layers drawn by common players; hidden only while our captions are on.
const NATIVE_CAPTIONS = '.bpx-player-subtitle-wrap,.bili-subtitle-x-subtitle-panel-major-group,.vjs-text-track-display,.jw-captions,.plyr__captions,.shaka-text-container,.dplayer-subtitle,.art-subtitle,.xgplayer-subtitles';

const STYLE = `
html.${WEB_CAPTIONS_CLASS} :is(${NATIVE_CAPTIONS}){visibility:hidden!important}
#${LAYER_ID}{position:fixed;z-index:2147482000;pointer-events:none;contain:layout}
#${LAYER_ID}[hidden]{display:none}
#${LAYER_ID} .w-launch{position:absolute;bottom:10px;right:10px;width:34px;height:34px;padding:5px;border:0;border-radius:9px;background:rgb(18 18 20 / 62%);color:#fff;cursor:pointer;pointer-events:auto;opacity:0;transition:opacity 160ms}
#${LAYER_ID}.is-hover .w-launch,#${LAYER_ID} .w-launch[aria-expanded=true],#${LAYER_ID} .w-launch:focus-visible{opacity:.88}
#${LAYER_ID} .w-launch svg{width:24px;height:24px}
#${LAYER_ID} #study-yt-panel{bottom:52px;right:10px;top:auto;pointer-events:auto}
#${DOCK_ID}{position:fixed;top:72px;right:16px;z-index:2147482001;width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 96px);display:flex;flex-direction:column;border-radius:12px;background:var(--st-paper,#fbfaf7);box-shadow:0 10px 32px rgb(0 0 0 / 22%);overflow:hidden}
#${DOCK_ID}[hidden]{display:none}
#${DOCK_ID}.is-left{right:auto;left:16px}
#${DOCK_ID} .d-bar{display:flex;justify-content:flex-end;gap:2px;padding:4px 6px 0}
#${DOCK_ID} .d-bar button{width:26px;height:22px;padding:0;border:0;border-radius:5px;background:none;color:var(--st-muted,#5a6172);font:14px/22px -apple-system,sans-serif;cursor:pointer}
#${DOCK_ID} .d-bar button:hover{background:var(--st-tint,#f3f1ec)}
#${DOCK_ID} .d-body{overflow:auto;min-height:0}
#${DOCK_ID} .d-body > section{margin:0;border:0;border-radius:0}
@media (prefers-color-scheme:dark){#${DOCK_ID}{background:var(--st-paper,#1d1e22)}}
`;

/**
 * @typedef {object} WebSource
 * @property {string} id
 * @property {string} label
 * @property {string} language '' when unknown.
 * @property {(signal: AbortSignal) => Promise<import('./subtitle-session.js').SubtitleCue[]>} read
 */

/**
 * The video the learner is watching: the largest one on screen.
 * @param {Document} [root]
 * @returns {HTMLVideoElement|null}
 */
export function mainVideo(root = document) {
    let best = null;
    let bestArea = 0;
    for (const video of root.querySelectorAll('video')) {
        const rect = video.getBoundingClientRect();
        if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) { continue; }
        const style = getComputedStyle(video);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) { continue; }
        // A playing video wins over a larger paused preview.
        const area = rect.width * rect.height * (video.paused ? 1 : 4);
        if (area > bestArea) {
            best = video;
            bestArea = area;
        }
    }
    return best;
}

/**
 * @param {string} value
 * @returns {string}
 */
function languageHint(value) {
    const match = /(?:^|[^a-z])(en|eng|english|zh|chs|cht|chi|chinese|ja|jpn|japanese|ko|kor|korean|fr|de|es)(?:[^a-z]|$)/i.exec(value);
    if (!match) { return ''; }
    const code = match[1].toLowerCase();
    return {eng: 'en', english: 'en', chs: 'zh', cht: 'zh', chi: 'zh', chinese: 'zh', jpn: 'ja', japanese: 'ja', kor: 'ko', korean: 'ko'}[code] ?? code;
}

/**
 * Reads a subtitle file the page already loaded. The page's own cookies are not sent
 * unless the file refuses an anonymous request.
 * @param {string} url
 * @param {AbortSignal} signal
 * @returns {Promise<import('./subtitle-session.js').SubtitleCue[]>}
 */
async function fetchSubtitle(url, signal) {
    let response = await fetch(url, {credentials: 'omit', signal}).catch(() => null);
    if (!response?.ok) { response = await fetch(url, {credentials: 'include', signal}); }
    if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
    const text = await response.text();
    if (text.length > FETCH_LIMIT) { throw new Error('字幕文件过大'); }
    return parseSubtitles(text, url).cues;
}

/**
 * Cues of a TextTrack, loading a disabled track quietly (mode "hidden") just long enough to read it.
 * @param {TextTrack} track
 * @param {AbortSignal} signal
 * @returns {Promise<import('./subtitle-session.js').SubtitleCue[]>}
 */
async function readTrack(track, signal) {
    const previous = track.mode;
    if (previous === 'disabled') { track.mode = 'hidden'; }
    try {
        for (let i = 0; i < 20 && !signal.aborted && !(track.cues && track.cues.length > 0); ++i) {
            await new Promise((resolve) => { setTimeout(resolve, 150); });
        }
        const cues = [...(track.cues ?? [])].map((cue) => ({startMs: cue.startTime * 1000, endMs: cue.endTime * 1000, text: /** @type {VTTCue} */ (cue).text ?? ''}));
        return cuesFromRows(cues);
    } finally {
        if (previous === 'disabled') { track.mode = 'disabled'; }
    }
}

export class WebVideoSite {
    constructor() {
        /** @type {'web'} */
        this.kind = 'web';
        /** @type {string[]} Subtitle-looking files the page requested, newest last. */
        this._seen = [];
        /** @type {HTMLElement|null} */
        this._dock = null;
        /** @type {HTMLElement|null} */
        this._layer = null;
        /** @type {HTMLVideoElement|null} */
        this._placed = null;
        /** @type {ResizeObserver|null} */
        this._resize = null;
        /** @type {number} */
        this._frame = 0;
        /** @type {Map<TextTrack, TextTrackMode>} Tracks we quieted while our captions show. */
        this._quieted = new Map();
    }

    /** @returns {string|null} */
    mediaKey() {
        return mainVideo() ? (mediaKeyOf(this.pageUrl()) || null) : null;
    }

    /** @returns {HTMLVideoElement|null} */
    video() { return mainVideo(); }

    /** @returns {string} The page itself; other sites have no shared time parameter. */
    pageUrl() {
        const video = this.video();
        if (location.protocol !== 'file:' || !video) { return location.href.split('#')[0]; }
        const url = new URL(video.currentSrc || video.src || location.href);
        url.hash = `study-duration=${Math.round(Number.isFinite(video.duration) ? video.duration : 0)}`;
        return url.href;
    }

    /** @param {string} name */
    remember(name) {
        if (!SUBTITLE_URL.test(name) || this._seen.includes(name)) { return; }
        this._seen.push(name);
        if (this._seen.length > 30) { this._seen.shift(); }
    }

    /** @param {() => void} onChange */
    watch(onChange) {
        let last = '';
        const check = () => {
            const key = `${location.href}|${this.mediaKey() ?? ''}`;
            if (key !== last) {
                last = key;
                onChange();
            }
        };
        window.addEventListener('popstate', check);
        window.setInterval(check, 1500);
        check();
    }

    /**
     * Every subtitle the page offers for the main video, best guesses first.
     * @param {string} learning Learning language, e.g. 'en'.
     * @returns {WebSource[]}
     */
    sources(learning = 'en') {
        const video = mainVideo();
        /** @type {WebSource[]} */
        const sources = [];
        if (video) {
            const elements = [...video.querySelectorAll('track')];
            for (const [index, track] of [...video.textTracks].entries()) {
                if (!['subtitles', 'captions'].includes(track.kind)) { continue; }
                const element = elements.find((item) => item.track === track);
                const label = track.label || track.language || `轨道 ${index + 1}`;
                sources.push({
                    id: `track:${index}`,
                    label: `${label}（播放器字幕）`,
                    language: track.language || languageHint(label),
                    read: async (signal) => {
                        const cues = await readTrack(track, signal).catch(() => []);
                        if (cues.length > 0 || !element?.src) { return cues; }
                        return await fetchSubtitle(element.src, signal);
                    },
                });
            }
        }
        for (const url of [...this._seen].reverse()) {
            if (video && [...video.querySelectorAll('track')].some((item) => item.src === url)) { continue; }
            let name = url;
            try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || url); } catch { /* keep the URL */ }
            const language = languageHint(new URL(url, location.href).searchParams.get('lang') ?? '') || languageHint(name);
            sources.push({id: `url:${url}`, label: `${name.slice(0, 60)}（页面字幕文件）`, language, read: (signal) => fetchSubtitle(url, signal)});
        }
        const rank = (/** @type {WebSource} */ source) => (source.language === learning ? 0 : (source.language ? 2 : 1));
        return sources.map((source, order) => ({source, order})).sort((a, b) => rank(a.source) - rank(b.source) || a.order - b.order).map((row) => row.source);
    }

    /**
     * Reads the chosen (or best) source; unreadable ones are skipped with a note.
     * @param {{signal: AbortSignal, sourceId?: string, learning?: string}} options
     * @returns {Promise<{cues: import('./subtitle-session.js').SubtitleCue[], language: string, label: string, id: string, all: {id: string, label: string}[]}|null>}
     */
    async load({signal, sourceId, learning = 'en'}) {
        const sources = this.sources(learning);
        const all = sources.map(({id, label}) => ({id, label}));
        const ordered = sourceId ? sources.filter((source) => source.id === sourceId) : sources;
        for (const source of ordered) {
            if (signal.aborted) { return null; }
            try {
                const cues = await source.read(signal);
                if (cues.length === 0) { continue; }
                const language = source.language || guessLanguage(cues);
                // Without a chosen source, skip a track in another language when the learning language may follow.
                if (!sourceId && language !== learning && sources.some((other) => other !== source && other.language === learning)) { continue; }
                return {cues, language, label: source.label, id: source.id, all};
            } catch { /* try the next one */ }
        }
        return null;
    }

    /**
     * The floating caption panel; closed until the learner opens it.
     * @returns {HTMLElement}
     */
    host() {
        this._style();
        if (this._dock?.isConnected) { return /** @type {HTMLElement} */ (this._dock.querySelector('.d-body')); }
        const dock = document.createElement('aside');
        dock.id = DOCK_ID;
        dock.className = 'st-scope';
        dock.hidden = true;
        const bar = document.createElement('div');
        bar.className = 'd-bar scan-disable';
        const side = barButton('⇆', '换到另一侧', () => dock.classList.toggle('is-left'));
        const close = barButton('×', '收起字幕栏', () => this.toggleDock(false));
        bar.append(side, close);
        const body = document.createElement('div');
        body.className = 'd-body';
        dock.append(bar, body);
        for (const type of ['keydown', 'keyup', 'keypress']) {
            // Site shortcuts (space, arrows, f) must not fire while reading or typing here.
            dock.addEventListener(type, (event) => event.stopPropagation());
        }
        document.body.append(dock);
        this._dock = dock;
        return body;
    }

    /** @returns {boolean} */
    pinFirst() { return false; }

    /**
     * @param {boolean} [open]
     * @returns {boolean} Whether the panel is now open.
     */
    toggleDock(open) {
        if (window.self !== window.top && innerWidth < 600) {
            if (this._dock) { this._dock.hidden = true; }
            return false;
        }
        if (!this._dock) { this.host(); }
        const dock = /** @type {HTMLElement} */ (this._dock);
        dock.hidden = !(open ?? dock.hidden);
        return !dock.hidden;
    }

    /** @returns {boolean} */
    dockOpen() { return Boolean(this._dock && !this._dock.hidden); }

    /** @returns {boolean} */
    active() { return this.mediaKey() !== null; }

    /**
     * A layer over the main video for our captions, launcher and panel. It follows the
     * video's box (also in fullscreen) and lets every other pointer event through.
     * @returns {HTMLElement|null}
     */
    player() {
        this._style();
        const video = mainVideo();
        if (!video) {
            if (this._layer) { this._layer.hidden = true; }
            return this._layer;
        }
        if (!this._layer) {
            const layer = document.createElement('div');
            layer.id = LAYER_ID;
            this._layer = layer;
            const schedule = () => {
                if (this._frame) { return; }
                this._frame = requestAnimationFrame(() => {
                    this._frame = 0;
                    this._position();
                });
            };
            window.addEventListener('scroll', schedule, {capture: true, passive: true});
            window.addEventListener('resize', schedule, {passive: true});
            document.addEventListener('fullscreenchange', schedule);
            let hoverAt = 0;
            document.addEventListener('pointermove', (event) => {
                if (event.timeStamp - hoverAt < 80 || !this._placed) { return; }
                hoverAt = event.timeStamp;
                const rect = this._placed.getBoundingClientRect();
                layer.classList.toggle('is-hover', event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
            }, {passive: true});
            this._resize = new ResizeObserver(schedule);
        }
        if (this._placed !== video) {
            this._resize?.disconnect();
            this._resize?.observe(video);
            this._placed = video;
        }
        this._position();
        return this._layer;
    }

    /** Keeps the layer on the video box and inside the fullscreen element. */
    _position() {
        const layer = this._layer;
        const video = this._placed;
        if (!layer || !video) { return; }
        const full = document.fullscreenElement;
        const parent = full && !(full instanceof HTMLVideoElement) ? full : document.body;
        if (layer.parentElement !== parent) { parent.append(layer); }
        const rect = video.getBoundingClientRect();
        layer.hidden = !video.isConnected || rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT || rect.bottom < 0 || rect.top > innerHeight;
        Object.assign(layer.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`});
    }

    /** @returns {HTMLElement|null} */
    controls() { return this.player(); }

    /**
     * Hides the page's own captions while ours show, and restores them after.
     * @param {boolean} on
     */
    hideNative(on) {
        document.documentElement.classList.toggle(WEB_CAPTIONS_CLASS, on);
        const video = mainVideo();
        if (on && video) {
            for (const track of video.textTracks) {
                if (track.mode === 'showing') {
                    this._quieted.set(track, track.mode);
                    track.mode = 'hidden';
                }
            }
        } else if (!on) {
            for (const [track, mode] of this._quieted) { track.mode = mode; }
            this._quieted.clear();
        }
    }

    /** @returns {number} */
    height() { return this._placed?.getBoundingClientRect().height ?? 0; }

    /** */
    _style() {
        if (document.getElementById(STYLE_ID)) { return; }
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLE;
        (document.head ?? document.documentElement).append(style);
    }
}

/**
 * @param {string} label
 * @param {string} title
 * @param {() => void} action
 * @returns {HTMLButtonElement}
 */
function barButton(label, title, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', action);
    return button;
}
