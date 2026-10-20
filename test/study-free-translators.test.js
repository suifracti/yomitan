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

import {afterEach, expect, test, vi} from 'vitest';
import {parseJson} from '../ext/js/core/json.js';
import {googleTranslate, microsoftTranslate, plainFromHtml} from '../ext/js/study/free-translators.js';
import {groupsFromIds, normalizeCues} from '../ext/js/study/subtitle-session.js';
import {normalizeSubtitlePrefs} from '../ext/js/study/subtitle-prefs.js';
import {CACHE_KEY, SETTINGS_KEY} from '../ext/js/study/study-data.js';
import {StudyService} from '../ext/js/study/study-service.js';

afterEach(() => { vi.unstubAllGlobals(); });

/**
 * @param {unknown} body
 * @param {number} [status]
 * @returns {Response}
 */
const reply = (body, status = 200) => /** @type {Response} */ (/** @type {unknown} */ ({ok: status < 400, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body))}));

test('Google batches rows, escapes markup and returns plain text in order', async () => {
    /** @type {unknown[]} */
    const bodies = [];
    const fetchImpl = /** @type {typeof fetch} */ (/** @type {unknown} */ (async (/** @type {string} */ _url, /** @type {RequestInit} */ init) => {
        bodies.push(parseJson(/** @type {string} */ (init.body)));
        return reply([['<b>大脑</b>可以改变 &amp; 成长。', '继续前进。']]);
    }));
    expect(await googleTranslate(['The brain <can> change & grow.', 'Keep going.'], {fetchImpl})).toEqual(['大脑可以改变 & 成长。', '继续前进。']);
    expect(bodies).toEqual([[[['The brain &lt;can&gt; change &amp; grow.', 'Keep going.'], 'en', 'zh-CN'], 'te_lib']]);
    await expect(googleTranslate(['x'], {fetchImpl: /** @type {typeof fetch} */ (/** @type {unknown} */ (async () => reply({}, 429)))})).rejects.toThrow('限流');
    await expect(googleTranslate(['x', 'y'], {fetchImpl: /** @type {typeof fetch} */ (/** @type {unknown} */ (async () => reply([['只有一句']])))})).rejects.toThrow('逐句');
});

test('Microsoft fetches a temporary token once and drops it after a 401', async () => {
    /** @type {string[]} */
    const urls = [];
    let status = 200;
    const fetchImpl = /** @type {typeof fetch} */ (/** @type {unknown} */ (async (/** @type {string} */ url) => {
        urls.push(url.split('?')[0]);
        if (url.includes('/auth')) { return reply('token-1'); }
        return status === 200 ? reply([{translations: [{text: '继续'}]}]) : reply({}, status);
    }));
    expect(await microsoftTranslate(['Keep going.'], {fetchImpl})).toEqual(['继续']);
    expect(await microsoftTranslate(['Keep going.'], {fetchImpl})).toEqual(['继续']);
    expect(urls.filter((url) => url.includes('/auth'))).toHaveLength(1);
    status = 401;
    await expect(microsoftTranslate(['Keep going.'], {fetchImpl})).rejects.toThrow('HTTP 401');
    status = 200;
    await microsoftTranslate(['Keep going.'], {fetchImpl});
    expect(urls.filter((url) => url.includes('/auth'))).toHaveLength(2);
});

test('plain text keeps entities readable and drops tags', () => {
    expect(plainFromHtml('<i>It&#39;s</i> &quot;ok&quot;')).toBe('It\'s "ok"');
});

test('model groups must cover every cue in order; text and times come from the cues', () => {
    const cues = normalizeCues([{id: 'a', startMs: 0, endMs: 1000, text: 'The brain'}, {id: 'b', startMs: 1000, endMs: 2500, text: 'can change.'}, {id: 'c', startMs: 3000, endMs: 4000, text: 'Go.'}]);
    expect(groupsFromIds(cues, [['a', 'b'], ['c']])).toEqual([{cueIds: ['a', 'b'], text: 'The brain can change.', startMs: 0, endMs: 2500}, {cueIds: ['c'], text: 'Go.', startMs: 3000, endMs: 4000}]);
    expect(groupsFromIds(cues, [['b', 'a'], ['c']])).toBe(null);
    expect(groupsFromIds(cues, [['a', 'b']])).toBe(null);
    expect(groupsFromIds(cues, [['a'], [], ['b', 'c']])).toBe(null);
});

test('preferences keep only known values', () => {
    expect(normalizeSubtitlePrefs({engine: 'deepl', blur: 'yes', aheadSeconds: 9999, overlay: false})).toMatchObject({engine: 'chrome', blur: false, aheadSeconds: 300, overlay: false});
});

/**
 * @param {string} engine
 * @returns {{service: StudyService, native: unknown[], data: Record<string, unknown>}}
 */
function serviceWith(engine) {
    /** @type {Record<string, unknown>} */
    const data = {[SETTINGS_KEY]: {model: 'fixture', effort: 'low', cacheEnabled: true}, studySubtitlePrefs: {engine}};
    /** @type {unknown[]} */
    const native = [];
    const service = new StudyService({get: async (key) => ({[key]: data[key]}), set: async (values) => { Object.assign(data, values); }}, (payload) => {
        native.push(payload);
        const p = /** @type {{items: {id: string}[]}} */ (payload);
        return {cancel() {}, promise: Promise.resolve({ok: true, result: {items: p.items.map((item) => ({id: item.id, translation: `本机 ${item.id}`}))}})};
    });
    return {service, native, data};
}

const request = (/** @type {string} */ requestId) => ({requestId, items: [{id: 'r1', text: 'Keep going.'}], language: 'en-US', config: {model: 'fixture', effort: 'low'}});

test('the background picks the stored service, not one named by the page', async () => {
    const apple = serviceWith('apple');
    const answer = /** @type {{engine: string, items: {translation: string}[]}} */ (await apple.service.handle('subtitleTranslate', request('a1')));
    expect(answer.engine).toBe('apple');
    expect(apple.native).toEqual([{action: 'appleTranslate', language: 'en', items: [{id: 'r1', text: 'Keep going.'}]}]);
    await expect(apple.service.handle('subtitleTranslate', {...request('a2'), engine: 'model'})).rejects.toThrow('参数无效');

    const google = serviceWith('google');
    vi.stubGlobal('fetch', async () => reply([['继续前进。']]));
    const web = /** @type {{items: {translation: string}[]}} */ (await google.service.handle('subtitleTranslate', request('g1')));
    expect(web.items[0].translation).toBe('继续前进。');
    expect(google.native).toEqual([]);

    // Each service keeps its own cache entries.
    const cache = /** @type {{key: string}[]} */ (google.data[CACHE_KEY]);
    expect(cache.some((row) => row.key.startsWith('subtitle:google:'))).toBe(true);

    const chrome = serviceWith('chrome');
    await expect(chrome.service.handle('subtitleTranslate', request('c1'))).rejects.toThrow('页面里运行');
});

test('segmentation answers that skip or reorder rows are refused', async () => {
    const {service} = serviceWith('model');
    /** @type {unknown} */
    let groups = [['r1', 'r2'], ['r3']];
    // @ts-expect-error - test replaces the native bridge
    service.native = () => ({cancel() {}, promise: Promise.resolve({ok: true, result: {groups}})});
    const items = [{id: 'r1', text: 'The brain'}, {id: 'r2', text: 'can change.'}, {id: 'r3', text: 'Go.'}];
    expect(await service.handle('subtitleSegment', {requestId: 's1', items, config: {model: 'fixture', effort: 'low'}})).toEqual({groups});
    groups = [['r2', 'r1'], ['r3']];
    await expect(service.handle('subtitleSegment', {requestId: 's2', items, config: {model: 'fixture', effort: 'low'}})).rejects.toThrow('逐行覆盖');
});
