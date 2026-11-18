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
import {prepareStudyFocus} from '../ext/js/display/study-focus.js';
import {bindStudyWordTabs} from '../ext/js/display/study-word-tabs.js';

test('parked word cards keep each saved sense and its own unsent draft', async () => {
    const url = 'https://reading.test/story';
    const sentence = {text: 'They charged him.', offset: 5};
    const html = '<nav></nav><div id="study-context"><textarea class="study-followup"></textarea></div>';
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html, url}});
    const notes = ['收费', '指控'].map((gloss, i) => ({
        id: String(i + 1).repeat(32),
        entry: {word: 'charge', sentence: sentence.text, url, sense: {key: String(i), gloss}},
    }));
    const stateFor = (/** @type {{id: string, entry: Pick<import('study').LibraryEntry, 'word'|'sentence'|'url'|'sense'>}} */ row) => ({url, sentence, savedRecordId: row.id, savedRecordEntry: row.entry});
    const goingTo = vi.fn();
    const mockDisplay = {query: 'charge', history: {state: stateFor(notes[0])}, on: vi.fn(), setContent: goingTo};
    const display = /** @type {import('../ext/js/display/display.js').Display} */ (/** @type {unknown} */ (mockDisplay));
    try {
        const nav = /** @type {HTMLElement} */ (document.querySelector('nav'));
        const question = /** @type {HTMLTextAreaElement} */ (document.querySelector('textarea'));
        const capture = () => mockDisplay.on.mock.calls[0][1]();
        const first = bindStudyWordTabs(display, nav, () => {});
        question.value = '这里收多少钱？';
        capture();
        first.park();
        mockDisplay.history.state = stateFor(notes[1]);
        question.value = '';
        const second = bindStudyWordTabs(display, nav, () => {});
        question.value = '指控内容是什么？';
        expect(second.key).not.toBe(first.key);
        const tabs = /** @type {HTMLButtonElement[]} */ ([...nav.querySelectorAll('[data-study-word-tab]')]);
        expect(tabs.map((tab) => tab.textContent)).toEqual(['charge · 收费', 'charge · 指控']);
        tabs[0].click();
        expect(goingTo.mock.lastCall?.[0]?.state).toMatchObject(stateFor(notes[0]));
        mockDisplay.history.state = stateFor(notes[0]);
        bindStudyWordTabs(display, nav, () => {});
        expect(question.value).toBe('这里收多少钱？');
        /** @type {HTMLButtonElement|null} */ (nav.querySelector('[aria-label="切回单词 charge · 指控"]'))?.click();
        expect(goingTo.mock.lastCall?.[0]?.state).toMatchObject(stateFor(notes[1]));
        mockDisplay.history.state = stateFor(notes[1]);
        const current = bindStudyWordTabs(display, nav, () => {});
        expect(question.value).toBe('指控内容是什么？');
        const context = document.querySelector('#study-context');
        context?.setAttribute('data-study-record-id', notes[0].id);
        capture();
        expect(current.key.details.state?.savedRecordId).toBe(notes[1].id);
        context?.dispatchEvent(new CustomEvent('study-saved', {detail: {...notes[1], vaultSaved: true, turnIds: ['new-turn']}}));
        expect(current.key.details.state?.savedRecordTurnIds).toEqual(['new-turn']);
        current.dispose();
    } finally {
        await env.teardown(global);
    }
});

test('my records opens two senses of the same sentence by their saved IDs', async () => {
    const url = 'https://reading.test/story';
    const html = '<div class="content-body-inner"><article class="study-entry"><section class="study-reading-anchor"><div class="study-source"><p>They charged him.</p></div></section><div id="study-context"></div></article></div>';
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html, url}});
    /** @type {Map<string, () => void>} */
    const events = new Map();
    const display = /** @type {import('../ext/js/display/display.js').Display} */ (/** @type {unknown} */ ({
        query: 'charge',
        history: {state: {url, sentence: {text: 'They charged him.'}}},
        on: (/** @type {string} */ name, /** @type {() => void} */ fn) => events.set(name, fn),
    }));
    const notes = ['收费', '指控'].map((gloss, i) => ({
        id: String(i + 1).repeat(32),
        vaultSaved: true,
        entry: {word: 'charge', sentence: 'They charged him.', url, sense: {key: String(i), gloss}},
        openUrl: `obsidian://open?vault=Test&file=charge-${i}`,
    }));
    const call = vi.fn(async (/** @type {string} */ action) => {
        const [recent, earlier] = notes;
        if (action === 'libraryMemory') { return {total: 2, items: [{id: recent.id, word: 'charge'}]}; }
        if (action === 'libraryRead') { return {items: [{record: recent}]}; }
        if (action === 'libraryList') { return {canSearch: true, total: 2, items: [recent, earlier]}; }
        return recent;
    });
    vi.stubGlobal('ResizeObserver', class {
        /** Layout is not measured in this DOM fixture. */
        observe() {}
        /** The fixture has no observation to release. */
        disconnect() {}
    });
    vi.stubGlobal('chrome', {
        permissions: {contains: async () => true},
        runtime: {getURL: (/** @type {string} */ path) => `chrome-extension://test${path}`},
        storage: {local: {get: async () => ({})}, onChanged: {addListener() {}, removeListener() {}}},
    });
    try {
        prepareStudyFocus(display, {call});
        events.get('contentUpdateComplete')?.();
        await vi.waitFor(() => expect(document.querySelectorAll('.sf-record-note')).toHaveLength(2));
        const rows = [...document.querySelectorAll('.sf-record-note')];
        expect(rows.map((row) => row.querySelector('strong')?.textContent)).toEqual(['charge · 收费', 'charge · 指控']);
        const links = rows.map((row) => new URL(row.querySelector('a')?.href ?? ''));
        expect(links.map((link) => link.searchParams.get('studyRecordId'))).toEqual(notes.map(({id}) => id));
        expect(links.every((link) => !link.searchParams.get('full'))).toBe(true);
        expect(document.querySelector('#study-context')?.hasAttribute('data-study-record-id')).toBe(false);
        expect(call).toHaveBeenCalledWith('libraryList', expect.objectContaining({scope: 'source', url, query: 'charge'}));
    } finally {
        events.get('contentClear')?.();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});

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
    const open = (openPanel = true) => new Promise((resolve) => {
        if (!receive) { throw new Error('message listener missing'); }
        receive({studyAction: 'openStudyRecord', data: {id, word: entry.word, sentence: entry.sentence, ...(openPanel ? {} : {openPanel})}}, {id: 'test', url: entry.url}, resolve);
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
        expect(await open(false)).toEqual({ok: true, value: true});
        target.searchParams.delete('studyAddCard');
        expect(create).toHaveBeenLastCalledWith({url: target.href});
        read.mockRejectedValueOnce(new Error('暂时读不到这条记录，请在学习库重试。'));
        expect(await open()).toEqual({ok: false, error: '暂时读不到这条记录，请在学习库重试。'});
        expect(create).toHaveBeenCalledTimes(2);
    } finally {
        read.mockRestore();
        vi.unstubAllGlobals();
    }
});

test('saved page words keep their count when browser binding fails and refresh colours once', async () => {
    /** @typedef {(message: unknown, sender: object, reply: (value: unknown) => void) => void} PageMessageHandler */
    /** @type {PageMessageHandler} */
    let receive = (_message, _sender, _reply) => { throw new Error('学习消息尚未注册'); };
    /** @type {string[]} */
    const calls = [];
    /** @type {string[]} */
    const sources = [];
    let failing = false;
    let linkUnavailable = true;
    vi.stubGlobal('chrome', {
        storage: {local: {
            get: async () => ({}),
            set: async (/** @type {object} */ data) => {
                if (linkUnavailable && 'studySyncLinksV1' in data) { throw new Error('扩展关联无法写入'); }
            },
        }},
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
                    postMessage: (/** @type {{action: string, entry: import('study').LibraryEntry}} */ value) => {
                        if (value.action === 'libraryTargetResolve') {
                            replyNative?.({ok: true, library: {targetId: 'a'.repeat(32)}});
                            return;
                        }
                        calls.push(value.action);
                        if (value.action !== 'librarySave') {
                            replyNative?.({ok: true, library: {words: {}}});
                            return;
                        }
                        sources.push(value.entry.url);
                        if (failing && value.entry.word === 'receipt') {
                            replyNative?.({ok: false, error: '暂时未写入'});
                        } else {
                            replyNative?.({ok: true, library: {id: 'b'.repeat(32), entry: value.entry, vaultSaved: true}});
                        }
                    },
                    disconnect() {},
                };
            },
        },
    });
    try {
        prepareStudyService();
        const items = ['harbor', 'receipt', 'charge'].map((word) => ({word, sentence: `Remember ${word}.`, meaning: '示例'}));
        const url = 'https://reading.test/story#chapter';
        const request = (batch = items, tabUrl = url + ':~:text=Remember') => new Promise((resolve) => {
            receive(
                {studyAction: 'pageWordsSave', data: {items: batch, source: url}},
                {id: 'fixture', url: 'https://reading.test/old', frameId: 0, tab: {url: tabUrl}},
                resolve,
            );
        });
        expect(await request()).toEqual({ok: true, value: {saved: 3, localSyncIncomplete: true}});
        expect(calls).toEqual([...items.flatMap(() => ['librarySave', 'libraryMarkKnown']), 'knownWords', 'libraryWordStatus']);
        expect(sources).toEqual([url, url, url]);
        calls.length = 0;
        linkUnavailable = false;
        failing = true;
        expect(await request()).toEqual({ok: true, value: {saved: 1, error: '暂时未写入'}});
        expect(calls).toEqual(['librarySave', 'libraryMarkKnown', 'librarySave', 'knownWords', 'libraryWordStatus']);
        calls.length = 0;
        expect(await request(items.slice(1), url + '-other')).toMatchObject({ok: false});
        expect(calls).toEqual([]);
    } finally {
        vi.unstubAllGlobals();
    }
});
