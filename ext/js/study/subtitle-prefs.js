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

import {studyCall} from './study-client.js';
import {pageSourceKey} from './media-key.js';
import {SUBTITLE_ENGINES} from './translation-engines.js';

// Viewer preferences shared by the in-video captions, the caption sidebar and the
// settings page. They only change presentation and which translation service the
// learner picked; the background re-reads them and never trusts a page's copy.

export const SUBTITLE_PREFS_KEY = 'studySubtitlePrefs';

export const TRANSLATION_PREFS_KEY = 'studyTranslationPrefs';

/** @typedef {import('./translation-engines.js').SubtitleEngine} SubtitleEngine */

/**
 * @typedef {object} SubtitlePrefs
 * @property {boolean} shortcuts Enable A/S/D caption shortcuts.
 * @property {boolean} enabled Enable video subtitle learning.
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
    enabled: true,
    shortcuts: true,
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

export {SUBTITLE_ENGINES} from './translation-engines.js';

/**
 * Keeps only known keys with valid values; anything else falls back to the default.
 * @param {unknown} value
 * @returns {SubtitlePrefs}
 */
export function normalizeSubtitlePrefs(value) {
    const input = /** @type {Record<string, unknown>} */ (value && typeof value === 'object' ? value : {});
    /** @type {SubtitlePrefs} */
    const result = {...DEFAULT_SUBTITLE_PREFS};
    for (const key of /** @type {(keyof SubtitlePrefs)[]} */ (['shortcuts', 'enabled', 'overlay', 'bilingual', 'blur', 'merge', 'aiSegment', 'autoTranslate', 'otherSites', 'shadow', 'resume'])) {
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
 * Video controls own presentation; only the shared key selects the translator.
 * @param {unknown} video
 * @param {unknown} shared
 * @returns {SubtitlePrefs}
 */
export function subtitlePrefsFrom(video, shared) {
    const prefs = normalizeSubtitlePrefs(video);
    if (!shared) { return prefs; }
    const {engine, autoTranslate} = normalizeSubtitlePrefs(shared);
    return {...prefs, engine, autoTranslate};
}

/**
 * @param {unknown} video
 * @returns {boolean}
 */
function hasOldTranslation(video) {
    return Boolean(video && typeof video === 'object' && ('engine' in video || 'autoTranslate' in video));
}

/**
 * @returns {Promise<SubtitlePrefs>}
 */
export async function readSubtitlePrefs() {
    const area = storageArea();
    if (!area) { return {...DEFAULT_SUBTITLE_PREFS}; }
    const stored = /** @type {Record<string, unknown>} */ (await area.get([SUBTITLE_PREFS_KEY, TRANSLATION_PREFS_KEY]).catch(() => ({})));
    const video = stored[SUBTITLE_PREFS_KEY];
    const shared = stored[TRANSLATION_PREFS_KEY];
    if (!shared && hasOldTranslation(video)) {
        // Ask the writer to migrate its current snapshot, not this tab's old one.
        return await writeSubtitlePrefs({}).catch(() => subtitlePrefsFrom(video, shared));
    }
    return subtitlePrefsFrom(video, shared);
}

/**
 * Runs inside the service worker's existing write queue, including one-time
 * migration. The caller supplies a patch, never both tabs' full snapshots.
 * @param {import('study').Storage} storage
 * @param {Partial<SubtitlePrefs>} patch
 * @returns {Promise<SubtitlePrefs>}
 */
export async function storeSubtitlePatch(storage, patch) {
    const [local, global] = await Promise.all([storage.get(SUBTITLE_PREFS_KEY), storage.get(TRANSLATION_PREFS_KEY)]);
    const old = local[SUBTITLE_PREFS_KEY];
    const shared = global[TRANSLATION_PREFS_KEY];
    const next = normalizeSubtitlePrefs({...subtitlePrefsFrom(old, shared), ...patch});
    const {engine, autoTranslate, ...video} = next;
    /** @type {Record<string, unknown>} */
    const changes = {};
    if (Object.keys(patch).some((key) => Object.hasOwn(video, key))) { changes[SUBTITLE_PREFS_KEY] = video; }
    if ('engine' in patch || 'autoTranslate' in patch || (!shared && hasOldTranslation(old))) {
        changes[TRANSLATION_PREFS_KEY] = {engine, autoTranslate};
    }
    if (Object.keys(changes).length > 0) { await storage.set(changes); }
    return next;
}

/**
 * @param {Partial<SubtitlePrefs>} patch
 * @returns {Promise<SubtitlePrefs>}
 */
export async function writeSubtitlePrefs(patch) {
    return /** @type {SubtitlePrefs} */ (await studyCall('subtitlePrefsUpdate', patch));
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
let videoStateWrites = Promise.resolve();

/** @typedef {{mediaKey: string, url?: string}} VideoStateSource */

/**
 * Preserve the provider's video/part keys. A general page or a file already has a
 * more precise source identity; its old playback key cannot identify one owner.
 * @param {VideoStateSource} source
 * @returns {string}
 */
export function videoStateScope({mediaKey, url}) {
    const source = pageSourceKey(url ?? '');
    return source.startsWith('youtube:') || source.startsWith('web:') ? mediaKey : source;
}

/** @typedef {{resumeMs?: number, offsetMs?: number, trackKey?: string, selectedTrackKey?: string, at: number}} VideoState */

/** @typedef {Partial<Omit<VideoState, 'at'>> & {ifSelected?: string|null}} VideoStatePatch */

/**
 * Apply a player's change to the worker's latest snapshot, not a tab's copy.
 * @param {unknown} stored
 * @param {string} mediaKey
 * @param {VideoStatePatch} patch
 * @returns {Record<string, VideoState>}
 */
export function mergeVideoState(stored, mediaKey, patch) {
    const all = /** @type {Record<string, VideoState>} */ ({...(stored && typeof stored === 'object' ? stored : {})});
    // An automatic fallback remembers its track only if nobody chose another one while it loaded.
    if (patch.ifSelected !== void 0 && (all[mediaKey]?.selectedTrackKey ?? null) !== patch.ifSelected) { return all; }
    const row = {...all[mediaKey], at: Date.now()};
    if (Number.isFinite(patch.resumeMs)) { row.resumeMs = patch.resumeMs; }
    if (typeof patch.selectedTrackKey === 'string') { row.selectedTrackKey = patch.selectedTrackKey; }
    if (Number.isFinite(patch.offsetMs) && typeof patch.trackKey === 'string') {
        row.offsetMs = patch.offsetMs;
        row.trackKey = patch.trackKey;
    }
    all[mediaKey] = row;
    const keys = Object.keys(all);
    if (keys.length > VIDEO_STATE_LIMIT) {
        for (const key of keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - VIDEO_STATE_LIMIT)) { delete all[key]; }
    }
    return all;
}

/**
 * @param {VideoStateSource} source
 * @returns {Promise<VideoState|null>}
 */
export async function readVideoState(source) {
    const scope = videoStateScope(source);
    if (!scope) { return null; }
    await videoStateWrites;
    return /** @type {VideoState|null} */ (await studyCall('videoStateRead', {mediaKey: source.mediaKey, scope}).catch(() => null));
}

/**
 * Merges a change for one video; the oldest videos are forgotten past the limit.
 * @param {VideoStateSource} source
 * @param {VideoStatePatch} patch
 */
export async function writeVideoState(source, patch) {
    const scope = videoStateScope(source);
    if (!scope || (typeof patch.selectedTrackKey === 'string' && patch.selectedTrackKey === patch.ifSelected)) { return; }
    // Send now while this frame still has the video's URL. A same-page read waits
    // for its own acknowledgements; the worker orders writes from *all* players.
    const sent = studyCall('videoStateUpdate', {mediaKey: source.mediaKey, scope, patch}).catch(() => {});
    videoStateWrites = Promise.all([videoStateWrites, sent]).then(() => {});
    await videoStateWrites;
}
