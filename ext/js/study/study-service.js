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

import {CACHE_KEY, CACHE_LIMIT, DETAIL_KEY, detailSource, DICTIONARY_CACHE_KEY, dictionaryKey, dictionaryLookup, isDictionaryResult, isStudyResult, resultKey, SAVED_KEY, sentenceKey, SETTINGS_KEY, studyConfig, studyLookup, TTL} from './study-data.js';
import {nativeStudyCall} from './study-client.js';

export class StudyService {
    /**
     *
     * @param {import('study').Storage} storage
     * @param {import('study').NativeCall} [native]
     */
    constructor(storage, native = nativeStudyCall) {
        /** @type {import('study').Storage} */
        this.storage = storage;
        /** @type {import('study').NativeCall} */
        this.native = native;
        /** @type {Map<string, {promise: Promise<import('study').Result>, cancel: () => void}>} */
        this.pending = new Map();
        /** @type {Map<string, {promise: Promise<import('study').DictionaryResult>, cancel: () => void, lookup: import('study').DictionaryLookup}>} */
        this.dictionaryPending = new Map();
        /** @type {number} */
        this.epoch = 0;
        /** @type {Promise<void>} */
        this.writes = Promise.resolve();
    }

    /**
     * @param {string} key
     * @returns {Promise<unknown>}
     */
    async read(key) {
        await this.writes;
        return (await this.storage.get(key))[key];
    }

    /**
     *
     * @param {string} key
     * @param {(value: unknown) => unknown} change
     */
    async write(key, change) {
        const operation = this.writes.then(async () => {
            const value = (await this.storage.get(key))[key];
            await this.storage.set({[key]: change(value)});
        });
        this.writes = operation.catch(() => {});
        await operation;
    }

    /**
     * @returns {Promise<import('study').CacheEntry[]>}
     */
    async cache() {
        const rows = this.rows(await this.read(CACHE_KEY));
        return rows.filter((r) => typeof r.created === 'number' && r.created > Date.now() - TTL && isStudyResult(r.result)).slice(-CACHE_LIMIT);
    }

    /**
     * @param {unknown} value
     * @returns {import('study').CacheEntry[]}
     */
    rows(value) {
        return Array.isArray(value) ? value : [];
    }

    /**
     *
     * @param {string} action
     * @param {unknown} value
     * @returns {Promise<unknown>}
     */
    async handle(action, value) {
        if (action === 'settings') {
            return studyConfig(await this.read(SETTINGS_KEY));
        }
        if (action === 'saveSettings') {
            const config = studyConfig(value);
            if (!config.cacheEnabled) {
                ++this.epoch;
                await this.write(CACHE_KEY, () => []);
                await this.write(DICTIONARY_CACHE_KEY, () => []);
            }
            await this.write(SETTINGS_KEY, () => config);
            return config;
        }
        if (action === 'models') {
            const response = await this.native({action: 'models'}).promise;
            if (!response.ok || !Array.isArray(response.models)) {
                throw new Error(response.error ?? '无法获取模型列表。');
            }
            return response.models;
        }
        if (action === 'clearCache') {
            ++this.epoch;
            await this.write(CACHE_KEY, () => []);
            await this.write(DICTIONARY_CACHE_KEY, () => []);
            return true;
        }
        if (action === 'storeDetail') {
            const row = {id: crypto.randomUUID(), source: detailSource(value), created: Date.now()};
            await this.write(DETAIL_KEY, (v) => [...(/** @type {import('study').DetailSnapshot[]} */ (Array.isArray(v) ? v : [])).filter((r) => r.created > Date.now() - TTL), row].slice(-20));
            return row;
        }
        if (action === 'detail') {
            const id = (/** @type {{id?: unknown}} */ (value ?? {})).id;
            if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) { throw new Error('详解编号无效。'); }
            const rows = await this.read(DETAIL_KEY);
            return (Array.isArray(rows) ? rows : []).find((r) => r.id === id && r.created > Date.now() - TTL) ?? null;
        }
        if (['dictionaryPeek', 'dictionaryGenerate', 'dictionaryCancel'].includes(action)) { return this.dictionary(action, value); }
        if (action === 'saved') {
            const rows = await this.read(SAVED_KEY);
            return Array.isArray(rows) ? rows : [];
        }
        if (action === 'clearSaved') {
            await this.write(SAVED_KEY, () => []);
            return true;
        }
        if (action === 'removeWord') {
            const {id} = /** @type {{id: string}} */ (value);
            await this.write(SAVED_KEY, (v) => (Array.isArray(v) ? v : []).filter((r) => r.id !== id));
            return true;
        }
        const lookup = studyLookup(value);
        const config = studyConfig(await this.read(SETTINGS_KEY));
        const key = resultKey(lookup, config);
        const skey = sentenceKey(lookup, config);
        if (action === 'saveWord') {
            const source = /** @type {{url?: string, title?: string, videoTime?: number}} */ (value);
            let url = '';
            try {
                const parsed = new URL(source.url ?? '');
                if (['https:', 'http:'].includes(parsed.protocol)) {
                    url = parsed.href.slice(0, 2000);
                }
            } catch { /* Local/plain source has no web URL. */ }
            const videoTime = typeof source.videoTime === 'number' && Number.isFinite(source.videoTime) && source.videoTime >= 0 ? Math.floor(source.videoTime) : void 0;
            if (videoTime !== void 0 && url) {
                const link = new URL(url);
                if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(link.hostname)) {
                    link.searchParams.set('t', `${videoTime}s`);
                    url = link.href;
                }
            }
            const row = {id: crypto.randomUUID(), ...lookup, url, title: String(source.title ?? '').slice(0, 300), videoTime, created: Date.now()};
            await this.write(SAVED_KEY, (v) => {
                const rows = (/** @type {import('study').SavedWord[]} */ (Array.isArray(v) ? v : [])).filter((r) => r.word !== lookup.word || r.sentence !== lookup.sentence || r.url !== url);
                if (rows.length >= 200) { throw new Error('本地收藏已满（200 条）；请先导出并手动清理，不会自动删除旧收藏。'); }
                return [...rows, row];
            });
            return row;
        }
        const cache = config.cacheEnabled ? await this.cache() : [];
        const exact = [...cache].reverse().find((r) => r.key === key) ??
        (lookup.mode ? void 0 : [...cache].reverse().find((r) => r.key === resultKey({...lookup, mode: 'translate'}, config)));
        if (action === 'peek') {
            return {result: exact?.result ?? null,
                translation: [...cache].reverse().find((r) => r.sentenceKey === skey)?.result.translation ?? null,
                busy: this.pending.has(key) || this.pending.has(resultKey({...lookup, mode: 'translate'}, config))};
        }
        if (action === 'cancel') {
            for (const mode of ['translate', 'explain']) {
                this.pending.get(resultKey({...lookup, mode}, config))?.cancel();
            }
            return true;
        }
        if (action !== 'generate') {
            throw new Error('未知的学习操作。');
        }
        if (exact) {
            return {result: exact.result, cached: true};
        }
        const sharedTranslation = [...cache].reverse().find((r) => r.sentenceKey === skey)?.result.translation;
        if (lookup.mode === 'translate' && sharedTranslation) {
            return {result: {translation: sharedTranslation, meaning: '', notes: ''}, cached: true};
        }
        if (!this.pending.has(key)) {
            const epoch = this.epoch;
            const {cacheEnabled, ...nativeConfig} = config;
            const payload = {action: lookup.mode ?? 'explain', sentence: lookup.sentence, word: lookup.word, context: lookup.context, config: nativeConfig};
            const reuse = sharedTranslation && sharedTranslation.length <= 600 ? {cachedTranslation: sharedTranslation} : {};
            const call = this.native({...payload, ...reuse});
            const promise = call.promise.then(async (response) => {
                if (response.ok !== true || !isStudyResult(response.result)) {
                    throw new Error(response.error ?? 'AI 返回了无效文本。');
                }
                if (cacheEnabled && epoch === this.epoch) {
                    const row = {key, sentenceKey: skey, created: Date.now(), result: response.result};
                    await this.write(CACHE_KEY, (v) => (epoch !== this.epoch ? v : [...this.rows(v).filter((r) => r.key !== key && r.created > Date.now() - TTL), row].slice(-CACHE_LIMIT)));
                }
                return response.result;
            }).finally(() => {
                this.pending.delete(key);
            });
            this.pending.set(key, {promise, cancel: call.cancel});
        }
        return {result: await this.pending.get(key)?.promise, cached: false};
    }

    /**
     * @param {string} action
     * @param {unknown} value
     * @returns {Promise<unknown>}
     */
    async dictionary(action, value) {
        const lookup = dictionaryLookup(value);
        const config = studyConfig(await this.read(SETTINGS_KEY));
        const key = dictionaryKey(lookup, config);
        const stored = await this.read(DICTIONARY_CACHE_KEY);
        const rows = /** @type {import('study').DictionaryCacheEntry[]} */ (Array.isArray(stored) ? stored : []);
        const exact = config.cacheEnabled ? [...rows].reverse().find((r) => r.key === key && r.created > Date.now() - TTL && isDictionaryResult(r.result, lookup)) : void 0;
        if (action === 'dictionaryPeek') { return {result: exact?.result ?? null, busy: this.dictionaryPending.has(key)}; }
        if (action === 'dictionaryCancel') {
            for (const call of this.dictionaryPending.values()) {
                if (JSON.stringify(call.lookup) === JSON.stringify(lookup)) { call.cancel(); }
            }
            return true;
        }
        if (exact) { return {result: exact.result, cached: true}; }
        if (!this.dictionaryPending.has(key)) {
            const epoch = this.epoch;
            const {cacheEnabled, ...nativeConfig} = config;
            const call = this.native({action: 'dictionary', ...lookup, config: nativeConfig});
            const promise = call.promise.then(async (response) => {
                if (!response.ok || !isDictionaryResult(response.result, lookup)) { throw new Error(response.error ?? 'AI 词典翻译未能逐段对齐；原英文保留。'); }
                const result = response.result;
                if (cacheEnabled && epoch === this.epoch) {
                    await this.write(DICTIONARY_CACHE_KEY, (v) => (epoch !== this.epoch ? v : [...(/** @type {import('study').DictionaryCacheEntry[]} */ (Array.isArray(v) ? v : [])).filter((r) => r.key !== key && r.created > Date.now() - TTL), {key, lookup, created: Date.now(), result}].slice(-CACHE_LIMIT)));
                }
                return result;
            }).finally(() => { this.dictionaryPending.delete(key); });
            this.dictionaryPending.set(key, {promise, cancel: call.cancel, lookup});
        }
        return {result: await this.dictionaryPending.get(key)?.promise, cached: false};
    }
}

/**
 * Register independently of upstream APIs;
 * only our extension documents may call it.
 */
export function prepareStudyService() {
    const service = new StudyService(chrome.storage.local);
    /**
     * @param {unknown} message
     * @param {chrome.runtime.MessageSender} sender
     * @param {(response: unknown) => void} reply
     * @returns {boolean}
     */
    const receive = (message, sender, reply) => {
        const {studyAction, data} = /** @type {{studyAction?: string, data?: unknown}} */ (/** @type {unknown} */ (message ?? {}));
        if (typeof studyAction !== 'string') {
            return false;
        }
        const prefix = chrome.runtime.getURL('');
        const pathname = sender.url?.slice(prefix.length).split(/[?#]/)[0];
        if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(prefix) || !['popup.html', 'search.html', 'study-settings.html'].includes(pathname ?? '')) {
            reply({ok: false, error: '不允许此页面访问学习组件。'});
            return false;
        }
        if (['saveSettings', 'clearCache', 'clearSaved', 'removeWord', 'models'].includes(studyAction) && pathname !== 'study-settings.html') {
            reply({ok: false, error: '请在 AI 设置页管理本地数据。'});
            return false;
        }
        if (studyAction === 'openDetail') {
            void service.handle('storeDetail', data).then(async (value) => {
                const {id} = /** @type {import('study').DetailSnapshot} */ (value);
                // Constant extension page only. No website URL or source sentence in navigation.
                await chrome.tabs.create({url: chrome.runtime.getURL(`search.html?studyDetail=${id}`), active: true});
                reply({ok: true, value: {id}});
            }).catch((error) => reply({ok: false, error: error instanceof Error ? error.message : '无法打开详解。'}));
            return true;
        }
        void service.handle(studyAction, data).then((result) => reply({ok: true, value: result}), (error) => reply({ok: false, error: error instanceof Error ? error.message : '学习操作失败。'}));
        return true;
    };
    chrome.runtime.onMessage.addListener(receive);
}
