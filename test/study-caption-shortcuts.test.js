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

test('A S D navigate captions and slow replay restores the original playback rate', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<div id="movie_player"><video></video><div class="ytp-right-controls"></div></div><div id="secondary-inner"></div>', url: 'https://www.youtube.com/watch?v=abcdefghijk'}});
    vi.stubGlobal('ResizeObserver', class {
        /** */
        observe() {}
        /** */
        disconnect() {}
    });
    vi.stubGlobal('chrome', {runtime: {getURL: (path) => '/' + path}});
    vi.useFakeTimers();
    const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');
    const {YoutubeOverlay} = await import('../ext/js/study/youtube-overlay.js');
    const reader = new YoutubeReader({prefs: {merge: false}, call: async () => ({items: []})});
    const overlay = new YoutubeOverlay(reader);
    try {
        const video = document.querySelector('video');
        video.play = vi.fn(async () => {});
        const pause = vi.fn();
        video.pause = pause;
        reader.start();
        reader.importText('1\n00:00:00,000 --> 00:00:02,000\nFirst sentence.\n\n2\n00:00:03,000 --> 00:00:05,000\nSecond sentence.\n\n3\n00:00:06,000 --> 00:00:08,000\nThird sentence.', 'fixture.srt');
        overlay.start();
        video.currentTime = 3.5;
        video.playbackRate = 1.25;
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'd', bubbles: true}));
        expect(video.currentTime).toBe(6);
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'a', bubbles: true}));
        expect(video.currentTime).toBe(3);
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'S', shiftKey: true, bubbles: true}));
        expect(video.playbackRate).toBe(0.75);
        video.currentTime = 5.1;
        video.dispatchEvent(new Event('timeupdate'));
        expect(video.playbackRate).toBe(1.25);
        expect(pause).toHaveBeenCalledOnce();
    } finally {
        vi.clearAllTimers();
        await vi.advanceTimersByTimeAsync(0);
        vi.useRealTimers();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
