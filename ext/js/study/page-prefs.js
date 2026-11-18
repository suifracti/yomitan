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

export const PAGE_PREFS_KEY = 'studyPageTranslation';

/** @typedef {{hidden?: boolean, y?: number}} BallPosition */
/** @typedef {{mode:'bilingual'|'translation',sites:string[],auto:boolean,selection:'button'|'auto'|'off',hoverKey:string,selectionDisplay:'inline'|'card',ball:boolean,ballSites:Record<string,BallPosition>}} PagePrefs */
/** @typedef {Partial<Omit<PagePrefs, 'ballSites'>> & {alwaysSite?: {host: string, enabled: boolean}, ballSite?: BallPosition & {host: string}}} PagePrefsPatch */

/** @type {PagePrefs} */
export const DEFAULT_PAGE_PREFS = {mode: 'bilingual', sites: [], auto: false, selection: 'button', hoverKey: 'Alt', selectionDisplay: 'inline', ball: true, ballSites: {}};

/**
 * @param {import('study').Storage} [storage]
 * @returns {Promise<PagePrefs>}
 */
export async function readPagePrefs(storage = chrome.storage.local) {
    const prefs = /** @type {Partial<PagePrefs>} */ ((await storage.get(PAGE_PREFS_KEY))[PAGE_PREFS_KEY]);
    return {...DEFAULT_PAGE_PREFS, ...prefs};
}

/**
 * Merge this action with the latest settings inside StudyService's write queue.
 * @param {import('study').Storage} storage
 * @param {PagePrefsPatch} patch
 * @returns {Promise<void>}
 */
export async function storePagePatch(storage, {alwaysSite, ballSite, ...values}) {
    const next = {...await readPagePrefs(storage), ...values};
    if (alwaysSite) {
        const {host, enabled} = alwaysSite;
        next.sites = [...next.sites.filter((name) => name !== host), ...(enabled ? [host] : [])];
    }
    if (ballSite) {
        const {host, hidden, y} = ballSite;
        const state = {...next.ballSites[host]};
        if (typeof y === 'number' && Number.isFinite(y)) { state.y = y; }
        if (hidden === true) { state.hidden = true; }
        if (hidden === false) { delete state.hidden; }
        next.ballSites = {...next.ballSites, [host]: state};
    }
    await storage.set({[PAGE_PREFS_KEY]: next});
}

/**
 * @param {PagePrefsPatch} patch
 * @returns {Promise<void>}
 */
export async function writePagePrefs(patch) {
    await studyCall('pagePrefsUpdate', patch);
}
