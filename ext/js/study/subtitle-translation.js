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

// Adapter only: existing Native model/config/lock and sentence cache, no learning writes.
import {CACHE_KEY, CACHE_LIMIT, sentenceKey, SETTINGS_KEY, studyConfig, TTL} from './study-data.js';

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
        const v = /** @type {{requestId?: string, items?: Item[], language?: string, title?: string, config?: {model?: string, effort?: string}}} */ (value ?? {});
        const id = v.requestId;
        if (typeof id !== 'string' || !/^[\w:.-]{1,200}$/.test(id)) { throw new Error('字幕请求编号无效。'); }
        if (action === 'subtitleCancel') {
            this.pending.get(id)?.cancel();
            return true;
        }
        if (Object.keys(v).some((k) => !['requestId', 'items', 'language', 'title', 'config'].includes(k))) { throw new Error('字幕翻译参数无效。'); }
        const items = v.items;
        if (!Array.isArray(items) || items.length === 0 || items.length > 8 || new Set(items.map((r) => r.id)).size !== items.length ||
        items.some((r) => !r || typeof r.id !== 'string' || !/^[\w-]{1,128}$/.test(r.id) || typeof r.text !== 'string' || !r.text.trim() || r.text.length > 2400 ||
        (r.context !== void 0 && (typeof r.context !== 'string' || r.context.length > 1200))) || items.reduce((n, r) => n + r.text.length, 0) > 6000) {
            throw new Error('字幕每批1–8句、总计最多6000字，原行编号不能重复。');
        }
        const config = studyConfig(await this.service.read(SETTINGS_KEY));
        if (v.config?.model !== config.model || v.config?.effort !== config.effort) { throw new Error('模型设置已改变，请重新点翻译。'); }
        if (this.pending.has(id)) { throw new Error('本批字幕正在翻译。'); }
        const epoch = this.service.epoch;
        let cancelled = false;
        const call = this.service.native({action: 'subtitles',
            language: v.language || 'en',
            title: (v.title || '').slice(0, 300),
            context: [...new Set(items.map((r) => r.context || ''))].join('\n').slice(0, 1200),
            items: items.map(({id: rowId, text}) => ({id: rowId, text})),
            config: {model: config.model, effort: config.effort}});
        const promise = call.promise.then(async (response) => {
            if (cancelled) { throw new Error('已取消字幕翻译；晚到结果未写入。'); }
            const result = /** @type {{items?: {id: string, translation: string}[]}|undefined} */ (response.result);
            const rows = result?.items;
            if (!response.ok || !Array.isArray(rows) || rows.length !== items.length || rows.some((r, i) => r.id !== items[i].id || typeof r.translation !== 'string' || !r.translation.trim() || r.translation.length > 2400)) {
                throw new Error(response.error || '译文与原字幕未逐行对齐，原文已保留。');
            }
            if (config.cacheEnabled && epoch === this.service.epoch) {
                await this.service.write(CACHE_KEY, (old) => {
                    if (cancelled || epoch !== this.service.epoch) { return old; }
                    const entries = items.map((item, i) => {
                        const key = sentenceKey({word: '字幕', sentence: item.text, context: item.context || '', language: v.language || 'en'}, config);
                        return {key: `subtitle:${key}`, sentenceKey: key, created: Date.now(), result: {translation: rows[i].translation, meaning: '', notes: ''}};
                    });
                    return [...(/** @type {import('study').CacheEntry[]} */ (Array.isArray(old) ? old : [])).filter((r) => r.created > Date.now() - TTL && !entries.some((e) => e.key === r.key)), ...entries].slice(-CACHE_LIMIT);
                });
            }
            return {items: rows};
        }).finally(() => { this.pending.delete(id); });
        this.pending.set(id, {promise,
            cancel: () => {
                cancelled = true;
                call.cancel();
            }});
        return await promise;
    }
}
