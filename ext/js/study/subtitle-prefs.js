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

// Viewer preferences shared by the in-video captions, the caption sidebar and the
// settings page. They only change presentation and which translation service the
// learner picked; the background re-reads them and never trusts a page's copy.

export const SUBTITLE_PREFS_KEY = 'studySubtitlePrefs';

export const TRANSLATION_PREFS_KEY = 'studyTranslationPrefs';

/** @typedef {'chrome'|'apple'|'google'|'microsoft'|'model'} SubtitleEngine */

/**
 * @typedef {object} SubtitlePrefs
 * @property {boolean} overlay Show our captions inside the video and hide YouTube's own.
 * @property {boolean} bilingual Show the Chinese line under the English one.
 * @property {boolean} blur Keep translations blurred until hovered or clicked.
 * @property {boolean} merge Join caption fragments into readable sentences.
 * @property {boolean} aiSegment Ask the model to re-segment captions (explicit opt-in).
 * @property {boolean} autoTranslate Keep translating ahead of the playback position.
 * @property {SubtitleEngine} engine Translation service for captions.
 * @property {number} aheadSeconds How far ahead automatic translation stays.
 * @property {boolean} otherSites Offer the reader on videos outside YouTube.
 * @property {boolean} shadow Shadowing: pause after each sentence so the learner can repeat it.
 * @property {number} shadowContinueSeconds Resume delay after shadow pause (0, 3 or 5).
 * @property {number} shadowRepeats How many times each sentence plays before the pause (1-5).
 * @property {boolean} resume Offer to continue from the last sentence studied in a video.
 */

/** @type {Readonly<SubtitlePrefs>} */
export const DEFAULT_SUBTITLE_PREFS = Object.freeze({
    overlay: true,
    bilingual: true,
    blur: false,
    merge: true,
    aiSegment: false,
    autoTranslate: false,
    engine: 'chrome',
    aheadSeconds: 60,
    otherSites: true,
    shadow: false,
    shadowRepeats: 1,
    shadowContinueSeconds: 0,
    resume: true,
});

/** @type {ReadonlyArray<SubtitleEngine>} */
export const SUBTITLE_ENGINES = Object.freeze(['chrome', 'apple', 'google', 'microsoft', 'model']);

/**
 * Keeps only known keys with valid values; anything else falls back to the default.
 * @param {unknown} value
 * @returns {SubtitlePrefs}
 */
export function normalizeSubtitlePrefs(value) {
    const input = /** @type {Record<string, unknown>} */ (value && typeof value === 'object' ? value : {});
    /** @type {SubtitlePrefs} */
    const result = {...DEFAULT_SUBTITLE_PREFS};
    for (const key of /** @type {(keyof SubtitlePrefs)[]} */ (['overlay', 'bilingual', 'blur', 'merge', 'aiSegment', 'autoTranslate', 'otherSites', 'shadow', 'resume'])) {
        if (typeof input[key] === 'boolean') { /** @type {Record<string, unknown>} */ (result)[key] = input[key]; }
    }
    const engine = input.engine;
    if (typeof engine === 'string' && SUBTITLE_ENGINES.includes(/** @type {SubtitleEngine} */ (engine))) { result.engine = /** @type {SubtitleEngine} */ (engine); }
    const ahead = input.aheadSeconds;
    if (typeof ahead === 'number' && Number.isFinite(ahead)) { result.aheadSeconds = Math.min(300, Math.max(20, Math.round(ahead))); }
    if ([0, 3, 5].includes(/** @type {number} */ (input.shadowContinueSeconds))) { result.shadowContinueSeconds = /** @type {number} */ (input.shadowContinueSeconds); }
    const repeats = input.shadowRepeats;
    if (typeof repeats === 'number' && Number.isFinite(repeats)) { result.shadowRepeats = Math.min(5, Math.max(1, Math.round(repeats))); }
    return result;
}

/**
 * @returns {?chrome.storage.LocalStorageArea}
 */
function storageArea() {
    return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
}

/**
 * @returns {Promise<SubtitlePrefs>}
 */
export async function readSubtitlePrefs() {
    const area = storageArea();
    if (!area) { return {...DEFAULT_SUBTITLE_PREFS}; }
    try {
        const stored = /** @type {Record<string, unknown>} */ (await area.get([SUBTITLE_PREFS_KEY, TRANSLATION_PREFS_KEY]));
        const old = normalizeSubtitlePrefs(stored[SUBTITLE_PREFS_KEY]);
        if (!stored[TRANSLATION_PREFS_KEY]) {
            await area.set({[TRANSLATION_PREFS_KEY]: {engine: old.engine, autoTranslate: old.autoTranslate}});
        }
        const shared = stored[TRANSLATION_PREFS_KEY] ? normalizeSubtitlePrefs(stored[TRANSLATION_PREFS_KEY]) : old;
        return {...old, engine: shared.engine, autoTranslate: shared.autoTranslate};
    } catch {
        return {...DEFAULT_SUBTITLE_PREFS};
    }
}

/**
 * Merges a change into the stored preferences and returns the result.
 * @param {Partial<SubtitlePrefs>} patch
 * @returns {Promise<SubtitlePrefs>}
 */
export async function writeSubtitlePrefs(patch) {
    const next = normalizeSubtitlePrefs({...await readSubtitlePrefs(), ...patch});
    const area = storageArea();
    if (area) {
        const {engine, autoTranslate, ...video} = next;
        await area.set({[SUBTITLE_PREFS_KEY]: video, [TRANSLATION_PREFS_KEY]: {engine, autoTranslate}});
    }
    return next;
}

/**
 * Calls back whenever another view or the settings page changes the preferences.
 * @param {(prefs: SubtitlePrefs) => void} callback
 * @returns {() => void} Stops listening.
 */
export function onSubtitlePrefsChanged(callback) {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) { return () => {}; }
    /**
     * @param {Record<string, chrome.storage.StorageChange>} changes
     * @param {string} area
     */
    const listener = (changes, area) => {
        if (area === 'local' && (changes[SUBTITLE_PREFS_KEY] || changes[TRANSLATION_PREFS_KEY])) { void readSubtitlePrefs().then(callback); }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
}

/** Per-video memory: where the learner was and how the captions were shifted. */
export const VIDEO_STATE_KEY = 'studyVideoState';

const VIDEO_STATE_LIMIT = 300;

/** @typedef {{resumeMs?: number, offsetMs?: number, trackKey?: string, selectedTrackKey?: string, at: number}} VideoState */

/**
 * @param {string} mediaKey
 * @returns {Promise<VideoState|null>}
 */
export async function readVideoState(mediaKey) {
    const area = storageArea();
    if (!area || !mediaKey) { return null; }
    try {
        const stored = /** @type {Record<string, unknown>} */ (await area.get(VIDEO_STATE_KEY));
        const all = /** @type {Record<string, VideoState>} */ (stored[VIDEO_STATE_KEY] && typeof stored[VIDEO_STATE_KEY] === 'object' ? stored[VIDEO_STATE_KEY] : {});
        const row = all[mediaKey];
        return row && typeof row === 'object' ? row : null;
    } catch {
        return null;
    }
}

/**
 * Merges a change for one video; the oldest videos are forgotten past the limit.
 * @param {string} mediaKey
 * @param {Partial<VideoState>} patch
 */
export async function writeVideoState(mediaKey, patch) {
    const area = storageArea();
    if (!area || !mediaKey) { return; }
    try {
        const stored = /** @type {Record<string, unknown>} */ (await area.get(VIDEO_STATE_KEY));
        const all = /** @type {Record<string, VideoState>} */ ({...(stored[VIDEO_STATE_KEY] && typeof stored[VIDEO_STATE_KEY] === 'object' ? stored[VIDEO_STATE_KEY] : {})});
        all[mediaKey] = {...all[mediaKey], ...patch, at: Date.now()};
        const keys = Object.keys(all);
        if (keys.length > VIDEO_STATE_LIMIT) {
            for (const key of keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - VIDEO_STATE_LIMIT)) { delete all[key]; }
        }
        await area.set({[VIDEO_STATE_KEY]: all});
    } catch { /* Memory is a convenience; studying continues without it. */ }
}
