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

import {afterAll, expect, test, vi} from 'vitest';
import {builtinEnvironments} from 'vitest/environments';
import {TextSourceGenerator} from '../ext/js/dom/text-source-generator.js';
import {TextSourceRange} from '../ext/js/dom/text-source-range.js';

const html = '<!DOCTYPE html><html><head></head><body><div id="movie_player"><video></video><button class="ytp-subtitles-button" aria-pressed="true"></button></div><div id="secondary"><div id="secondary-inner"></div></div></body></html>';
const environment = await builtinEnvironments.jsdom.setup(global, {jsdom: {html, url: 'https://www.youtube.com/watch?v=abcdefghijk'}});
afterAll(() => environment.teardown(global));

const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');

const timedText = JSON.stringify({events: [
    {tStartMs: 0, dDurationMs: 1000, segs: [{utf8: 'Intro'}]},
    {tStartMs: 1000, dDurationMs: 2000, segs: [{utf8: 'The brain can '}, {utf8: 'change'}]},
    {tStartMs: 3000, dDurationMs: 2000, aAppend: 1, segs: [{utf8: '\n'}]},
    {tStartMs: 3000, dDurationMs: 2000, segs: [{utf8: 'Keep\ngoing'}]},
]});

test('loads the player caption request read-only and keeps sentences per caption', async () => {
    /** @type {string[]} */
    const fetched = [];
    vi.stubGlobal('fetch', async (/** @type {string} */ url) => {
        fetched.push(url);
        return {ok: true, status: 200, text: async () => timedText};
    });
    const reader = new YoutubeReader({prefs: {merge: false}});
    reader.start();
    expect(fetched).toEqual([]); // Nothing is requested before the user clicks.
    reader.rememberRequest('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&kind=asr&tlang=zh-Hans&fmt=srv3&pot=x');
    reader.rememberRequest('https://www.youtube.com/api/timedtext?v=ZZZZZZZZZZZ&lang=en');
    await vi.waitFor(() => expect(document.querySelector('#study-yt-reader')).not.toBe(null));
    const load = /** @type {HTMLButtonElement} */ (document.querySelector('#study-yt-reader .r-head button:last-child'));
    load.click();
    await vi.waitFor(() => expect(document.querySelectorAll('#study-yt-reader .r-cue').length).toBe(3));

    const url = new URL(fetched[0]);
    expect(url.searchParams.get('v')).toBe('abcdefghijk');
    expect(url.searchParams.get('fmt')).toBe('json3');
    expect(url.searchParams.has('tlang')).toBe(false);
    expect(url.searchParams.get('pot')).toBe('x');

    const rows = [...document.querySelectorAll('#study-yt-reader .r-cue')];
    expect(rows.map((r) => /** @type {HTMLElement} */ (r.querySelector('.r-time')).dataset.time)).toEqual(['0:00', '0:01', '0:03']);
    expect(rows.map((r) => r.querySelector('.r-text')?.textContent)).toEqual(['Intro\n', 'The brain can change\n', 'Keep going\n']);
    expect(document.querySelector('[data-asb-study-cue]')).toBe(null);
    expect(document.querySelector('#study-yt-reader .r-status')?.textContent).toContain('en 自动字幕 · 3 句');

    // Timestamp text stays out of the DOM text, and the newline ends the sentence at this caption.
    const textNode = /** @type {Text} */ (rows[1].querySelector('.r-text')?.firstChild);
    const range = document.createRange();
    range.setStart(textNode, 4);
    range.setEnd(textNode, 9);
    const sentence = new TextSourceGenerator().extractSentence(TextSourceRange.create(range), false, 200, true, new Map([['.', [false, true]]]), new Map(), new Map());
    expect(sentence.text.trim()).toBe('The brain can change');

    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    let current = 0;
    Object.defineProperty(video, 'currentTime', {get: () => current, set: (/** @type {number} */ v) => { current = v; }});
    /** @type {HTMLButtonElement} */ (rows[1].querySelector('.r-time')).click();
    expect(current).toBe(1);
    current = 3.5;
    video.dispatchEvent(new Event('timeupdate'));
    expect(rows.map((r) => r.classList.contains('is-current'))).toEqual([false, false, true]);

    // Row tools live outside the sentence node; looping replays one caption until the learner leaves it.
    expect(rows[1].querySelector('.r-text .r-tools')).toBe(null);
    const loop = /** @type {HTMLButtonElement} */ (rows[1].querySelector('.r-tools .r-loop'));
    loop.click();
    expect(current).toBe(1);
    expect(loop.getAttribute('aria-pressed')).toBe('true');
    expect(rows[1].classList.contains('is-looping')).toBe(true);
    current = 3.1;
    video.dispatchEvent(new Event('timeupdate'));
    expect(current).toBe(1);
    current = 10;
    video.dispatchEvent(new Event('timeupdate'));
    expect(current).toBe(10);
    expect(loop.getAttribute('aria-pressed')).toBe('false');
    expect(rows[1].classList.contains('is-looping')).toBe(false);
    vi.unstubAllGlobals();
});

test('explicit batch translation stays on its original rows and reaches the ordinary word-card context', async () => {
    const calls = [];
    vi.stubGlobal('fetch', async () => ({ok: true, status: 200, text: async () => timedText}));
    const reader = new YoutubeReader({prefs: {merge: false},
        call: async (action, data) => {
            calls.push(action);
            if (action === 'subtitleSettings') {
                return {model: 'fixture', effort: 'low', cacheEnabled: true};
            }
            if (action === 'subtitleTranslate') {
                const {items} = /** @type {{items: {id: string}[]}} */ (data);
                return {items: items.map((r) => ({id: r.id, translation: '译文 ' + r.id}))};
            }
            return true;
        }});
    reader.start();
    reader.rememberRequest('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en');
    await vi.waitFor(() => expect(document.querySelector('#study-yt-reader .r-head button:last-child')).not.toBe(null));
    document.querySelector('#study-yt-reader .r-head button:last-child').click();
    await vi.waitFor(() => expect(document.querySelectorAll('#study-yt-reader .r-cue')).toHaveLength(3));
    expect(calls).toEqual([]);
    document.querySelector('video').currentTime = 0;
    document.querySelector('#study-yt-reader .r-translate').click();
    await vi.waitFor(() => expect([...document.querySelectorAll('.r-translation')].filter((r) => r.textContent.startsWith('译文'))).toHaveLength(3));
    const {youtubeStudyContext} = await import('../ext/js/study/youtube-study-context.js');
    const node = document.querySelectorAll('#study-yt-reader .r-text')[1].firstChild;
    const range = document.createRange();
    range.setStart(node, 4);
    range.setEnd(node, 9);
    const source = youtubeStudyContext.read(range);
    expect(source.videoTime).toBe(1);
    expect(source.translation).toBe('译文 1');
    expect(source.url).toContain('t=1s');
    expect(source.sentence.text).toBe('The brain can change');
    expect(calls).toEqual(['subtitleSettings', 'subtitleTranslate']);
    expect(document.querySelector('[data-asb-study-cue]')).toBe(null);
    vi.unstubAllGlobals();
});

for (const mode of ['language', 'clear']) {
    test(`reader respects the service cache after ${mode === 'language' ? 'a subtitle language change' : 'clearing translations'}`, async () => {
        const {StudyService} = await import('../ext/js/study/study-service.js');
        const {SETTINGS_KEY} = await import('../ext/js/study/study-data.js');
        /** @type {Record<string, unknown>} */
        const data = {[SETTINGS_KEY]: {model: 'fixture', effort: 'low', cacheEnabled: true}};
        let nativeCalls = 0;
        const service = new StudyService({get: async (key) => ({[key]: data[key]}), set: async (values) => { Object.assign(data, values); }}, (payload) => {
            const p = /** @type {{language: string, items: {id: string}[]}} */ (payload);
            ++nativeCalls;
            return {cancel() {}, promise: Promise.resolve({ok: true, result: {items: p.items.map((item) => ({id: item.id, translation: p.language === 'fr' ? '面包' : '疼痛'}))}})};
        });
        vi.stubGlobal('fetch', async () => ({ok: true, status: 200, text: async () => JSON.stringify({events: [{tStartMs: 0, dDurationMs: 1500, segs: [{utf8: 'Pain'}]}]})}));
        const reader = new YoutubeReader({prefs: {merge: false}, call: service.handle.bind(service)});
        reader.start();
        /**
         * @param {string} language
         * @returns {Promise<string>}
         */
        const translate = async (language) => {
            reader.rememberRequest(`https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=${language}`);
            const load = /** @type {HTMLButtonElement} */ (document.querySelector('#study-yt-reader .r-head button:last-child'));
            load.click();
            await vi.waitFor(() => expect(load.disabled).toBe(false));
            const button = /** @type {HTMLButtonElement} */ (document.querySelector('#study-yt-reader .r-translate'));
            button.click();
            await vi.waitFor(() => expect(button.disabled).toBe(false));
            return document.querySelector('.r-translation')?.textContent || '';
        };
        try {
            expect(await translate(mode === 'language' ? 'fr' : 'en')).toBe(mode === 'language' ? '面包' : '疼痛');
            if (mode === 'clear') { await service.handle('clearCache', {}); }
            expect(await translate('en')).toBe('疼痛');
            expect(nativeCalls).toBe(2);
        } finally { vi.unstubAllGlobals(); }
    });
}

for (const change of ['navigation', 'player replacement']) {
    test(`caption reload does not click an obsolete player after ${change}`, async () => {
        vi.useFakeTimers();
        const reader = new YoutubeReader({prefs: {merge: false}});
        const cc = /** @type {HTMLButtonElement} */ (document.querySelector('#movie_player .ytp-subtitles-button'));
        cc.setAttribute('aria-pressed', 'true');
        const click = vi.spyOn(cc, 'click');
        try {
            // eslint-disable-next-line no-underscore-dangle -- Exercise the in-flight caption lookup without mounting another reader.
            const pending = reader._findCaptionUrl('abcdefghijk', reader._generation);
            expect(click).toHaveBeenCalledTimes(1);
            if (change === 'navigation') {
                // eslint-disable-next-line no-underscore-dangle -- Navigation invalidates the generation via the existing reset.
                reader._reset();
            } else {
                cc.replaceWith(cc.cloneNode(true));
            }
            await vi.advanceTimersByTimeAsync(11000);
            expect(await pending).toBe(null);
            expect(click).toHaveBeenCalledTimes(1);
        } finally {
            click.mockRestore();
            vi.useRealTimers();
        }
    });
}

test('caption reload still reopens CC and accepts the current player request', async () => {
    vi.useFakeTimers();
    const reader = new YoutubeReader({prefs: {merge: false}});
    const cc = /** @type {HTMLButtonElement} */ (document.querySelector('#movie_player .ytp-subtitles-button'));
    cc.setAttribute('aria-pressed', 'true');
    const click = vi.spyOn(cc, 'click');
    try {
        // eslint-disable-next-line no-underscore-dangle -- Cover the normal branch of the same in-flight caption lookup.
        const pending = reader._findCaptionUrl('abcdefghijk', reader._generation);
        reader.rememberRequest('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en');
        await vi.advanceTimersByTimeAsync(550);
        expect((await pending)?.searchParams.get('lang')).toBe('en');
        expect(click).toHaveBeenCalledTimes(2);
    } finally {
        click.mockRestore();
        vi.useRealTimers();
    }
});

for (const stage of ['response', 'body', 'navigation']) {
    test(`stops a stalled subtitle fetch during ${stage} and releases the load button`, async () => {
        vi.useFakeTimers();
        /** @type {AbortSignal|null|undefined} */
        let signal;
        const stalled = () => new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once: true});
        });
        vi.stubGlobal('fetch', vi.fn(async (_url, /** @type {RequestInit|undefined} */ options) => {
            signal = options?.signal;
            if (stage !== 'body') { return await stalled(); }
            return {ok: true, status: 200, text: stalled};
        }));
        const reader = new YoutubeReader({prefs: {merge: false}});
        reader.start();
        reader.rememberRequest('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en');
        const load = /** @type {HTMLButtonElement} */ (document.querySelector('#study-yt-reader .r-head button:last-child'));
        try {
            load.click();
            await vi.advanceTimersByTimeAsync(0);
            expect(load.disabled).toBe(true);
            if (stage === 'navigation') {
                // eslint-disable-next-line no-underscore-dangle -- Simulate navigation while the fetch is pending.
                reader._reset();
                await vi.advanceTimersByTimeAsync(0);
            } else {
                await vi.advanceTimersByTimeAsync(15000);
            }
            expect(signal?.aborted).toBe(true);
            expect(load.disabled).toBe(false);
            if (stage !== 'navigation') {
                expect(document.querySelector('#study-yt-reader .r-status')?.textContent).toContain('超时');
            }
            if (stage === 'response') {
                vi.stubGlobal('fetch', async () => ({ok: true, status: 200, text: async () => timedText}));
                load.click();
                await vi.advanceTimersByTimeAsync(0);
                expect(document.querySelectorAll('#study-yt-reader .r-cue')).toHaveLength(3);
                expect(load.disabled).toBe(false);
            }
        } finally {
            // eslint-disable-next-line no-underscore-dangle -- Clean up this reader's pending load even if the assertion fails.
            reader._reset();
            vi.useRealTimers();
            vi.unstubAllGlobals();
        }
    });
}
