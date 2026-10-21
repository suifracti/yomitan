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

test('Alt translates only the pointed sentence and toggles it off', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<p>First sentence. We learn together! Last sentence.</p>', url: 'https://example.test/article'}});
    vi.stubGlobal('chrome', {runtime: {sendMessage: async () => ({ok: true, value: {}})}, storage: {local: {get: async () => ({})}}});
    const {PageTranslate} = await import('../ext/js/study/page-translate.js');
    const translate = vi.fn(async () => '我们一起学习！');
    const page = new PageTranslate({translate});
    try {
        const source = document.querySelector('p');
        document.caretRangeFromPoint = () => {
            const range = document.createRange();
            range.setStart(source.firstChild, 20);
            return range;
        };
        page.bindSelection();
        source.dispatchEvent(new MouseEvent('pointermove', {bubbles: true, clientX: 50, clientY: 50}));
        for (const type of ['keydown', 'keyup']) { document.dispatchEvent(new KeyboardEvent(type, {key: 'Alt'})); }
        await vi.waitFor(() => expect(translate).toHaveBeenCalledWith('We learn together!'));
        await vi.waitFor(() => expect(source.nextElementSibling.textContent).toContain('我们一起学习'));
        for (const type of ['keydown', 'keyup']) { document.dispatchEvent(new KeyboardEvent(type, {key: 'Alt'})); }
        expect(source.nextElementSibling).toBeNull();
        expect(source.textContent).toBe('First sentence. We learn together! Last sentence.');
    } finally {
        page.stop();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
