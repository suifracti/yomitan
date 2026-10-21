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

test('active page translation follows new comments, revealed replies and reused text hosts until stopped', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<main><p id="comment"><i hidden></i><span>A first comment.</span></p><section hidden><p id="reply">A hidden reply.</p></section></main>', url: 'https://example.test/article'}});
    vi.stubGlobal('IntersectionObserver', class {
        /** @param {IntersectionObserverCallback} callback */
        constructor(callback) { /**
                                 *
                                 */
            this.callback = callback;
        }

        /** @param {Element} target */
        observe(target) {
            if (!target.closest('[hidden]')) {
                queueMicrotask(() => this.callback(/** @type {IntersectionObserverEntry[]} */ ([{target, isIntersecting: true}]), /** @type {IntersectionObserver} */ (this)));
            }
        }

        /** */
        unobserve() {}
        /** */
        disconnect() {}
    });
    vi.stubGlobal('chrome', {runtime: {sendMessage: async () => ({ok: true, value: {model: 'fixture', effort: 'low'}})}, storage: {local: {get: async () => ({studyTranslationPrefs: {engine: 'chrome'}})}}});
    const {PageTranslate} = await import('../ext/js/study/page-translate.js');
    const controller = new PageTranslate({translate: async (text) => '译：' + text});
    try {
        await controller.toggle();
        const comment = document.querySelector('#comment');
        await vi.waitFor(() => expect(comment.nextElementSibling.textContent).toBe('译：A first comment.'));
        comment.querySelector('span').textContent = 'An updated comment.';
        const later = document.createElement('p');
        later.textContent = 'A later comment.';
        document.querySelector('main').append(later);
        document.querySelector('section').hidden = false;
        await vi.waitFor(() => expect(comment.nextElementSibling.textContent).toBe('译：An updated comment.'));
        await vi.waitFor(() => expect(later.nextElementSibling.textContent).toBe('译：A later comment.'));
        await vi.waitFor(() => expect(document.querySelector('#reply').nextElementSibling.textContent).toBe('译：A hidden reply.'));
        controller.stop();
        const stopped = document.createElement('p');
        stopped.textContent = 'After stopping.';
        document.querySelector('main').append(stopped);
        await new Promise((resolve) => { setTimeout(resolve, 10); });
        expect(document.querySelector('.study-page-translation')).toBeNull();
    } finally {
        controller.stop();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
