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

const mocks = vi.hoisted(() => ({
    studyCall: vi.fn(),
    applicationMain: vi.fn(),
}));

vi.mock('../ext/js/study/study-client.js', () => ({studyCall: mocks.studyCall}));
vi.mock('../ext/js/application.js', () => ({Application: {main: mocks.applicationMain}}));

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    document.body.replaceChildren();
});

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
            <section id="study-library-list"></section>
            <button id="study-library-more"></button>
        </main>`;
}

describe('study library page', () => {
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
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback({api: {viewNotes: vi.fn()}}));
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
        mocks.applicationMain.mockImplementation(async (_enabled, callback) => callback({api: {viewNotes: vi.fn()}}));
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
});
