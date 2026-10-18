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

import {afterEach, describe, expect, test, vi} from 'vitest';
import {parseJson} from '../dev/json.js';

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
            <button data-library-category="all" aria-pressed="true">全部</button>
            <button data-library-category="favorites" aria-pressed="false">收藏</button>
            <button data-library-category="saved" aria-pressed="false">已保存</button>
            <button data-library-category="linked" aria-pressed="false">关联卡</button>
            <button data-library-category="pending" aria-pressed="false">待同步</button>
            <input id="study-library-search">
            <button id="study-library-refresh"></button>
            <button id="study-library-export-saved">导出已收集收藏</button>
            <button id="study-library-clear-saved">清空已收集收藏</button>
            <section id="study-library-list"></section>
            <button id="study-library-more"></button>
        </main>`;
}

describe('study library page', () => {
    test('an open favorites view follows local stars without calling a model or reloading all records', async () => {
        vi.resetModules();
        makePageDom();
        let changed;
        let rows = [];
        vi.stubGlobal('chrome', {runtime: {getURL: (path) => `chrome-extension://test${path}`}, storage: {onChanged: {addListener: /** @param {(changes: Record<string, unknown>, area: string) => void} listener */ (listener) => { changed = listener; }}}});
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(makeApplication()));
        mocks.studyCall.mockImplementation(async (action) => {
            if (action === 'saved') { return rows; }
            if (action === 'syncPending') { return []; }
            if (action === 'libraryList') { return {items: [], total: 0}; }
            throw new Error(`Unexpected call: ${action}`);
        });
        await import('../ext/js/pages/study-library.js');
        await vi.waitFor(() => expect(document.querySelector('.study-library-empty')?.textContent).toContain('没有已读取'));
        document.querySelector('[data-library-category="favorites"]').click();
        expect(changed).toBeTypeOf('function');
        mocks.studyCall.mockClear();
        rows = [{id: 'new-star', word: 'absolutely', sentence: 'A public fixture.', url: '', title: ''}];
        changed({studySavedWordsV1: {}}, 'local');
        await vi.waitFor(() => expect(document.querySelector('[data-record-id="new-star"] h2')?.textContent).toBe('absolutely'));
        rows = [];
        changed({studySavedWordsV1: {}}, 'local');
        await vi.waitFor(() => expect(document.querySelector('[data-record-id="new-star"]')).toBeNull());
        expect(mocks.studyCall.mock.calls.map(([action]) => action)).toEqual(['saved', 'saved']);
    });

    test('wires the standard web selection scanner so Control can look up selected card text', async () => {
        vi.resetModules();
        makePageDom();
        vi.stubGlobal('chrome', {runtime: {getURL: (path) => `chrome-extension://test${path}`}});
        const application = makeApplication();
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback(application));
        mocks.studyCall.mockImplementation(async (actionValue) => {
            switch (String(actionValue)) {
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
        expect(mocks.studyCall.mock.calls.map(([action]) => action)).toEqual(['syncPending', 'saved', 'libraryList']);
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
                case 'syncPending': return [];
                case 'saved': return [];
                case 'libraryList': return {items: [], total: 0};
                default: throw new Error(`Unexpected call: ${String(actionValue)}`);
            }
        });

        await import('../ext/js/pages/study-library.js');
        await vi.waitFor(() => expect(document.querySelector('.study-library-empty')?.textContent).toContain('没有已读取'));
        await vi.waitFor(() => expect(document.querySelector('#study-library-status')?.textContent).toContain('lookup init failed'));
        expect(mocks.studyCall.mock.calls.map(([action]) => action)).toEqual(['syncPending', 'saved', 'libraryList']);
    });
    test('filters actual save state and keeps favorite-only rows out of learned saves', async () => {
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
        vi.stubGlobal('chrome', {runtime: {getURL: (path) => `chrome-extension://test${path}`}});
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
        expect(calls.slice(0, 4).map((call) => call.action)).toEqual(['syncPending', 'saved', 'libraryList', 'libraryReconcile']);
        expect(calls[2].payload).toMatchObject({scope: 'all', offset: 0, language: 'en'});
        expect(calls[3].payload).toMatchObject({id: 'native-record-id', language: 'en'});
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
                    case 'syncPending': return [];
                    case 'saved': return [...savedRows];
                    case 'libraryList': return {items: [record], total: 1};
                    case 'libraryReconcile': return record;
                    case 'removeWord':
                        if (payload.id === 'failing-fav') { throw new Error('收藏暂时无法移除'); }
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
        expect(document.querySelector('[data-record-id="kept-library-record"]')).toBeNull();
        expect(document.querySelector('[data-record-id="failing-fav"]')).not.toBeNull();
        document.querySelector('[data-library-category="all"]').click();
        expect(document.querySelector('[data-record-id="kept-library-record"]')?.textContent).toContain('Anki 查看');
        expect(savedRows.map((row) => row.id)).toEqual(['failing-fav']);
        expect(downloadClick).toHaveBeenCalledOnce();
    });
});
