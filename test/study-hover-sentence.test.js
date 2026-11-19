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
import {splitStudySentence} from '../ext/js/display/study-translation.js';

test('Alt and the study card keep titles, initials, numbers, and closing quotes in the right sentence', async () => {
    const first = 'Dr. Rivera and the U.S. survey group clearly recorded a total of 3,500 samples and an average of 12.5 units per sample during the long morning shift.';
    const second = '“The team saved all measurements for the next shift.”';
    const third = 'Several more measurements came from laboratories in the U.S.';
    const fourth = 'The results were published on the following Monday.';
    const original = `${first} ${second} ${third} ${fourth}`;
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: `<p>${original}</p>`, url: 'https://example.test/article'}});
    vi.stubGlobal('chrome', {runtime: {sendMessage: async () => ({ok: true, value: {}})}, storage: {local: {get: async () => ({})}}});
    const {PageTranslate} = await import('../ext/js/study/page-translate.js');
    const translate = vi.fn(async () => '我们一起学习！');
    const page = new PageTranslate({translate});
    try {
        const source = document.querySelector('p');
        document.caretRangeFromPoint = () => {
            const range = document.createRange();
            range.setStart(source.firstChild, first.indexOf('units') + 1);
            return range;
        };
        page.bindSelection();
        source.dispatchEvent(new MouseEvent('pointermove', {bubbles: true, clientX: 50, clientY: 50}));
        for (const type of ['keydown', 'keyup']) { document.dispatchEvent(new KeyboardEvent(type, {key: 'Alt'})); }
        await vi.waitFor(() => expect(translate).toHaveBeenCalledWith(first, expect.any(Object)));
        await vi.waitFor(() => expect(source.nextElementSibling.textContent).toContain('我们一起学习'));
        for (const type of ['keydown', 'keyup']) { document.dispatchEvent(new KeyboardEvent(type, {key: 'Alt'})); }
        expect(source.nextElementSibling).toBeNull();
        expect(source.textContent).toBe(original);
        expect(splitStudySentence(original)).toEqual([first, second, third, fourth]);
    } finally {
        page.stop();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
