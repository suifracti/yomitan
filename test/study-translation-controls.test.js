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

import {readFileSync} from 'node:fs';
import {expect, test, vi} from 'vitest';
import {builtinEnvironments} from 'vitest/environments';
import {prepareStudyService, StudyService} from '../ext/js/study/study-service.js';
import {studyCall} from '../ext/js/study/study-client.js';
import {prepareSubtitleSettings} from '../ext/js/pages/subtitle-settings.js';
import {translationEngineSelect} from '../ext/js/study/youtube-overlay.js';
import {writeSubtitlePrefs} from '../ext/js/study/subtitle-prefs.js';

test('opens settings through the background and keeps video and settings engine controls in sync', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: readFileSync(new URL('../ext/settings.html', import.meta.url), 'utf8'), url: 'https://www.youtube.com/watch?v=abcdefghijk'}});
    const stored = {studyTranslationPrefs: {engine: 'chrome', autoTranslate: false}};
    const listeners = [];
    let receive;
    const create = vi.fn(async () => ({}));
    const runtime = {id: 'test', getURL: (p) => `chrome-extension://test/${p}`, onMessage: {addListener(fn) { receive = fn; }},
        sendMessage: (message) => new Promise((resolve) => receive(message, {id: 'test', url: location.href, frameId: 0}, resolve))};
    vi.stubGlobal('chrome', {runtime, tabs: {create}, storage: {onChanged: {addListener: (fn) => listeners.push(fn), removeListener() {}}, local: {
        get: async () => ({...stored}), set: async (value) => {
            Object.assign(stored, value);
            for (const fn of listeners) { fn(Object.fromEntries(Object.entries(value).map(([key, newValue]) => [key, {newValue}])), 'local'); }
        },
    }}});
    try {
        prepareStudyService();
        await studyCall('openStudySettings', {section: 'ai'});
        expect(create).toHaveBeenCalledWith({url: 'chrome-extension://test/settings.html#ai'});
        await prepareSubtitleSettings(document);
        const picker = translationEngineSelect((engine) => { void writeSubtitlePrefs({engine}); });
        document.body.append(picker);
        const select = picker.querySelector('select'); select.value = 'model'; select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(document.querySelector('[data-translation-model]').hidden).toBe(false));
        expect(document.querySelector('select[name=subtitle-engine]').value).toBe('model');
        expect(document.querySelectorAll('select[name=subtitle-engine]').length).toBe(1);
        expect(document.querySelectorAll('input[name=subtitle-engine]').length).toBe(0);
        expect(stored.studyTranslationPrefs.engine).toBe('model');
    } finally { vi.unstubAllGlobals(); await env.teardown(global); }
});


test('opens a saved video word with its original source context and stops when it cannot be read', async () => {
    const id = 'a'.repeat(32);
    const entry = {
        word: 'change',
        sentence: 'People can change their habits.',
        context: 'A lesson about daily routines.',
        url: 'https://www.bilibili.com/video/BV1xWnM6HEUU?p=2',
        title: 'Episode two',
        videoTime: 72,
        language: 'en',
    };
    const record = {id, entry};
    /** @type {((message: unknown, sender: {id?: string, url?: string}, reply: (value: unknown) => void) => boolean)|undefined} */
    let receive;
    const create = vi.fn(async (/** @type {{url: string}} */ _options) => ({}));
    vi.stubGlobal('chrome', {
        runtime: {
            id: 'test',
            getURL: (/** @type {string} */ path) => `chrome-extension://test/${path}`,
            onMessage: {addListener: (/** @type {(message: unknown, sender: {id?: string, url?: string}, reply: (value: unknown) => void) => boolean} */ fn) => { receive = fn; }},
        },
        tabs: {create},
        storage: {onChanged: {addListener() {}}, local: {get: async () => ({}), set: async () => {}}},
    });
    const read = vi.spyOn(StudyService.prototype, 'handle').mockResolvedValue({items: [{id, record}]});
    const open = () => new Promise((resolve) => {
        if (!receive) { throw new Error('message listener missing'); }
        receive({studyAction: 'openStudyRecord', data: {id, word: entry.word, sentence: entry.sentence}}, {id: 'test', url: entry.url}, resolve);
    });
    try {
        prepareStudyService();
        expect(await open()).toEqual({ok: true, value: true});
        const opened = /** @type {{url: string}} */ (create.mock.calls[0][0]);
        const target = new URL(opened.url);
        expect(target.searchParams.get('studyRecordId')).toBe(id);
        expect(target.searchParams.get('studySourceUrl')).toBe(entry.url);
        expect(target.searchParams.get('studySourceTitle')).toBe(entry.title);
        expect(target.searchParams.get('studyContext')).toBe(entry.context);
        expect(target.searchParams.get('studyVideoTime')).toBe('72');
        expect(target.searchParams.get('studyLanguage')).toBe('en');
        expect(target.searchParams.get('full')).toBe(entry.sentence);
        expect(target.searchParams.get('studyAddCard')).toBe('1');
        expect(read).toHaveBeenCalledWith('libraryRead', {ids: [id], language: 'en'});
        read.mockRejectedValueOnce(new Error('暂时读不到这条记录，请在学习库重试。'));
        expect(await open()).toEqual({ok: false, error: '暂时读不到这条记录，请在学习库重试。'});
        expect(create).toHaveBeenCalledTimes(1);
    } finally {
        read.mockRestore();
        vi.unstubAllGlobals();
    }
});

test('saved page words update the shared word colours once after the whole batch', async () => {
    /** @typedef {(message: unknown, sender: object, reply: (value: unknown) => void) => void} PageMessageHandler */
    /** @type {PageMessageHandler} */
    let receive = (_message, _sender, _reply) => { throw new Error('学习消息尚未注册'); };
    /** @type {string[]} */
    const calls = [];
    let failing = false;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Called below with its current service as the receiver.
    const send = StudyService.prototype.handle;
    const save = vi.spyOn(StudyService.prototype, 'handle').mockImplementation(async function saveFixture(action, value) {
        if (action === 'librarySave') {
            calls.push(action);
            if (failing && /** @type {{entry: {word: string}}} */ (value).entry.word === 'receipt') { throw new Error('暂时未写入'); }
            return {vaultSaved: true};
        }
        return await send.call(this, action, value);
    });
    vi.stubGlobal('chrome', {
        storage: {local: {get: async () => ({}), set: async () => {}}},
        permissions: {contains: async () => true},
        runtime: {
            id: 'fixture',
            getURL: (/** @type {string} */ name) => `chrome-extension://fixture/${name}`,
            onMessage: {addListener: (/** @type {PageMessageHandler} */ fn) => { receive = fn; }},
            connectNative: () => {
                /** @type {((value: unknown) => void)|undefined} */
                let replyNative;
                return {
                    onMessage: {addListener: (/** @type {(value: unknown) => void} */ fn) => { replyNative = fn; }},
                    onDisconnect: {addListener() {}},
                    postMessage: (/** @type {{action: string}} */ value) => {
                        calls.push(value.action);
                        replyNative?.({ok: true, library: {words: {}}});
                    },
                    disconnect() {},
                };
            },
        },
    });
    try {
        prepareStudyService();
        const items = ['harbor', 'receipt', 'charge'].map((word) => ({word, sentence: `Remember ${word}.`, meaning: '示例'}));
        const request = () => new Promise((resolve) => {
            receive({studyAction: 'pageWordsSave', data: {items}}, {id: 'fixture', url: 'https://reading.test/story'}, resolve);
        });
        expect(await request()).toEqual({ok: true, value: true});
        expect(calls).toEqual([...items.flatMap(() => ['librarySave', 'libraryMarkKnown']), 'libraryWordStatus']);
        calls.length = 0;
        failing = true;
        expect(await request()).toEqual({ok: false, error: '暂时未写入'});
        expect(calls).toEqual(['librarySave', 'libraryMarkKnown', 'librarySave', 'libraryWordStatus']);
    } finally {
        save.mockRestore();
        vi.unstubAllGlobals();
    }
});
