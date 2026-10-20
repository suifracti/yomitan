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

import {expect, test, vi} from 'vitest';
import {builtinEnvironments} from 'vitest/environments';

test('keeps shadow pause actions visible, repeats with R outside inputs, and cancels or finishes the countdown', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<div id="movie_player"><video></video><div class="ytp-right-controls"></div></div><div id="secondary-inner"></div><input>', url: 'https://www.youtube.com/watch?v=abcdefghijk'}});
    const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');
    const {YoutubeOverlay} = await import('../ext/js/study/youtube-overlay.js');
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('chrome', {runtime: {getURL: (p) => `chrome-extension://test/${p}`}});
    vi.stubGlobal('fetch', async () => ({ok: true, text: async () => JSON.stringify({events: [0, 3000].map((t) => ({tStartMs: t, dDurationMs: 3000, segs: [{utf8: 'A sentence to repeat.'}]}))})}));
    const video = document.querySelector('video'); let paused = false;
    Object.defineProperty(video, 'paused', {get: () => paused});
    const play = vi.spyOn(video, 'play').mockImplementation(async () => { paused = false; video.dispatchEvent(new Event('play')); });
    vi.spyOn(video, 'pause').mockImplementation(() => { paused = true; });
    const reader = new YoutubeReader({prefs: {merge: false, shadow: true, shadowContinueSeconds: 3}});
    const overlay = new YoutubeOverlay(reader);
    vi.useFakeTimers();
    try {
        reader.rememberRequest('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en'); overlay.start(); reader.start();
        await vi.advanceTimersByTimeAsync(0);
        reader._shadowTick(); video.currentTime = 2.98; reader._shadowTick();
        const bar = document.querySelector('.o-shadow');
        expect(bar.textContent).toContain('已暂停跟读'); expect(bar.textContent).toContain('3 秒');
        document.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', {key: 'r', bubbles: true}));
        expect(play).not.toHaveBeenCalled();
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'r', bubbles: true}));
        expect(play).toHaveBeenCalledOnce(); expect(video.currentTime).toBe(0);
        reader._shadowTick(); video.currentTime = 2.98; reader._shadowTick();
        reader.session.acceptTranslation(reader.session.cues[0].id, '一句跟读用的句子。');
        const translation = [...bar.querySelectorAll('button')].find((b) => b.textContent === '看译文');
        expect(translation).toBeDefined(); translation.click(); await vi.advanceTimersByTimeAsync(0);
        expect(bar.textContent).toContain('一句跟读用的句子。');
        await vi.advanceTimersByTimeAsync(3100); expect(paused).toBe(true);
        [...bar.querySelectorAll('button')].find((b) => b.textContent === '空格 继续').click();
        video.currentTime = 3.1; reader._shadowTick(); video.currentTime = 5.98; reader._shadowTick();
        await vi.advanceTimersByTimeAsync(3000); expect(paused).toBe(false);
    } finally { reader._reset(); clearInterval(overlay._timer); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); await env.teardown(global); }
});
