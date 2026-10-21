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

test('dictionary reading opens all details and examples without extra-example folds', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<article><div class="entry-body"><section class="entry-body-section" data-section-type="definitions"><div class="definition-item"><details><summary>Grammar</summary>mortar (plural mortars)</details><ol data-sc-content="glosses"><li>A mixture.<details data-sc-content="details-entry-examples"><summary>Examples</summary><div data-sc-content="extra-info">First example.</div><div data-sc-content="extra-info" hidden>Second example.</div></details></li></ol><details><summary>Etymology</summary>From Latin.</details></div></section></div></article>'}});
    try {
        const {prepareStudyDictionary} = await import('../ext/js/display/study-dictionary.js');
        const entry = document.querySelector('article');
        const dispose = prepareStudyDictionary(entry, 'mortar');
        expect([...entry.querySelectorAll('details')].every((node) => node.open)).toBe(true);
        expect(entry.querySelector('[data-sc-content=extra-info][hidden]')).toBeNull();
        expect(entry.querySelector('.study-example-more')).toBeNull();
        expect(entry.textContent).toContain('Second example.');
        dispose();
    } finally {
        await env.teardown(global);
    }
});
