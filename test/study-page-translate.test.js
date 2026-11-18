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

test('restoring the page stops unsent chunks without interrupting the next translation run', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {
        html: '<p></p>', url: 'https://example.test/article',
    }});
    const original = /** @type {HTMLParagraphElement} */ (document.querySelector('p'));
    original.textContent = 'First long paragraph. '.repeat(105) + 'Old ending.';
    /** @typedef {{ok: boolean, value: {items: {translation: string}[]}}} Reply */
    /** @type {import('core').DeferredPromiseDetails<Reply|null>} */
    const oldReply = deferPromise();
    /** @type {import('core').DeferredPromiseDetails<Reply|null>} */
    const currentReply = deferPromise();
    const send = vi.fn(async (/** @type {{studyAction: string, data: {items?: {text: string}[]}}} */ message) => {
        if (message.studyAction === 'subtitleSettings') { return {ok: true, value: {model: 'fixture', effort: 'low'}}; }
        const text = message.data.items?.[0]?.text ?? '';
        if (text.startsWith('First long paragraph.')) { return await oldReply.promise; }
        if (text === 'Another paragraph.') { return await currentReply.promise; }
        return {ok: true, value: {items: [{translation: '旧尾段不应发送'}]}};
    });
    vi.stubGlobal('chrome', {
        runtime: {sendMessage: send},
        storage: {local: {get: async () => ({studyTranslationPrefs: {engine: 'google'}})}},
    });
    vi.stubGlobal('IntersectionObserver', class {
        /** */
        observe() {}
        /** */
        disconnect() {}
    });
    const {PageTranslate} = await import('../ext/js/study/page-translate.js');
    const controller = new PageTranslate();
    /** @type {Promise<void>[]} */
    const requests = [];
    const sent = () => send.mock.calls.flatMap(([message]) => message.data.items?.map(({text}) => text) ?? []);
    try {
        await controller.toggle();
        const old = controller.translateNode(original);
        requests.push(old);
        await vi.waitFor(() => expect(sent()).toHaveLength(1));
        await controller.toggle();
        original.textContent = 'Another paragraph.';
        await controller.toggle();
        const current = controller.translateNode(original);
        requests.push(current);
        await vi.waitFor(() => expect(sent()[1]).toBe('Another paragraph.'));
        oldReply.resolve({ok: true, value: {items: [{translation: '旧译文'}]}});
        await old;
        expect(sent()).toHaveLength(2);
        expect(original.nextElementSibling).toBeNull();
        expect(controller.busy).toBe(1);
        expect(controller.pending.has(original)).toBe(true);
        currentReply.resolve({ok: true, value: {items: [{translation: '本次译文'}]}});
        await current;
        expect(original.nextElementSibling?.textContent).toBe('本次译文');
        expect(controller.busy).toBe(0);
    } finally {
        oldReply.resolve(null);
        currentReply.resolve(null);
        controller.stop();
        await Promise.allSettled(requests);
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});

test('mixed-language blocks and selections use their source language, including in the page cache', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {
        html: '<html lang="en-GB"><body><p id="english">Pain</p><section lang="fr-CA"><p id="french">Pain</p></section><p lang="ru" id="russian">Привет, мир.</p><p>Quote: <span lang="fr" id="quote">Le pain</span></p></body></html>',
        url: 'https://example.test/article',
    }});
    /** @type {Element[]} */
    const observed = [];
    vi.stubGlobal('IntersectionObserver', class {
        /** @param {Element} target */
        observe(target) { observed.push(target); }
        /** */
        disconnect() {}
    });
    vi.stubGlobal('chrome', {runtime: {sendMessage: async () => ({ok: true, value: {model: 'fixture', effort: 'low'}})}, storage: {local: {get: async () => ({studyTranslationPrefs: {engine: 'google'}})}}});
    const {PageTranslate} = await import('../ext/js/study/page-translate.js');
    const translate = vi.fn(async (/** @type {string} */ text, /** @type {{language?: string}} */ options) => `${options.language}:${text}`);
    const controller = new PageTranslate({translate});
    try {
        controller.prefs.mode = 'translation';
        await controller.toggle();
        const english = /** @type {HTMLElement} */ (document.getElementById('english'));
        const french = /** @type {HTMLElement} */ (document.getElementById('french'));
        const russian = /** @type {HTMLElement} */ (document.getElementById('russian'));
        expect(observed).toContain(russian);
        await controller.translateNode(english);
        await controller.translateNode(french);
        await controller.translateNode(russian);
        expect(english.nextElementSibling?.textContent).toBe('en:Pain');
        expect(french.nextElementSibling?.textContent).toBe('fr:Pain');
        expect(russian.nextElementSibling?.textContent).toBe('ru:Привет, мир.');
        const quote = /** @type {HTMLElement} */ (document.getElementById('quote'));
        const range = document.createRange();
        range.selectNodeContents(quote);
        Range.prototype.getBoundingClientRect = () => ({left: 10, right: 200, bottom: 20});
        Range.prototype.getClientRects = () => [];
        window.getSelection()?.addRange(range);
        controller.showSelection();
        controller.selectionUi?.querySelector('button')?.click();
        await vi.waitFor(() => expect(quote.parentElement?.nextElementSibling?.textContent).toContain('fr:Le pain'));
        expect(quote.parentElement?.nextElementSibling?.querySelector('[aria-label="记住这句"]')).toBeNull();
        expect(translate).toHaveBeenCalledTimes(4);

        observed.length = 0;
        const oldFrench = french.nextElementSibling;
        /** @type {HTMLElement} */ (french.parentElement).lang = 'de';
        await vi.waitFor(() => expect(oldFrench?.isConnected).toBe(false));
        expect(french.classList.contains('study-original-hidden')).toBe(false);
        expect(observed).toContain(french);
        await controller.translateNode(french);
        const german = french.nextElementSibling;
        expect(german?.textContent).toBe('de:Pain');
        expect(english.nextElementSibling?.textContent).toBe('en:Pain');

        const oldEnglish = english.nextElementSibling;
        observed.length = 0;
        document.documentElement.lang = 'fr';
        await vi.waitFor(() => expect(oldEnglish?.isConnected).toBe(false));
        expect(english.classList.contains('study-original-hidden')).toBe(false);
        expect(observed).toContain(english);
        expect(french.nextElementSibling).toBe(german);
        await controller.translateNode(english);
        expect(english.nextElementSibling?.textContent).toBe('fr:Pain');
        expect(translate).toHaveBeenCalledTimes(5);
    } finally {
        controller.stop();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});

test('switching the global service cannot turn a free page request into an unconfirmed model request', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {
        html: '<p>First paragraph.</p><p>Second paragraph.</p><p>Third paragraph.</p>', url: 'https://example.test/article',
    }});
    const prefs = {engine: 'google'};
    const session = {studyTranslationConsents: []};
    let changeAtSend = false;
    let nativeAllowed = false;
    /** @typedef {(message: object, sender: object, reply: (value: unknown) => void) => boolean} Receive */
    /** @typedef {{items: {id: string}[]}} ModelRequest */
    /** @typedef {(reply: unknown) => void} ModelReply */
    /** @type {Receive} */
    let receive;
    const sendModel = vi.fn((/** @type {ModelRequest} */ request) => ({
        ok: true, result: {items: request.items.map(({id}) => ({id, translation: '模型译文'}))},
    }));
    const sender = {id: 'fixture', url: 'https://example.test/article', tab: {id: 7}, frameId: 0};
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([['免费译文']]))));
    vi.stubGlobal('IntersectionObserver', class {
        /** */
        observe() {}
        /** */
        disconnect() {}
    });
    vi.stubGlobal('chrome', {
        permissions: {contains: async () => nativeAllowed},
        storage: {
            local: {get: async () => ({studyTranslationPrefs: {...prefs}, studySettingsV2: {cacheEnabled: false}}), set: async () => {}},
            session: {get: async () => ({...session}), set: async (/** @type {object} */ value) => Object.assign(session, value)},
        },
        runtime: {
            id: sender.id,
            getURL: (/** @type {string} */ path) => `chrome-extension://fixture/${path}`,
            onMessage: {addListener: (/** @type {Receive} */ listener) => { receive = listener; }},
            sendMessage: (/** @type {{studyAction: string}} */ message) => new Promise((resolve) => {
                if (changeAtSend && message.studyAction === 'subtitleTranslate') {
                    prefs.engine = 'model';
                    changeAtSend = false;
                }
                receive(message, sender, resolve);
            }),
            connectNative: () => {
                /** @type {ModelReply} */
                let onMessage;
                return {
                    onMessage: {addListener: (/** @type {ModelReply} */ fn) => { onMessage = fn; }},
                    onDisconnect: {addListener() {}},
                    postMessage: (/** @type {ModelRequest} */ request) => onMessage(sendModel(request)),
                    disconnect() {},
                };
            },
        },
    });
    const {prepareStudyService} = await import('../ext/js/study/study-service.js');
    const {PageTranslate} = await import('../ext/js/study/page-translate.js');
    const controller = new PageTranslate();
    try {
        prepareStudyService();
        const [first, second, third] = document.querySelectorAll('p');
        await controller.toggle();
        await controller.translateNode(first);
        expect(first.nextElementSibling?.textContent).toBe('免费译文');

        changeAtSend = true;
        await controller.translateNode(second);
        expect(sendModel).not.toHaveBeenCalled();
        expect(second.nextElementSibling?.textContent).toContain('翻译服务刚换了');

        nativeAllowed = true;
        const retry = controller.translateNode(second);
        const next = controller.translateNode(third);
        await vi.waitFor(() => expect(document.querySelectorAll('.study-translation-confirm')).toHaveLength(1));
        expect(sendModel).not.toHaveBeenCalled();
        /** @type {?HTMLButtonElement} */ (document.querySelector('.study-translation-confirm button'))?.click();
        await Promise.all([retry, next]);
        expect(sendModel).toHaveBeenCalledTimes(2);
        expect(second.nextElementSibling?.textContent).toBe('模型译文');
        expect(third.nextElementSibling?.textContent).toBe('模型译文');
    } finally {
        controller.stop();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});

test('translates visible blocks and restores the exact original nodes in both modes', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<p id="source">Hello <a href="#world"><strong>world</strong></a><button>Skip</button>.</p><nav>Navigation</nav>', url: 'https://example.test/article'}});
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
    const translate = vi.fn(async () => '你好，世界。');
    const controller = new PageTranslate({translate});
    try {
        const original = document.querySelector('#source');
        const link = original.querySelector('a');
        const strong = original.querySelector('strong');
        const clicked = vi.fn((/** @type {Event} */ event) => event.preventDefault());
        link.addEventListener('click', clicked);
        await controller.toggle();
        expect(observed).toContain(original);
        expect(observed).not.toContain(document.querySelector('nav'));
        await controller.translateNode(original);
        const translation = document.querySelector('.study-page-translation');
        expect(translation.firstChild.textContent).toBe('你好，世界。');
        controller.prefs.mode = 'translation';
        controller.paint();
        expect(original.classList.contains('study-original-hidden')).toBe(true);
        expect(translation.dataset.original).toBe('Hello world .');
        const reveal = translation.querySelector('button');
        expect(reveal?.getAttribute('aria-expanded')).toBe('false');
        reveal.click();
        expect(original.classList.contains('study-original-hidden')).toBe(false);
        expect(document.activeElement).toBe(link);
        expect(original.querySelector('a')).toBe(link);
        link.click();
        expect(clicked).toHaveBeenCalledOnce();
        expect(link.getAttribute('href')).toBe('#world');
        reveal.click();
        expect(original.classList.contains('study-original-hidden')).toBe(true);
        // A dynamic page can reuse the same paragraph in a different card.
        const destination = document.createElement('article');
        document.body.append(destination);
        observed.length = 0;
        destination.append(original);
        await vi.waitFor(() => expect(original.classList.contains('study-original-hidden')).toBe(false));
        expect(translation?.isConnected).toBe(false);
        expect(observed).toContain(original);
        await controller.translateNode(original);
        const moved = original.nextElementSibling;
        expect(moved?.firstChild?.textContent).toBe('你好，世界。');
        expect(original.classList.contains('study-original-hidden')).toBe(true);
        expect(translate).toHaveBeenCalledOnce();

        // If the page removes just our wrapper, the original must be readable.
        observed.length = 0;
        moved?.remove();
        await vi.waitFor(() => expect(observed).toContain(original));
        expect(original.classList.contains('study-original-hidden')).toBe(false);
        expect(original.querySelector('a')).toBe(link);
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

test('removes standalone inline translations when dynamic pages replace or move their source', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {
        html: '<p id="source">The first comment.</p><p id="other">A different comment.</p><section></section>',
        url: 'https://example.test/article',
    }});
    vi.stubGlobal('chrome', {
        runtime: {sendMessage: async () => ({ok: true, value: {model: 'fixture', effort: 'low'}})},
        storage: {local: {get: async () => ({studyTranslationPrefs: {engine: 'google'}})}},
    });
    const {PageTranslate} = await import('../ext/js/study/page-translate.js');
    const translate = vi.fn(async () => '临时译文');
    const page = new PageTranslate({translate});
    const original = /** @type {HTMLElement} */ (document.getElementById('source'));
    const other = /** @type {HTMLElement} */ (document.getElementById('other'));
    const open = async (/** @type {HTMLElement} */ source) => {
        const trigger = document.createElement('div');
        document.body.append(trigger);
        const range = document.createRange();
        range.selectNodeContents(source);
        await page.openSelection(range.toString(), trigger, source, {url: location.href, element: source, range, language: 'en'});
        return source.nextElementSibling;
    };
    try {
        const first = await open(original);
        const untouched = await open(other);
        expect(first?.textContent).toContain('临时译文');
        original.textContent = 'The page reused this comment.';
        await vi.waitFor(() => expect(first?.isConnected).toBe(false));
        expect(other.nextElementSibling).toBe(untouched);
        expect(translate).toHaveBeenCalledTimes(2);

        const second = await open(original);
        const destination = document.querySelector('section');
        destination?.append(original);
        await vi.waitFor(() => expect(second?.isConnected).toBe(false));
        expect(destination?.firstElementChild).toBe(original);
        expect(original.textContent).toBe('The page reused this comment.');
        expect(other.nextElementSibling).toBe(untouched);
        expect(translate).toHaveBeenCalledTimes(3);
    } finally {
        page.stop();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});

test('checks and runs Chrome translation in the language direction the caller asked for', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<!DOCTYPE html><html lang="zh-CN"><body></body></html>', url: 'https://example.test/article'}});
    /** @type {string[]} */
    const checked = [];
    /** @type {string[]} */
    const created = [];
    vi.stubGlobal('Translator', {
        /**
         * @param {{sourceLanguage: string, targetLanguage: string}} pair
         * @returns {Promise<string>}
         */
        availability: async ({sourceLanguage, targetLanguage}) => {
            checked.push(`${sourceLanguage}->${targetLanguage}`);
            return sourceLanguage === 'zh' && targetLanguage === 'en' ? 'available' : 'unavailable';
        },
        /**
         * @param {{sourceLanguage: string, targetLanguage: string}} pair
         * @returns {Promise<{translate: () => Promise<string>}>}
         */
        create: async ({sourceLanguage, targetLanguage}) => {
            created.push(`${sourceLanguage}->${targetLanguage}`);
            return {translate: async () => 'The bricks dry in the sun.'};
        },
    });
    vi.stubGlobal('chrome', {
        runtime: {sendMessage: async () => ({ok: true, value: {model: 'fixture', effort: 'low'}})},
        storage: {local: {get: async () => ({studyTranslationPrefs: {engine: 'chrome'}}), set: async () => {}}, onChanged: {addListener() {}}},
    });
    try {
        const {translateText} = await import('../ext/js/study/page-translate.js');
        const translated = await translateText('砖块在阳光下晒干。', {language: 'zh', target: 'en'});
        expect(translated).toBe('The bricks dry in the sun.');
        expect(checked).toEqual(['zh->en']);
        expect(created).toEqual(['zh->en']);
    } finally {
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});

test('retries the same pinned selection with a newly chosen service after the setting has saved', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {
        html: '<!DOCTYPE html><html lang="en"><body><p id="original">Keep the window open.</p></body></html>',
        url: 'https://example.test/article',
    }});
    let selected = 'chrome';
    let finishWrite = () => {};
    const requests = [];
    vi.stubGlobal('chrome', {
        runtime: {sendMessage: async (/** @type {{studyAction: string, data?: {engine: string}}} */ message) => {
            if (message.studyAction === 'subtitlePrefsUpdate') {
                return await new Promise((resolve) => {
                    finishWrite = () => {
                        selected = message.data?.engine ?? selected;
                        resolve({ok: true, value: {engine: selected}});
                    };
                });
            }
            return {ok: true, value: {model: 'fixture', effort: 'low'}};
        }},
        storage: {local: {get: async () => ({studyTranslationPrefs: {engine: selected}})}},
    });
    const {PageTranslate} = await import('../ext/js/study/page-translate.js');
    const page = new PageTranslate({translate: async (text, {engine} = {}) => {
        requests.push([text, engine]);
        if (engine === 'chrome') { throw new Error('还没下载语言包'); }
        return '别关窗。';
    }});
    page.prefs.selectionDisplay = 'card';
    const original = /** @type {HTMLElement} */ (document.getElementById('original'));
    const card = document.createElement('div');
    document.body.append(card);
    try {
        await page.openSelection('Keep the window open.', card, original);
        expect(card.textContent).toContain('还没下载语言包');
        const click = (/** @type {string} */ selector) => /** @type {HTMLButtonElement} */ (card.querySelector(selector)).click();
        click('[title="固定"]');
        click('.su-current');
        click('[data-value="google"]');
        expect(requests).toEqual([['Keep the window open.', 'chrome']]);
        click('[data-selection-retry]');
        await Promise.resolve();
        expect(requests).toHaveLength(1);
        finishWrite();
        await vi.waitFor(() => expect(card.querySelector('.study-page-translation')?.textContent).toContain('别关窗。'));
        expect(requests).toEqual([['Keep the window open.', 'chrome'], ['Keep the window open.', 'google']]);
        expect(page.selectionCard).toBe(card);
        expect(card.dataset.pinned).toBe('true');
        expect(original.textContent).toBe('Keep the window open.');
    } finally {
        page.stop();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
