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

test('shows the four services in every menu and keeps a saved Microsoft choice', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<select></select>'}});
    try {
        const {fillEngineSelect} = await import('../ext/js/study/translation-engines.js');
        const select = /** @type {HTMLSelectElement} */ (document.querySelector('select'));
        fillEngineSelect(select, 'google');
        expect([...select.options].map(({value}) => value)).toEqual(['google', 'chrome', 'apple', 'model']);
        expect(select.value).toBe('google');
        expect(select.options[0].textContent).toContain('需要联网');
        expect(select.options[1].textContent).toContain('下载语言包');
        fillEngineSelect(select, 'microsoft');
        expect(select.value).toBe('microsoft');
        expect(select.options[4].textContent).toContain('Microsoft');
    } finally {
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
