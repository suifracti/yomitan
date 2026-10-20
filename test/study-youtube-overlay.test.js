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

const html = '<!DOCTYPE html><html><head></head><body><div id="movie_player"><video></video><div class="ytp-caption-window-container"></div><div class="ytp-right-controls"><button class="ytp-subtitles-button" aria-pressed="true"></button></div></div><div id="secondary"><div id="secondary-inner"><div id="panels"></div></div></div></body></html>';
const environment = await builtinEnvironments.jsdom.setup(global, {jsdom: {html, url: 'https://www.youtube.com/watch?v=abcdefghijk'}});
afterAll(() => environment.teardown(global));
/** Layout is not measured in jsdom; the overlay only needs the observer API to exist. */
class FakeResizeObserver {
    /** */
    observe() {}
    /** */
    disconnect() {}
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver);

const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');
const {YoutubeOverlay} = await import('../ext/js/study/youtube-overlay.js');
const {youtubeStudyContext} = await import('../ext/js/study/youtube-study-context.js');

const timedText = JSON.stringify({events: [
    {tStartMs: 0, dDurationMs: 1500, segs: [{utf8: 'The brain can'}]},
    {tStartMs: 1500, dDurationMs: 1500, segs: [{utf8: 'change itself.'}]},
    {tStartMs: 3200, dDurationMs: 2000, segs: [{utf8: 'Keep going.'}]},
]});

test('one controller drives merged rows, in-video captions and the pinned sidebar together', async () => {
    vi.stubGlobal('fetch', async () => ({ok: true, status: 200, text: async () => timedText}));
    const reader = new YoutubeReader({prefs: {merge: true}});
    const overlay = new YoutubeOverlay(reader);
    overlay.start();
    reader.start();
    reader.rememberRequest('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&fmt=srv3');
    await vi.waitFor(() => expect(document.querySelector('#study-yt-reader')).not.toBe(null));
    expect(document.querySelector('.ytp-right-controls #study-yt-button')).not.toBe(null);

    // The sidebar stays first even when YouTube inserts its own panel above it.
    const host = /** @type {HTMLElement} */ (document.querySelector('#secondary-inner'));
    host.prepend(document.createElement('ytd-engagement-panel'));
    await vi.waitFor(() => expect(host.firstElementChild?.id).toBe('study-yt-reader'));

    reader.loadCaptions();
    await vi.waitFor(() => expect(document.querySelectorAll('#study-yt-reader .r-cue').length).toBe(2));
    const rows = [...document.querySelectorAll('#study-yt-reader .r-cue')];
    expect(rows[0].querySelector('.r-text')?.textContent).toBe('The brain can change itself.\n');
    const firstId = /** @type {string} */ (reader.session?.cues[0].id);
    expect(reader.members(firstId)).toHaveLength(2);
    expect(reader.session?.cues[0].endMs).toBe(3000);

    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    let current = 0;
    Object.defineProperty(video, 'currentTime', {get: () => current, set: (/** @type {number} */ v) => { current = v; }});
    current = 2;
    video.dispatchEvent(new Event('timeupdate'));
    const player = /** @type {HTMLElement} */ (document.querySelector('#movie_player'));
    const shown = () => [...document.querySelectorAll('#study-yt-overlay .o-line:not([hidden]) .o-text')].map((e) => e.textContent);
    expect(shown()).toEqual(['The brain can change itself.\n']);
    expect(player.classList.contains('study-captions-on')).toBe(true);

    // A word picked in the video reads the same sentence and marks it in both views.
    const textNode = /** @type {Text} */ (document.querySelector('#study-yt-overlay .o-line:not([hidden]) .o-text')?.firstChild);
    const range = document.createRange();
    range.setStart(textNode, 4);
    range.setEnd(textNode, 9);
    const context = youtubeStudyContext.read(range);
    expect(context?.sentence.text).toBe('The brain can change itself.');
    expect(context?.mediaRange).toEqual({start: 0, end: 3});
    expect(rows[0].classList.contains('is-lookup')).toBe(true);
    expect(document.querySelector('#study-yt-overlay .o-line:not([hidden])')?.classList.contains('is-lookup')).toBe(true);

    // Looping from the video shows on the sidebar row too.
    /** @type {HTMLButtonElement} */ (document.querySelector('#study-yt-overlay .o-line:not([hidden]) [data-loop]')).click();
    expect(rows[0].classList.contains('is-looping')).toBe(true);
    reader.toggleLoop(firstId);
    expect(rows[0].classList.contains('is-looping')).toBe(false);

    // While the pointer rests on the caption it does not change under the learner.
    const layer = /** @type {HTMLElement} */ (document.querySelector('#study-yt-overlay'));
    layer.dispatchEvent(new Event('pointerenter'));
    current = 4;
    video.dispatchEvent(new Event('timeupdate'));
    expect(shown()).toEqual(['The brain can change itself.\n']);
    layer.dispatchEvent(new Event('pointerleave'));
    expect(shown()).toEqual(['Keep going.\n']);

    // Preferences change every view at once.
    reader.updatePrefs({bilingual: false, blur: true});
    expect(layer.classList.contains('o-mono')).toBe(true);
    expect(document.querySelector('#study-yt-reader')?.classList.contains('r-mono')).toBe(true);
    expect(document.querySelector('#study-yt-reader')?.classList.contains('r-blur')).toBe(true);
    reader.updatePrefs({overlay: false});
    expect(player.classList.contains('study-captions-on')).toBe(false);
    expect(layer.hidden).toBe(true);

    // Downloads keep the raw track for VTT and the reading rows for JSON.
    /** @type {string[]} */
    const saved = [];
    vi.stubGlobal('URL', Object.assign(URL, {createObjectURL: () => 'blob:x', revokeObjectURL: () => {}}));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record() { saved.push(/** @type {HTMLAnchorElement} */ (this).download); });
    reader.download('vtt');
    reader.download('json');
    expect(saved).toEqual(['abcdefghijk-en.vtt', 'abcdefghijk-en.json']);
    click.mockRestore();

    // Switching back to raw fragments rebuilds rows from the original track.
    reader.updatePrefs({merge: false});
    expect(document.querySelectorAll('#study-yt-reader .r-cue').length).toBe(3);
    vi.unstubAllGlobals();
});
