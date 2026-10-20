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
import {SubtitleSession, cuesFromTimedText, groupForReading, groupsFromIds, timeLabel} from './subtitle-session.js';
import {ENGINE_LABELS, chromeTranslate} from './free-translators.js';
import {DEFAULT_SUBTITLE_PREFS, normalizeSubtitlePrefs, onSubtitlePrefsChanged, readSubtitlePrefs, readVideoState, writeSubtitlePrefs, writeVideoState} from './subtitle-prefs.js';
import {TranslationQueue} from './translation-queue.js';
import {studyCall} from './study-client.js';
import {YoutubeOverlay, engineSelect, offsetControl, repeatSelect, syncControls} from './youtube-overlay.js';
import {youtubeStudyContext} from './youtube-study-context.js';
import {captionUrl, youtubeVideoId} from './vendor/kiss/youtube-caption-source.js';
import {timedUrl} from './media-key.js';
import {guessLanguage, parseSubtitles, splitBilingual} from './subtitle-formats.js';
import {WebVideoSite} from './web-video-site.js';
import {youtubeSite} from './youtube-site.js';

const ROOT_ID = 'study-yt-reader';
const STYLE_ID = 'study-yt-reader-style';
const TOKENS_ID = 'study-yt-reader-tokens';
const WAIT_MS = 10000;

// Colors come from js/study/study-tokens.css (linked on mount); the fallbacks keep
// the panel readable if the token sheet has not loaded yet. Everything stays
// under the panel root so the YouTube page itself is untouched.
const STYLE = `
#${ROOT_ID}{--r-fg:var(--st-ink,var(--yt-spec-text-primary,#1f2430));--r-muted:var(--st-muted,var(--yt-spec-text-secondary,#5a6172));--r-line:var(--st-line,var(--yt-spec-10-percent-layer,#e6e3dc));--r-tint:var(--st-tint,#f3f1ec);--r-accent:var(--st-accent,#3b4a8c);--r-mark:var(--st-mark,rgb(255 214 92 / 45%));
margin:0 0 16px;border:1px solid var(--r-line);border-radius:10px;background:var(--st-paper,transparent);color:var(--r-fg);font:14px/1.5 var(--st-sans,Roboto,Arial,sans-serif);overflow:hidden}
#${ROOT_ID} .r-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:8px 12px}
#${ROOT_ID} .r-title{flex:1 1 auto;font-weight:600;font-size:13px}
#${ROOT_ID} .r-status{order:9;flex:1 0 100%;min-width:0;color:var(--r-muted);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
#${ROOT_ID} .r-status[data-mode=loop]{color:var(--r-accent)}
#${ROOT_ID} button.r-btn{font:inherit;font-size:12px;color:var(--r-accent);background:transparent;border:1px solid var(--r-line);border-radius:6px;padding:3px 10px;cursor:pointer;transition:background-color 120ms,border-color 120ms}
#${ROOT_ID} button.r-btn:hover:not(:disabled){border-color:var(--r-accent);background:var(--r-tint)}
#${ROOT_ID} button.r-btn:disabled{opacity:.5;cursor:default}
#${ROOT_ID} button[hidden]{display:none}
#${ROOT_ID} button:focus-visible{outline:2px solid var(--r-accent);outline-offset:1px}
#${ROOT_ID} .r-list{position:relative;max-height:min(60vh,520px);overflow:auto;overscroll-behavior:contain;border-top:1px solid var(--r-line)}
#${ROOT_ID} .r-list:empty{display:none}
#${ROOT_ID} .r-cue{display:grid;grid-template-columns:46px minmax(0,1fr) auto;column-gap:6px;padding:7px 8px 7px 0;border-left:3px solid transparent}
#${ROOT_ID} .r-cue.is-current{background:var(--r-tint);border-left-color:var(--r-accent)}
#${ROOT_ID} .r-cue.is-lookup .r-text{text-decoration:underline 2px var(--r-mark);text-underline-offset:4px}
#${ROOT_ID} .r-cue.is-looping{border-left-color:var(--r-accent);background:var(--r-tint)}
#${ROOT_ID} .r-time{grid-column:1;border:0;background:none;padding:0 4px;color:var(--r-muted);font:12px/24px var(--st-sans,Roboto,Arial,sans-serif);font-variant-numeric:tabular-nums;cursor:pointer;text-align:right;align-self:start}
#${ROOT_ID} .r-time::before{content:attr(data-time)}
#${ROOT_ID} .r-time:hover{color:var(--r-accent)}
#${ROOT_ID} .r-text{grid-column:2;margin:0;font-family:var(--st-serif,Georgia,serif);font-size:15px;line-height:1.6;white-space:pre-line;overflow-wrap:anywhere;user-select:text}
#${ROOT_ID} .r-translation{grid-column:2;margin:2px 0 0;color:var(--r-fg);font-size:14px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
#${ROOT_ID} .r-translation:empty{display:none}
#${ROOT_ID} .r-tools{grid-column:3;grid-row:1;align-self:start;display:flex;gap:4px;opacity:0;transition:opacity 120ms}
#${ROOT_ID} .r-cue:hover .r-tools,#${ROOT_ID} .r-cue.is-current .r-tools,#${ROOT_ID} .r-cue.is-looping .r-tools,#${ROOT_ID} .r-tools:focus-within{opacity:1}
#${ROOT_ID} .r-loop{font:inherit;font-size:11px;line-height:20px;color:var(--r-muted);background:none;border:1px solid transparent;border-radius:6px;padding:1px 6px;cursor:pointer}
#${ROOT_ID} .r-loop:hover{color:var(--r-accent);border-color:var(--r-line)}
#${ROOT_ID} .r-loop[aria-pressed=true]{color:var(--r-accent);border-color:var(--r-accent)}
#${ROOT_ID} .r-tabs{display:flex;gap:14px;padding:0 12px;border-top:1px solid var(--r-line)}
#${ROOT_ID} .r-tab{padding:6px 0 5px;border:0;border-bottom:2px solid transparent;background:none;color:var(--r-muted);font:inherit;font-size:12px;cursor:pointer}
#${ROOT_ID} .r-tab[aria-selected=true]{color:var(--r-fg);border-bottom-color:var(--r-accent);font-weight:600}
#${ROOT_ID} .r-list[hidden],#${ROOT_ID} .r-words[hidden]{display:none}
#${ROOT_ID} .r-words{max-height:min(60vh,520px);overflow:auto;border-top:1px solid var(--r-line)}
#${ROOT_ID} .r-words-note{margin:0;padding:12px;color:var(--r-muted);font-size:12px}
#${ROOT_ID} .r-word{display:grid;grid-template-columns:46px auto minmax(0,1fr);column-gap:6px;align-items:baseline;padding:7px 8px 7px 0;border-bottom:1px solid var(--r-line)}
#${ROOT_ID} .r-word-text{font-family:var(--st-serif,Georgia,serif);font-size:15px}
#${ROOT_ID} .r-word-meta{color:var(--r-muted);font-size:11px;text-align:right}
#${ROOT_ID} .r-summary{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:10px 12px;color:var(--r-muted);font-size:12px}
#${ROOT_ID} .r-summary a{color:var(--r-accent)}
#${ROOT_ID} .r-word-sentence{grid-column:2/-1;margin:2px 0 0;color:var(--r-muted);font-size:13px;line-height:1.5;overflow-wrap:anywhere}
#${ROOT_ID} button.r-more{padding:3px 8px;letter-spacing:.1em}
#${ROOT_ID} .r-menu{display:flex;flex-wrap:wrap;gap:6px 14px;padding:8px 12px;border-top:1px solid var(--r-line);font-size:12px;color:var(--r-fg)}
#${ROOT_ID} .r-menu[hidden]{display:none}
#${ROOT_ID} .r-switch{display:inline-flex;align-items:center;gap:5px;cursor:pointer}
#${ROOT_ID} .r-switch input{margin:0;accent-color:var(--r-accent)}
#${ROOT_ID} .r-engine{display:inline-flex;align-items:center;gap:6px;flex:1 0 100%}
#${ROOT_ID} .r-engine select{font:inherit;font-size:12px;color:var(--r-fg);background:var(--st-sheet,transparent);border:1px solid var(--r-line);border-radius:6px;padding:2px 6px}
#${ROOT_ID} .r-downloads{display:flex;flex-wrap:wrap;gap:6px;flex:1 0 100%}
#${ROOT_ID} .r-source{display:inline-flex;align-items:center;gap:6px;flex:1 0 100%}
#${ROOT_ID} .r-source[hidden]{display:none}
#${ROOT_ID} .r-offset{display:inline-flex;align-items:center;gap:4px;flex:1 0 100%}
#${ROOT_ID} .r-offset button{font:inherit;font-size:11px;color:var(--r-accent);background:none;border:1px solid var(--r-line);border-radius:5px;padding:1px 6px;cursor:pointer}
#${ROOT_ID} .r-offset output{min-width:4.5em;text-align:center;font-variant-numeric:tabular-nums}
#${ROOT_ID} .r-status[data-mode=shadow]{color:var(--r-accent)}
#${ROOT_ID} .r-source select{max-width:100%;font:inherit;font-size:12px;color:var(--r-fg);background:var(--st-sheet,transparent);border:1px solid var(--r-line);border-radius:6px;padding:2px 6px}
#${ROOT_ID}.is-drop{outline:2px dashed var(--r-accent);outline-offset:-4px}
#${ROOT_ID}.r-blur .r-translation:not(.is-revealed){filter:blur(5px);cursor:pointer;transition:filter 120ms}
#${ROOT_ID}.r-blur .r-cue:hover .r-translation{filter:none}
#${ROOT_ID}.r-mono .r-translation{display:none}
#${ROOT_ID} .r-cue.is-flash{animation:r-flash 1.2s ease-out}
@keyframes r-flash{from{background:var(--r-mark)}to{background:transparent}}
@media (prefers-reduced-motion:reduce){#${ROOT_ID} *{transition:none;animation:none}}
`;

/**
 * @typedef {{root: HTMLElement, status: HTMLElement, load: HTMLButtonElement, follow: HTMLButtonElement, resume: HTMLButtonElement, list: HTMLElement, translate: HTMLButtonElement, cancel: HTMLButtonElement, retry: HTMLButtonElement, more: HTMLButtonElement, menu: HTMLElement, words: HTMLElement}} ReaderView
 */

/**
 * @typedef {{text: string, context: string, start: number, end: number, url: string, translation: () => string, video: () => HTMLVideoElement|null, isCurrent: () => boolean}} RowInfo
 */

/** @typedef {import('./youtube-site.js').YoutubeSite|WebVideoSite} ReaderSite */

const SUBTITLE_ACCEPT = '.srt,.vtt,.webvtt,.sbv,.ass,.ssa,.ttml,.dfxp,.xml,.json,.txt';
const FILE_LIMIT = 4_000_000;

/**
 * The single caption controller on a watch page. The sidebar is rendered here; other
 * views (the in-video captions) subscribe to its events instead of keeping state:
 * `session`, `reset`, `active`, `lookup`, `loop`, `translation` and `prefs`.
 */
export class YoutubeReader extends EventTarget {
    /** @param {{call?: typeof studyCall, prefs?: Partial<import('./subtitle-prefs.js').SubtitlePrefs>, site?: ReaderSite}} [options] */
    constructor({call = studyCall, prefs, site = youtubeSite} = {}) {
        super();
        /** @type {ReaderSite} */
        this._site = site;
        /** @type {string|null} Identity of the watched video (see media-key.js). */
        this._mediaKey = null;
        /** @type {{id: string, label: string}[]} Subtitle sources found on other sites. */
        this._sources = [];
        /** @type {Map<string, string>} Translations that came inside a bilingual file. */
        this._fileTranslations = new Map();
        /** @type {number} Caption shift for this video, kept across regrouping and reloads. */
        this._offsetMs = 0;
        /** @type {{id: string, startMs: number, endMs: number, plays: number}|null} Sentence being shadowed. */
        this._shadowRow = null;
        /** @type {string} The sentence we just paused after, so playing on does not pause again. */
        this._shadowDone = '';
        /** @type {number} */
        this._shadowTimer = 0;
        /** @type {number} */
        this._savedAt = 0;
        /** @type {number} Resume point offered for this video, or -1. */
        this._resumeMs = -1;
        /** @type {import('./subtitle-prefs.js').SubtitlePrefs} */
        this._prefs = normalizeSubtitlePrefs({...DEFAULT_SUBTITLE_PREFS, ...prefs});
        /** @type {boolean} Tests pass fixed preferences instead of reading storage. */
        this._fixedPrefs = prefs !== void 0;
        /** @type {SubtitleSession|null} The provider track as received, for exports. */
        this._rawSession = null;
        /** @type {Map<string, string[]>} Reading row ID -> original cue IDs. */
        this._members = new Map();
        /** @type {Map<string, RowInfo>} */
        this._rowInfo = new Map();
        /** @type {MutationObserver|null} */
        this._pin = null;
        /** @type {number} Automatic translation waits until this time after a failure. */
        this._autoBackoff = 0;
        /** @type {string[][]|null} Model sentence groups for the current raw track. */
        this._aiGroups = null;
        /** @type {number} */
        this._segmentRun = 0;
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
                // Chrome's on-device translator only exists in pages, so it runs here.
                if (this._prefs.engine === 'chrome') {
                    const source = (this._session?.source.language || 'en').split('-')[0];
                    const rows = await chromeTranslate(items.map((item) => item.text), {source, signal});
                    return items.map((item, index) => ({id: item.id, translation: rows[index]}));
                }
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
        /** @type {AbortController|null} */
        this._loadController = null;
        /** @type {string[]} Caption requests made by the player itself (they carry its own tokens). */
        this._seen = [];
        /** @type {() => void} */
        this._timeListener = () => this._onTime();
        /** @type {{id: string, start: number, end: number, video: HTMLVideoElement}|null} */
        this._loop = null;
        /** @type {string} */
        this._lookup = '';
    }

    /** */
    start() {
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) { this.rememberRequest(entry.name); }
            });
            observer.observe({type: 'resource', buffered: true});
        } catch { /* Without resource timing the user still gets an explicit failure message. */ }
        this._site.watch(() => this._sync());
        window.addEventListener('resize', () => this._place());
        if (!this._fixedPrefs) {
            void readSubtitlePrefs().then((prefs) => this.setPrefs(prefs));
            onSubtitlePrefsChanged((prefs) => this.setPrefs(prefs));
        }
        this._sync();
    }

    /** @returns {import('./subtitle-prefs.js').SubtitlePrefs} */
    get prefs() { return this._prefs; }

    /** @returns {SubtitleSession|null} */
    get session() { return this._session; }

    /** @returns {string} */
    get lookupId() { return this._lookup; }

    /** @returns {string} */
    get loopId() { return this._loop?.id ?? ''; }

    /**
     * @param {string} id
     * @returns {RowInfo|undefined}
     */
    rowInfo(id) { return this._rowInfo.get(id); }

    /**
     * Applies preferences from storage or another view; rebuilds rows only when the
     * sentence grouping itself changed.
     * @param {import('./subtitle-prefs.js').SubtitlePrefs} prefs
     */
    setPrefs(prefs) {
        const previous = this._prefs;
        this._prefs = normalizeSubtitlePrefs(prefs);
        this._view?.root.classList.toggle('r-blur', this._prefs.blur);
        this._view?.root.classList.toggle('r-mono', !this._prefs.bilingual);
        if ((previous.merge !== this._prefs.merge || previous.aiSegment !== this._prefs.aiSegment) && this._rawSession && this._view) {
            this._present(this._rawSession);
        }
        if (this._prefs.aiSegment && !previous.aiSegment) { void this._runSegmentation(); }
        this._armShadow();
        if (!this._prefs.aiSegment) { ++this._segmentRun; }
        this._syncMenu();
        this._emit('prefs', {prefs: this._prefs});
    }

    /**
     * Saves a preference change for every view and the settings page.
     * @param {Partial<import('./subtitle-prefs.js').SubtitlePrefs>} patch
     */
    updatePrefs(patch) {
        this.setPrefs({...this._prefs, ...patch});
        if (!this._fixedPrefs) { void writeSubtitlePrefs(patch).catch(() => {}); }
    }

    /**
     * @param {string} type
     * @param {Record<string, unknown>} [detail]
     */
    _emit(type, detail = {}) {
        this.dispatchEvent(new CustomEvent(type, {detail}));
    }

    /**
     * Joined sentences are display rows; each keeps its original cue IDs and times.
     * @param {SubtitleSession} raw
     * @returns {SubtitleSession}
     */
    _readingSession(raw) {
        this._members = new Map(raw.cues.map((cue) => [cue.id, [cue.id]]));
        const ai = this._prefs.aiSegment && this._aiGroups ? groupsFromIds(raw.cues, this._aiGroups) : null;
        if (!ai && !this._prefs.merge) { return raw; }
        const groups = ai ?? groupForReading(raw.cues);
        if (groups.length === raw.cues.length) { return raw; }
        this._members = new Map(groups.map((group) => [group.cueIds[0], [...group.cueIds]]));
        return new SubtitleSession(raw.source, groups.map((group) => ({id: group.cueIds[0], startMs: group.startMs, endMs: group.endMs, text: group.text})));
    }

    /**
     * Renders the reading rows of a track, carrying over translations a bilingual file brought.
     * @param {SubtitleSession} raw
     */
    _present(raw) {
        const session = this._readingSession(raw);
        for (const target of new Set([raw, session])) {
            try { target.setOffset(this._offsetMs); } catch { /* keep the previous shift */ }
        }
        if (this._fileTranslations.size > 0) {
            for (const cue of session.cues) {
                const text = this.members(cue.id).map((id) => this._fileTranslations.get(id) ?? '').filter(Boolean)
                    .join('\n');
                if (text) { session.acceptTranslation(cue.id, text.slice(0, 6000)); }
            }
        }
        this._render(session);
    }

    /**
     * Original cue IDs behind one reading row, for cards that must outlive regrouping.
     * @param {string} id
     * @returns {string[]}
     */
    members(id) { return [...(this._members.get(id) ?? [id])]; }

    /**
     * Scrolls the sidebar to a row and marks it briefly, without changing follow state.
     * @param {string} id
     */
    revealRow(id) {
        const row = this._rows.get(id);
        const list = this._view?.list;
        if (!row || !list) { return; }
        // On other sites the list sits in a floating panel that may be closed.
        this._site.toggleDock(true);
        this._pauseFollow();
        list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 3);
        row.classList.remove('is-flash');
        void row.offsetWidth;
        row.classList.add('is-flash');
    }

    /** @param {string} id */
    seekTo(id) { this._seek(id); }

    /** @param {string} id */
    toggleLoop(id) { this._toggleLoop(id); }

    /** @returns {number} */
    get offsetMs() { return this._offsetMs; }

    /**
     * Shifts the captions against the video (positive = later) and remembers it for this video.
     * @param {number} ms
     */
    setOffset(ms) {
        const value = Math.max(-600000, Math.min(600000, Math.round(ms / 50) * 50));
        this._offsetMs = value;
        for (const target of new Set([this._rawSession, this._session])) {
            try { target?.setOffset(value); } catch { /* bounds are checked above */ }
        }
        this._shadowRow = null;
        this._active = '';
        this._onTime();
        this._syncMenu();
        this._emit('offset', {ms: value});
        if (this._mediaKey && this._rawSession) { void writeVideoState(this._mediaKey, {offsetMs: value, trackKey: this._rawSession.source.trackKey}); }
    }

    /** Jumps to the offered resume point. */
    resume() {
        if (this._resumeMs < 0 || !this._video) { return; }
        this._video.currentTime = this._resumeMs / 1000;
        this._clearResume();
        this._resumeFollow();
    }

    /** @returns {number} */
    get resumeMs() { return this._resumeMs; }

    /** */
    _clearResume() {
        if (this._resumeMs < 0) { return; }
        this._resumeMs = -1;
        if (this._view) { this._view.resume.hidden = true; }
        this._emit('resume', {ms: -1});
    }

    /**
     * After a track loads: restore its caption shift and offer (never force) the last position.
     * @param {SubtitleSession} raw
     */
    async _restoreVideoState(raw) {
        const key = this._mediaKey;
        if (!key) { return; }
        const state = await readVideoState(key);
        if (!state || this._rawSession !== raw) { return; }
        if (typeof state.offsetMs === 'number' && state.offsetMs !== 0 && state.trackKey === raw.source.trackKey) { this.setOffset(state.offsetMs); }
        const at = state.resumeMs;
        const now = (this._video?.currentTime ?? 0) * 1000;
        if (this._prefs.resume && typeof at === 'number' && at > 30000 && Math.abs(at - now) > 15000 && this._view) {
            this._resumeMs = at;
            this._view.resume.textContent = `从 ${timeLabel(at)} 继续`;
            this._view.resume.hidden = false;
            this._emit('resume', {ms: at});
        }
    }

    /** Starts or stops the shadowing check with the preference. */
    _armShadow() {
        if (this._prefs.shadow && this._session && !this._shadowTimer) {
            this._shadowTimer = window.setInterval(() => this._shadowTick(), 60);
        } else if ((!this._prefs.shadow || !this._session) && this._shadowTimer) {
            clearInterval(this._shadowTimer);
            this._shadowTimer = 0;
            this._shadowRow = null;
        }
    }

    /**
     * Shadowing: each sentence plays the chosen number of times, then the video pauses
     * so the learner can say it. Playing on continues; a loop takes precedence.
     */
    _shadowTick() {
        const session = this._session;
        const video = this._video;
        if (!session || !video || video.paused || this._loop || !this._prefs.shadow) { return; }
        const offset = session.offsetMs;
        const now = video.currentTime * 1000 - offset;
        let row = this._shadowRow;
        if (!row || now < row.startMs - 300 || now > row.endMs + 1500) {
            const cue = session.cues.find((c) => c.startMs <= now && now < c.endMs);
            if (!cue || (cue.id === this._shadowDone && now > cue.endMs - 400)) {
                this._shadowRow = null;
                return;
            }
            if (cue.id !== this._shadowDone) { this._shadowDone = ''; }
            row = {id: cue.id, startMs: cue.startMs, endMs: cue.endMs, plays: 1};
            this._shadowRow = row;
        }
        if (now < row.endMs - 40) { return; }
        if (row.plays < this._prefs.shadowRepeats) {
            ++row.plays;
            video.currentTime = Math.max(0, row.startMs + offset) / 1000;
            this._status(`跟读：第 ${row.plays}/${this._prefs.shadowRepeats} 遍`, 'shadow');
            return;
        }
        video.pause();
        this._shadowDone = row.id;
        this._shadowRow = null;
        this._status('跟读：跟着说完这句，再按播放继续', 'shadow');
        this._emit('shadow', {id: row.id});
    }

    /**
     * Remembers the sentence being watched, at most every few seconds.
     * @param {number} playbackMs
     */
    _saveProgress(playbackMs) {
        const key = this._mediaKey;
        if (!key || !this._video || this._video.paused || Date.now() - this._savedAt < 5000) { return; }
        this._savedAt = Date.now();
        void writeVideoState(key, {resumeMs: Math.max(0, Math.round(playbackMs))});
        if (this._resumeMs >= 0 && Math.abs(playbackMs - this._resumeMs) < 15000) { this._clearResume(); }
    }

    /** Starts the explicit caption load, as the sidebar button does. */
    loadCaptions() { void this._load(this._generation); }

    /** Translates the next rows from the playback position, as the sidebar button does. */
    translateNext() { void this._translate(false); }

    /**
     * @param {'vtt'|'bilingual'|'json'} kind
     */
    download(kind) {
        const raw = this._rawSession;
        const session = this._session;
        if (!raw || !session) { return; }
        const base = `${this._videoId ?? ((document.title || 'subtitles').replaceAll(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60))}-${raw.source.language}`;
        if (kind === 'vtt') {
            saveText(`${base}.vtt`, raw.exportVtt(false), 'text/vtt');
        } else if (kind === 'bilingual') {
            saveText(`${base}.zh.vtt`, session.exportVtt(true), 'text/vtt');
        } else {
            const rows = session.cues.map((cue) => ({id: cue.id, cueIds: this.members(cue.id), startMs: cue.startMs, endMs: cue.endMs, text: cue.text, translation: session.translation(cue.id)}));
            saveText(`${base}.json`, JSON.stringify({source: raw.source, offsetMs: session.offsetMs, cues: raw.cues, rows}, null, 2), 'application/json');
        }
    }

    /** @returns {Element|null} */
    _host() { return this._site.host(); }

    /** */
    _place() {
        const root = this._view?.root;
        const host = root && this._site.pinFirst() ? this._host() : null;
        if (root && host && root.parentElement !== host) {
            host.prepend(root);
            this._keepFirst(host);
        }
    }

    /**
     * @param {string} name
     */
    rememberRequest(name) {
        if (this._site.kind === 'web') {
            this._site.remember(name);
            return;
        }
        if (!name.includes('/api/timedtext')) { return; }
        this._seen.push(name);
        if (this._seen.length > 50) { this._seen.shift(); }
    }

    /** */
    _sync() {
        const key = this._site.mediaKey();
        if (key === this._mediaKey && (key === null || this._view?.root.isConnected)) {
            this._rebindVideo();
            return;
        }
        this._reset();
        this._mediaKey = key;
        this._videoId = key?.startsWith('youtube:') ? key.slice(8) : null;
        if (key !== null) { void this._mount(++this._generation); }
    }

    /** Players that rebuild their <video> keep the same captions; follow the new element. */
    _rebindVideo() {
        if (!this._session || this._video?.isConnected) { return; }
        const video = this._site.video();
        if (!video) { return; }
        this._video?.removeEventListener('timeupdate', this._timeListener);
        this._video = video;
        video.addEventListener('timeupdate', this._timeListener);
    }

    /** */
    _reset() {
        ++this._generation;
        this._loadController?.abort();
        this._loadController = null;
        this._translateRun = '';
        this._queue.cancel();
        this._translating = false;
        this._failed.clear();
        youtubeStudyContext.reset();
        this._video?.removeEventListener('timeupdate', this._timeListener);
        this._video = null;
        this._loop = null;
        this._lookup = '';
        this._session = null;
        this._rawSession = null;
        this._aiGroups = null;
        this._fileTranslations = new Map();
        this._sources = [];
        this._offsetMs = 0;
        this._resumeMs = -1;
        this._shadowRow = null;
        this._shadowDone = '';
        if (this._shadowTimer) {
            clearInterval(this._shadowTimer);
            this._shadowTimer = 0;
        }
        ++this._segmentRun;
        this._rows.clear();
        this._rowInfo.clear();
        this._active = '';
        this._follow = true;
        this._pin?.disconnect();
        this._pin = null;
        this._view?.root.remove();
        this._view = null;
        this._emit('reset');
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
        if (!document.getElementById(TOKENS_ID) && typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
            const tokens = document.createElement('link');
            tokens.id = TOKENS_ID;
            tokens.rel = 'stylesheet';
            tokens.href = chrome.runtime.getURL('js/study/study-tokens.css');
            document.head.append(tokens);
        }
        document.getElementById(ROOT_ID)?.remove();
        const root = document.createElement('section');
        root.id = ROOT_ID;
        root.className = 'st-scope';
        root.lang = 'zh-CN';
        const head = document.createElement('div');
        head.className = 'r-head';
        const title = document.createElement('span');
        title.className = 'r-title';
        title.textContent = '字幕学习';
        const status = document.createElement('span');
        status.className = 'r-status';
        status.setAttribute('role', 'status');
        status.textContent = this._site.kind === 'web' ? '载入页面字幕或导入字幕文件后选词学习。' : '载入原文后选词学习；翻译需手动点击。';
        const follow = this._button('跟随播放', () => this._resumeFollow());
        follow.hidden = true;
        const resume = this._button('继续', () => this.resume());
        resume.hidden = true;
        resume.title = '回到上次学到的句子';
        const load = this._button('载入字幕', () => { void this._load(generation); });
        const translate = this._button('翻译接下来8句', () => { void this._translate(false); });
        translate.title = '从当前播放位置起，翻译还没有译文的 8 句';
        translate.classList.add('r-translate'); translate.hidden = true;
        const retry = this._button('重试失败', () => { void this._translate(true); });
        retry.hidden = true;
        const cancel = this._button('取消翻译', () => {
            this._translateRun = '';
            this._queue.cancel();
            this._status('已取消；原文和已完成译文保留。');
        });
        cancel.hidden = true;
        // Less frequent actions live behind one menu so the list stays the first thing to read.
        const more = this._button('⋯', () => {
            menu.hidden = !menu.hidden;
            more.setAttribute('aria-expanded', String(!menu.hidden));
        });
        more.classList.add('r-more');
        more.setAttribute('aria-label', '更多：显示方式与下载');
        more.setAttribute('aria-expanded', 'false');
        const menu = document.createElement('div');
        menu.className = 'r-menu scan-disable';
        menu.hidden = true;
        /** @type {[keyof import('./subtitle-prefs.js').SubtitlePrefs, string][]} */
        const toggles = [['autoTranslate', '自动翻译'], ['overlay', '视频内字幕'], ['bilingual', '双语显示'], ['blur', '模糊译文'], ['merge', '合并成整句'], ['aiSegment', 'AI 断句（用模型）'], ['shadow', '跟读（每句后暂停）'], ['resume', '记住观看进度']];
        // Other sites may offer several subtitle files; the learner can switch between them.
        const source = document.createElement('label');
        source.className = 'r-source';
        source.hidden = true;
        source.append('字幕来源');
        const sourceSelect = document.createElement('select');
        sourceSelect.dataset.source = '';
        sourceSelect.addEventListener('change', () => { void this._load(generation, sourceSelect.value); });
        source.append(sourceSelect);
        menu.append(source, engineSelect((engine) => this.updatePrefs({engine})));
        for (const [key, label] of toggles) {
            const toggle = document.createElement('label');
            toggle.className = 'r-switch';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.dataset.pref = key;
            box.addEventListener('change', () => this.updatePrefs({[key]: box.checked}));
            toggle.append(box, label);
            menu.append(toggle);
        }
        menu.append(repeatSelect((shadowRepeats) => this.updatePrefs({shadowRepeats})), offsetControl(this));
        const downloads = document.createElement('div');
        downloads.className = 'r-downloads';
        const importButton = this._button('导入字幕文件…', () => this.pickFile());
        importButton.title = 'SRT、VTT、ASS、TTML、SBV 或 JSON；只在本页使用，不上传';
        downloads.append(importButton);
        for (const [kind, label] of /** @type {['vtt'|'bilingual'|'json', string][]} */ ([['vtt', '下载原文 VTT'], ['bilingual', '下载双语 VTT'], ['json', '下载 JSON']])) {
            const button = this._button(label, () => this.download(kind));
            button.dataset.download = kind;
            downloads.append(button);
        }
        menu.append(downloads);
        head.append(title, status, resume, translate, retry, cancel, follow, more, load);
        const list = document.createElement('div');
        list.className = 'r-list';
        list.setAttribute('role', 'list');
        const pause = () => this._pauseFollow();
        list.addEventListener('wheel', pause, {passive: true});
        list.addEventListener('touchmove', pause, {passive: true});
        // Selecting text must not be pulled away by follow scrolling.
        list.addEventListener('selectstart', pause);
        // Two views over this video: the caption list and the words already saved from it.
        const tabs = document.createElement('div');
        tabs.className = 'r-tabs scan-disable';
        tabs.setAttribute('role', 'tablist');
        const words = document.createElement('div');
        words.className = 'r-words';
        words.hidden = true;
        /** @type {HTMLButtonElement[]} */
        const tabButtons = [];
        for (const [name, label] of [['captions', '字幕'], ['words', '本视频生词']]) {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'r-tab';
            tab.setAttribute('role', 'tab');
            tab.dataset.tab = name;
            tab.setAttribute('aria-selected', String(name === 'captions'));
            tab.textContent = label;
            tab.addEventListener('click', () => {
                for (const other of tabButtons) { other.setAttribute('aria-selected', String(other === tab)); }
                list.hidden = name !== 'captions';
                words.hidden = name !== 'words';
                if (name === 'words') { void this._loadWords(); }
            });
            tabButtons.push(tab);
            tabs.append(tab);
        }
        root.append(head, menu, tabs, list, words);
        root.classList.toggle('r-blur', this._prefs.blur);
        root.classList.toggle('r-mono', !this._prefs.bilingual);
        // Reveal one blurred translation on click without affecting the others.
        list.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target.closest('.r-translation') : null;
            if (target && root.classList.contains('r-blur')) { target.classList.toggle('is-revealed'); }
        });
        // A subtitle file dropped on the panel is read locally, like the import button.
        root.addEventListener('dragover', (event) => {
            if (!event.dataTransfer?.types.includes('Files')) { return; }
            event.preventDefault();
            root.classList.add('is-drop');
        });
        root.addEventListener('dragleave', () => root.classList.remove('is-drop'));
        root.addEventListener('drop', (event) => {
            const file = event.dataTransfer?.files[0];
            root.classList.remove('is-drop');
            if (!file) { return; }
            event.preventDefault();
            void this._importFile(file);
        });
        host.prepend(root);
        this._view = {root, status, load, follow, resume, list, translate, cancel, retry, more, menu, words};
        if (this._site.pinFirst()) { this._keepFirst(host); }
        this._syncMenu();
    }

    /**
     * YouTube inserts its own panels into the right column later; keep ours on top.
     * @param {Element} host
     */
    _keepFirst(host) {
        this._pin?.disconnect();
        const root = this._view?.root;
        if (!root) { return; }
        this._pin = new MutationObserver(() => {
            if (root.isConnected && root.parentElement === host && host.firstElementChild !== root) { host.prepend(root); }
        });
        this._pin.observe(host, {childList: true});
    }

    /** Mirrors the stored preferences into the sidebar menu and download buttons. */
    _syncMenu() {
        const view = this._view;
        if (!view) { return; }
        for (const box of view.menu.querySelectorAll('input[data-pref]')) {
            const key = /** @type {keyof import('./subtitle-prefs.js').SubtitlePrefs} */ (/** @type {HTMLInputElement} */ (box).dataset.pref);
            /** @type {HTMLInputElement} */ (box).checked = Boolean(this._prefs[key]);
        }
        for (const select of view.menu.querySelectorAll('select[data-engine]')) { /** @type {HTMLSelectElement} */ (select).value = this._prefs.engine; }
        syncControls(view.menu, this);
        for (const button of view.menu.querySelectorAll('button[data-download]')) {
            /** @type {HTMLButtonElement} */ (button).disabled = !this._session;
        }
        const select = /** @type {HTMLSelectElement|null} */ (view.menu.querySelector('select[data-source]'));
        if (select) {
            const label = /** @type {HTMLElement} */ (select.parentElement);
            label.hidden = this._sources.length < 2;
            select.replaceChildren(...this._sources.map(({id, label: text}) => Object.assign(document.createElement('option'), {value: id, textContent: text})));
            select.value = this._session?.source.trackKey ?? '';
        }
    }

    /** Opens a file picker for a local subtitle file. */
    pickFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = SUBTITLE_ACCEPT;
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (file) { void this._importFile(file); }
        }, {once: true});
        input.click();
    }

    /** @param {File} file */
    async _importFile(file) {
        if (!this._view || !this._mediaKey) { return; }
        if (file.size > FILE_LIMIT) {
            this._status('字幕文件过大（上限 4 MB）。');
            return;
        }
        const generation = this._generation;
        try {
            const text = await file.text();
            if (generation !== this._generation) { return; }
            this.importText(text, file.name);
        } catch (error) {
            if (generation === this._generation) { this._status(`导入失败：${error instanceof Error ? error.message : String(error)}`); }
        }
    }

    /**
     * Uses subtitle text from a file the learner chose. Times come from the file;
     * the offset control can line them up with this video.
     * @param {string} text
     * @param {string} name
     */
    importText(text, name) {
        if (!this._view || !this._mediaKey) { return; }
        try {
            const {cues, format} = parseSubtitles(text, name);
            this._useCues(cues, {trackKey: `file:${name.slice(0, 100)}`, label: `${name.slice(0, 60)}（本地文件 · ${format.toUpperCase()}）`, language: '', acquisition: 'import'});
        } catch (error) {
            this._status(`导入失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * @param {import('./subtitle-session.js').SubtitleCue[]} input
     * @param {{trackKey: string, label: string, language: string, acquisition: 'provider'|'import'}} meta
     */
    _useCues(input, meta) {
        const key = this._mediaKey;
        if (!key) { return; }
        const bilingual = splitBilingual(input);
        const cues = bilingual?.cues ?? input;
        const language = meta.language || guessLanguage(cues);
        const session = new SubtitleSession({
            mediaKey: key,
            trackKey: meta.trackKey,
            revision: `${meta.trackKey}|${cues.length}|${cues.at(-1)?.endMs ?? 0}`,
            language,
            acquisition: meta.acquisition,
            url: this._site.pageUrl(),
            trackName: meta.label,
        }, cues);
        this._rawSession = session;
        this._aiGroups = null;
        /** @type {Map<string, string>} */
        const translations = bilingual?.translations ?? new Map();
        this._fileTranslations = translations;
        this._offsetMs = 0;
        this._present(session);
        void this._restoreVideoState(session);
        if (bilingual) { this._status(`${meta.label} · ${cues.length} 句 · 已带中文译文`); }
        if (this._prefs.aiSegment) { void this._runSegmentation(); }
    }

    /**
     * @param {string} text
     * @param {(event?: MouseEvent) => void} onClick
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
     * @param {string} [mode]
     */
    _status(text, mode = '') {
        if (!this._view) { return; }
        this._view.status.textContent = text;
        this._view.status.dataset.mode = mode;
    }

    /**
     * @param {number} generation
     * @param {string} [sourceId] A source from the menu; empty picks the best one.
     */
    async _load(generation, sourceId = '') {
        if (this._site.kind === 'web') {
            await this._loadWeb(generation, sourceId);
            return;
        }
        const view = this._view;
        const videoId = this._videoId;
        if (!view || !videoId || generation !== this._generation || this._loadController) { return; }
        const controller = new AbortController();
        this._loadController = controller;
        /** @type {ReturnType<typeof setTimeout>|null} */
        let timeout = null;
        let timedOut = false;
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
            timeout = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, WAIT_MS);
            const response = await fetch(url.href, {credentials: 'include', signal: controller.signal});
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
            this._rawSession = session;
            this._aiGroups = null;
            this._fileTranslations = new Map();
            this._offsetMs = 0;
            this._present(session);
            void this._restoreVideoState(session);
            if (this._prefs.aiSegment) { void this._runSegmentation(); }
        } catch (error) {
            if (generation === this._generation) { this._status(timedOut ? '字幕读取超时，请重试。' : `字幕读取失败：${error instanceof Error ? error.message : String(error)}`); }
        } finally {
            if (timeout !== null) { clearTimeout(timeout); }
            if (this._loadController === controller) { this._loadController = null; }
            view.load.disabled = false;
        }
    }

    /**
     * Other sites: the video's own text tracks or a subtitle file the page loaded.
     * @param {number} generation
     * @param {string} sourceId
     */
    async _loadWeb(generation, sourceId) {
        const view = this._view;
        const site = this._site;
        if (!view || !this._mediaKey || generation !== this._generation || this._loadController || site.kind !== 'web') { return; }
        const controller = new AbortController();
        this._loadController = controller;
        const timeout = setTimeout(() => controller.abort(), WAIT_MS);
        view.load.disabled = true;
        this._status('正在查找这个视频的字幕…');
        try {
            const found = await site.load({signal: controller.signal, sourceId, learning: 'en'});
            if (generation !== this._generation) { return; }
            this._sources = found?.all ?? site.sources('en').map(({id, label}) => ({id, label}));
            if (!found) {
                this._status(controller.signal.aborted ? '字幕读取超时，请重试。' : '没找到这个视频的字幕：先在播放器里打开字幕（CC）再点载入，或在「⋯」里导入字幕文件。');
                this._syncMenu();
                return;
            }
            this._useCues(found.cues, {trackKey: found.id, label: found.label, language: found.language, acquisition: 'provider'});
        } catch (error) {
            if (generation === this._generation) { this._status(`字幕读取失败：${error instanceof Error ? error.message : String(error)}`); }
        } finally {
            clearTimeout(timeout);
            if (this._loadController === controller) { this._loadController = null; }
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
        const current = () => generation === this._generation && youtubeVideoId(location.href) === videoId;
        if (!current()) { return null; }
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
        if (!current() || !cc.isConnected || document.querySelector('#movie_player .ytp-subtitles-button') !== cc) { return null; }
        cc.click();
        const deadline = Date.now() + WAIT_MS;
        while (!url && current() && Date.now() < deadline) {
            await new Promise((resolve) => { setTimeout(resolve, 250); });
            url = find();
        }
        return current() ? url : null;
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
        this._loop = null;
        this._lookup = '';
        this._session = session;
        this._rows.clear();
        this._rowInfo.clear();
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
            translated.textContent = session.translation(cue.id);
            // Times are read when used, so a later offset change still captures the right clip.
            /** @type {RowInfo} */
            const info = {
                text: text.textContent.trimEnd(),
                context: this._context(session, index),
                get start() { return Math.max(0, cue.startMs + session.offsetMs) / 1000; },
                get end() { return Math.max(0, cue.endMs + session.offsetMs) / 1000; },
                get url() { return timedUrl(session.source.url || location.href, Math.max(0, cue.startMs + session.offsetMs) / 1000).url; },
                translation: () => session.translation(cue.id),
                video: () => {
                    this._markLookup(cue.id);
                    return this._video;
                },
                isCurrent: () => this._session === session && this._mediaKey !== null && this._mediaKey === this._site.mediaKey(),
            };
            youtubeStudyContext.register(text, info);
            this._rowInfo.set(cue.id, info);
            // Row tools sit outside the sentence node so a lookup never reads their labels.
            const tools = document.createElement('span');
            tools.className = 'r-tools scan-disable';
            const loop = document.createElement('button');
            loop.type = 'button';
            loop.className = 'r-loop';
            loop.textContent = '循环';
            loop.setAttribute('aria-pressed', 'false');
            loop.setAttribute('aria-label', `循环本句 ${timeLabel(cue.startMs)}`);
            loop.addEventListener('click', () => this._toggleLoop(cue.id));
            tools.append(loop);
            row.append(time, text, tools, translated);
            rows.push(row);
            this._rows.set(cue.id, row);
        }
        view.list.replaceChildren(...rows);
        view.load.textContent = '重新载入';
        view.translate.hidden = false;
        view.retry.hidden = true;
        this._status(`${session.source.trackName ?? session.source.language} · ${session.cues.length} 句；选词用现有词卡`);
        this._active = '';
        this._syncMenu();
        this._emit('session', {session});
        const video = this._site.video();
        if (video) {
            this._video = video;
            video.addEventListener('timeupdate', this._timeListener);
            this._onTime();
        }
        this._armShadow();
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
        this._status(`正在翻译 ${items.length} 句 · ${ENGINE_LABELS[this._prefs.engine]}…`);
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
                        this._emit('translation', {id: row.id});
                    } else {
                        this._failed.add(row.id);
                        if (target) { target.textContent = `翻译未完成：${row.error || '可重试'}`; }
                    }
                }});
            if (this._session === session && !result.cancelled) {
                this._status(`已译 ${session.progress().translated}/${session.cues.length} · ${ENGINE_LABELS[this._prefs.engine]}${this._failed.size > 0 ? ' · 有失败，可重试或换服务' : ''}`);
                if (this._failed.size > 0) { this._autoBackoff = Date.now() + 20000; }
            }
        } catch (error) {
            this._autoBackoff = Date.now() + 20000;
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
        if (this._loop && this._loop.id !== id) { this._stopLoop('已退出循环'); }
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
        const loop = this._loop;
        if (loop) {
            const now = video.currentTime;
            if (loop.video !== video || now < loop.start - 0.75 || now > loop.end + 1.5) {
                this._stopLoop('已退出循环（播放位置已改变）');
            } else if (now >= loop.end) {
                video.currentTime = loop.start;
                return;
            }
        }
        const active = session.active(video.currentTime * 1000).map((c) => c.id);
        const key = active.join('|');
        if (key === this._active) { return; }
        this._active = key;
        for (const [id, row] of this._rows) { row.classList.toggle('is-current', active.includes(id)); }
        this._emit('active', {ids: active});
        this._autoTranslate(video.currentTime * 1000);
        if (this._prefs.resume) { this._saveProgress(video.currentTime * 1000); }
        const first = active.length > 0 ? this._rows.get(active[0]) : void 0;
        if (this._follow && first) {
            const list = this._view.list;
            list.scrollTop = Math.max(0, first.offsetTop - list.clientHeight / 3);
        }
    }

    /**
     * @param {string} id
     */
    _toggleLoop(id) {
        const session = this._session;
        const video = this._video;
        if (!session || !video) { return; }
        if (this._loop?.id === id) {
            this._stopLoop('已退出循环');
            return;
        }
        this._stopLoop('');
        try {
            const cue = session.cue(id);
            const start = session.seekSeconds(id);
            this._loop = {id, start, end: (cue.endMs + session.offsetMs) / 1000, video};
            video.currentTime = start;
        } catch (error) {
            this._loop = null;
            this._status(error instanceof Error ? error.message : String(error));
            return;
        }
        const row = this._rows.get(id);
        row?.classList.add('is-looping');
        row?.querySelector('.r-loop')?.setAttribute('aria-pressed', 'true');
        this._emit('loop', {id});
        this._status('正在循环本句 · 再点「循环」或跳到别处即退出', 'loop');
        this._resumeFollow();
    }

    /**
     * @param {string} message
     */
    _stopLoop(message) {
        const loop = this._loop;
        if (!loop) { return; }
        this._loop = null;
        const row = this._rows.get(loop.id);
        row?.classList.remove('is-looping');
        row?.querySelector('.r-loop')?.setAttribute('aria-pressed', 'false');
        if (message) { this._status(message); }
        this._emit('loop', {id: ''});
    }

    /**
     * The sentence bound to the word card is marked separately from playback.
     * A lookup also ends a loop so audio capture never fights the loop for the player.
     * @param {string} id
     */
    _markLookup(id) {
        if (this._loop) { this._stopLoop('已退出循环（查词中）'); }
        if (this._lookup === id) { return; }
        this._rows.get(this._lookup)?.classList.remove('is-lookup');
        this._lookup = id;
        this._rows.get(id)?.classList.add('is-lookup');
        this._emit('lookup', {id});
    }

    /**
     * Asks the model to regroup the whole track window by window (explicit opt-in).
     * The last group of each window is re-sent with the next one so sentences are not
     * cut at window edges. Any invalid answer keeps the rule-based grouping.
     */
    async _runSegmentation() {
        const raw = this._rawSession;
        if (!raw || !this._prefs.aiSegment) { return; }
        const run = ++this._segmentRun;
        const live = () => run === this._segmentRun && this._rawSession === raw && this._prefs.aiSegment;
        try {
            const config = /** @type {import('study').StudyConfig} */ (await this._call('subtitleSettings'));
            const cues = raw.cues;
            /** @type {string[][]} */
            const groups = [];
            let start = 0;
            while (start < cues.length) {
                if (!live()) { return; }
                const window = [];
                let chars = 0;
                for (const cue of cues.slice(start, start + 60)) {
                    const text = cue.text.slice(0, 600);
                    if (window.length > 1 && chars + text.length > 12000) { break; }
                    chars += text.length;
                    window.push({id: cue.id, text});
                }
                this._status(`AI 断句中 ${Math.round(start / cues.length * 100)}%…`);
                let proposed = [[window[0].id]];
                if (window.length > 1) {
                    const result = /** @type {{groups: string[][]}} */ (await this._call('subtitleSegment', {
                        requestId: `seg-${run}-${start}`,
                        items: window,
                        language: raw.source.language,
                        config: {model: config.model, effort: config.effort},
                    }));
                    proposed = result.groups;
                }
                if (!live()) { return; }
                const last = start + window.length >= cues.length;
                const keep = last || proposed.length < 2 ? proposed : proposed.slice(0, -1);
                groups.push(...keep);
                start += keep.flat().length;
            }
            if (!live()) { return; }
            this._aiGroups = groups;
            this._present(raw);
            this._status(`AI 断句完成 · ${groups.length} 句`);
        } catch (error) {
            if (live()) { this._status(`AI 断句未完成：${error instanceof Error ? error.message : String(error)}；已保留规则断句。`); }
        }
    }

    /** Lists the words already saved from this video; clicking one returns to its moment. */
    async _loadWords() {
        const view = this._view;
        const mediaKey = this._mediaKey;
        if (!view || !mediaKey) { return; }
        const generation = this._generation;
        view.words.replaceChildren(Object.assign(document.createElement('p'), {className: 'r-words-note', textContent: '正在读取这个视频里记住的词…'}));
        try {
            const result = /** @type {{items?: {id: string, word: string, sentence: string, videoTime: number|null, stage: number, cards: number}[]}} */ (await this._call('libraryVideoWords', {mediaKey}));
            if (generation !== this._generation) { return; }
            const items = result.items ?? [];
            if (items.length === 0) {
                view.words.replaceChildren(Object.assign(document.createElement('p'), {className: 'r-words-note', textContent: '这个视频还没有记住的词。选词后点「记住它」就会出现在这里。'}));
                return;
            }
            // One explicit button writes a short study summary into this video's Obsidian note.
            const summary = document.createElement('div');
            summary.className = 'r-summary scan-disable';
            const write = this._button('写入视频笔记', (event) => {
                // Only a real click by the learner; page scripts cannot press it for them.
                if (event?.isTrusted === false) { return; }
                void this.writeSummary();
            });
            write.title = '在 Obsidian 的视频记录里写入（或更新）本视频的学习小结；只改小结那一段';
            const summaryState = document.createElement('span');
            summaryState.setAttribute('role', 'status');
            summary.append(write, summaryState);
            view.words.replaceChildren(summary, ...items.map((item) => {
                const row = document.createElement('div');
                row.className = 'r-word';
                const time = document.createElement('button');
                time.type = 'button';
                time.className = 'r-time';
                const seconds = typeof item.videoTime === 'number' ? item.videoTime : null;
                time.dataset.time = seconds === null ? '—' : timeLabel(seconds * 1000);
                time.setAttribute('aria-label', seconds === null ? `${item.word}（无时间）` : `回到 ${item.word} 的原句`);
                time.disabled = seconds === null;
                time.addEventListener('click', () => {
                    if (seconds === null || !this._video) { return; }
                    this._video.currentTime = seconds;
                    this._resumeFollow();
                });
                const word = document.createElement('strong');
                word.className = 'r-word-text';
                word.textContent = item.word;
                const meta = document.createElement('span');
                meta.className = 'r-word-meta';
                meta.textContent = item.cards > 0 ? `${item.cards} 张卡${item.stage ? ` · 到第 ${item.stage} 阶段` : ''}` : '只记了笔记';
                const sentence = document.createElement('p');
                sentence.className = 'r-word-sentence';
                sentence.textContent = item.sentence;
                row.append(time, word, meta, sentence);
                return row;
            }));
        } catch (error) {
            if (generation === this._generation) {
                view.words.replaceChildren(Object.assign(document.createElement('p'), {className: 'r-words-note', textContent: `暂时读不到：${error instanceof Error ? error.message : String(error)}`}));
            }
        }
    }

    /**
     * Writes or refreshes the study summary in this video's note (explicit action only).
     * @returns {Promise<void>}
     */
    async writeSummary() {
        const view = this._view;
        const mediaKey = this._mediaKey;
        const box = view?.words.querySelector('.r-summary');
        if (!view || !mediaKey || !box) { return; }
        const button = /** @type {HTMLButtonElement} */ (box.querySelector('button'));
        const state = /** @type {HTMLElement} */ (box.querySelector('[role=status]'));
        const generation = this._generation;
        button.disabled = true;
        state.textContent = '正在写入…';
        try {
            const result = /** @type {{path: string, words: number, cards: number, openUrl: string}} */ (await this._call('libraryVideoSummary', {mediaKey, title: document.title.slice(0, 300)}));
            if (generation !== this._generation) { return; }
            const open = document.createElement('a');
            open.href = result.openUrl;
            open.textContent = '在 Obsidian 打开';
            state.replaceChildren(`已写入 ${result.words} 个词、${result.cards} 张卡的小结 · `, open);
        } catch (error) {
            if (generation === this._generation) { state.textContent = `没有写入：${error instanceof Error ? error.message : String(error)}`; }
        } finally {
            button.disabled = false;
        }
    }

    /**
     * Keeps translations ready ahead of the playback position while the learner has
     * automatic translation on; pauses in background tabs and after failures.
     * @param {number} playbackMs
     */
    _autoTranslate(playbackMs) {
        const session = this._session;
        if (!session || !this._prefs.autoTranslate || this._translating || document.hidden || Date.now() < this._autoBackoff) { return; }
        const until = playbackMs + this._prefs.aheadSeconds * 1000;
        const needed = session.cues.some((cue) => cue.endMs + session.offsetMs >= playbackMs && cue.startMs + session.offsetMs <= until && !session.translation(cue.id));
        if (needed) { void this._translate(false); }
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
 * @param {string} name
 * @param {string} text
 * @param {string} type
 */
function saveText(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], {type: `${type};charset=utf-8`}));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Starts the reader once per top-level YouTube page.
 * @returns {YoutubeReader}
 */
export function startYoutubeReader() {
    const reader = new YoutubeReader();
    new YoutubeOverlay(reader).start();
    reader.start();
    return reader;
}

/**
 * Starts the same reader on any other page; it stays idle until a video appears.
 * @returns {YoutubeReader}
 */
export function startWebReader() {
    const site = new WebVideoSite();
    const reader = new YoutubeReader({site});
    new YoutubeOverlay(reader, site).start();
    reader.start();
    return reader;
}
