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
 * Read-only YouTube caption list beside the video. Captions load automatically when the video is ready.
 * Captions are ordinary page text here: the existing Yomitan scanner opens the word card,
 * and nothing pretends to be the protected ASB cue (no data-asb-study-cue).
 * Explicit translation uses the existing Native path; row metadata feeds the original word card.
 */
import {SETTINGS_KEY, studyConfig, WORD_STATUS_KEY} from './study-data.js';
import {SubtitleSession, cuesFromTimedText, groupForReading, groupsFromIds, timeLabel} from './subtitle-session.js';
import {ENGINE_LABELS, chromeTranslate} from './free-translators.js';
import {DEFAULT_SUBTITLE_PREFS, normalizeSubtitlePrefs, onSubtitlePrefsChanged, readSubtitlePrefs, readVideoState, writeSubtitlePrefs, writeVideoState} from './subtitle-prefs.js';
import {TranslationQueue} from './translation-queue.js';
import {studyCall} from './study-client.js';
import {wordForms} from './word-marks.js';
import {YoutubeOverlay, translationEngineSelect, shadowContinueSelect, syncControls} from './youtube-overlay.js';
import {CaptionList, learningCaptions, ROOT_ID, SIDEBAR_STYLE as STYLE} from './caption-sidebar.js';
import {youtubeStudyContext} from './youtube-study-context.js';
import {confirmTranslation} from './translation-confirm.js';
import {enhanceStudyUi} from './study-ui.js';
import {captionUrl, captionTrackId, youtubeVideoId} from './vendor/kiss/youtube-caption-source.js';
import {pageSourceKey, timedUrl} from './media-key.js';
import {guessLanguage, parseSubtitles, splitBilingual} from './subtitle-formats.js';
import {WebVideoSite} from './web-video-site.js';
import {youtubeSite} from './youtube-site.js';

const STYLE_ID = 'study-yt-reader-style';
const TOKENS_ID = 'study-yt-reader-tokens';
const WAIT_MS = 10000;


/**
 * @typedef {{root: HTMLElement, status: HTMLElement, progress: HTMLElement, load: HTMLButtonElement, follow: HTMLButtonElement, resume: HTMLButtonElement, list: HTMLElement, translate: HTMLButtonElement, cancel: HTMLButtonElement, retry: HTMLButtonElement, more: HTMLButtonElement, menu: HTMLElement, words: HTMLElement, search: HTMLInputElement, searchBar: HTMLElement, searchCount: HTMLElement}} ReaderView
 */

/**
 * @typedef {import('./youtube-study-context.js').Row} RowInfo
 */

/** @typedef {import('study').SavedVideoListening} SavedPlayback */
/** @typedef {import('./youtube-site.js').YoutubeSite|WebVideoSite} ReaderSite */

const SUBTITLE_ACCEPT = '.srt,.vtt,.webvtt,.sbv,.ass,.ssa,.ttml,.dfxp,.xml,.json,.txt';
const FILE_LIMIT = 4_000_000;

/**
 * @param {URL} url
 * @returns {string}
 */
function captionCaptureKey(url) {
    return JSON.stringify(['lang', 'kind', 'name', 'tlang'].map((part) => url.searchParams.get(part) || ''));
}

/**
 * @param {number} second
 * @param {string} sentence
 * @returns {string}
 */
function savedCueKey(second, sentence) {
    return `${Math.floor(second)}:${sentence.replaceAll(/\s+/g, ' ').trim().toLowerCase()}`;
}

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
        /** @type {string} Saved-note grouping for the active page, independent of playback progress. */
        this._sourceKey = '';
        /** @type {(() => void)|null} */
        this._removeModelSettingsListener = null;
        /** @type {{id: string, label: string}[]} Subtitle sources found on other sites. */
        this._sources = [];
        /** @type {Map<string, string>} Translations that came inside a bilingual file. */
        this._fileTranslations = new Map();
        /** @type {Map<string, string>} Finished rows of the loaded track, across display regrouping only. */
        this._regroupedTranslations = new Map();
        /** @type {number} Caption shift for this video, kept across regrouping and reloads. */
        this._offsetMs = 0;
        /** @type {{id: string, startMs: number, endMs: number, plays: number}|null} Sentence being shadowed. */
        this._shadowRow = null;
        /** @type {string} The sentence we just paused after, so playing on does not pause again. */
        this._shadowDone = '';
        /** @type {{id: string, plays: number, position: number, video: HTMLVideoElement}|null} */
        this._shadowPause = null;
        /** @type {(()=>void)|null} */
        this._restoreReplay = null;
        /** @type {{panel: HTMLElement, listHidden: boolean, wordsHidden: boolean, cancel?: () => void}|null} */
        this._listen = null;
        /** @type {SavedPlayback[]|null} */
        this._libraryListening = null;
        /** @type {number} */
        this._shadowTimer = 0;
        /** @type {number} */
        this._savedAt = 0;
        /** @type {number} Resume point offered for this video, or -1. */
        this._resumeMs = -1;
        /** @type {boolean} Keep initial rendering from replacing the saved resume position. */
        this._restoringVideoState = false;
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
        /** @type {Map<string, import('./subtitle-session.js').SubtitleSearchRange>} */
        this._searchRanges = new Map();
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
        /** @type {{id: string, engine: import('./subtitle-prefs.js').SubtitleEngine, controller: AbortController, batch: Set<string>, waiting: Map<string, ((value: string) => void)[]>}|null} */
        this._translation = null;
        /** @type {string} Model consent for this video and selected model. */
        this._fullConsent = '';
        /** @type {Set<string>} */
        this._failed = new Set();
        /** @type {TranslationQueue} */
        this._queue = new TranslationQueue(async ({items, config, signal}) => {
            const run = this._translation;
            if (!run || signal.aborted) { throw new Error('已取消'); }
            const requestId = run.id;
            run.batch = new Set(items.map((item) => item.id));
            const cancel = () => { void this._call('subtitleCancel', {requestId}).catch(() => {}); };
            signal.addEventListener('abort', cancel, {once: true});
            try {
                // Chrome's on-device translator only exists in pages, so it runs here.
                if (run.engine === 'chrome') {
                    const source = (this._session?.source.language || 'en').split('-')[0];
                    const rows = await chromeTranslate(items.map((item) => item.text), {source, signal});
                    return items.map((item, index) => ({id: item.id, translation: rows[index]}));
                }
                const result = /** @type {{items: {id: string, translation: string}[]}} */ (await this._call('subtitleTranslate', {requestId,
                    items,
                    config,
                    expectedEngine: run.engine,
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
        /** @type {CaptionList<import('./subtitle-session.js').SubtitleCue>} */
        this._list = new CaptionList((cue, index) => this._makeRow(cue, index), (id, row) => this._paintRow(id, row));
        /** @type {Map<string, HTMLElement>} Rows built so far (long tracks build them as needed). */
        this._rows = this._list.rows;
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
        /** @type {Map<string, {url: URL, body: string}>} */
        this._capturedCaptions = new Map();
        /** @type {string|null} */
        this._captionVideoId = null;
        /** @type {() => void} */
        this._timeListener = () => this._onTime();
        /** @type {{id: string, cancel: (pause?: boolean) => void}|null} */
        this._loop = null;
        /** @type {string} */
        this._lookup = '';
        /** @type {Record<string, unknown>} */
        this._learningWords = {};
        /** @type {Set<string>} */
        this._recommended = new Set();
        /** @type {{word: string, sentence: string}[]} */
        this._cardContexts = [];
        /** @type {{word: string, gloss: string, term: string, cueId: string}[]} */
        this._recommendationItems = [];
    }

    /** */
    start() {
        if (this._site.kind === 'youtube') {
            window.addEventListener('message', (/** @type {MessageEvent<{type?: string, url?: string, body?: string}|null>} */ event) => {
                const data = event.data;
                if (event.source !== window || event.origin !== location.origin || data?.type !== 'yomitan-caption-response' || typeof data.url !== 'string' || typeof data.body !== 'string') { return; }
                const url = captionUrl(data.url, youtubeVideoId(location.href));
                if (url && data.body.trim()) {
                    const videoId = url.searchParams.get('v');
                    if (this._captionVideoId !== videoId) {
                        this._capturedCaptions.clear(); this._captionVideoId = videoId;
                    }
                    const key = captionCaptureKey(url);
                    this._capturedCaptions.delete(key);
                    this._capturedCaptions.set(key, {url, body: data.body});
                    if (this._capturedCaptions.size > 10) { this._capturedCaptions.delete(this._capturedCaptions.keys().next().value); }
                    this.rememberRequest(url.href);
                }
            });
            window.postMessage({type: 'yomitan-caption-response', ready: true}, location.origin);
        }
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) { this.rememberRequest(entry.name); }
            });
            observer.observe({type: 'resource', buffered: true});
        } catch { /* Without resource timing the user still gets an explicit failure message. */ }
        this._site.watch(() => this._sync());
        // A player can hand playback to another <video> without changing the media key.
        window.setInterval(() => this._rebindVideo(), 1500);
        window.addEventListener('resize', () => this._place());
        if (!this._fixedPrefs) {
            void readSubtitlePrefs().then((prefs) => this.setPrefs(prefs));
            onSubtitlePrefsChanged((prefs) => this.setPrefs(prefs));
        }
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            void chrome.storage.local.get(WORD_STATUS_KEY).then((stored) => {
                this._learningWords = /** @type {{words?: Record<string, unknown>}|undefined} */ (stored[WORD_STATUS_KEY])?.words ?? {};
                this._refreshLearning();
            });
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local' || !changes[WORD_STATUS_KEY]) { return; }
                this._learningWords = /** @type {{words?: Record<string, unknown>}|undefined} */ (changes[WORD_STATUS_KEY].newValue)?.words ?? {};
                this._refreshLearning();
            });
            chrome.runtime?.onMessage?.addListener((message, sender) => {
                const view = this._view;
                if (sender.id === chrome.runtime.id && message?.studyVideoNotesChanged === true && view && !view.root.hidden && !view.words.hidden) {
                    void this._loadWords();
                }
                return false;
            });
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
        if (previous.engine !== prefs.engine && this._translation) {
            this._status('已切换翻译服务；原文和已完成译文保留。');
            this._finishTranslation(true);
        }
        this._prefs = normalizeSubtitlePrefs(prefs);
        if (previous.shortcuts && !this._prefs.shortcuts) { this._restoreReplay?.(); }
        if (previous.enabled !== this._prefs.enabled) { this._sync(); }
        this._view?.root.classList.toggle('r-blur', this._prefs.blur);
        this._view?.root.classList.toggle('r-mono', !this._prefs.bilingual);
        if ((previous.merge !== this._prefs.merge || previous.aiSegment !== this._prefs.aiSegment) && this._rawSession && this._view) {
            this._present(this._rawSession, true);
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
     * Renders the reading rows, preserving translations only for unchanged rows of this loaded track.
     * @param {SubtitleSession} raw
     * @param {boolean} [regroup]
     */
    _present(raw, regroup = false) {
        const saved = this._regroupedTranslations;
        if (!regroup) { saved.clear(); }
        const key = (/** @type {import('./subtitle-session.js').SubtitleCue} */ cue) => JSON.stringify([this._members.get(cue.id), cue.startMs, cue.endMs, cue.text]);
        const previous = regroup ? this._session : null;
        if (previous) {
            for (const cue of previous.cues) {
                const text = previous.translation(cue.id);
                if (!text) { continue; }
                const rowKey = key(cue);
                saved.delete(rowKey);
                saved.set(rowKey, text);
            }
            // Bound per-track memory even if AI proposes new groupings repeatedly.
            for (const rowKey of saved.keys()) {
                if (saved.size <= raw.cues.length * 3) { break; }
                saved.delete(rowKey);
            }
        }
        const session = this._readingSession(raw);
        for (const target of new Set([raw, session])) {
            try { target.setOffset(this._offsetMs); } catch { /* keep the previous shift */ }
        }
        if (saved.size > 0 || this._fileTranslations.size > 0) {
            for (const cue of session.cues) {
                const text = saved.get(key(cue)) || this.members(cue.id).map((id) => this._fileTranslations.get(id) ?? '').filter(Boolean)
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
        const row = this._ensureCaptionRow(id);
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
     * Shifts the captions against the video (positive = later).
     * @param {number} ms
     * @param {boolean} [remember] A restored shift isn't a new learner edit.
     */
    setOffset(ms, remember = true) {
        this._endListening();
        this._restoreReplay?.();
        for (const button of this._view?.list.querySelectorAll('button[data-cue-notes][aria-expanded="true"]') ?? []) { /** @type {HTMLButtonElement} */ (button).click(); }
        const value = Math.max(-600000, Math.min(600000, Math.round(ms / 50) * 50));
        if (value !== this._offsetMs) {
            this._stopLoop('');
            this._shadowPause = null;
        }
        this._offsetMs = value;
        for (const target of new Set([this._rawSession, this._session])) {
            try { target?.setOffset(value); } catch { /* bounds are checked above */ }
        }
        this._shadowRow = null;
        this._active = '';
        this._onTime();
        this._syncMenu();
        this._emit('offset', {ms: value});
        if (remember && this._mediaKey && this._rawSession) { void writeVideoState(this._rawSession.source, {offsetMs: value, trackKey: this._rawSession.source.trackKey}); }
        this._tryLibraryListening();
    }

    /** Jumps to the offered resume point. */
    resume() {
        if (this._resumeMs < 0 || !this._video || this._sourceKey !== pageSourceKey(this._site.pageUrl())) { return; }
        this._endListening();
        this._stopLoop('');
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
        const state = await readVideoState(raw.source);
        if (this._rawSession !== raw || this._sourceKey !== pageSourceKey(this._site.pageUrl())) { return; }
        if (!state) {
            this._restoringVideoState = false;
            this._tryLibraryListening();
            return;
        }
        if (typeof state.offsetMs === 'number' && state.trackKey === raw.source.trackKey) { this.setOffset(state.offsetMs, false); }
        const at = state.resumeMs;
        const now = (this._video?.currentTime ?? 0) * 1000;
        if (this._prefs.resume && typeof at === 'number' && at > 30000 && Math.abs(at - now) > 15000 && this._view) {
            this._resumeMs = at;
            this._view.resume.textContent = `从 ${timeLabel(at)} 继续`;
            this._view.resume.hidden = false;
            this._emit('resume', {ms: at});
        }
        this._restoringVideoState = false;
        this._tryLibraryListening();
    }

    /** Starts or stops the shadowing check with the preference. */
    _armShadow() {
        if (this._prefs.shadow && this._session && !this._shadowTimer) {
            this._shadowTimer = window.setInterval(() => this._shadowTick(), 60);
        } else if ((!this._prefs.shadow || !this._session) && this._shadowTimer) {
            clearInterval(this._shadowTimer);
            this._shadowTimer = 0;
            this._shadowRow = null;
            this._shadowPause = null;
        }
    }

    /**
     * Shadowing: each sentence plays the chosen number of times, then the video pauses
     * so the learner can say it. Playing on continues; a loop takes precedence.
     */
    _shadowTick() {
        const session = this._session;
        const video = this._video;
        if (!session || !video || video.paused || video.seeking || this._loop || this._restoreReplay || this._listen || !this._prefs.shadow) { return; }
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
        const id = row.id;
        const plays = (this._shadowPause?.id === id ? this._shadowPause.plays : 0) + row.plays;
        this._shadowPause = {id, plays, position: video.currentTime, video};
        this._status('已暂停跟读，按空格继续，或按 R 再听一遍。', 'shadow');
        this._emit('shadow', {id, plays});
    }

    /** @returns {string} Empty when the old pause no longer owns this playback position. */
    get shadowPausedId() {
        const pause = this._shadowPause;
        const video = this._video;
        if (!this._prefs.shadow || !video?.paused || video.seeking || pause?.video !== video) { return ''; }
        return video.currentTime === pause.position && this._site.video() === video ? pause.id : '';
    }

    /** */
    clearShadowStatus() {
        if (this._view?.status.dataset.mode === 'shadow') { this._status(''); }
    }

    /**
     * Remembers normal playback, at most every few seconds.
     * @param {number} playbackMs
     */
    _saveProgress(playbackMs) {
        const source = this._rawSession?.source;
        const video = this._video;
        if (!source || this._restoringVideoState || !video || video.paused || Date.now() - this._savedAt < 5000) { return; }
        if (youtubeStudyContext.isTemporaryPlayback(video)) { return; }
        this._savedAt = Date.now();
        void writeVideoState(source, {resumeMs: Math.max(0, Math.round(playbackMs))});
        if (this._resumeMs >= 0 && Math.abs(playbackMs - this._resumeMs) < 15000) { this._clearResume(); }
    }

    /** Starts the explicit caption load, as the sidebar button does. */
    loadCaptions() { void this._load(this._generation); }

    /** Translates the next rows from the playback position, as the sidebar button does. */
    translateNext() { void this._translate(false, true); }

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
        if (root && window.self !== window.top) {
            root.hidden = innerWidth < 600;
            if (innerWidth < 600) { this._site.toggleDock(false); }
        }
        const host = root && this._site.pinFirst() ? this._host() : null;
        if (root && host && root.parentElement !== host) {
            enhanceStudyUi(root);
        host.prepend(root);
            this._keepFirst(host);
        }
    }

    /** Continue after the learner has repeated the sentence. */
    continueShadow() {
        void this._video?.play()?.catch(() => {
            this._restoreReplay?.();
            this._status('播放没有开始，请点播放器的播放按钮。');
        });
    }

    /**
     * A/S/D operate only on the loaded track, preserving the user's playback rate.
     * @param {string} key
     * @param {boolean} slow
     * @returns {boolean}
     */
    captionShortcut(key, slow) {
        const session = this._session;
        const video = this._video;
        if (!session || !video || session.cues.length === 0) { return false; }
        this._restoreReplay?.();
        const shadow = this.shadowPausedId;
        const paused = shadow ? session.cues.findIndex((c) => c.id === shadow) : -1;
        let current = paused;
        if (current < 0) {
            current = 0;
            for (let i = 0; i < session.cues.length; ++i) {
                if (session.cues[i].startMs + session.offsetMs <= video.currentTime * 1000) {
                    current = i;
                } else {
                    break;
                }
            }
        }
        const index = Math.max(0, Math.min(session.cues.length - 1, current + (key === 'a' ? -1 : (key === 'd' ? 1 : 0))));
        const cue = session.cues[index];
        if (key === 's') {
            this._playCaptionRange(session, cue.id, cue.id, {slow});
        } else {
            this._resetCuePlayback();
            if (this._seek(cue.id)) { this.continueShadow(); }
        }
        return true;
    }

    /** */
    _resetCuePlayback() {
        this._stopLoop('');
        this._shadowRow = null;
        this._shadowDone = '';
        this._shadowPause = null;
    }

    /**
     * @param {SubtitleSession} session
     * @param {string} firstId
     * @param {string} lastId
     * @param {{slow?: boolean, follow?: boolean}} [options]
     */
    _playCaptionRange(session, firstId, lastId, {slow = false, follow = true} = {}) {
        const video = this._video;
        if (!video || this._session !== session) { return; }
        this._restoreReplay?.();
        this._resetCuePlayback();
        this._endListening();
        try {
            const start = session.seekSeconds(firstId);
            const end = (session.cue(lastId).endMs + session.offsetMs) / 1000;
            const info = this._rowInfo.get(firstId);
            const isCurrent = () => this._video === video && info?.isCurrent() === true;
            const cancel = youtubeStudyContext.playRange(video, {start, end, isCurrent, rate: slow ? 0.75 : void 0}, (reason) => {
                this._restoreReplay = null;
                if (reason === 'failed') { this._status('播放没有开始，请点播放器的播放按钮。'); }
            });
            this._restoreReplay = () => cancel(false);
            if (follow) { this._resumeFollow(); }
        } catch (error) {
            this._status(error instanceof Error ? error.message : String(error));
        }
    }

    /** Replay the paused sentence; the next pause counts this listen too. */
    replayShadow() {
        const id = this.shadowPausedId;
        if (!id || !this._session || !this._video) { return; }
        this._video.currentTime = this._session.seekSeconds(id);
        this._shadowDone = ''; this._shadowRow = null;
        this.continueShadow();
    }

    /**
     * @param {string} id
     * @returns {Promise<string>}
     */
    async showSentenceTranslation(id) {
        if (!this._session?.translation(id)) { await this._translate(false, false, id); }
        return this._session?.translation(id) || '这句还没翻译出来，请再点一次「看译文」。';
    }

    /**
     * Open the existing lookup with this exact caption as its context.
     * @param {string} id
     * @param {string} [word]
     * @param {boolean|'audio'} [openPanel]
     * @param {string} [recordId]
     * @returns {Promise<boolean|undefined>}
     */
    async lookupCaption(id, word = '', openPanel = false, recordId = '') {
        const text = this._ensureCaptionRow(id)?.querySelector('.r-text');
        const info = this._rowInfo.get(id);
        if (!/^en(?:-|$)/i.test(this._session?.source.language || '')) { return false; }
        if (!text?.firstChild || !info || !youtubeStudyContext.openCard) {
            this._status('词卡还没准备好，请刷新页面后再试。');
            return;
        }
        const range = document.createRange();
        const match = word ? [...info.text.matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)].find((m) => (recordId ? m[0].toLowerCase() === word.toLowerCase() : wordForms(m[0]).includes(word.toLowerCase()))) : null;
        if (word && !match) { return false; }
        if (openPanel === 'audio') {
            /** @type {HTMLButtonElement|null|undefined} */ (this._view?.root.querySelector('[data-tab="captions"]'))?.click();
            this.revealRow(id);
        }
        range.setStart(text.firstChild, match?.index ?? 0); range.setEnd(text.firstChild, match ? match.index + match[0].length : info.text.length);
        await youtubeStudyContext.openCard(range, openPanel, recordId); return true;
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
        if (this._view && !this._session && !this._loadController) { void this._load(this._generation); }
    }

    /** */
    _sync() {
        const key = this._prefs.enabled ? this._site.mediaKey() : null;
        const source = key ? pageSourceKey(this._site.pageUrl()) : '';
        if (key === this._mediaKey && source === this._sourceKey && (key === null || this._view?.root.isConnected)) {
            this._rebindVideo();
            return;
        }
        this._reset();
        this._mediaKey = key;
        this._sourceKey = source;
        this._videoId = key?.startsWith('youtube:') ? key.slice(8) : null;
        if (this._captionVideoId !== this._videoId) {
            this._capturedCaptions.clear(); this._captionVideoId = this._videoId;
        }
        if (key !== null) { void this._mount(++this._generation); }
    }

    /** Players that rebuild their <video> keep the same captions; follow the new element. */
    _rebindVideo() {
        if (!this._session) { return; }
        const video = this._site.video();
        if (!video || video === this._video) { return; }
        this._endListening();
        this._stopLoop('');
        this._restoreReplay?.();
        this._video?.removeEventListener('timeupdate', this._timeListener);
        this._shadowRow = this._shadowPause = null;
        this._shadowDone = '';
        this._video = video;
        video.addEventListener('timeupdate', this._timeListener);
        this._tryLibraryListening();
    }

    /** */
    _reset() {
        this._endListening();
        this._libraryListening = null;
        this._restoreReplay?.();
        this._stopLoop('');
        ++this._generation;
        this._loadController?.abort();
        this._loadController = null;
        this._finishTranslation(true);
        this._failed.clear();
        youtubeStudyContext.reset();
        this._video?.removeEventListener('timeupdate', this._timeListener);
        this._video = null;
        this._lookup = '';
        this._session = null;
        this._searchRanges.clear();
        this._cardContexts = []; this._recommendationItems = [];
        this._rawSession = null;
        this._restoringVideoState = false;
        this._aiGroups = null;
        this._fileTranslations = new Map();
        this._regroupedTranslations.clear();
        this._sources = [];
        this._offsetMs = 0;
        this._resumeMs = -1;
        this._savedAt = 0;
        this._shadowRow = null;
        this._shadowDone = ''; this._shadowPause = null;
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
        this._removeModelSettingsListener?.();
        this._removeModelSettingsListener = null;
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
        root.dataset.studyUi = '';
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
        status.textContent = '正在查找字幕…';
        const follow = this._button('跟随播放', () => {
            this._clearCaptionSearch();
            this._resumeFollow();
        });
        follow.setAttribute('aria-pressed', 'true');
        const resume = this._button('继续', () => this.resume());
        resume.hidden = true;
        resume.title = '回到上次学到的句子';
        const load = this._button('重新载入', () => { void this._load(generation); });
        const translate = this._button('翻译全文', () => { void this._translate(false, true); });
        translate.title = '先翻当前位置后面的句子，再翻前面的；可随时取消';
        const progress = document.createElement('small'); progress.className = 'r-progress';
        progress.setAttribute('role', 'status');
        translate.classList.add('r-translate'); translate.hidden = true;
        const retry = this._button('重试失败', () => { void this._translate(true); });
        retry.hidden = true;
        const cancel = this._button('取消', () => {
            this._status('已取消；原文和已完成译文保留。');
            this._finishTranslation(true);
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
        /**
         * @param {string} groupTitle
         * @returns {HTMLFieldSetElement}
         */
        const group = (groupTitle) => {
            const field = document.createElement('fieldset'); field.className = 'r-menu-group';
            const legend = document.createElement('legend');
            legend.textContent = groupTitle;
            field.append(legend);
            return field;
        };
        const translation = group('翻译'); translation.append(translationEngineSelect((engine) => this.updatePrefs({engine}), this._prefs.engine));
        const modelRows = document.createElement('div'); modelRows.dataset.modelRows = ''; translation.append(modelRows);
        const model = document.createElement('select'); model.dataset.model = ''; model.dataset.label = '模型';
        const effort = document.createElement('select'); effort.dataset.effort = ''; effort.dataset.label = '推理强度';
        const modelStatus = document.createElement('small'); modelStatus.setAttribute('role','status');
        modelRows.append(model, effort, modelStatus);
        let catalog = [];
        const fillModel = async () => {
            const config = studyConfig((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
            model.replaceChildren(...(catalog.length ? catalog : [{model:config.model,displayName:config.model}]).map((m) => Object.assign(document.createElement('option'),{value:m.model,textContent:m.displayName})));
            if (![...model.options].some((o) => o.value === config.model)) { model.append(Object.assign(document.createElement('option'),{value:config.model,textContent:config.model})); }
            model.value = config.model;
            const found = catalog.find((m) => m.model === config.model);
            effort.replaceChildren(...(found?.efforts || [config.effort]).map((value) => Object.assign(document.createElement('option'),{value,textContent:({none:'关闭',minimal:'最小',low:'低 · 更快',medium:'中',high:'高',xhigh:'很高',max:'最高',ultra:'极高'})[value] || value})));
            effort.value = config.effort;
            model.dispatchEvent(new Event('study-ui-sync'));
            effort.dispatchEvent(new Event('study-ui-sync'));
        };
        const saveModel = async (patch) => {
            const config = studyConfig((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
            await chrome.storage.local.set({[SETTINGS_KEY]:{...config,...patch}}); await fillModel(); modelStatus.textContent = '已保存';
        };
        model.addEventListener('change', () => { const found = catalog.find((m) => m.model === model.value); void saveModel({model:model.value,effort:found?.defaultEffort || 'low'}); });
        effort.addEventListener('change', () => { void saveModel({effort:effort.value}); });
        let loadingModels = false;
        translation.addEventListener('click', () => {
            if (this._prefs.engine !== 'model' || catalog.length || loadingModels) { return; }
            loadingModels = true; modelStatus.textContent = '正在读取模型列表…';
            void studyCall('subtitleModels').then((rows) => { catalog = rows; modelStatus.textContent = ''; return fillModel(); }, () => { modelStatus.textContent = '没读到模型列表，请在设置里授权本机连接后再点一次。'; }).finally(() => { loadingModels = false; });
        });
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            void fillModel();
            /**
             * @param {Record<string, chrome.storage.StorageChange>} changes
             * @param {string} area
             */
            const updateModel = (changes, area) => {
                if (area === 'local' && changes[SETTINGS_KEY] && root.isConnected) { void fillModel(); }
            };
            chrome.storage.onChanged?.addListener(updateModel);
            this._removeModelSettingsListener = () => chrome.storage.onChanged?.removeListener(updateModel);
        }
        const processing = group('字幕处理');
        const source = document.createElement('label');
        source.className = 'r-source';
        source.hidden = true;
        source.append('字幕来源');
        const sourceSelect = document.createElement('select'); sourceSelect.dataset.source = ''; sourceSelect.dataset.label = '字幕语言';
        sourceSelect.addEventListener('change', () => {
            void this._load(generation, sourceSelect.value);
        });
        source.append(sourceSelect);
        head.append(source);
        for (const [key, label] of [['merge', '合并成整句'], ['aiSegment', 'AI 断句（用模型）'], ['resume', '记住观看进度']]) {
            const toggle = document.createElement('label'); toggle.className = 'r-switch';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.dataset.pref = key;
            box.addEventListener('change', () => this.updatePrefs({[key]: box.checked}));
            toggle.append(box, label); processing.append(toggle);
        }
        processing.append(shadowContinueSelect((shadowContinueSeconds) => this.updatePrefs({shadowContinueSeconds})));
        const files = group('文件');
        const importButton = this._button('导入字幕文件…', () => this.pickFile());
        importButton.title = '只读取你选的字幕文件，不上传';
        const downloads = document.createElement('details'); downloads.className = 'r-downloads';
        const downloadLabel = document.createElement('summary');
        downloadLabel.textContent = '下载 ▾';
        downloads.append(downloadLabel);
        for (const [kind, label] of /** @type {['vtt'|'bilingual'|'json', string][]} */ ([['vtt', '原文 VTT'], ['bilingual', '双语 VTT'], ['json', 'JSON']])) {
            const button = this._button(label, () => {
                this.download(kind);
                downloads.open = false;
            });
            button.dataset.download = kind; downloads.append(button);
        }
        files.append(load, importButton, downloads); menu.append(translation, processing, files);
        const shortcutHint = document.createElement('small');
        shortcutHint.dataset.shortcutHint = '';
        menu.append(shortcutHint);
        const difficulty = document.createElement('small');
        difficulty.className = 'r-difficulty';
        head.append(title, difficulty, resume);
        const toolbar = document.createElement('div'); toolbar.className = 'r-toolbar';
        toolbar.append(translate, progress, cancel, follow, more);
        const list = document.createElement('div');
        list.className = 'r-list';
        list.setAttribute('role', 'list');
        const searchBar = document.createElement('div');
        searchBar.className = 'r-search scan-disable';
        searchBar.hidden = true;
        const search = Object.assign(document.createElement('input'), {type: 'search', placeholder: '找字幕（原文／已译中文）', autocomplete: 'off'});
        search.setAttribute('aria-label', '找字幕');
        search.addEventListener('input', () => this._renderCaptionRows(true));
        const searchCount = document.createElement('small');
        searchCount.setAttribute('aria-live', 'polite');
        searchBar.append(search, searchCount);
        const pause = () => {
            if (!search.value.trim()) { this._pauseFollow(); }
        };
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
        for (const [name, label] of [['captions', '字幕'], ['words', '我在这个视频记的词']]) {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'r-tab';
            tab.setAttribute('role', 'tab');
            tab.dataset.tab = name;
            tab.setAttribute('aria-selected', String(name === 'captions'));
            tab.textContent = label;
            tab.addEventListener('click', () => {
                this._endListening();
                for (const other of tabButtons) { other.setAttribute('aria-selected', String(other === tab)); }
                list.hidden = name !== 'captions';
                searchBar.hidden = list.hidden || !this._session;
                words.hidden = name !== 'words';
                if (name === 'words') { void this._loadWords(); }
            });
            tabButtons.push(tab);
            tabs.append(tab);
        }
        root.append(head, toolbar, status, menu, tabs, searchBar, list, words);
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
        enhanceStudyUi(root);
        host.prepend(root);
        this._view = {root, status, progress, load, follow, resume, list, translate, cancel, retry, more, menu, words, search, searchBar, searchCount};
        this._place();
        if (this._site.pinFirst()) { this._keepFirst(host); }
        this._syncMenu();
        void this._claimLibraryListening(generation);
        void this._load(generation);
    }

    /** @param {number} generation */
    async _claimLibraryListening(generation) {
        if (window !== window.top || !/^https?:$/.test(location.protocol)) { return; }
        const items = /** @type {SavedPlayback[]|null} */ (await this._call('claimVideoListening').catch(() => null));
        if (!items?.length || generation !== this._generation) { return; }
        this._libraryListening = items;
        this._site.toggleDock(true);
        this._tryLibraryListening();
    }

    /** */
    _tryLibraryListening() {
        if (this._libraryListening && this._session && this._video && !this._restoringVideoState && !this._listen) {
            this._beginListening(this._libraryListening, true);
        }
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
        const shortcutHint = view.menu.querySelector('[data-shortcut-hint]');
        if (shortcutHint) { shortcutHint.textContent = this._prefs.shortcuts ? 'A 上一句 · S 重听 · D 下一句 · Shift+S 慢速重听' : '字幕快捷键已关闭，可在设置里开启'; }
        for (const box of view.menu.querySelectorAll('input[data-pref]')) {
            const key = /** @type {keyof import('./subtitle-prefs.js').SubtitlePrefs} */ (/** @type {HTMLInputElement} */ (box).dataset.pref);
            /** @type {HTMLInputElement} */ (box).checked = Boolean(this._prefs[key]);
        }
        for (const select of view.menu.querySelectorAll('select[data-engine]')) { /** @type {HTMLSelectElement} */ (select).value = this._prefs.engine; }
        syncControls(view.menu, this);
        view.menu.querySelector('[data-model-rows]').hidden = this._prefs.engine !== 'model';
        for (const button of view.menu.querySelectorAll('button[data-download]')) {
            /** @type {HTMLButtonElement} */ (button).disabled = !this._session;
        }
        const select = /** @type {HTMLSelectElement|null} */ (view.root.querySelector('select[data-source]'));
        if (select) {
            const label = /** @type {HTMLElement} */ (select.parentElement);
            (select.closest('.r-source') || label).hidden = this._sources.length < 2;
            select.replaceChildren(...this._sources.map(({id, label: text}) => Object.assign(document.createElement('option'), {value: id, textContent: text})));
            select.value = this._session?.source.trackKey ?? ''; select.dispatchEvent(new Event('study-ui-sync'));
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
            const {cues, format, translations, language = '', offsetMs} = parseSubtitles(text, name);
            this._loadController?.abort();
            this._loadController = null;
            this._view.load.disabled = false;
            delete this._view.root.dataset.captionSource;
            delete this._view.root.dataset.captionTrack;
            this._useCues(cues, {trackKey: `file:${name.slice(0, 100)}`, label: `${name.slice(0, 60)}（本地文件 · ${format.toUpperCase()}）`, language, acquisition: 'import', translations, offsetMs});
        } catch (error) {
            this._status(`导入失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * @param {import('./subtitle-session.js').SubtitleCue[]} input
     * @param {{trackKey: string, label: string, language: string, acquisition: 'provider'|'import', translations?: Map<string,string>, offsetMs?: number}} meta
     */
    _useCues(input, meta) {
        const key = this._mediaKey;
        if (!key) { return; }
        const bilingual = meta.translations ? null : splitBilingual(input, meta.acquisition === 'import');
        const cues = bilingual?.cues ?? input;
        // A session always needs a language; "und" is the standard code for an unknown one.
        const language = meta.language || guessLanguage(cues) || 'und';
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
        this._restoringVideoState = true;
        this._aiGroups = null;
        /** @type {Map<string, string>} */
        const translations = meta.translations ?? bilingual?.translations ?? new Map();
        this._fileTranslations = translations;
        this._offsetMs = meta.offsetMs ?? 0;
        this._present(session);
        void this._restoreVideoState(session);
        if (translations.size > 0) { this._status(`${meta.label} · ${cues.length} 句 · 已带中文译文`); }
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
        const previous = this._rawSession;
        const controller = new AbortController();
        this._loadController = controller;
        const current = () => generation === this._generation && this._loadController === controller;
        /** @type {ReturnType<typeof setTimeout>|null} */
        let timeout = null;
        let timedOut = false;
        view.load.disabled = true;
        try {
            const tracks = await this._call('youtubeCaptionTracks').catch(() => []);
            if (!current()) { return; }
            const available = /** @type {{baseUrl: string, languageCode: string, vssId?: string, kind?: string, name?: {simpleText?: string, runs?: {text: string}[]}}[]} */ ((Array.isArray(tracks) ? tracks : []).filter((track) => captionUrl(track.baseUrl, videoId)));
            available.sort((a,b) => Number(a.kind === 'asr') - Number(b.kind === 'asr'));
            this._sources = available.map((track) => ({id:captionTrackId(track),label:`${track.name?.simpleText || track.name?.runs?.map((r) => r.text).join('') || track.languageCode}${track.kind === 'asr' ? ' · 自动' : ''}`}));
            const source = {mediaKey: `youtube:${videoId}`, url: `https://www.youtube.com/watch?v=${videoId}`};
            const state = await readVideoState(source);
            if (!current()) { return; }
            const requested = sourceId || state?.selectedTrackKey;
            const selected = available.find((t) => captionTrackId(t) === requested);
            if (sourceId && !selected) {
                this._status('刚选的字幕已经找不到，请重新选择。');
                return;
            }
            /** @type {(typeof available)[number]|undefined} */
            let chosen = selected || available.find((t) => /^en(?:-|$)/i.test(t.languageCode)) || available[0];
            const captured = await this._findCaptionUrl(videoId, generation, controller.signal);
            if (!current()) { return; }
            let url = captured || (chosen ? captionUrl(chosen.baseUrl, videoId) : null);
            if (captured && selected) {
                // Keep the player's signed URL and proof token; change only the track identity.
                const trackUrl = new URL(selected.baseUrl, location.href);
                for (const key of ['lang', 'kind', 'name']) {
                    const value = trackUrl.searchParams.get(key);
                    if (value) {
                        captured.searchParams.set(key, value);
                    } else {
                        captured.searchParams.delete(key);
                    }
                }
            } else if (captured) {
                chosen = available.find((t) => {
                    const trackUrl = new URL(t.baseUrl, location.href);
                    return ['lang', 'kind', 'name'].every((key) => trackUrl.searchParams.get(key) === captured.searchParams.get(key));
                });
            }
            if (!url) {
                this._status('没有找到字幕，可导入字幕文件。');
                view.status.append(this._button('导入字幕', () => this.pickFile()));
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
            let capturedBody = this._capturedCaptions.get(captionCaptureKey(url));
            if (!capturedBody && !selected) {
                capturedBody = [...this._capturedCaptions.values()].find(({url: candidate}) => /^en/i.test(candidate.searchParams.get('lang') || '') && !candidate.searchParams.get('tlang'));
            }
            if (capturedBody) {
                url = capturedBody.url;
                chosen = available.find((entry) => {
                    const candidate = new URL(entry.baseUrl);
                    return ['lang', 'kind', 'name'].every((part) => candidate.searchParams.get(part) === url.searchParams.get(part));
                });
            }
            const response = capturedBody ? new Response(capturedBody.body) : await fetch(url.href, {credentials: 'include', signal: controller.signal});
            const text = response.ok ? await response.text() : '';
            if (!current()) { return; }
            if (!text.trim()) {
                this._status(`YouTube 没有返回字幕内容（HTTP ${response.status}）；请在播放器的字幕设置里选择英语，然后刷新页面。`);
                return;
            }
            const language = url.searchParams.get('lang') ?? '';
            const kind = url.searchParams.get('kind') ?? '';
            const session = new SubtitleSession({
                mediaKey: `youtube:${videoId}`,
                trackKey: chosen ? captionTrackId(chosen) : `${language}|${kind}`,
                revision: `${language}|${kind}|${url.searchParams.get('name') ?? ''}`,
                language: language || 'und',
                acquisition: 'provider',
                url: `https://www.youtube.com/watch?v=${videoId}`,
                trackName: chosen ? this._sources.find((s) => s.id === captionTrackId(chosen)).label : (kind === 'asr' ? `${language} 自动字幕` : language),
            }, cuesFromTimedText(text));
            if (chosen) {
                await writeVideoState(source, {selectedTrackKey: captionTrackId(chosen), ifSelected: sourceId ? void 0 : state?.selectedTrackKey ?? null});
            }
            if (!current()) { return; }
            this._rawSession = session;
            this._restoringVideoState = true;
            this._aiGroups = null;
            this._fileTranslations = new Map();
            this._offsetMs = 0;
            this._present(session);
            view.root.dataset.captionSource = capturedBody ? 'capture' : 'refetch';
            view.root.dataset.captionTrack = `${language}|${kind}`;
            void this._restoreVideoState(session);
            if (this._prefs.aiSegment) { void this._runSegmentation(); }
        } catch (error) {
            if (current()) { this._status(timedOut ? '字幕读取超时，请重试。' : `字幕读取失败：${error instanceof Error ? error.message : String(error)}`); }
        } finally {
            if (timeout !== null) { clearTimeout(timeout); }
            if (this._loadController === controller) {
                this._loadController = null;
                view.load.disabled = this._translation !== null;
                if (this._rawSession === previous) { this._syncMenu(); }
            }
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
        const source = {mediaKey: this._mediaKey, url: site.pageUrl()};
        const sourceKey = this._sourceKey;
        const controller = new AbortController();
        const current = () => generation === this._generation && this._loadController === controller && sourceKey === pageSourceKey(site.pageUrl());
        this._loadController = controller;
        const timeout = setTimeout(() => controller.abort(), WAIT_MS);
        view.load.disabled = true;
        this._status('正在查找这个视频的字幕…');
        try {
            const state = sourceId ? null : await readVideoState(source);
            if (!current() || controller.signal.aborted) { return; }
            const found = await site.load({signal: controller.signal, sourceId, preferredId: state?.selectedTrackKey, learning: 'en'});
            if (!current()) { return; }
            const sources = found?.all ?? (await site.sources('en')).map(({id, label}) => ({id, label}));
            if (!current()) { return; }
            this._sources = sources;
            if (!found) {
                this._status(controller.signal.aborted ? '字幕读取超时，可在「⋯」里重新载入，或导入字幕。' : '没有找到字幕，可导入字幕文件。');
                view.status.append(this._button('导入字幕', () => this.pickFile()));
                this._syncMenu();
                return;
            }
            this._useCues(found.cues, {trackKey: found.id, label: found.label, language: found.language, acquisition: 'provider'});
            await writeVideoState(source, {selectedTrackKey: found.id, ifSelected: sourceId ? void 0 : state?.selectedTrackKey ?? null});
        } catch (error) {
            if (current()) { this._status(`字幕读取失败：${error instanceof Error ? error.message : String(error)}`); }
        } finally {
            clearTimeout(timeout);
            if (this._loadController === controller) {
                this._loadController = null;
                view.load.disabled = this._translation !== null;
            }
        }
    }

    /**
     * Uses the caption request the player already made. If none yet, turns on the player's CC once and waits.
     * @param {string} videoId
     * @param {number} generation
     * @param {AbortSignal} [signal]
     * @returns {Promise<URL|null>}
     */
    async _findCaptionUrl(videoId, generation, signal) {
        const sameVideo = () => generation === this._generation && youtubeVideoId(location.href) === videoId;
        const current = () => !signal?.aborted && sameVideo();
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
        if (!sameVideo() || !cc.isConnected || document.querySelector('#movie_player .ytp-subtitles-button') !== cc) { return null; }
        // If cancelled during the off/on probe, only restore the player's original CC state.
        if (!signal?.aborted || cc.getAttribute('aria-pressed') !== 'true') { cc.click(); }
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
        this._endListening();
        this._restoreReplay?.();
        this._stopLoop('');
        const view = this._view;
        if (!view) { return; }
        this._failed.clear();
        this._finishTranslation(true);
        this._autoBackoff = 0;
        youtubeStudyContext.reset();
        this._video?.removeEventListener('timeupdate', this._timeListener);
        this._lookup = '';
        this._shadowRow = null; this._shadowDone = '';
        this._shadowPause = null;
        if (this._session?.source.trackKey !== session.source.trackKey) { view.search.value = ''; }
        this._session = session;
        view.searchBar.hidden = view.list.hidden;
        this._rowInfo.clear();
        const source = this._sourceKey;
        for (const [index, cue] of session.cues.entries()) {
            // Times are read when used, so a later offset change still captures the right clip.
            /** @type {RowInfo} */
            const info = {
                text: cue.text.replaceAll(/\s*\n\s*/g, ' ').trimEnd(),
                context: this._context(session, index),
                get start() { return Math.max(0, cue.startMs + session.offsetMs) / 1000; },
                get end() { return Math.max(0, cue.endMs + session.offsetMs) / 1000; },
                get url() { return timedUrl(session.source.url || location.href, Math.max(0, cue.startMs + session.offsetMs) / 1000).url; },
                translation: () => session.translation(cue.id),
                waitTranslation: () => this._waitCaptionTranslation(session, cue.id),
                video: () => {
                    this._markLookup(cue.id);
                    return this._video;
                },
                isCurrent: () => this._session === session && this._mediaKey !== null && this._mediaKey === this._site.mediaKey() && source === pageSourceKey(this._site.pageUrl()),
            };
            this._rowInfo.set(cue.id, info);
        }
        this._refreshLearning();
        this._renderCaptionRows();
        view.load.textContent = '重新载入';
        view.translate.hidden = /^(zh|cmn|yue)(?:-|$)/i.test(session.source.language);
        view.progress.textContent = `已翻译 ${session.progress().translated}/${session.cues.length}`;
        view.retry.hidden = true;
        this._status(`${session.source.trackName ?? session.source.language} · ${session.cues.length} 句`);
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
        this._tryLibraryListening();
    }

    /** @param {boolean} [resetScroll] */
    _renderCaptionRows(resetScroll = false) {
        const {_view: view, _session: session} = this;
        if (!view || !session) { return; }
        const query = view.search.value.trim();
        const {rows, ranges} = session.search(query);
        this._searchRanges = ranges;
        const top = resetScroll ? 0 : view.list.scrollTop;
        this._list.render(view.list, rows);
        view.list.scrollTop = top;
        view.follow.setAttribute('aria-pressed', String(this._follow && !query));
        view.searchCount.textContent = !query ? '' : (rows.length > 0 ? `找到 ${rows.length} 行` : '没找到');
        if (resetScroll && !query && this._follow && this._active) {
            const row = this._list.ensure(this._active.split('|')[0]);
            if (row) { view.list.scrollTop = Math.max(0, row.offsetTop - view.list.clientHeight / 3); }
        }
    }

    /** */
    _clearCaptionSearch() {
        if (!this._view?.search.value) { return; }
        this._view.search.value = '';
        this._renderCaptionRows(true);
    }

    /**
     * @param {string} id
     * @returns {HTMLElement|undefined}
     */
    _ensureCaptionRow(id) {
        const row = this._list.ensure(id);
        if (row || !this._view?.search.value.trim() || !this._rowInfo.has(id)) { return row; }
        this._clearCaptionSearch();
        return this._list.ensure(id);
    }

    /**
     * Builds one sidebar row; long tracks call this only when the row is needed.
     * @param {import('./subtitle-session.js').SubtitleCue} cue
     * @param {number} _index
     * @returns {HTMLElement}
     */
    _makeRow(cue, _index) {
        const session = /** @type {SubtitleSession} */ (this._session);
        const info = /** @type {RowInfo} */ (this._rowInfo.get(cue.id));
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
        if (!/^en(?:-|$)/i.test(text.lang)) { text.classList.add('scan-disable'); }
        // The newline (pre-line) ends Yomitan's sentence at this caption instead of running into the next row.
        // Line breaks inside one caption are display wrapping, not sentence ends.
        text.textContent = `${info.text}\n`;
        if (/^en(?:-|$)/i.test(session.source.language)) { youtubeStudyContext.register(text, info); }
        const translated = document.createElement('p');
        translated.className = 'r-translation scan-disable';
        translated.lang = 'zh-CN';
        translated.textContent = session.translation(cue.id) || (this._failed.has(cue.id) ? '翻译未完成：可重试' : '');
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
        const star = document.createElement('span');
        star.className = 'r-star';
        star.textContent = '★';
        star.title = '本句恰好一个在学词';
        star.hidden = !this._recommended.has(cue.id);
        time.append(star);
        tools.append(loop);
        row.append(time, text, tools, translated);
        const range = this._searchRanges.get(cue.id);
        if (range) {
            const replay = this._button(`▶ 回听 ${range.lines} 行`, () => this._playCaptionRange(session, cue.id, range.lastId, {follow: false}));
            replay.className = 'r-search-play r-loop scan-disable';
            row.append(replay);
        }
        if (/^en(?:-|$)/i.test(session.source.language)) { this._addCueNotes(cue.id, info, row, tools); }
        return row;
    }

    /**
     * @param {string} id
     * @param {RowInfo} info
     * @param {HTMLElement} row
     * @param {HTMLElement} tools
     */
    _addCueNotes(id, info, row, tools) {
        /** @type {HTMLElement|null} */
        let panel = null;
        const close = () => {
            panel?.remove();
            panel = null;
            toggle.setAttribute('aria-expanded', 'false');
        };
        const toggle = this._button('笔记', () => {
            if (panel) {
                close();
                return;
            }
            const mediaKey = this._mediaKey;
            if (!mediaKey) { return; }
            const notes = Object.assign(document.createElement('div'), {className: 'r-cue-notes scan-disable', textContent: '正在查这句…'});
            notes.setAttribute('aria-live', 'polite');
            row.append(notes);
            panel = notes;
            toggle.setAttribute('aria-expanded', 'true');
            const videoTime = Math.floor(info.start);
            const key = savedCueKey(videoTime, info.text);
            for (const [otherId, other] of this._rowInfo) {
                if (otherId !== id && savedCueKey(other.start, other.text) === key) {
                    notes.textContent = '这一秒有两条相同字幕，无法确认是哪一条。';
                    return;
                }
            }
            const live = () => panel === notes && row.isConnected && info.isCurrent() && Math.floor(info.start) === videoTime;
            void this._call('libraryVideoWords', {mediaKey, cue: {sentence: info.text, videoTime}}).then((value) => {
                if (!live()) {
                    if (panel === notes) { close(); }
                    return;
                }
                const {items} = /** @type {{items: SavedPlayback[]}} */ (value);
                notes.textContent = items.length > 0 ? '这句记过：' : '这句还没有保存过的笔记。';
                for (const {id: recordId, word, sentence, sense} of items) {
                    const open = this._button([word, sense?.gloss].filter(Boolean).join(' · '), () => {
                        if (!live()) {
                            close();
                            return;
                        }
                        void this._call('openStudyRecord', {id: recordId, word, sentence, openPanel: false}).catch(() => {
                            if (live()) { this._status('没能打开这条笔记，请再点一次或去学习库找。'); }
                        });
                    });
                    notes.append(open);
                }
            }).catch(() => {
                if (live()) {
                    notes.textContent = '没能查到这句。可关闭后重试，或去「我在这个视频记的词」找。';
                } else if (panel === notes) { close(); }
            });
        });
        toggle.className = 'r-loop';
        toggle.title = '查看这句记过的词义';
        toggle.dataset.cueNotes = '';
        toggle.setAttribute('aria-expanded', 'false');
        tools.append(toggle);
    }

    /**
     * Gives a newly built row the states the controller already holds.
     * @param {string} id
     * @param {HTMLElement} row
     */
    _paintRow(id, row) {
        row.classList.toggle('is-current', this._active.split('|').includes(id));
        row.classList.toggle('is-lookup', this._lookup === id);
        const looping = this._loop?.id === id;
        row.classList.toggle('is-looping', looping);
        row.querySelector('.r-loop')?.setAttribute('aria-pressed', String(looping));
    }

    /**
     * @param {SubtitleSession} session
     * @param {number} index
     * @returns {string}
     */
    _context(session, index) {
        return [session.cues[index - 1]?.text, session.cues[index + 1]?.text].filter(Boolean).join('\n').slice(0, 1200);
    }

    /**
     * A word card joins only the batch already sent for its own cue.
     * @param {SubtitleSession} session
     * @param {string} id
     * @returns {Promise<string|null>}
     */
    async _waitCaptionTranslation(session, id) {
        if (this._session !== session) { return ''; }
        const ready = session.translation(id);
        if (ready) { return ready; }
        const run = this._translation;
        if (!run?.batch.has(id)) { return null; }
        return await new Promise((resolve) => {
            const listeners = run.waiting.get(id) ?? [];
            listeners.push(resolve);
            run.waiting.set(id, listeners);
        });
    }

    /** @param {boolean} [cancelled] */
    _finishTranslation(cancelled = false) {
        const run = this._translation;
        if (!run) { return; }
        this._translation = null;
        if (cancelled) { run.controller.abort(); }
        for (const listeners of run.waiting.values()) {
            for (const resolve of listeners) { resolve(''); }
        }
        const view = this._view;
        if (!view) { return; }
        view.translate.disabled = false;
        view.retry.disabled = false;
        view.load.disabled = this._loadController !== null;
        view.cancel.hidden = true;
        view.retry.hidden = this._failed.size === 0;
        if (!view.retry.hidden) { view.status.append(' ', view.retry); }
        if (!cancelled && view.search.value.trim()) { this._renderCaptionRows(); }
    }

    /**
     * @param {boolean} retryOnly
     * @param {boolean} [full]
     * @param {string} [onlyId]
     */
    async _translate(retryOnly, full = false, onlyId) {
        const session = this._session;
        const view = this._view;
        if (!session || !view || this._translation || /^(zh|cmn|yue)(?:-|$)/i.test(session.source.language)) { return; }
        const active = session.active((this._video?.currentTime || 0) * 1000)[0];
        const index = active ? session.cues.indexOf(active) : 0;
        const ordered = [...session.cues.slice(index), ...session.cues.slice(0, index)];
        const needed = ordered.filter((cue) => (retryOnly ? this._failed.has(cue.id) : !session.translation(cue.id)));
        const selected = onlyId ? needed.filter((cue) => cue.id === onlyId) : (full || retryOnly ? needed : needed.slice(0, 8));
        const items = selected.map((cue) => ({
            id: cue.id,
            text: cue.text.replaceAll(/\s*\n\s*/g, ' '),
            context: this._context(session, session.cues.indexOf(cue)),
        }));
        if (items.length === 0) {
            this._status('这些句子已经翻译好了。');
            return;
        }
        const run = {id: crypto.randomUUID(), engine: this._prefs.engine, controller: new AbortController(), batch: new Set(), waiting: new Map()};
        const live = () => this._translation === run;
        this._translation = run;
        view.translate.disabled = true;
        view.retry.disabled = true;
        view.load.disabled = true;
        view.cancel.hidden = false;
        this._status(`正在翻译 ${items.length} 句 · ${ENGINE_LABELS[run.engine]}…`);
        try {
            const config = /** @type {import('study').StudyConfig} */ (await this._call('subtitleSettings'));
            if (!live()) { return; }
            const consent = JSON.stringify([session.source.mediaKey, run.engine, config.model, config.effort]);
            if (full && run.engine === 'model' && this._fullConsent !== consent) {
                // Token estimate only; no provider pricing or billing precision is claimed.
                const estimate = Math.ceil(items.reduce((sum, item) => sum + item.text.length + item.context.length, 0) / 3 + items.length * 80);
                const approved = await confirmTranslation(`全文 ${session.cues.length} 句，大约消耗 ${estimate.toLocaleString()} Token（估算，实际用量由模型决定）。继续吗？`, run.controller.signal);
                if (!live()) { return; }
                if (!approved) {
                    this._status('没有开始翻译。'); return;
                }
                this._fullConsent = consent;
            }
            const result = await this._queue.translate(items, {...config,
                // The service owns cache language, expiry and clearing; do not bypass it with a second memo.
                cacheEnabled: false,
                signal: run.controller.signal,
                onItem: (row) => {
                    if (!live()) { return; }
                    const target = this._rows.get(row.id)?.querySelector('.r-translation');
                    if (row.translation) {
                        session.acceptTranslation(row.id, row.translation);
                        this._failed.delete(row.id);
                        if (target) { target.textContent = row.translation; }
                        this._emit('translation', {id: row.id});
                        view.progress.textContent = `已翻译 ${session.progress().translated}/${session.cues.length}`;
                    } else {
                        this._failed.add(row.id);
                        if (target) { target.textContent = `翻译未完成：${row.error || '可重试'}`; }
                    }
                    run.batch.delete(row.id);
                    for (const resolve of run.waiting.get(row.id) ?? []) { resolve(session.translation(row.id)); }
                    run.waiting.delete(row.id);
                }});
            if (live() && !result.cancelled) {
                this._status(`已译 ${session.progress().translated}/${session.cues.length} · ${ENGINE_LABELS[run.engine]}${this._failed.size > 0 ? ' · 有失败，可重试或换服务' : ''}`);
                if (this._failed.size > 0) { this._autoBackoff = Date.now() + 20000; }
            }
        } catch (error) {
            if (live()) {
                this._autoBackoff = Date.now() + 20000;
                this._status(error instanceof Error ? error.message : String(error));
            }
        } finally {
            if (live()) { this._finishTranslation(); }
        }
    }

    /**
     * @param {string} id
     * @returns {boolean}
     */
    _seek(id) {
        this._endListening();
        this._restoreReplay?.();
        if (!this._session || !this._video) { return false; }
        if (this._loop && this._loop.id !== id) { this._stopLoop('已退出循环'); }
        try {
            this._video.currentTime = this._session.seekSeconds(id);
            this._resumeFollow();
            return true;
        } catch (error) {
            this._status(error instanceof Error ? error.message : String(error));
            return false;
        }
    }

    /** */
    _onTime() {
        const session = this._session;
        const video = this._video;
        if (!session || !video || !this._view?.root.isConnected) { return; }
        const playbackMs = video.currentTime * 1000;
        if (this._prefs.resume && !this._listen) { this._saveProgress(playbackMs); }
        const active = session.active(playbackMs).map((c) => c.id);
        const key = active.join('|');
        if (key === this._active) { return; }
        this._active = key;
        for (const [id, row] of this._rows) { row.classList.toggle('is-current', active.includes(id)); }
        this._emit('active', {ids: active});
        if (!this._listen) { this._autoTranslate(playbackMs); }
        const first = active.length > 0 && this._follow && !this._view.search.value.trim() ? this._list.ensure(active[0]) : void 0;
        if (this._follow && first) {
            const list = this._view.list;
            list.scrollTop = Math.max(0, first.offsetTop - list.clientHeight / 3);
        }
    }

    /**
     * @param {string} id
     */
    _toggleLoop(id) {
        this._endListening();
        const session = this._session;
        const video = this._video;
        if (!session || !video) { return; }
        if (this._loop?.id === id) {
            this._stopLoop('已退出循环');
            return;
        }
        this._resetCuePlayback();
        try {
            const start = session.seekSeconds(id);
            const end = (session.cue(id).endMs + session.offsetMs) / 1000;
            const info = this._rowInfo.get(id);
            const isCurrent = () => this._video === video && info?.isCurrent() === true;
            const cancel = youtubeStudyContext.playRange(video, {start, end, isCurrent, repeat: true}, (reason) => {
                if (this._loop?.id !== id) { return; }
                this._stopLoop(reason === 'failed' ? '播放没有开始，请点播放器的播放按钮。' : '已退出循环');
            });
            this._loop = {id, cancel};
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
        loop.cancel(false);
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
            this._present(raw, true);
            this._status(`AI 断句完成 · ${groups.length} 句`);
        } catch (error) {
            if (live()) { this._status(`AI 断句未完成：${error instanceof Error ? error.message : String(error)}；已保留规则断句。`); }
        }
    }

    /** Updates learning marks and recommendations. */
    _refreshLearning() {
        if (!this._session || !this._view) { return; }
        const stats = learningCaptions(this._session, /^en(?:-|$)/i.test(this._session.source.language) ? this._learningWords : {}, this._cardContexts);
        this._recommended = stats.recommended;
        this._recommendationItems = stats.items;
        this._view.root.querySelector('.r-difficulty').textContent = `语速 ${stats.wpm} 词/分 · 在学词 ${stats.learning}`;
        for (const [id, row] of this._rows) { /** @type {HTMLElement} */ (row.querySelector('.r-star')).hidden = !this._recommended.has(id); }
        const old = this._view.words.querySelector('.r-recommend');
        if (old) { old.replaceWith(this._recommendations()); }
    }

    /** @returns {HTMLElement} */
    _recommendations() {
        const section = document.createElement('div');
        section.className = 'r-recommend';
        const title = document.createElement('strong'); title.textContent = '推荐制卡';
        section.append(title);
        if (this._recommendationItems.length === 0) {
            section.append(Object.assign(document.createElement('p'), {className: 'r-words-note', textContent: '暂时没有：至少要有一个还在学的词出现在字幕里'}));
        }
        for (const item of this._recommendationItems) {
            const info = this._rowInfo.get(item.cueId);
            const row = document.createElement('div'); row.className = 'r-recommend-item';
            const word = document.createElement('strong'); word.textContent = [item.word, item.gloss].filter(Boolean).join(' · ');
            const text = document.createElement('p'); text.className = 'r-recommend-text';
            const match = [...info.text.matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)].find((m) => m[0].toLowerCase() === item.term.toLowerCase());
            const mark = document.createElement('mark'); mark.textContent = match[0];
            text.append(info.text.slice(0, match.index), mark, info.text.slice(match.index + match[0].length));
            youtubeStudyContext.register(text, info);
            const range = () => {
                const value = document.createRange(); value.selectNodeContents(mark);
                return value;
            };
            const replay = this._button('▶ 回听', () => {
                const source = youtubeStudyContext.read(range());
                if (source) {
                    try {
                        youtubeStudyContext.play(source.token);
                    } catch (error) { this._status(error instanceof Error ? error.message : '回听没有开始，请再试一次。'); }
                }
            });
            replay.dataset.recommendReplay = '';
            const card = this._button('制卡', () => {
                if (!youtubeStudyContext.openCard) {
                    this._status('划词查询还没准备好，请刷新页面后再试。'); return;
                }
                void youtubeStudyContext.openCard(range()).catch((error) => this._status(`词卡没有打开：${error.message}`));
            });
            card.dataset.recommendCard = '';
            row.append(word, text, replay, card); section.append(row);
        }
        return section;
    }

    /** @param {{id: string, word: string, sentence: string, videoTime: number|null}} item */
    async _openSavedWord(item) {
        if (this._sourceKey !== pageSourceKey(this._site.pageUrl())) { return; }
        const normalize = (/** @type {string} */ text) => text.replaceAll(/\s+/g, ' ').trim().toLowerCase();
        const sentence = normalize(item.sentence);
        const cues = [...this._rowInfo].filter(([, row]) => normalize(row.text) === sentence &&
        (item.videoTime === null || Math.floor(row.start) === item.videoTime));
        if (cues.length === 1 && await this.lookupCaption(cues[0][0], item.word, true, item.id)) { return; }
        await this._call('openStudyRecord', {id: item.id, word: item.word, sentence: item.sentence});
    }

    /** @returns {boolean} */
    get listening() { return this._listen !== null; }

    /**
     * @param {SavedPlayback[]} items
     * @param {boolean} [chronological]
     */
    _beginListening(items, chronological = false) {
        const view = this._view;
        const session = this._session;
        const video = this._video;
        if (!view || !video || !session || !/^en(?:-|$)/i.test(session.source.language)) {
            this._status('请先载入原来的英语字幕，再练回听。');
            return;
        }
        /** @typedef {Pick<RowInfo, 'text'|'start'|'end'|'isCurrent'> & {cueId?: string}} Clip */
        /** @type {Map<string, Clip|null>} */
        const index = new Map();
        const add = (/** @type {Clip} */ clip) => {
            if (clip.end <= clip.start) { return; }
            const key = savedCueKey(clip.start, clip.text);
            index.set(key, index.has(key) ? null : clip);
        };
        for (const [cueId, {start, end, text, isCurrent}] of this._rowInfo) {
            add({start, end, text, isCurrent, cueId});
        }
        const wanted = new Set(items.flatMap(({videoTime, sentence}) => (typeof videoTime === 'number' ? [savedCueKey(videoTime, sentence)] : [])));
        for (const key of index.keys()) { wanted.delete(key); }
        const raw = this._rawSession;
        if (raw && wanted.size > 0) {
            // The display grouping isn't the recording: recover exact clips from the same track only.
            const source = this._sourceKey;
            const isCurrent = () => this._session === session && this._rawSession === raw && this._mediaKey !== null && this._mediaKey === this._site.mediaKey() && source === pageSourceKey(this._site.pageUrl());
            const seconds = (/** @type {number} */ ms) => Math.max(0, ms + session.offsetMs) / 1000;
            for (const {text, startMs, endMs} of [...raw.cues, ...groupForReading(raw.cues).filter(({cueIds}) => cueIds.length > 1)]) {
                const start = seconds(startMs);
                if (wanted.has(savedCueKey(start, text))) { add({text, start, end: seconds(endMs), isCurrent}); }
            }
        }
        /** @type {Map<string, SavedPlayback[]>} */
        const savedByCue = new Map();
        for (const item of items) {
            if (typeof item.videoTime !== 'number') { continue; }
            const key = savedCueKey(item.videoTime, item.sentence);
            if (!index.get(key)) { continue; }
            const records = savedByCue.get(key) ?? [];
            records.push(item);
            savedByCue.set(key, records);
        }
        let queue = [...savedByCue.keys()];
        if (chronological) {
            queue.sort((a, b) => /** @type {Clip} */ (index.get(a)).start - /** @type {Clip} */ (index.get(b)).start);
        }
        if (queue.length === 0) {
            this._status('当前字幕对不上已记下的原句和时间。切回原来的字幕或偏移再试。');
            return;
        }
        this._libraryListening = null;
        this._restoreReplay?.();
        this._stopLoop('');
        this._shadowRow = this._shadowPause = null;
        this._shadowDone = '';
        const panel = document.createElement('section');
        panel.className = 'r-listen-practice scan-disable';
        const title = document.createElement('strong');
        const hint = document.createElement('p');
        hint.setAttribute('role', 'status');
        const answer = document.createElement('p');
        answer.className = 'r-listen-answer';
        const controls = document.createElement('div');
        controls.className = 'r-listen-actions';
        const notes = document.createElement('div');
        notes.className = 'r-listen-actions';
        notes.setAttribute('role', 'group');
        notes.setAttribute('aria-label', '这句已存的词义');
        /** @type {NonNullable<YoutubeReader['_listen']>} */
        const practice = {panel, listHidden: view.list.hidden, wordsHidden: view.words.hidden};
        /** @type {Set<string>} */
        const missed = new Set();
        let current = 0;
        let retrying = false;
        const prompt = () => {
            answer.hidden = true;
            answer.textContent = '';
            notes.replaceChildren();
            notes.remove();
            const done = current === queue.length;
            for (const button of [play, reveal, miss, next]) { button.hidden = done; }
            retry.hidden = !done || missed.size === 0;
            if (done) {
                title.textContent = '本轮结束';
                hint.textContent = missed.size > 0 ? '可以只重听标过「没听清」的句子。' : '这轮没有标记没听清的句子。';
                retry.textContent = `重听这 ${missed.size} 句`;
                (retry.hidden ? stop : retry).focus();
            } else {
                title.textContent = `${retrying ? '重听没听清的' : '先听，再看原句'} · ${current + 1}/${queue.length}`;
                hint.textContent = '不看字幕，试着听懂这一句。';
                miss.setAttribute('aria-pressed', 'false');
                next.textContent = current + 1 === queue.length ? '结束这一轮' : '下一句';
                play.focus();
            }
        };
        const play = this._button('播放本句', () => {
            practice.cancel?.();
            const info = index.get(queue[current]);
            if (!info) {
                hint.textContent = '这句的字幕已改变。请退出后重开练习。';
                return;
            }
            try {
                const isCurrent = () => this._video === video && info.isCurrent();
                hint.textContent = video.muted || video.volume === 0 ? '正在播放；播放器已静音，请打开声音。' : '正在播放本句…';
                practice.cancel = youtubeStudyContext.playRange(video, {start: info.start, end: info.end, isCurrent}, (reason) => {
                    practice.cancel = void 0;
                    hint.textContent = {ended: '已播完。可以再听，或看原句。', failed: '播放没开始，请再点一次。', cancelled: '已停止。可以再点一次播放。'}[reason];
                });
            } catch (error) {
                hint.textContent = error instanceof Error ? error.message : '播放没开始，请再点一次。';
            }
        });
        play.dataset.listenPlay = '';
        const reveal = this._button('看原句', () => {
            const id = queue[current];
            const info = index.get(id);
            if (!info) { return; }
            const {cueId} = info;
            const revealed = document.createTextNode([info.text, cueId ? session.translation(cueId) : ''].filter(Boolean).join('\n'));
            answer.replaceChildren(revealed);
            answer.hidden = false;
            reveal.hidden = true;
            const records = savedByCue.get(id) ?? [];
            if (this._mediaKey && records.length > 0) {
                const ids = new Set(records.map((record) => record.id));
                const cue = {sentence: info.text, videoTime: Math.floor(info.start)};
                void this._call('libraryVideoWords', {mediaKey: this._mediaKey, cue}).then((value) => {
                    if (this._listen !== practice || revealed.parentNode !== answer || !info.isCurrent()) { return; }
                    const {items: matched} = /** @type {{items: SavedPlayback[]}} */ (value);
                    const translations = new Set(matched.filter((item) => ids.has(item.id)).map((item) => item.translation?.trim()).filter(Boolean));
                    if (translations.size > 0) { revealed.data = [info.text, ...translations].join('\n'); }
                }).catch(() => {});
            }
            for (const {id: recordId, word, sentence, sense, supplementAudio} of records) {
                const label = [word, sense?.gloss].filter(Boolean).join(' · ');
                const resume = this._button(`继续学习：${label}`, () => {
                    practice.cancel?.();
                    void this._call('openStudyRecord', {id: recordId, word, sentence, openPanel: false}).catch(() => {
                        if (this._listen === practice && queue[current] === id) { hint.textContent = '没能打开这条笔记。再点一次，或去学习库找它。'; }
                    });
                });
                resume.dataset.listenNote = '';
                notes.append(resume);
                if (supplementAudio && cueId) {
                    const audio = this._button('补存原声', () => {
                        practice.cancel?.();
                        void this.lookupCaption(cueId, word, 'audio', recordId).then((opened) => {
                            if (!opened) { this._status('这句暂时不能补录；请确认原词和英语字幕还对得上。'); }
                        }).catch(() => { this._status('没能打开原声面板，可以再试一次。'); });
                    });
                    audio.dataset.listenAudio = '';
                    notes.append(audio);
                }
            }
            answer.after(notes);
        });
        reveal.dataset.listenReveal = '';
        const miss = this._button('没听清', () => {
            const id = queue[current];
            const marked = !missed.delete(id);
            if (marked) { missed.add(id); }
            miss.setAttribute('aria-pressed', String(marked));
            hint.textContent = marked ? '已标记。这轮结束后可以只重听标过的句子。' : '已取消这句的标记。';
        });
        miss.dataset.listenMiss = '';
        const next = this._button('下一句', () => {
            practice.cancel?.();
            ++current;
            prompt();
        });
        next.dataset.listenNext = '';
        const retry = this._button('', () => {
            queue = queue.filter((id) => missed.has(id));
            missed.clear();
            current = 0;
            retrying = true;
            prompt();
        });
        retry.dataset.listenRetry = '';
        const stop = this._button('退出', () => {
            this._endListening();
            view.words.querySelector('button[data-listen-saved]')?.focus();
        });
        controls.append(play, reveal, miss, next, retry, stop);
        panel.append(title, hint, controls, answer);
        this._listen = practice;
        view.words.hidden = true;
        view.list.hidden = true;
        view.words.before(panel);
        this._emit('listening');
        prompt();
    }

    /** */
    _endListening() {
        const practice = this._listen;
        if (!practice) { return; }
        this._listen = null;
        practice.cancel?.();
        practice.panel.remove();
        if (this._view) {
            this._view.words.hidden = practice.wordsHidden;
            this._view.list.hidden = practice.listHidden;
        }
        this._emit('listening');
    }

    /**
     * Lists the words already saved from this video; clicking one returns to its moment.
     * @returns {Promise<void>}
     */
    async _loadWords() {
        const view = this._view;
        const mediaKey = this._mediaKey;
        const source = this._sourceKey;
        if (!view || !mediaKey || source !== pageSourceKey(this._site.pageUrl())) { return; }
        const generation = this._generation;
        const recommended = this._recommendations();
        recommended.replaceChildren('正在挑选适合制卡的句子…');
        const saved = document.createElement('div');
        const note = Object.assign(document.createElement('p'), {className: 'r-words-note', textContent: '看视频时点过『记住它』的词。点时间可以回到那一刻。'});
        const review = this._button('复习本视频 ↗', () => {
            review.disabled = true;
            void this._call('openPageLibrary', {mediaKey}).catch(() => {
                if (generation === this._generation) { this._status('没能打开本视频的原句，请从学习库的「按素材」找。'); }
            }).finally(() => { review.disabled = false; });
        });
        review.dataset.reviewSource = '';
        note.append(' ', review);
        view.words.replaceChildren(note, recommended, saved);
        const current = () => generation === this._generation && saved.parentElement === view.words && source === pageSourceKey(this._site.pageUrl());
        saved.replaceChildren(Object.assign(document.createElement('p'), {className: 'r-words-note', textContent: '正在读取这个视频里记住的词…'}));
        try {
            const result = /** @type {{cardContexts?: {word: string, sentence: string}[], items?: (SavedPlayback & {stage: number, cards: number, cardHint?: string})[]}} */ (await this._call('libraryVideoWords', {mediaKey}));
            if (!current()) { return; }
            const items = result.items ?? [];
            this._cardContexts = result.cardContexts ?? items.filter((item) => item.cards > 0);
            this._refreshLearning();
            if (items.length === 0) {
                saved.replaceChildren(Object.assign(document.createElement('p'), {className: 'r-words-note', textContent: '这个视频还没有记住的词。选词后点「记住它」就会出现在这里。'}));
                return;
            }
            // One explicit button writes a short study summary into this video's Obsidian note.
            const summary = document.createElement('div');
            summary.className = 'r-summary scan-disable';
            const write = this._button('生成学习小结（存到 Obsidian）', (event) => {
                // Only a real click by the learner; page scripts cannot press it for them.
                if (event?.isTrusted === false) { return; }
                void this.writeSummary();
            });
            write.title = '在 Obsidian 的视频记录里写入（或更新）本视频的学习小结；只改小结那一段';
            const summaryState = document.createElement('span');
            summaryState.setAttribute('role', 'status');
            const explanation = Object.assign(document.createElement('small'), {className: 'r-summary-help', textContent: '把这个视频里记的词、原句和时间链接，整理成一页笔记'});
            const listen = this._button('先听，再看原句', () => this._beginListening(items));
            listen.dataset.listenSaved = '';
            summary.append(listen, write, explanation, summaryState);
            saved.replaceChildren(summary, ...items.map((item) => {
                const row = document.createElement('div');
                row.className = 'r-word';
                const time = document.createElement('button');
                time.type = 'button';
                time.className = 'r-time';
                const seconds = typeof item.videoTime === 'number' ? item.videoTime : null;
                time.dataset.time = seconds === null ? '' : timeLabel(seconds * 1000);
                time.hidden = seconds === null;
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
                // With sense-level records (roadmap B8) each sense is its own row.
                const sense = typeof item.sense?.gloss === 'string' && item.sense.gloss ? `义项「${item.sense.gloss.slice(0, 20)}」 · ` : '';
                const status = item.cards > 0 ? `已制 ${item.cards} 张卡` : '';
                meta.textContent = sense + ([status, item.cardHint].filter(Boolean).join(' · ') || '还没制卡');
                if (item.cards === 0 && !item.cardHint) {
                    const card = this._button('制卡', () => { void this._openSavedWord(item).catch(() => this._status('词卡没有打开，请再试一次。')); });
                    card.dataset.savedCard = ''; meta.append(' ', card);
                }
                const sentence = document.createElement('p');
                sentence.className = 'r-word-sentence';
                sentence.textContent = item.sentence;
                row.append(time, word, meta, sentence);
                return row;
            }));
        } catch (error) {
            if (current()) {
                view.words.querySelector('.r-recommend').textContent = '暂时无法挑选制卡句子，请重新打开这个页签。';
                saved.replaceChildren(Object.assign(document.createElement('p'), {className: 'r-words-note', textContent: `暂时读不到：${error instanceof Error ? error.message : String(error)}`}));
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
        if (!view || !mediaKey || !box || this._sourceKey !== pageSourceKey(this._site.pageUrl())) { return; }
        const button = /** @type {HTMLButtonElement} */ (box.querySelector('button'));
        const state = /** @type {HTMLElement} */ (box.querySelector('[role=status]'));
        const generation = this._generation;
        button.disabled = true;
        state.textContent = '正在写入…';
        try {
            const result = /** @type {{path: string, words: number, cards: number, openUrl: string}} */ (await this._call('libraryVideoSummary', {mediaKey, title: document.title.slice(0, 300), ...(location.protocol === 'file:' ? {url: this._site.pageUrl()} : {})}));
            if (generation !== this._generation) { return; }
            const open = document.createElement('a');
            open.href = result.openUrl;
            open.textContent = '打开笔记 ↗';
            state.replaceChildren('已保存 · ', open);
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
        if (!session || !this._prefs.autoTranslate || this._translation || document.hidden || Date.now() < this._autoBackoff) { return; }
        const until = playbackMs + this._prefs.aheadSeconds * 1000;
        const needed = session.cues.some((cue) => cue.endMs + session.offsetMs >= playbackMs && cue.startMs + session.offsetMs <= until && !session.translation(cue.id));
        if (needed) { void this._translate(false); }
    }

    /** */
    _pauseFollow() {
        this._follow = false;
        if (this._view && this._session) { this._view.follow.setAttribute('aria-pressed', 'false'); }
    }

    /** */
    _resumeFollow() {
        this._follow = true;
        if (this._view) { this._view.follow.setAttribute('aria-pressed', String(!this._view.search.value.trim())); }
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
