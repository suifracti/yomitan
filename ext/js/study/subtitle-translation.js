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

// Adapter only: the learner's chosen caption service plus the existing sentence cache;
// no learning writes. The service choice is re-read from storage, never from the page.
import {googleTranslate, microsoftTranslate} from './free-translators.js';
import {CACHE_KEY, CACHE_LIMIT, sentenceKey, SETTINGS_KEY, studyConfig, TTL} from './study-data.js';
import {normalizeSubtitlePrefs, SUBTITLE_PREFS_KEY, TRANSLATION_PREFS_KEY} from './subtitle-prefs.js';

/** @typedef {{id: string, text: string, context?: string}} Item */
export class SubtitleTranslation {
    /** @param {import('./study-service.js').StudyService} service */
    constructor(service) {
        /** @type {import('./study-service.js').StudyService} */
        this.service = service;
        /** @type {Map<string, {cancel: () => void, promise: Promise<unknown>}>} */
        this.pending = new Map();
    }

    /**
     * @param {string} action
     * @param {unknown} value
     * @returns {Promise<unknown>}
     */
    async handle(action, value) {
        if (action === 'subtitleSettings') { return studyConfig(await this.service.read(SETTINGS_KEY)); }
        const v = /** @type {{requestId?: string, items?: Item[], language?: string, title?: string, freeOnly?: boolean, config?: {model?: string, effort?: string}}} */ (value ?? {});
        const id = v.requestId;
        if (typeof id !== 'string' || !/^[\w:.-]{1,200}$/.test(id)) { throw new Error('字幕请求编号无效。'); }
        if (action === 'subtitleCancel') {
            this.pending.get(id)?.cancel();
            return true;
        }
        if (action === 'subtitleSegment') { return await this.segment(id, value); }
        if (Object.keys(v).some((k) => !['requestId', 'items', 'language', 'title', 'config', 'freeOnly'].includes(k))) { throw new Error('字幕翻译参数无效。'); }
        const items = v.items;
        if (!Array.isArray(items) || items.length === 0 || items.length > 8 || new Set(items.map((r) => r.id)).size !== items.length ||
        items.some((r) => !r || typeof r.id !== 'string' || !/^[\w-]{1,128}$/.test(r.id) || typeof r.text !== 'string' || !r.text.trim() || r.text.length > 2400 ||
        (r.context !== void 0 && (typeof r.context !== 'string' || r.context.length > 1200))) || items.reduce((n, r) => n + r.text.length, 0) > 6000) {
            throw new Error('字幕每批1–8句、总计最多6000字，原行编号不能重复。');
        }
        if (this.pending.has(id)) { throw new Error('本批字幕正在翻译。'); }
        const epoch = this.service.epoch;
        let cancelled = false;
        /** @type {ReturnType<import('study').NativeCall>|null} */
        let call = null;
        const web = new AbortController();
        const checkCancelled = () => {
            if (cancelled) { throw new Error('已取消字幕翻译；晚到结果未写入。'); }
        };
        const promise = (async () => {
            const {engine} = normalizeSubtitlePrefs({...await this.service.read(SUBTITLE_PREFS_KEY), ...await this.service.read(TRANSLATION_PREFS_KEY)});
            const config = studyConfig(await this.service.read(SETTINGS_KEY));
            checkCancelled();
            if (v.freeOnly && engine === 'model') { throw new Error('请在设置里选一种免费翻译，再点重试。'); }
            if (engine === 'chrome') { throw new Error('Chrome 内置翻译在页面里运行；请刷新页面后再点翻译。'); }
            if (engine === 'model' && (v.config?.model !== config.model || v.config?.effort !== config.effort)) { throw new Error('模型设置已改变，请重新点翻译。'); }
            const language = v.language || 'en';
            const base = language.split('-')[0].toLowerCase();
            /**
             * @param {Item} item
             * @returns {string}
             */
            const keyOf = (item) => {
                const key = sentenceKey({word: '字幕', sentence: item.text, context: item.context || '', language}, config);
                // Other subtitle languages must not share English's sentence cache namespace.
                const scoped = ['en', 'ja'].includes(language) ? key : JSON.stringify([language, key]);
                // Each service keeps its own translations; the model keeps the original keys.
                return engine === 'model' ? scoped : `${engine}:${scoped}`;
            };
            const cache = config.cacheEnabled ? await this.service.cache() : [];
            checkCancelled();
            const cached = new Map(cache.map((row) => [row.key, row.result.translation]));
            /** @type {Map<string, string>} */
            const translations = new Map();
            const missing = items.filter((item) => {
                const text = epoch === this.service.epoch ? cached.get(`subtitle:${keyOf(item)}`) : void 0;
                if (typeof text !== 'string' || !text.trim() || text.length > 2400) { return true; }
                translations.set(item.id, text);
                return false;
            });
            if (missing.length > 0 && (engine === 'google' || engine === 'microsoft')) {
                const translate = engine === 'google' ? googleTranslate : microsoftTranslate;
                const rows = await translate(missing.map((item) => item.text), {source: base, signal: web.signal});
                checkCancelled();
                for (const [index, item] of missing.entries()) { translations.set(item.id, rows[index]); }
            } else if (missing.length > 0) {
                const rowsToSend = missing.map(({id: rowId, text}) => ({id: rowId, text}));
                call = engine === 'apple' ?
                    this.service.native({action: 'appleTranslate', language: base, items: rowsToSend}) :
                    this.service.native({action: 'subtitles',
                        language,
                        title: (v.title || '').slice(0, 300),
                        context: [...new Set(items.map((r) => r.context || ''))].join('\n').slice(0, 1200),
                        items: rowsToSend,
                        config: {model: config.model, effort: config.effort}});
                const response = await call.promise;
                checkCancelled();
                const result = /** @type {{items?: {id: string, translation: string}[]}|undefined} */ (response.result);
                const rows = result?.items;
                if (!response.ok || !Array.isArray(rows) || rows.length !== missing.length || rows.some((r, i) => !r || r.id !== missing[i].id || typeof r.translation !== 'string' || !r.translation.trim() || r.translation.length > 2400)) {
                    throw new Error(response.error || '译文与原字幕未逐行对齐，原文已保留。');
                }
                for (const row of rows) { translations.set(row.id, row.translation); }
            }
            if (missing.length > 0 && config.cacheEnabled && epoch === this.service.epoch) {
                await this.service.write(CACHE_KEY, (old) => {
                    if (cancelled || epoch !== this.service.epoch) { return old; }
                    const entries = missing.map((item) => {
                        const key = keyOf(item);
                        return {key: `subtitle:${key}`, sentenceKey: key, created: Date.now(), result: {translation: translations.get(item.id), meaning: '', notes: ''}};
                    });
                    return [...(/** @type {import('study').CacheEntry[]} */ (Array.isArray(old) ? old : [])).filter((r) => r.created > Date.now() - TTL && !entries.some((e) => e.key === r.key)), ...entries].slice(-CACHE_LIMIT);
                });
            }
            checkCancelled();
            return {engine, items: items.map((item) => ({id: item.id, translation: translations.get(item.id)}))};
        })().finally(() => { this.pending.delete(id); });
        // Register before any storage await can yield, so cancellation also covers cache/settings reads.
        this.pending.set(id, {promise,
            cancel: () => {
                cancelled = true;
                call?.cancel();
                web.abort();
            }});
        return await promise;
    }

    /**
     * Model sentence segmentation for one window of caption fragments. Only grouping
     * comes back; text, order and times stay those of the original cues.
     * @param {string} id
     * @param {unknown} value
     * @returns {Promise<{groups: string[][]}>}
     * @throws {Error}
     */
    async segment(id, value) {
        const v = /** @type {{items?: Item[], language?: string, config?: {model?: string, effort?: string}}} */ (value ?? {});
        if (Object.keys(v).some((k) => !['requestId', 'items', 'language', 'config'].includes(k))) { throw new Error('断句参数无效。'); }
        const items = v.items;
        if (!Array.isArray(items) || items.length < 2 || items.length > 80 || new Set(items.map((r) => r?.id)).size !== items.length ||
        items.some((r) => !r || typeof r.id !== 'string' || !/^[\w-]{1,128}$/.test(r.id) || typeof r.text !== 'string' || !r.text.trim() || r.text.length > 600) ||
        items.reduce((n, r) => n + r.text.length, 0) > 12000) {
            throw new Error('断句每批2–80行、总计最多12000字。');
        }
        if (this.pending.has(id)) { throw new Error('本批字幕正在断句。'); }
        let cancelled = false;
        /** @type {ReturnType<import('study').NativeCall>|null} */
        let call = null;
        const promise = (async () => {
            const config = studyConfig(await this.service.read(SETTINGS_KEY));
            if (cancelled) { throw new Error('已取消断句。'); }
            if (v.config?.model !== config.model || v.config?.effort !== config.effort) { throw new Error('模型设置已改变，请重新开启 AI 断句。'); }
            call = this.service.native({action: 'segment', language: v.language || 'en', items: items.map(({id: rowId, text}) => ({id: rowId, text})), config: {model: config.model, effort: config.effort}});
            const response = await call.promise;
            if (cancelled) { throw new Error('已取消断句。'); }
            const groups = /** @type {{groups?: unknown}|undefined} */ (response.result)?.groups;
            const flat = Array.isArray(groups) && groups.every((group) => Array.isArray(group) && group.length > 0) ? /** @type {unknown[][]} */ (groups).flat() : null;
            if (!response.ok || !flat || flat.length !== items.length || flat.some((rowId, index) => rowId !== items[index].id)) {
                throw new Error(response.error || 'AI 断句没有逐行覆盖原字幕；已保留规则断句。');
            }
            return {groups: /** @type {string[][]} */ (groups)};
        })().finally(() => { this.pending.delete(id); });
        this.pending.set(id, {promise,
            cancel: () => {
                cancelled = true;
                call?.cancel();
            }});
        return await promise;
    }
}
