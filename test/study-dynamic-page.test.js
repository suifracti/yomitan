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

test('fast scrolling skips queued offscreen paragraphs before starting the new viewport', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {
        html: '<main><p>First paragraph.</p><p>Second paragraph.</p><p>Third paragraph.</p><p>Skipped paragraph.</p><p>Newly visible paragraph.</p></main>',
        url: 'https://example.test/article',
    }});
    /** @type {(entries: {target: Element, isIntersecting: boolean}[]) => void} */
    let deliver = () => {};
    vi.stubGlobal('IntersectionObserver', class {
        /** @param {(entries: {target: Element, isIntersecting: boolean}[]) => void} callback */
        constructor(callback) { deliver = callback; }
        /** */
        observe() {}
        /** */
        unobserve() {}
        /** */
        disconnect() {}
    });
    vi.stubGlobal('chrome', {runtime: {sendMessage: async () => ({ok: true, value: {model: 'fixture', effort: 'low'}})}, storage: {local: {get: async () => ({studyTranslationPrefs: {engine: 'google'}})}}});
    const {PageTranslate} = await import('../ext/js/study/page-translate.js');
    /** @type {(() => void)[]} */
    const finish = [];
    const translate = vi.fn((/** @type {string} */ text) => /** @type {Promise<string>} */ (new Promise((resolve) => {
        finish.push(() => resolve('译：' + text));
    })));
    const controller = new PageTranslate({translate});
    try {
        await controller.toggle();
        const paragraphs = [...document.querySelectorAll('p')];
        deliver(paragraphs.slice(0, 4).map((target) => ({target, isIntersecting: true})));
        await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(3));
        deliver([{target: paragraphs[3], isIntersecting: false}, {target: paragraphs[4], isIntersecting: true}]);
        finish.shift()?.();
        await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(4));
        expect(translate.mock.calls.map(([text]) => text)).toEqual([
            'First paragraph.', 'Second paragraph.', 'Third paragraph.', 'Newly visible paragraph.',
        ]);
        deliver([{target: paragraphs[3], isIntersecting: true}]);
        controller.stop();
        for (const settle of finish) { settle(); }
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(translate).toHaveBeenCalledTimes(4);
        expect(document.querySelector('.study-page-translation')).toBeNull();
    } finally {
        controller.stop();
        for (const settle of finish) { settle(); }
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});

test('restarting page translation with another service does not wait for cancelled requests', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {
        html: '<main><p>First paragraph.</p><p>Second paragraph.</p><p>Third paragraph.</p><p>Fourth paragraph.</p></main>',
        url: 'https://example.test/article',
    }});
    /** @type {(entries: {target: Element, isIntersecting: boolean}[]) => void} */
    let deliver = () => {};
    vi.stubGlobal('IntersectionObserver', class {
        /** @param {(entries: {target: Element, isIntersecting: boolean}[]) => void} callback */
        constructor(callback) { deliver = callback; }
        /** */
        observe() {}
        /** */
        unobserve() {}
        /** */
        disconnect() {}
    });
    let engine = 'chrome';
    vi.stubGlobal('chrome', {
        runtime: {sendMessage: async () => ({ok: true, value: {model: 'fixture', effort: 'low'}})},
        storage: {local: {get: async () => ({studyTranslationPrefs: {engine}})}},
    });
    const {PageTranslate} = await import('../ext/js/study/page-translate.js');
    /** @type {(() => void)[]} */
    const finish = [];
    /** @type {typeof import('../ext/js/study/page-translate.js').translateText} */
    const translateText = (text, options) => new Promise((resolve) => {
        finish.push(() => resolve(options?.engine + '：' + text));
    });
    const translate = vi.fn(translateText);
    const controller = new PageTranslate({translate});
    const visible = [...document.querySelectorAll('p')].map((target) => ({target, isIntersecting: true}));
    try {
        await controller.toggle();
        deliver(visible);
        await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(3));
        controller.stop();
        engine = 'apple';
        await controller.toggle();
        deliver(visible);
        await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(6));
        for (const settle of finish.splice(0, 3)) { settle(); }
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(translate).toHaveBeenCalledTimes(6);
        expect(document.querySelector('.study-page-translation')).toBeNull();

        finish.shift()?.();
        await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(7));
        expect(visible[0].target.nextElementSibling?.textContent).toBe('apple：First paragraph.');
    } finally {
        controller.stop();
        for (const settle of finish) { settle(); }
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});

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
