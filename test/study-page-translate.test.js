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

test('translates visible blocks and restores the exact original nodes in both modes', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<p id="source">Hello <strong>world</strong><button>Skip</button>.</p><nav>Navigation</nav>', url: 'https://example.test/article'}});
    /** @type {Element[]} */
    const observed = [];
    vi.stubGlobal('IntersectionObserver', class {
        /** @param {IntersectionObserverCallback} callback */
        constructor(callback) { /**
                                 *
                                 */
            this.callback = callback;
        }

        /** @param {Element} node */
        observe(node) { observed.push(node); }
        /** */
        unobserve() {}
        /** */
        disconnect() {}
    });
    vi.stubGlobal('chrome', {runtime: {sendMessage: async () => ({ok: true, value: {model: 'fixture', effort: 'low'}})}, storage: {local: {get: async () => ({studyTranslationPrefs: {engine: 'chrome'}}), set: async () => {}}, onChanged: {addListener() {}}}});
    const {PageTranslate} = await import('../ext/js/study/page-translate.js');
    const controller = new PageTranslate({translate: async () => '你好，世界。'});
    try {
        const original = document.querySelector('#source');
        const strong = original.querySelector('strong');
        await controller.toggle();
        expect(observed).toContain(original);
        expect(observed).not.toContain(document.querySelector('nav'));
        await controller.translateNode(original);
        expect(document.querySelector('.study-page-translation').textContent).toBe('你好，世界。');
        controller.prefs.mode = 'translation';
        controller.paint();
        expect(original.classList.contains('study-original-hidden')).toBe(true);
        expect(document.querySelector('.study-page-translation').dataset.original).toBe('Hello world .');
        const later = document.createElement('p');
        later.textContent = 'A later paragraph.';
        document.body.append(later);
        await vi.waitFor(() => expect(observed).toContain(later));
        controller.stop();
        expect(document.querySelector('#source')).toBe(original);
        expect(original.querySelector('strong')).toBe(strong);
        expect(original.textContent).toBe('Hello worldSkip.');
        expect(document.querySelector('.study-page-translation')).toBeNull();
    } finally {
        controller.stop();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
