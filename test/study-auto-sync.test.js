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

import {afterEach, expect, test, vi} from 'vitest';
import {deferPromise} from '../ext/js/core/utilities.js';
import {describeAutoSync} from '../ext/js/pages/auto-sync-settings.js';
import {AUTO_SYNC_KEY, AUTO_SYNC_STATE_KEY, WORD_STATUS_KEY} from '../ext/js/study/study-data.js';
import {StudyService} from '../ext/js/study/study-service.js';

afterEach(() => { vi.unstubAllGlobals(); });

/**
 * @param {Record<string, unknown>} data
 * @param {(payload: object) => (import('study').NativeResult|Promise<import('study').NativeResult>)} reply
 * @returns {{service: StudyService, sent: unknown[]}}
 */
function make(data, reply) {
    /** @type {unknown[]} */
    const sent = [];
    const service = new StudyService({get: async (key) => ({[key]: data[key]}), set: async (values) => { Object.assign(data, values); }}, (payload) => {
        sent.push(payload);
        return {cancel() {}, promise: Promise.resolve(reply(payload))};
    });
    return {service, sent};
}

test('a pass syncs once, refreshes the daily badge and keeps its summary', async () => {
    const setBadgeText = vi.fn();
    vi.stubGlobal('chrome', {permissions: {contains: async () => true}, action: {setBadgeText}});
    /** @type {Record<string, unknown>} */
    const data = {};
    const {service, sent} = make(data, (payload) => ({ok: true, library: 'action' in payload && payload.action === 'ankiToday' ? {due: 3} : {synced: 2, conflicts: 1, upgrade: [{id: 'a', word: 'brick'}]}}));
    await service.autoSync();
    expect(sent).toEqual([{action: 'libraryAutoSync'}, {action: 'ankiToday'}]);
    expect(setBadgeText).toHaveBeenCalledWith({text: '3'});
    expect(data[AUTO_SYNC_STATE_KEY]).toMatchObject({synced: 2, conflicts: 1});
    expect(describeAutoSync(data[AUTO_SYNC_STATE_KEY])).toMatch(/同步了 2 条 · 1 条有冲突.*1 个词可以加“会用”卡/);
});

test('the pass stays quiet when switched off or without the bridge permission', async () => {
    vi.stubGlobal('chrome', {permissions: {contains: async () => false}});
    const off = make({[AUTO_SYNC_KEY]: {enabled: true}}, () => ({ok: true, library: {}}));
    await off.service.autoSync();
    expect(off.sent).toEqual([]);
    vi.stubGlobal('chrome', {permissions: {contains: async () => true}});
    const disabled = make({[AUTO_SYNC_KEY]: {enabled: false}}, () => ({ok: true, library: {}}));
    await disabled.service.autoSync();
    expect(disabled.sent).toEqual([]);
});

test('a failed pass is recorded without throwing', async () => {
    vi.stubGlobal('chrome', {permissions: {contains: async () => true}, action: {setBadgeText: vi.fn()}});
    /** @type {Record<string, unknown>} */
    const data = {};
    const {service} = make(data, () => ({ok: false, error: 'Anki 未打开'}));
    await service.autoSync();
    expect(describeAutoSync(data[AUTO_SYNC_STATE_KEY])).toContain('Anki 未打开');
    expect(describeAutoSync(void 0)).toContain('还没有运行过');
});

test('a late refresh cannot mark a word known again after undo', async () => {
    vi.stubGlobal('chrome', {permissions: {contains: async () => true}});
    const started = deferPromise();
    const release = deferPromise();
    /** @type {Record<string, unknown>} */
    const data = {};
    let known = true;
    const {service, sent} = make(data, async (payload) => {
        const {action} = /** @type {{action: string}} */ (payload);
        if (action === 'libraryMarkKnown') {
            known = false;
            return {ok: true, library: {manualKnown: false}};
        }
        if (action === 'knownWords') { return {ok: true, library: {known: [], ignored: []}}; }
        const charge = {s: known ? 'known' : 'partial', manualKnown: known, iv: 33};
        if (known) {
            started.resolve(void 0);
            await release.promise;
        }
        return {ok: true, library: {version: 2, words: {charge, charges: charge}}};
    });
    const older = service.refreshWordStatus();
    await started.promise;
    await service.handle('libraryMarkKnown', {word: 'charges', known: false});
    release.resolve(void 0);
    await older;
    expect(data[WORD_STATUS_KEY]).toMatchObject({words: {charge: {s: 'partial', iv: 33}, charges: {manualKnown: false}}});
    expect(sent).toEqual([{action: 'libraryWordStatus'}, {action: 'libraryMarkKnown', word: 'charges', known: false}, {action: 'libraryWordStatus'}]);
});
