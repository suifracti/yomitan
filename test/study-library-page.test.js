/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2016-2022  Yomichan Authors
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
// @vitest-environment jsdom

import {Blob} from 'node:buffer';
import {afterEach, describe, expect, test, vi} from 'vitest';
import {parseJson} from '../dev/json.js';
import {deferPromise} from '../ext/js/core/utilities.js';
import {mountStuckHint} from '../ext/js/display/study-stuck.js';
import {WORD_STATUS_KEY} from '../ext/js/study/study-data.js';

const mocks = vi.hoisted(() => ({
    studyCall: vi.fn(),
    applicationMain: vi.fn(),
    HotkeyHandler: vi.fn(() => ({prepare: vi.fn()})),
    PopupFactory: vi.fn(() => ({prepare: vi.fn()})),
    Frontend: vi.fn(() => ({prepare: vi.fn()})),
    ThemeController: vi.fn(() => ({prepare: vi.fn(), updateTheme: vi.fn()})),
}));

vi.mock('../ext/js/study/study-client.js', () => ({studyCall: mocks.studyCall}));
vi.mock('../ext/js/application.js', () => ({Application: {main: mocks.applicationMain}}));
vi.mock('../ext/js/input/hotkey-handler.js', () => ({HotkeyHandler: mocks.HotkeyHandler}));
vi.mock('../ext/js/app/popup-factory.js', () => ({PopupFactory: mocks.PopupFactory}));
vi.mock('../ext/js/app/frontend.js', () => ({Frontend: mocks.Frontend}));
vi.mock('../ext/js/app/theme-controller.js', () => ({ThemeController: mocks.ThemeController}));

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    document.body.replaceChildren();
});

/** @returns {object} */
function makeApplication() {
    return {api: {viewNotes: vi.fn(), getEnvironmentInfo: vi.fn().mockResolvedValue({browser: 'chrome'}), optionsGetFull: vi.fn().mockResolvedValue({profiles: [{options: {general: {popupTheme: 'dark'}}}], profileCurrent: 0})}, crossFrame: {}};
}

/** @returns {void} */
function makePageDom() {
    document.body.innerHTML = `
        <main>
            <p id="study-library-status"></p>
            <p id="study-library-today"></p>
            <button id="study-library-open-anki"></button>
            <button data-library-category="all" aria-pressed="true">全部</button>
            <button data-library-category="sources" aria-pressed="false">按素材</button>
            <button data-library-category="source" hidden>本页原句</button>
            <button data-library-category="word" hidden>同词原句</button>
            <button data-library-category="favorites" aria-pressed="false">收藏</button>
            <button data-library-category="saved" aria-pressed="false">已保存</button>
            <button data-library-category="linked" aria-pressed="false">关联卡</button>
            <button data-library-category="pending" aria-pressed="false">待同步</button>
            <label for="study-library-search">搜索学习库</label>
            <input id="study-library-search">
            <button id="study-library-refresh"></button>
            <button id="study-library-practice-button" hidden>用旧原句辨词义</button>
            <button id="study-library-cloze-button" hidden>练原句填空</button>
            <button id="study-library-dictation-button" hidden>练原声听写</button>
            <button id="study-library-listen-source" hidden>回视频练一轮</button>
            <section id="study-library-practice" hidden></section>
            <button id="study-library-export-saved">导出已收集收藏</button>
            <button id="study-library-clear-saved">清空已收集收藏</button>
            <section id="study-library-list"></section>
            <button id="study-library-more"></button>
        </main>`;
}

describe('study library page', () => {
    test('the lookup practice link opens an old sentence for the same word, not a search hit for a different word', async () => {
        vi.resetModules();
        vi.stubGlobal('chrome', {
            runtime: {getURL: (name) => `chrome-extension://test${name}`},
            storage: {local: {get: async () => ({[WORD_STATUS_KEY]: {version: 2, words: {charges: {s: 'learning', lemma: 'charge', senses: 1}}}})}},
        });
        const call = vi.fn();
        const popup = mountStuckHint({
            doc: document,
            getEntry: () => ({word: 'charges', sentence: 'Private current sentence with charges.', url: 'https://private.example'}),
            call,
            isCurrent: () => true,
            onChoice: vi.fn(),
        });
        document.body.replaceChildren(popup);
        const link = await vi.waitFor(() => {
            const anchor = popup.querySelector('a');
            expect(anchor).not.toBeNull();
            expect(anchor?.hidden).toBe(false);
            return /** @type {HTMLAnchorElement} */ (anchor);
        });
        const url = new URL(link.href);
        expect(url.pathname).toBe('/study-library.html');
        expect([...url.searchParams]).toEqual([['word', 'charge'], ['practice', 'word']]);
        expect(call).not.toHaveBeenCalled();

        makePageDom();
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        const previousUrl = location.href;
        const saved = {id: '2'.repeat(32),
            vaultSaved: true,
            entry: {
                word: 'charges',
                lemma: 'charge',
                sentence: 'She charges by the hour.',
                meaning: '收费',
                translation: '她按小时收费。',
                url: 'https://reading.example/story',
                title: 'A magazine',
            }};
        const unrelated = {id: '1'.repeat(32), vaultSaved: true, entry: {word: 'hour', sentence: 'An hour of charging is enough.'}};
        mocks.studyCall.mockImplementation(async (action, payload) => {
            if (action === 'libraryList') {
                const items = payload?.scope === 'word' && payload.word === 'charge' ? [saved] : [unrelated, saved];
                return {items, total: items.length, canSearch: true};
            }
            return [];
        });
        history.replaceState(null, '', url.search);
        try {
            await import('../ext/js/pages/study-library.js');
            const panel = /** @type {HTMLElement} */ (document.querySelector('#study-library-practice'));
            await vi.waitFor(() => expect(panel.hidden).toBe(false));
            expect(panel.textContent).toContain('练原句填空 · 1 / 1');
            expect(panel.textContent).toContain('She');
            expect(panel.textContent).not.toContain('charging');
            document.getElementById('study-library-cloze-button')?.click();
            expect(panel.hidden).toBe(true);
            const list = document.getElementById('study-library-list');
            expect(list?.textContent).toContain('她按小时收费。');
            expect(list?.textContent).toContain('A magazine');
            expect(list?.textContent).not.toContain('An hour of charging');
            expect(mocks.studyCall.mock.calls).toEqual([
                ['libraryList', {language: 'en', scope: 'word', word: 'charge', url: '', title: '', offset: 0}],
            ]);
            mocks.studyCall.mockRejectedValueOnce(new Error('不支持的学习库操作或字段。'));
            document.getElementById('study-library-refresh')?.click();
            const status = document.getElementById('study-library-status');
            await vi.waitFor(() => expect(status?.textContent).toContain('可先到「全部」搜索「charge」'));
            expect(mocks.studyCall.mock.calls).toHaveLength(2);
        } finally { history.replaceState(null, '', previousUrl); }
    });

    test('compares two saved uses of one sense in the existing practice panel', async () => {
        vi.resetModules();
        makePageDom();
        vi.stubGlobal('chrome', {runtime: {getURL: (name) => `chrome-extension://test${name}`}});
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        const previousUrl = location.href;
        const items = ['We run at sunrise.', 'She runs by the river.'].map((sentence, index) => ({
            id: String(index + 1).repeat(32),
            entry: {
                word: index === 0 ? 'run' : 'runs',
                sentence,
                context: 'A morning routine.',
                title: index === 0 ? 'Park journal' : 'River journal',
                url: `https://reading.example/story?id=${index}`,
                sense: {key: 'run#2', gloss: '跑步'},
            },
        }));
        mocks.studyCall.mockImplementation(async (action, payload) => {
            if (action !== 'libraryList') { return []; }
            return {items: [], total: 0, canSearch: true, ...(payload?.query === 'runs' ? {practiceExamples: items} : {})};
        });
        history.replaceState(null, '', '?query=runs');
        try {
            await import('../ext/js/pages/study-library.js');
            const start = /** @type {HTMLButtonElement} */ (document.querySelector('#study-library-practice-button'));
            await vi.waitFor(() => expect(start.hidden).toBe(false));
            expect(start.textContent).toBe('用旧原句看用法');
            const calls = mocks.studyCall.mock.calls.length;
            const panel = /** @type {HTMLElement} */ (document.querySelector('#study-library-practice'));
            start.click();
            expect(panel.hidden).toBe(false);
            expect([...panel.querySelectorAll('mark')].map((word) => word.textContent)).toEqual(['run', 'runs']);
            expect(panel.querySelectorAll('button')).toHaveLength(0);
            expect(panel.textContent).toContain('River journal');
            expect(panel.textContent).toContain('跑步');
            const links = [...panel.querySelectorAll('a')].filter((link) => link.textContent.includes('继续学习'));
            expect(links.map((link) => new URL(link.href).searchParams.get('studyRecordId'))).toEqual(items.map(({id}) => id));
            start.click();
            expect(panel.hidden).toBe(true);
            expect(mocks.studyCall.mock.calls).toHaveLength(calls);
        } finally { history.replaceState(null, '', previousUrl); }
    });

    test('cloze reads saved audio only on demand and discards it after the learner moves on', async () => {
        vi.resetModules();
        makePageDom();
        vi.stubGlobal('chrome', {runtime: {getURL: (name) => `chrome-extension://test${name}`}});
        const audio = deferPromise();
        const close = vi.fn().mockResolvedValue(void 0);
        const decodeAudioData = vi.fn();
        vi.stubGlobal('AudioContext', class {
            resume = vi.fn().mockResolvedValue(void 0);
            close = close;
            decodeAudioData = decodeAudioData;
        });
        const items = [
            {id: '1'.repeat(32), vaultSaved: true, entry: {word: 'built', sentence: 'We built a shelter.'}, media: {audio: {name: 'saved.webm'}}},
            {id: '2'.repeat(32), vaultSaved: true, entry: {word: 'charges', sentence: 'The bank charges a fee.'}},
        ];
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        mocks.studyCall.mockImplementation(async (action, payload) => {
            if (action === 'libraryList') { return {items, total: items.length, canSearch: true}; }
            if (action === 'libraryReconcile') { return items.find((item) => item.id === payload.id); }
            if (action === 'libraryAudioRead') { return audio.promise; }
            return [];
        });
        await import('../ext/js/pages/study-library.js');
        const start = /** @type {HTMLButtonElement} */ (document.querySelector('#study-library-cloze-button'));
        await vi.waitFor(() => expect(start.hidden).toBe(false));
        start.click();
        const panel = /** @type {HTMLElement} */ (document.querySelector('#study-library-practice'));
        const buttonNamed = (/** @type {string} */ name) => [...panel.querySelectorAll('button')].find((item) => item.textContent === name);
        expect(mocks.studyCall.mock.calls.filter(([action]) => action === 'libraryAudioRead')).toEqual([]);
        expect(buttonNamed('播放已存原声')).toBeDefined();
        buttonNamed('播放已存原声')?.click();
        await vi.waitFor(() => expect(mocks.studyCall).toHaveBeenCalledWith('libraryAudioRead', {id: items[0].id}));
        buttonNamed('直接看答案')?.click();
        expect(buttonNamed('播放已存原声')).toBeDefined();
        buttonNamed('下一句')?.click();
        expect(panel.textContent).toContain('The bank […] a fee.');
        expect(buttonNamed('播放已存原声')).toBeUndefined();
        expect(close).toHaveBeenCalledOnce();
        audio.resolve({parts: ['YQ==']});
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(decodeAudioData).not.toHaveBeenCalled();
        expect(mocks.studyCall.mock.calls.filter(([action]) => action === 'libraryAudioRead')).toEqual([['libraryAudioRead', {id: items[0].id}]]);
    });

    test('dictates only matching recordings, then reveals the complete sentence and returns to its record', async () => {
        vi.resetModules();
        makePageDom();
        vi.stubGlobal('chrome', {runtime: {getURL: (name) => `chrome-extension://test${name}`}});
        const startAudio = vi.fn();
        vi.stubGlobal('Blob', Blob);
        vi.stubGlobal('AudioContext', class {
            resume = vi.fn().mockResolvedValue(void 0);
            close = vi.fn().mockResolvedValue(void 0);
            decodeAudioData = vi.fn().mockResolvedValue({});
            createBufferSource = () => ({buffer: null, connect: vi.fn(), addEventListener: vi.fn(), start: startAudio});
        });
        const items = [
            {id: '1'.repeat(32), vaultSaved: true, entry: {word: 'silent', sentence: 'A silent record.'}},
            {id: '2'.repeat(32), vaultSaved: true, audioContextChanged: true, entry: {word: 'edited', sentence: 'An edited record.'}, media: {audio: {name: 'old.webm'}}},
            {id: '3'.repeat(32), vaultSaved: true, entry: {word: 'on', sentence: 'We went on and on!', translation: '我们接着说个不停！'}, media: {audio: {name: 'exact.webm'}}},
            {id: '4'.repeat(32), vaultSaved: true, entry: {word: 'loud', sentence: 'It was not only loud, but clear.'}, media: {audio: {name: 'later.webm'}}},
        ];
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        mocks.studyCall.mockImplementation(async (action, payload) => {
            if (action === 'libraryList') {
                if (payload.practice === 'dictation') { return {items: items.slice(1), total: 3}; }
                return {items: items.slice(0, 2), total: items.length, canSearch: true};
            }
            if (action === 'libraryAudioRead') { return {parts: ['YQ==']}; }
            return [];
        });
        await import('../ext/js/pages/study-library.js');
        const start = /** @type {HTMLButtonElement} */ (document.querySelector('#study-library-dictation-button'));
        const panel = /** @type {HTMLElement} */ (document.querySelector('#study-library-practice'));
        await vi.waitFor(() => expect(start.hidden).toBe(false));
        const baseline = mocks.studyCall.mock.calls.length;
        start.click();
        await vi.waitFor(() => expect(panel.textContent).toContain('1 / 2'));
        expect(panel.textContent).not.toContain('We went');
        expect(panel.textContent).not.toContain('我们接着');
        const find = ['libraryList', {language: 'en', scope: 'all', url: '', title: '', practice: 'dictation'}];
        expect(mocks.studyCall.mock.calls.slice(baseline)).toEqual([find]);
        /** @type {HTMLButtonElement} */ (panel.querySelector('button')).click();
        await vi.waitFor(() => expect(startAudio).toHaveBeenCalledOnce());
        const submit = (/** @type {string} */ answer) => {
            const field = /** @type {HTMLTextAreaElement} */ (panel.querySelector('textarea'));
            field.value = answer;
            field.form?.dispatchEvent(new Event('submit', {cancelable: true}));
        };
        const next = () => { /** @type {HTMLButtonElement} */ (panel.querySelector('[data-cloze-next]')).click(); };
        submit('we went on and on');
        expect(panel.textContent).toContain('和原句一致');
        expect(panel.textContent).toContain('We went on and on!');
        expect(panel.textContent).toContain('我们接着说个不停！');
        const link = /** @type {HTMLAnchorElement} */ (panel.querySelector('a'));
        expect(new URL(link.href).searchParams.get('studyRecordId')).toBe(items[2].id);
        next();
        expect(panel.textContent).toContain('2 / 2');
        expect(panel.textContent).not.toContain('but clear');
        submit('It was only loud but clearer');
        expect([...panel.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['clearer', 'not', 'clear']);
        expect(panel.textContent).toContain('It was not only loud, but clear.');
        next();
        expect(panel.textContent).toContain('本轮结束');
        expect(mocks.studyCall.mock.calls.slice(baseline)).toEqual([find, ['libraryAudioRead', {id: items[2].id}]]);
        [...panel.querySelectorAll('button')].find((b) => b.textContent === '重听没对上的 1 句')?.click();
        expect(panel.textContent).toContain('重听没对上的 · 1 / 1');
        expect(panel.textContent).not.toContain('but clear');
        /** @type {HTMLButtonElement} */ (panel.querySelector('button')).click();
        await vi.waitFor(() => expect(startAudio).toHaveBeenCalledTimes(2));
        expect(mocks.studyCall.mock.calls.slice(baseline)).toEqual([find, ['libraryAudioRead', {id: items[2].id}], ['libraryAudioRead', {id: items[3].id}]]);
        submit('it was not only loud but clear');
        expect(panel.textContent).toContain('和原句一致');
        next();
        expect(panel.textContent).not.toContain('重听没对上的');
    });

    test('continues dictation beyond the first five recordings without prefetching or autoplay', async () => {
        vi.resetModules();
        makePageDom();
        vi.stubGlobal('chrome', {runtime: {getURL: (name) => `chrome-extension://test${name}`}});
        const items = Array.from({length: 11}, (_, i) => ({
            id: (i + 1).toString(16).padStart(32, '0'),
            vaultSaved: true,
            entry: {word: 'recording', sentence: `This is recording ${i + 1}.`},
            media: {audio: {name: 'clip.webm'}},
        }));
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        mocks.studyCall.mockImplementation(async (action, payload) => {
            if (action !== 'libraryList') { return []; }
            const start = Number(payload.offset ?? 0);
            return {items: items.slice(start, start + 10), total: items.length, canSearch: true};
        });
        await import('../ext/js/pages/study-library.js');
        const start = /** @type {HTMLButtonElement} */ (document.querySelector('#study-library-dictation-button'));
        const panel = /** @type {HTMLElement} */ (document.querySelector('#study-library-practice'));
        const button = (/** @type {string} */ label) => [...panel.querySelectorAll('button')].find((item) => item.textContent === label);
        const offsets = () => mocks.studyCall.mock.calls
            .filter(([action, payload]) => action === 'libraryList' && payload.practice === 'dictation')
            .map(([, payload]) => payload.offset ?? 0);
        await vi.waitFor(() => expect(start.hidden).toBe(false));
        start.click();
        await vi.waitFor(() => expect(panel.textContent).toContain('练原声听写 · 1 / 5'));
        for (let i = 0; i < 5; ++i) { button('跳过')?.click(); }
        expect(offsets()).toEqual([0]);
        expect(button('练下一组')).toBeDefined();
        button('练下一组')?.click();
        await vi.waitFor(() => expect(panel.textContent).toContain('练原声听写 · 1 / 5'));
        button('直接看原句')?.click();
        expect(panel.textContent).toContain('This is recording 6.');
        button('下一句')?.click();
        for (let i = 0; i < 4; ++i) { button('跳过')?.click(); }
        expect(offsets()).toEqual([0]);
        button('练下一组')?.click();
        await vi.waitFor(() => expect(panel.textContent).toContain('练原声听写 · 1 / 1'));
        button('直接看原句')?.click();
        expect(panel.textContent).toContain('This is recording 11.');
        button('完成这轮')?.click();
        expect(button('练下一组')).toBeUndefined();
        expect(offsets()).toEqual([0, 10]);
        expect(mocks.studyCall.mock.calls.some(([action]) => action === 'libraryAudioRead')).toBe(false);
    });

    test('uses saved sentences for a short cloze without grading or changing the records', async () => {
        vi.resetModules();
        makePageDom();
        vi.stubGlobal('chrome', {runtime: {getURL: (name) => `chrome-extension://test${name}`}});
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        const entries = [
            {word: 'built', lemma: 'build', sentence: 'We built a shelter.', sense: {gloss: '搭建（built）'}},
            {word: 'play', sentence: 'The display is clear.'},
            {word: 'left', sentence: 'She left when he left.'},
            {word: 'charges', sentence: 'The bank charges a fee.', sense: {gloss: '收费'}},
        ];
        const items = entries.map((entry, index) => ({id: String(index + 1).repeat(32), vaultSaved: true, entry: {...entry, language: 'en', url: '', title: ''}}));
        mocks.studyCall.mockImplementation(async (action, payload) => {
            if (action === 'libraryList') { return {items, total: items.length, canSearch: true}; }
            if (action === 'libraryReconcile') { return items.find((item) => item.id === payload.id); }
            if (action === 'ankiToday') { return {paused: true}; }
            return [];
        });
        await import('../ext/js/pages/study-library.js');
        const start = /** @type {HTMLButtonElement} */ (document.querySelector('#study-library-cloze-button'));
        await vi.waitFor(() => expect(start.hidden).toBe(false));
        const reads = mocks.studyCall.mock.calls.length;
        start.click();
        const panel = /** @type {HTMLElement} */ (document.querySelector('#study-library-practice'));
        const search = /** @type {HTMLElement} */ (document.querySelector('#study-library-search'));
        expect(search.hidden).toBe(true);
        expect(panel.textContent).toContain('1 / 2');
        expect(panel.textContent).toContain('We […] a shelter.');
        expect(panel.textContent).toContain('搭建');
        expect(panel.textContent).not.toContain('built');
        const submit = (/** @type {string} */ input) => {
            const field = /** @type {HTMLInputElement} */ (panel.querySelector('input'));
            field.value = input;
            field.form?.dispatchEvent(new Event('submit', {cancelable: true}));
        };
        submit('build');
        expect(panel.textContent).toContain('和原句用词不同');
        expect(panel.textContent).toContain('We built a shelter.');
        /** @type {HTMLButtonElement} */ (panel.querySelector('[data-cloze-next]')).click();
        expect(panel.textContent).toContain('The bank […] a fee.');
        submit('Charges');
        expect(panel.textContent).toContain('和原句一致');
        expect(new URL(/** @type {HTMLAnchorElement} */ (panel.querySelector('a')).href).searchParams.get('studyRecordId')).toBe(items[3].id);
        /** @type {HTMLButtonElement} */ (panel.querySelector('[data-cloze-next]')).click();
        expect(panel.textContent).toContain('本轮结束');
        start.click();
        expect(panel.hidden).toBe(true);
        expect(search.hidden).toBe(false);
        expect(mocks.studyCall.mock.calls).toHaveLength(reads);
    });

    test('practice finds eligible sentences on the next source page without expanding the visible list', async () => {
        vi.resetModules();
        makePageDom();
        const url = 'https://reading.example/story?id=41#chapter';
        const previousUrl = location.href;
        history.replaceState(null, '', `?source=${encodeURIComponent(url)}`);
        vi.stubGlobal('chrome', {runtime: {getURL: (name) => `chrome-extension://test${name}`}});
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        const unfit = Array.from({length: 10}, (_, i) => ({
            id: String(i).padStart(32, '0'),
            entry: {word: 'play', sentence: 'We play whenever they play.', url},
            vaultSaved: true,
        }));
        const later = ['lamp', 'path', 'lake', 'gate', 'moon'].map((word, i) => ({
            id: String(i + 10).padStart(32, '0'),
            entry: {word, sentence: `We can see the ${word} at stop ${i + 1}.`, url},
            vaultSaved: true,
        }));
        const rows = [...unfit, ...later, ...Array.from({length: 20}, (_, i) => ({...unfit[0], id: String(i + 15).padStart(32, '0')}))];
        mocks.studyCall.mockImplementation(async (action, value) => {
            if (action !== 'libraryList') { throw new Error(`Unexpected call: ${action}`); }
            const offset = Number(value.offset);
            return {items: rows.slice(offset, offset + 10), total: rows.length, canSearch: true};
        });
        try {
            await import('../ext/js/pages/study-library.js');
            const start = /** @type {HTMLButtonElement} */ (document.querySelector('#study-library-cloze-button'));
            await vi.waitFor(() => expect(start.hidden).toBe(false));
            expect(mocks.studyCall.mock.calls).toEqual([['libraryList', {language: 'en', scope: 'source', url, title: '', offset: 0}]]);
            start.click();
            const panel = /** @type {HTMLElement} */ (document.querySelector('#study-library-practice'));
            await vi.waitFor(() => expect(panel.textContent).toContain('练原句填空 · 1 / 5'));
            expect(panel.textContent).toContain('We can see the […] at stop 1.');
            expect(mocks.studyCall.mock.calls).toEqual([0, 10].map((offset) => ['libraryList', {language: 'en', scope: 'source', url, title: '', offset}]));
            start.click();
            expect(document.querySelectorAll('#study-library-list article')).toHaveLength(10);
        } finally { history.replaceState(null, '', previousUrl); }
    });

    test('opening the library from an article reads only that source before any user action', async () => {
        vi.resetModules();
        makePageDom();
        const previousUrl = location.href;
        const url = 'https://reading.example/story?id=31#chapter';
        history.replaceState(null, '', `?source=${encodeURIComponent(url)}`);
        vi.stubGlobal('chrome', {runtime: {getURL: (name) => `chrome-extension://test${name}`}});
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        mocks.studyCall.mockResolvedValue({items: [], total: 0, canSearch: true});
        try {
            await import('../ext/js/pages/study-library.js');
            await vi.waitFor(() => expect(document.querySelector('#study-library-list').textContent).toContain('还没有在这页记过的原句'));
            expect(document.querySelector('[data-library-category="source"]').getAttribute('aria-pressed')).toBe('true');
            expect(mocks.studyCall.mock.calls).toEqual([['libraryList', {language: 'en', url, title: '', scope: 'source', offset: 0}]]);
        } finally {
            history.replaceState(null, '', previousUrl);
        }
    });

    test('a local video can be reviewed from the source shelf and dictation stays in that exact file scope', async () => {
        vi.resetModules();
        makePageDom();
        const previousUrl = location.href;
        const url = 'file:///examples/folder-a/lesson%20one.mp4#study-duration=120';
        history.replaceState(null, '', `?source=${encodeURIComponent(url)}&practice=dictation`);
        vi.stubGlobal('chrome', {runtime: {getURL: (name) => `chrome-extension://test${name}`}});
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        const row = {id: 'a'.repeat(32), vaultSaved: true, entry: {word: 'shelter', sentence: 'We built a shelter.', url, videoTime: 12}, media: {audio: {name: 'own-clip.webm'}}};
        mocks.studyCall.mockImplementation(async (_action, value) => (value?.scope === 'sources' ?
            {sources: [{url, title: '', records: 1, audio: 1}], total: 1, canSearch: true} :
            {items: [row], total: 1, canSearch: true}));
        try {
            const {createSourceLine} = await import('../ext/js/pages/study-library.js');
            const source = createSourceLine(row.entry, '', '', 'chrome-extension://test/study-library.html');
            expect(source?.querySelector('strong')?.textContent).toBe('lesson one.mp4');
            expect(source?.textContent).toContain('lesson one.mp4 · 0:12');
            const anchors = [...(source?.querySelectorAll('a') ?? [])];
            expect(anchors.map((a) => a.textContent)).toEqual(['同来源原句 ↗']);
            expect(new URL(anchors[0].href).searchParams.get('source')).toBe(url);
            await vi.waitFor(() => expect(document.querySelector('#study-library-practice').textContent).toContain('练原声听写 · 1 / 1'));
            expect(document.querySelector('[data-library-category="source"]').getAttribute('aria-pressed')).toBe('true');
            expect(/** @type {HTMLButtonElement} */ (document.querySelector('#study-library-listen-source')).hidden).toBe(true);
            const params = {language: 'en', url, title: '', scope: 'source'};
            expect(mocks.studyCall.mock.calls).toEqual([
                ['libraryList', {...params, offset: 0}], ['libraryList', {...params, practice: 'dictation'}],
            ]);
            document.querySelector('[data-library-category="sources"]').click();
            await vi.waitFor(() => expect(document.querySelector('#study-library-list [data-material] h2')?.textContent).toBe('lesson one.mp4'));
            const shelf = document.querySelector('#study-library-list [data-material]');
            expect(shelf?.textContent).toContain('/examples/folder-a/lesson one.mp4 · 1 条记录 · 1 条有原声');
            const links = [...(shelf?.querySelectorAll('a') ?? [])].map((a) => new URL(a.href));
            expect(links.map((link) => [link.protocol, link.searchParams.get('source'), link.searchParams.get('practice')])).toEqual([
                ['chrome-extension:', url, null], ['chrome-extension:', url, 'dictation'],
            ]);
            expect(mocks.studyCall.mock.calls.slice(2)).toEqual([['libraryList', {language: 'en', url: '', title: '', scope: 'sources', offset: 0}]]);
        } finally {
            history.replaceState(null, '', previousUrl);
        }
    });

    test('drops outdated list work but keeps the pending filter selected during loading', async () => {
        vi.resetModules();
        makePageDom();
        vi.stubGlobal('chrome', {runtime: {getURL: (path) => `chrome-extension://test${path}`}});
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        const pending = {id: 'a'.repeat(32),
            entry: {word: 'brick', sentence: 'A brick wall.', url: '', title: ''},
            vaultSaved: true,
            syncState: 'missing',
            ankiState: 'pending'};
        /** @type {() => void} */
        let release = () => {};
        const first = new Promise((resolve) => { release = () => resolve({items: [], total: 0}); });
        /** @type {() => void} */
        let releaseSync = () => {};
        const secondSync = new Promise((resolve) => { releaseSync = () => resolve([]); });
        let syncs = 0;
        mocks.studyCall.mockImplementation(async (action, value) => {
            if (action === 'syncPending') { return ++syncs === 2 ? secondSync : []; }
            if (action === 'saved') { return []; }
            if (action === 'libraryList') { return value.scope === 'pending' ? {items: [pending], total: 1, needsAttention: 1} : first; }
            if (action === 'libraryReconcile') { return pending; }
            if (action === 'ankiToday') { return {paused: true}; }
            throw new Error(`Unexpected call: ${action}`);
        });
        await import('../ext/js/pages/study-library.js');
        await vi.waitFor(() => expect(mocks.studyCall).toHaveBeenCalledWith('libraryList', expect.objectContaining({scope: 'all'})));
        document.querySelector('[data-library-category="favorites"]').click();
        release();
        await vi.waitFor(() => expect(syncs).toBe(2));
        document.querySelector('[data-library-category="pending"]').click();
        releaseSync();
        await vi.waitFor(() => expect(mocks.studyCall).toHaveBeenCalledWith('libraryList', expect.objectContaining({scope: 'pending'})));
        await vi.waitFor(() => expect(document.querySelector('[data-record-id] h2')?.textContent).toBe('brick'));
        expect(mocks.studyCall.mock.calls.filter(([action]) => action === 'libraryList')).toHaveLength(2);
        expect(document.querySelector('[data-library-category="pending"]').getAttribute('aria-pressed')).toBe('true');
        expect(document.querySelector('[data-library-category="pending"]').textContent).toBe('需处理 1');
    });

    test('an open favorites view follows local stars without calling a model or reloading all records', async () => {
        vi.resetModules();
        makePageDom();
        let changed;
        let rows = [];
        /** @type {Promise<unknown>|null} */
        let delayed = null;
        vi.stubGlobal('chrome', {runtime: {getURL: (path) => `chrome-extension://test${path}`}, storage: {onChanged: {addListener: /** @param {(changes: Record<string, unknown>, area: string) => void} listener */ (listener) => { changed = listener; }}}});
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        mocks.studyCall.mockImplementation(async (action) => {
            if (action === 'saved') {
                const result = delayed ?? rows;
                delayed = null;
                return result;
            }
            if (action === 'syncPending') { return []; }
            if (action === 'ankiToday') { return {paused: true}; }
            if (action === 'libraryList') { return {items: [], total: 0, canSearch: true}; }
            throw new Error(`Unexpected call: ${action}`);
        });
        await import('../ext/js/pages/study-library.js');
        await vi.waitFor(() => expect(document.querySelector('.study-library-empty')?.textContent).toContain('没有已读取'));
        document.querySelector('[data-library-category="favorites"]').click();
        await vi.waitFor(() => expect(document.querySelector('#study-library-status')?.textContent).toContain('本页 0 条已逐条核对'));
        expect(changed).toBeTypeOf('function');
        mocks.studyCall.mockClear();
        rows = [{id: 'new-star', word: 'absolutely', sentence: 'A public fixture.', url: '', title: ''}];
        changed({studySavedWordsV1: {}}, 'local');
        await vi.waitFor(() => expect(document.querySelector('[data-record-id="new-star"] h2')?.textContent).toBe('absolutely'));
        const snapshot = rows;
        /** @type {() => void} */
        let finishOld = () => {};
        delayed = new Promise((resolve) => { finishOld = () => resolve(snapshot); });
        changed({studySavedWordsV1: {}}, 'local');
        rows = [];
        changed({studySavedWordsV1: {}}, 'local');
        await vi.waitFor(() => expect(document.querySelector('[data-record-id="new-star"]')).toBeNull());
        finishOld();
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(document.querySelector('[data-record-id="new-star"]')).toBeNull();
        expect(mocks.studyCall.mock.calls.map(([action]) => action)).toEqual(['saved', 'saved', 'saved']);
    });

    test('previews use cards for the exact saved sentence without rating the learner or adding a card', async () => {
        vi.resetModules();
        const id = 'a'.repeat(32);
        const entry = {word: 'charge',
            sentence: 'They charge a fee.',
            meaning: '收费',
            translation: '他们要收费。',
            url: '',
            title: '',
            context: '',
            notes: '',
            explanationSource: '词典简释'};
        const record = {id, entry, ankiState: 'synced', ankiEnabled: true, noteId: 21, cards: [{kind: 'meaning', noteId: 21, state: 'synced'}]};
        vi.stubGlobal('chrome', {storage: {local: {get: async () => ({studyAutoSyncState: {upgrade: [{id}]}})}}});
        mocks.studyCall.mockResolvedValue([]);
        const panel = document.createElement('div');
        document.body.append(panel);
        const {mountStudyLibrary} = await import('../ext/js/display/study-library.js');
        const dispose = mountStudyLibrary(panel, () => entry, () => true);
        panel.dispatchEvent(new CustomEvent('study-record-current', {detail: record}));
        panel.querySelector('[data-study-add-card]').click();
        const hint = panel.querySelector('.study-card-upgrade');
        await vi.waitFor(() => expect(hint.hidden).toBe(false));
        hint.querySelector('button').click();
        expect([...panel.querySelectorAll('[data-study-card-kind]')].map((option) => option.value)).toEqual(['produce', 'cloze']);
        expect(panel.querySelector('[data-study-mastery][aria-checked=true]')).toBeNull();
        expect([...panel.querySelectorAll('[data-study-card-back]')].every((box) => box.value.includes(entry.sentence))).toBe(true);
        expect(mocks.studyCall.mock.calls.some(([action]) => action === 'libraryCardsAdd' || action === 'librarySave')).toBe(false);
        dispose();
    });

    test('wires the standard web selection scanner so Control can look up selected card text', async () => {
        vi.resetModules();
        makePageDom();
        vi.stubGlobal('chrome', {runtime: {getURL: (path) => `chrome-extension://test${path}`}});
        const application = makeApplication();
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(application));
        mocks.studyCall.mockImplementation(async (actionValue) => {
            switch (String(actionValue)) {
                case 'ankiToday': return {paused: true};
                case 'syncPending': return [];
                case 'saved': return [];
                case 'libraryList': return {items: [], total: 0};
                default: throw new Error(`Unexpected call: ${String(actionValue)}`);
            }
        });

        await import('../ext/js/pages/study-library.js');
        await vi.waitFor(() => expect(document.querySelector('.study-library-empty')?.textContent).toContain('没有已读取'));

        expect(mocks.ThemeController).toHaveBeenCalledWith(document.documentElement);
        expect(mocks.ThemeController.mock.results[0].value.prepare).toHaveBeenCalledOnce();
        expect(mocks.ThemeController.mock.results[0].value.theme).toBe('dark');
        expect(mocks.ThemeController.mock.results[0].value.siteOverride).toBe(true);
        expect(mocks.ThemeController.mock.results[0].value.updateTheme).toHaveBeenCalledOnce();
        expect(mocks.HotkeyHandler).toHaveBeenCalledOnce();
        expect(mocks.HotkeyHandler.mock.results[0].value.prepare).toHaveBeenCalledWith(application.crossFrame);
        expect(mocks.PopupFactory).toHaveBeenCalledWith(application);
        expect(mocks.PopupFactory.mock.results[0].value.prepare).toHaveBeenCalledOnce();
        expect(mocks.Frontend).toHaveBeenCalledWith(expect.objectContaining({
            application,
            pageType: 'web',
            depth: 0,
            parentPopupId: null,
            parentFrameId: null,
            useProxyPopup: false,
            canUseWindowPopup: true,
            allowRootFramePopupProxy: true,
            childrenSupported: true,
            browser: 'chrome',
        }));
        expect(mocks.Frontend.mock.calls[0][0].hotkeyHandler).toBe(mocks.HotkeyHandler.mock.results[0].value);
        expect(mocks.Frontend.mock.results[0].value.prepare).toHaveBeenCalledOnce();
        expect(mocks.studyCall.mock.calls.map(([action]) => action)).toEqual(['ankiToday', 'syncPending', 'saved', 'libraryList']);
    });

    test('keeps library loading when the lookup frontend cannot start', async () => {
        vi.resetModules();
        makePageDom();
        vi.stubGlobal('chrome', {runtime: {getURL: (path) => `chrome-extension://test${path}`}});
        const application = makeApplication();
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(application));
        mocks.Frontend.mockImplementationOnce(() => ({prepare: vi.fn().mockRejectedValue(new Error('lookup init failed'))}));
        mocks.studyCall.mockImplementation(async (actionValue) => {
            switch (String(actionValue)) {
                case 'ankiToday': return {paused: true};
                case 'syncPending': return [];
                case 'saved': return [];
                case 'libraryList': return {items: [], total: 0};
                default: throw new Error(`Unexpected call: ${String(actionValue)}`);
            }
        });

        await import('../ext/js/pages/study-library.js');
        await vi.waitFor(() => expect(document.querySelector('.study-library-empty')?.textContent).toContain('没有已读取'));
        await vi.waitFor(() => expect(document.querySelector('#study-library-status')?.textContent).toContain('lookup init failed'));
        expect(mocks.studyCall.mock.calls.map(([action]) => action)).toEqual(['ankiToday', 'syncPending', 'saved', 'libraryList']);
    });
    test('filters actual save state and keeps favorite-only rows out of learned saves', async () => {
        makePageDom();
        vi.resetModules();
        const {matchesCategory, createResumeUrl} = await import('../ext/js/pages/study-library.js');
        const record = {favorite: true, vaultSaved: true, ankiState: 'linked', cards: [{noteId: 12}], entry: {word: 'arrive'}};
        expect(matchesCategory(record, 'all')).toBe(true);
        expect(matchesCategory(record, 'favorites')).toBe(true);
        expect(matchesCategory(record, 'saved')).toBe(true);
        expect(matchesCategory(record, 'linked')).toBe(true);
        expect(matchesCategory(record, 'pending')).toBe(false);
        expect(matchesCategory({...record, ankiState: 'pending'}, 'pending')).toBe(true);
        expect(matchesCategory({...record, learningState: 'favorite-only'}, 'saved')).toBe(false);

        const url = createResumeUrl({
            id: 'abc123',
            entry: {word: 'arrive', sentence: 'We arrive at noon.', context: 'The train stops here.', url: 'https://example.com/watch', title: 'Lesson', videoTime: 42},
        }, 'chrome-extension://test');
        const parsed = new URL(url);
        expect(parsed.searchParams.get('query')).toBe('arrive');
        expect(parsed.searchParams.get('full')).toBe('We arrive at noon.');
        expect(parsed.searchParams.get('studySourceUrl')).toBe('https://example.com/watch');
        expect(parsed.searchParams.get('studySourceTitle')).toBe('Lesson');
        expect(parsed.searchParams.get('studyContext')).toBe('The train stops here.');
        expect(parsed.searchParams.get('studyVideoTime')).toBe('42');
        expect(parsed.searchParams.get('studyRecordId')).toBe('abc123');
    });

    test('loads local favorites, flushes pending work, reconciles listed records, and submits field choices', async () => {
        vi.resetModules();
        makePageDom();
        let changed;
        vi.stubGlobal('chrome', {runtime: {getURL: (path) => `chrome-extension://test${path}`}, storage: {onChanged: {addListener: /** @param {Function} f */ (f) => { changed = f; }}}});
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        const nativeRecord = {
            id: 'native-record-id',
            entry: {
                language: 'en',
                word: 'linger',
                sentence: 'We linger by the gate.',
                context: 'A train is late.',
                url: 'https://example.com/lesson',
                title: 'Lesson',
            },
            path: 'English/linger.md',
            openUrl: 'obsidian://open?file=linger',
            vaultSaved: true,
            ankiEnabled: true,
            ankiState: 'linked',
            noteId: 123,
            cards: [{noteId: 123}],
            favorite: false,
            conflicts: [{key: 'meaning', local: 'local meaning', remote: 'remote meaning'}],
        };
        let savedLocal = {
            id: 'real-local-id',
            word: 'linger',
            sentence: 'We linger by the gate.',
            context: 'A train is late.',
            url: 'https://example.com/lesson',
            title: 'Lesson',
            created: 1,
        };
        /** @type {{action: string, payload: Record<string, unknown>}[]} */
        const calls = [];
        mocks.studyCall.mockImplementation(/**
                                            * @param {unknown} actionValue
                                            * @param {unknown} payloadValue
                                            * @returns {Promise<unknown>}
                                            */ async (actionValue, payloadValue = {}) => {
                const action = String(actionValue);
                const payload = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (payloadValue));
                calls.push({action, payload});
                switch (action) {
                    case 'syncPending': return [];
                    case 'saved': return [savedLocal];
                    case 'libraryList': return {items: [nativeRecord], total: 1, target: {deck: 'English', model: 'Study'}};
                    case 'libraryReconcile':
                        return payload.resolutions ? {...nativeRecord, favorite: true, conflicts: []} : nativeRecord;
                    case 'saveWord':
                        savedLocal = {...savedLocal, libraryId: nativeRecord.id, syncPending: false};
                        return savedLocal;
                    default: throw new Error(`Unexpected call: ${action}`);
                }
            },
        );

        await import('../ext/js/pages/study-library.js');
        await vi.waitFor(() => expect(document.querySelector('.study-library-conflicts')).not.toBeNull());
        const initialCalls = calls.filter((call) => call.action !== 'ankiToday');
        expect(initialCalls.slice(0, 4).map((call) => call.action)).toEqual(['syncPending', 'saved', 'libraryList', 'libraryReconcile']);
        expect(initialCalls[2].payload).toMatchObject({scope: 'all', offset: 0, language: 'en'});
        expect(initialCalls[3].payload).toMatchObject({id: 'native-record-id', language: 'en'});
        expect(document.querySelector('.study-library-conflicts')).not.toBeNull();

        document.querySelector('[data-library-category="favorites"]').click();
        const localCard = await vi.waitFor(() => {
            const node = document.querySelector('[data-local-favorite-sync="real-local-id"]');
            expect(node).not.toBeNull();
            return node;
        });
        expect(localCard.closest('article').dataset.recordId).toBe('real-local-id');
        localCard.click();
        await vi.waitFor(() => expect(calls.some((call) => call.action === 'saveWord')).toBe(true));
        expect(calls.find((call) => call.action === 'saveWord').payload).toMatchObject({word: 'linger', sentence: 'We linger by the gate.', url: 'https://example.com/lesson'});
        await vi.waitFor(() => expect(calls.filter((call) => call.action === 'libraryReconcile').length).toBeGreaterThan(1));
        expect(calls.filter((call) => call.action === 'libraryReconcile').every((call) => call.payload.id === 'native-record-id')).toBe(true);

        document.querySelector('[data-library-category="all"]').click();
        const localChoice = document.querySelector('.study-library-conflicts input[value="local"]');
        localChoice.checked = true;
        localChoice.focus();
        changed({studyWordStatus: {newValue: {words: {linger: {s: 'known', manualKnown: true}}}}}, 'local');
        expect(document.activeElement).toBe(localChoice);
        expect(document.querySelector('.study-library-conflicts input:checked')).toBe(localChoice);
        document.querySelector('.study-library-conflicts button').click();
        await vi.waitFor(() => expect(calls.some((call) => call.action === 'libraryReconcile' && Boolean(call.payload.resolutions))).toBe(true));
        const submission = calls.find((call) => call.action === 'libraryReconcile' && call.payload.resolutions);
        expect(submission?.payload.resolutions).toEqual({meaning: 'local'});
    });

    test('keeps the list snapshot visible but labels it unverified when reconciliation fails', async () => {
        vi.resetModules();
        makePageDom();
        vi.stubGlobal('chrome', {runtime: {getURL: (path) => `chrome-extension://test${path}`}});
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        const record = {
            id: 'stale-native-id',
            entry: {language: 'en', word: 'linger', sentence: 'We linger by the gate.', context: '', url: '', title: ''},
            path: 'English/linger.md',
            openUrl: 'obsidian://open?file=linger',
            vaultSaved: true,
            ankiState: 'linked',
            noteId: 456,
            cards: [{noteId: 456}],
        };
        mocks.studyCall.mockImplementation(/**
                                            * @param {unknown} actionValue
                                            * @returns {Promise<unknown>}
                                            */ async (actionValue) => {
                switch (String(actionValue)) {
                    case 'syncPending': return [];
                    case 'saved': return [];
                    case 'libraryList': return {items: [record], total: 1};
                    case 'libraryReconcile': throw new Error('Anki is unavailable');
                    default: throw new Error(`Unexpected call: ${String(actionValue)}`);
                }
            },
        );

        await import('../ext/js/pages/study-library.js');
        await vi.waitFor(() => expect(document.querySelector('.study-library-state')?.textContent).toContain('未核对最新状态'));
        expect(document.querySelector('[data-record-id="stale-native-id"]')?.textContent).toContain('linger');
        expect(document.querySelector('[data-record-id="stale-native-id"]')?.textContent).toContain('Anki is unavailable');
    });

    test('shows continue learning and human source before hiding technical details', async () => {
        vi.resetModules();
        makePageDom();
        vi.stubGlobal('chrome', {runtime: {getURL: (path) => `chrome-extension://test${path}`}});
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        const record = {
            id: 'readable-record',
            entry: {
                language: 'en',
                word: 'arrive',
                sentence: 'We arrive at the station before noon.',
                context: 'The train is early today.',
                url: 'https://example.com/station',
                title: 'A Morning at the Station',
                subtitleSource: {version: 1, locator: {start: 12, end: 18}, provenance: {tabId: 8675309}},
            },
            path: 'English/arrive.md',
            openUrl: 'obsidian://open?file=arrive',
            vaultSaved: true,
            ankiEnabled: true,
            ankiState: 'linked',
            noteId: 123,
            cards: [{noteId: 123}],
            favorite: true,
        };
        mocks.studyCall.mockImplementation(async (actionValue) => {
            switch (String(actionValue)) {
                case 'syncPending': return [];
                case 'saved': return [];
                case 'libraryList': return {items: [record], total: 1};
                case 'libraryReconcile': return record;
                default: throw new Error(`Unexpected call: ${String(actionValue)}`);
            }
        });

        await import('../ext/js/pages/study-library.js');
        const card = await vi.waitFor(() => {
            const node = document.querySelector('[data-record-id="readable-record"]');
            expect(node).not.toBeNull();
            return node;
        });

        expect(card.querySelector('.study-library-primary-action')?.textContent).toBe('继续学习 ↗');
        expect(card.querySelector('.study-library-source')?.textContent).toContain('A Morning at the Station');
        expect(card.querySelector('.study-library-state')?.textContent).toContain('笔记已保存');
        expect(card.querySelector('.study-library-context')?.textContent).toBe('The train is early today.');
        const details = card.querySelector('details.study-library-technical-details');
        expect(details).not.toBeNull();
        expect(details.open).toBe(false);
        expect(details.querySelector('.study-library-path')?.textContent).toContain('English/arrive.md');
        expect(details.querySelector('pre')?.textContent).toContain('8675309');
        expect(details.querySelector('pre')?.textContent).toContain('"locator"');
        expect(card.querySelector('.study-library-path')?.closest('details')).toBe(details);
        const visibleText = [...card.children]
            .filter((node) => node.tagName !== 'DETAILS')
            .map((node) => node.textContent)
            .join(' ');
        expect(visibleText).not.toContain('English/arrive.md');
        expect(visibleText).not.toContain('8675309');
        expect(visibleText).not.toContain('"locator"');
        expect(card.querySelector('.study-library-primary-action')?.getAttribute('href')).toContain('studyRecordId=readable-record');
    });

    test('hides the known legacy article locator JSON from context and keeps its title as the source', async () => {
        vi.resetModules();
        makePageDom();
        vi.stubGlobal('chrome', {runtime: {getURL: (path) => `chrome-extension://test${path}`}});
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        const legacyContext = '{"kind":"article","locator":"chapter-3#paragraph-8","position":"paragraph 8","title":"A Chapter About Trains"}';
        const record = {
            id: 'legacy-article-record',
            entry: {language: 'en', word: 'linger', sentence: 'We linger by the gate.', context: legacyContext, url: '', title: ''},
            favorite: false,
        };
        mocks.studyCall.mockImplementation(async (actionValue) => {
            switch (String(actionValue)) {
                case 'syncPending': return [];
                case 'saved': return [];
                case 'libraryList': return {items: [record], total: 1};
                case 'libraryReconcile': return record;
                default: throw new Error(`Unexpected call: ${String(actionValue)}`);
            }
        });

        await import('../ext/js/pages/study-library.js');
        const card = await vi.waitFor(() => {
            const node = document.querySelector('[data-record-id="legacy-article-record"]');
            expect(node).not.toBeNull();
            return node;
        });
        expect(card.querySelector('.study-library-context')).toBeNull();
        expect(card.querySelector('.study-library-source')?.textContent).toContain('A Chapter About Trains');
        const details = card.querySelector('details.study-library-technical-details');
        expect(details?.open).toBe(false);
        expect(details?.querySelector('pre')?.textContent).toContain('"kind"');
        expect(details?.querySelector('pre')?.textContent).toContain('chapter-3#paragraph-8');
        const visibleText = [...card.children]
            .filter((node) => node.tagName !== 'DETAILS')
            .map((node) => node.textContent)
            .join(' ');
        expect(visibleText).not.toContain('chapter-3#paragraph-8');
        expect(visibleText).not.toContain('"kind"');
        const primaryAction = /** @type {HTMLAnchorElement} */ (card.querySelector('.study-library-primary-action'));
        const resumeUrl = new URL(primaryAction.href);
        expect(resumeUrl.searchParams.get('studyContext')).toBe('');
        expect(resumeUrl.searchParams.get('studySourceTitle')).toBe('A Chapter About Trains');
    });

    test('exports the collected local favorites and clears them through unstar actions without deleting records', async () => {
        vi.resetModules();
        makePageDom();
        vi.stubGlobal('chrome', {runtime: {getURL: (path) => `chrome-extension://test${path}`}});
        const confirm = vi.fn(() => true);
        vi.stubGlobal('confirm', confirm);
        const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        class CapturingBlob {
            /**
             * @param {string[]} parts
             * @param {{type?: string}} options
             */
            constructor(parts, options = {}) {
                /** @type {string[]} */
                this.parts = parts;
                /** @type {string} */
                this.type = options.type ?? '';
            }
        }
        class TestURL extends URL {
            /**
             * @param {Blob} _blob
             * @returns {string}
             */
            static createObjectURL(_blob) { return 'blob:test-study-library'; }
            /** @param {string} _url */
            static revokeObjectURL(_url) {}
        }
        const createObjectURL = vi.spyOn(TestURL, 'createObjectURL').mockReturnValue('blob:test-study-library');
        vi.spyOn(TestURL, 'revokeObjectURL');
        vi.stubGlobal('Blob', CapturingBlob);
        vi.stubGlobal('URL', TestURL);
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        const record = {
            id: 'kept-library-record',
            entry: {language: 'en', word: 'stay', sentence: 'Please stay here.', context: '', url: '', title: ''},
            path: 'English/stay.md',
            openUrl: 'obsidian://open?file=stay',
            vaultSaved: true,
            ankiEnabled: true,
            ankiState: 'linked',
            noteId: 987,
            cards: [{noteId: 987}],
            favorite: true,
        };
        let savedRows = [
            {id: 'sync-fav', libraryId: 'kept-library-record', syncPending: true, word: 'stay', sentence: 'Please stay here.', context: '', url: '', title: '', created: 1},
            {id: 'legacy-fav', word: 'arrive', sentence: 'We arrive at noon.', context: '', url: '', title: 'Legacy lesson', created: 2},
            {id: 'failing-fav', word: 'wait', sentence: 'We wait here.', context: '', url: '', title: 'Pending lesson', created: 3},
        ];
        /** @type {{action: string, payload: Record<string, unknown>}[]} */
        const calls = [];
        mocks.studyCall.mockImplementation(/**
                                            * @param {unknown} actionValue
                                            * @param {unknown} [payloadValue]
                                            * @returns {Promise<unknown>}
                                            */ async (actionValue, payloadValue = {}) => {
                const action = String(actionValue);
                const payload = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (payloadValue));
                calls.push({action, payload});
                switch (action) {
                    case 'ankiToday': return {paused: true};
                    case 'syncPending': return [];
                    case 'saved': return [...savedRows];
                    case 'libraryList': return {items: [record], total: 1};
                    case 'libraryReconcile': return record;
                    case 'removeWord':
                        if (payload.id === 'failing-fav') { throw new Error('收藏暂时无法移除'); }
                        if (payload.id === 'sync-fav') { record.favorite = false; }
                        savedRows = savedRows.filter((row) => row.id !== payload.id);
                        return true;
                    default: throw new Error(`Unexpected call: ${action}`);
                }
            },
        );

        await import('../ext/js/pages/study-library.js');
        await vi.waitFor(() => expect(document.querySelector('[data-record-id="kept-library-record"]')).not.toBeNull());

        document.getElementById('study-library-export-saved').click();
        await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
        const exported = /** @type {{parts: string[], type: string}} */ (/** @type {unknown} */ (createObjectURL.mock.calls[0][0]));
        expect(exported.type).toBe('application/json');
        const exportedData = /** @type {{format: string, saved: {id: string}[]}} */ (parseJson(exported.parts.join('')));
        expect(exportedData.format).toBe('study-saved-v1');
        expect(exportedData.saved.map(({id}) => id)).toEqual(['sync-fav', 'legacy-fav', 'failing-fav']);
        expect(document.getElementById('study-library-status').textContent).toContain('未加载的原生收藏不会自动读入');

        document.getElementById('study-library-clear-saved').click();
        await vi.waitFor(() => expect(calls.filter((call) => call.action === 'removeWord')).toHaveLength(3));
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining('保留 Obsidian 笔记和 Anki 卡片'));
        expect(calls.filter((call) => call.action === 'removeWord').map((call) => call.payload.id)).toEqual(['sync-fav', 'legacy-fav', 'failing-fav']);
        expect(calls.some((call) => call.action === 'clearSaved')).toBe(false);
        expect(calls.some((call) => /delete/i.test(call.action))).toBe(false);
        await vi.waitFor(() => expect(document.getElementById('study-library-status').textContent).toContain('已移除 2 条 · 1 条未完成'));
        expect(document.querySelector('[data-record-id="kept-library-record"]')).not.toBeNull();
        const clearedRecord = document.querySelector('[data-record-id="kept-library-record"]');
        expect(clearedRecord?.textContent).toContain('Anki 查看');
        expect(clearedRecord?.querySelector('[aria-pressed="false"]')?.textContent).toBe('☆ 收藏');
        document.querySelector('[data-library-category="favorites"]').click();
        await vi.waitFor(() => expect(document.getElementById('study-library-status').textContent).toContain('本页 1 条已逐条核对'));
        expect(document.querySelector('[data-record-id="kept-library-record"]')).toBeNull();
        expect(document.querySelector('[data-record-id="failing-fav"]')).not.toBeNull();
        document.querySelector('[data-library-category="all"]').click();
        await vi.waitFor(() => expect(document.getElementById('study-library-status').textContent).toContain('本页 1 条已逐条核对'));
        expect(document.querySelector('[data-record-id="kept-library-record"]')?.textContent).toContain('Anki 查看');
        expect(savedRows.map((row) => row.id)).toEqual(['failing-fav']);
        expect(downloadClick).toHaveBeenCalledOnce();
    });
});
