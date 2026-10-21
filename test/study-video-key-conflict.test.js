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

test('K over video captions is left to the player and never changes word state', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<div id="movie_player"><span>architecture</span></div>'}});
    const words = {architecture: {s: 'learning'}};
    const send = vi.fn();
    vi.stubGlobal('CSS', {highlights: new Map()});
    vi.stubGlobal('Highlight', Set);
    vi.stubGlobal('chrome', {runtime: {sendMessage: send, onMessage: {addListener() {}}},
        storage: {
            local: {get: async () => ({studyWordMarks: {enabled: true, possible: false, encounters: false}, studyWordStatus: {words}})},
            onChanged: {addListener() {}},
        }});
    vi.useFakeTimers();
    try {
        const {WordMarks} = await import('../ext/js/study/word-marks.js');
        const marks = new WordMarks();
        await marks.start();
        document.elementFromPoint = () => document.querySelector('span');
        const point = vi.spyOn(marks, '_pointWord');
        const event = new KeyboardEvent('keydown', {key: 'k', bubbles: true, cancelable: true});
        document.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(point).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        expect(words.architecture).toEqual({s: 'learning'});
    } finally {
        vi.clearAllTimers();
        await vi.advanceTimersByTimeAsync(0);
        vi.useRealTimers();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
