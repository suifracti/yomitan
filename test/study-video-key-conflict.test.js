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
    try {
        const {WordMarks} = await import('../ext/js/study/word-marks.js');
        const marks = new WordMarks();
        marks._enabled = true;
        marks._words = {architecture: {s: 'learning'}};
        document.elementFromPoint = () => document.querySelector('span');
        const point = vi.spyOn(marks, '_pointWord');
        marks._bindHover();
        const event = new KeyboardEvent('keydown', {key: 'k', bubbles: true, cancelable: true});
        document.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(point).not.toHaveBeenCalled();
        expect(marks._words.architecture).toEqual({s: 'learning'});
    } finally {
        await env.teardown(global);
    }
});
