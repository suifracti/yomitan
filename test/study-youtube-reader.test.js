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
    const reader = new YoutubeReader();
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
    vi.unstubAllGlobals();
});
