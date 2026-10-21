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

import {expect, test} from 'vitest';
import {builtinEnvironments} from 'vitest/environments';

test('only explicitly mounted study controls are enhanced, without mutation feedback', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<select id="website"><option>Website</option></select><input id="website-check" type="checkbox"><section data-study-ui><select><option value="a">A</option><option value="b">B</option></select><label><input type="checkbox"> Study</label></section>'}});
    try {
        const {enhanceStudyUi} = await import('../ext/js/study/study-ui.js');
        expect(document.querySelector('.study-ui-select')).toBeNull();
        const panel = document.querySelector('section');
        enhanceStudyUi(panel);
        enhanceStudyUi(panel);
        const select = panel.querySelector('select');
        select.value = 'b';
        select.dispatchEvent(new Event('study-ui-sync'));
        panel.querySelector('.study-ui-switch button').click();
        await new Promise((resolve) => { setTimeout(resolve, 10); });
        expect(panel.querySelectorAll('.study-ui-select')).toHaveLength(1);
        expect(panel.querySelector('.su-value').textContent).toBe('B ›');
        expect(panel.querySelector('input').checked).toBe(true);
        expect(document.querySelector('#website').parentElement).toBe(document.body);
        expect(document.querySelector('#website-check').parentElement).toBe(document.body);
    } finally {
        await env.teardown(global);
    }
});
