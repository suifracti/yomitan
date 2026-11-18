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
import {deferPromise} from '../ext/js/core/utilities.js';
import {prepareStudyService} from '../ext/js/study/study-service.js';

test('merges restoring the ball with concurrent changes from another tab', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {url: 'chrome-extension://test/action-popup.html', html: '<a id="page-ball-restore" hidden></a>'}});
    const store = {
        studyPageTranslation: {ball: true, ballSites: {'example.test': {hidden: true, y: 0.4}}},
        studyTranslationPrefs: {engine: 'google', autoTranslate: false},
    };
    /** @type {import('core').DeferredPromiseDetails<void>} */
    const started = deferPromise();
    /** @type {import('core').DeferredPromiseDetails<void>} */
    const resume = deferPromise();
    let first = true;
    /** @typedef {{studyAction: string, data?: object}} Message */
    /** @typedef {(message: Message, sender: object, reply: (result: unknown) => void) => boolean} Receive */
    /** @type {Receive} */
    let receive;
    const popup = {id: 'test', url: location.href, frameId: 0};
    const other = {id: 'test', url: 'https://another.test/news', frameId: 0};
    /**
     * @param {Message} message
     * @param {{id: string, url: string, frameId: number}} [sender]
     * @returns {Promise<unknown>}
     */
    const send = (message, sender = popup) => new Promise((resolve) => { receive(message, sender, resolve); });
    vi.stubGlobal('chrome', {
        runtime: {
            id: 'test',
            getURL: (path) => `chrome-extension://test/${path}`,
            sendMessage: send,
            onMessage: {addListener: (/** @type {Receive} */ listener) => { receive = listener; }},
        },
        storage: {
            local: {
                get: async (keys) => {
                    /** @type {string[]} */
                    const names = [];
                    if (typeof keys === 'string') { names.push(keys); }
                    if (Array.isArray(keys)) {
                        for (const key of keys) {
                            if (typeof key === 'string') { names.push(key); }
                        }
                    }
                    /** @type {Record<string, unknown>} */
                    const picked = {};
                    for (const name of names) {
                        if (name in store) { picked[name] = /** @type {Record<string, unknown>} */ (store)[name]; }
                    }
                    return picked;
                },
                set: async (value) => {
                    if (first && 'studyPageTranslation' in value) {
                        first = false;
                        started.resolve();
                        await resume.promise;
                    }
                    Object.assign(store, value);
                },
            },
            onChanged: {addListener() {}, removeListener() {}},
        },
    });
    try {
        prepareStudyService();
        const {preparePageControls} = await import('../ext/js/study/page-translate.js');
        const link = /** @type {HTMLAnchorElement} */ (document.querySelector('#page-ball-restore'));
        await preparePageControls(document, {url: 'https://example.test/article'});
        expect(link.hidden).toBe(false);
        expect(link.textContent).toBe('恢复本站悬浮球');
        link.click();
        await started.promise;
        const drag = send({studyAction: 'pagePrefsUpdate', data: {ballSite: {host: 'another.test', y: 0.7}}}, other);
        const mode = send({studyAction: 'pagePrefsUpdate', data: {mode: 'translation'}}, other);
        resume.resolve();
        expect(await Promise.all([drag, mode])).toMatchObject([{ok: true}, {ok: true}]);
        expect(store.studyPageTranslation).toMatchObject({
            mode: 'translation',
            ballSites: {'example.test': {y: 0.4}, 'another.test': {y: 0.7}},
        });
        expect(store.studyPageTranslation.ballSites['example.test']).toEqual({y: 0.4});
        const ownSite = {...other, url: 'https://example.test/article'};
        expect(await send({studyAction: 'pagePrefsUpdate', data: {ballSite: {host: 'example.test', y: 0.8}}}, ownSite)).toMatchObject({ok: true});
        expect(await send({studyAction: 'pagePrefsUpdate', data: {ballSite: {host: 'example.test', hidden: true}}}, other)).toMatchObject({ok: false});
        expect(store.studyPageTranslation.ballSites['example.test']).toEqual({y: 0.8});
    } finally {
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
