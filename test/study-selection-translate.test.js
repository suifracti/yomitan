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

test('selection translation saves a sentence only on click, while Alt toggles the same paragraph renderer', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<p id="source">We learn from real sentences.</p>', url: 'https://example.test/article'}});
    const send = vi.fn(async () => ({ok: true, value: {model: 'fixture', effort: 'low'}}));
    vi.stubGlobal('chrome', {runtime: {sendMessage: send}, storage: {local: {get: async () => ({studyTranslationPrefs: {engine: 'chrome'}})}}});
    const {PageTranslate} = await import('../ext/js/study/page-translate.js');
    const controller = new PageTranslate({translate: async () => '我们从真实的句子学习。'});
    try {
        Range.prototype.getBoundingClientRect = () => ({left: 10, bottom: 20});
        const original = document.querySelector('#source');
        const range = document.createRange();
        range.selectNodeContents(original);
        window.getSelection().addRange(range);
        controller.showSelection();
        expect(controller.selectionUi.textContent).toBe('译');
        controller.selectionUi.querySelector('button').click();
        await vi.waitFor(() => expect(controller.selectionUi.textContent).toContain('记住这句'));
        expect(send.mock.calls.some(([m]) => m.studyAction === 'pageSentenceSave')).toBe(false);
        [...controller.selectionUi.querySelectorAll('button')].find((b) => b.textContent === '记住这句').click();
        await vi.waitFor(() => expect(send.mock.calls.some(([m]) => m.studyAction === 'pageSentenceSave')).toBe(true));
        expect(original.textContent).toBe('We learn from real sentences.');
        window.getSelection().removeAllRanges();
        controller.showSelection();
        controller.bindSelection();
        original.dispatchEvent(new MouseEvent('pointerover', {bubbles: true}));
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Alt'}));
        document.dispatchEvent(new KeyboardEvent('keyup', {key: 'Alt'}));
        await vi.waitFor(() => expect(original.nextElementSibling?.classList.contains('study-page-translation')).toBe(true));
    } finally {
        controller.stop();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
