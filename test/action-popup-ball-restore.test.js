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

test('restores the ball on the current site and keeps its dragged position', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {url: 'chrome-extension://test/action-popup.html', html: '<a id="page-ball-restore" hidden></a>'}});
    const store = {
        studyPageTranslation: {ball: true, ballSites: {'example.test': {hidden: true, y: 0.4}}},
        studyTranslationPrefs: {engine: 'google', autoTranslate: false},
    };
    vi.stubGlobal('chrome', {
        runtime: {id: 'test', getURL: (path) => `chrome-extension://test/${path}`, sendMessage: async () => ({ok: true, value: {}})},
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
                set: async (value) => Object.assign(store, value),
            },
            onChanged: {addListener() {}, removeListener() {}},
        },
    });
    try {
        const {preparePageControls} = await import('../ext/js/study/page-translate.js');
        const link = /** @type {HTMLAnchorElement} */ (document.querySelector('#page-ball-restore'));
        await preparePageControls(document, {url: 'https://example.test/article'});
        expect(link.hidden).toBe(false);
        expect(link.textContent).toBe('恢复本站悬浮球');
        link.click();
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(store.studyPageTranslation.ballSites['example.test']).toEqual({y: 0.4});
    } finally {
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
