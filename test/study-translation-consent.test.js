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

test('model approval estimates only visible prose and remembers this website for the session', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<p id="visible">A short visible sentence.</p><p id="below">Hidden below the viewport.</p>', url: 'https://example.test/article'}});
    let approved = false;
    const send = vi.fn(async (/** @type {{studyAction:string,data?:{approve?:boolean}}} */ m) => {
        if (m.data?.approve) { approved = true; }
        return {ok: true, value: m.studyAction === 'pageTranslationConsent' ? approved : {model: 'fixture', effort: 'low'}};
    });
    vi.stubGlobal('chrome', {runtime: {sendMessage: send}, storage: {local: {get: async () => ({studyTranslationPrefs: {engine: 'model'}})}}});
    try {
        Element.prototype.getBoundingClientRect = function bounds() {
            return /** @type {DOMRect} */ ({top: this.id === 'visible' ? 10 : 5000, bottom: this.id === 'visible' ? 50 : 5100, left: 10, right: 400});
        };
        const {PageTranslate} = await import('../ext/js/study/page-translate.js');
        const controller = new PageTranslate();
        const request = controller.approve();
        await vi.waitFor(() => expect(document.querySelector('.study-translation-confirm')).not.toBeNull());
        expect(document.querySelector('.study-translation-confirm').textContent).toContain('9 Token');
        document.querySelector('.study-translation-confirm button').click();
        expect(await request).toBe(true);
        const second = new PageTranslate();
        expect(await second.approve()).toBe(true);
        expect(document.querySelector('.study-translation-confirm')).toBeNull();
    } finally {
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
