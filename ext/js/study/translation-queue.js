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

/* One bounded user-initiated queue. No API keys, model SDK, writes or automatic retry. */

/**
 * @typedef {{id: string, text: string, context?: string}} TranslationItem
 * @typedef {TranslationItem & {state: 'cached'|'translated'|'failed', translation?: string, error?: string}} TranslationRow
 * @typedef {{items: TranslationItem[], target: string, config: {model: string, effort: string}, promptVersion: string, signal: AbortSignal}} TranslationRequest
 * @typedef {(request: TranslationRequest) => Promise<unknown>} TranslationAdapter
 */

export class TranslationQueue {
    /** @type {TranslationAdapter} */
    #adapter;
    /** @type {Map<string, string>} */
    #cache = new Map();
    /** @type {AbortController|null} */
    #controller = null;
    /** @type {number} */
    #run = 0;

    /**
     * @param {TranslationAdapter} adapter
     * @throws {TypeError}
     */
    constructor(adapter) {
        if (typeof adapter !== 'function') { throw new TypeError('需要受控的翻译适配器'); }
        /**
         * Injected caller of the existing Native model path.
         * @type {TranslationAdapter}
         */
        this.#adapter = adapter;
    }

    /**
     * Drops the current run; late results are discarded.
     */
    cancel() {
        this.#run++;
        this.#controller?.abort();
        this.#controller = null;
    }

    /**
     * @param {TranslationItem[]} items
     * @param {{target?: string, model?: string, effort?: string, promptVersion?: string, cacheEnabled?: boolean, onItem?: (row: TranslationRow) => void, signal?: AbortSignal}} [options]
     * @returns {Promise<{items: TranslationRow[], nativeCalls: number, cancelled: boolean}>}
     */
    async translate(items, {target = 'zh-CN', model, effort, promptVersion = 'reading-v1', cacheEnabled = true, onItem = () => {}, signal} = {}) {
        if (!Array.isArray(items) || items.length > 5000) { throw new TypeError('翻译范围无效'); }
        if (typeof model !== 'string' || !model || typeof effort !== 'string' || !effort) { throw new TypeError('应读取用户现有模型配置，不能自动选择另一个模型'); }
        const ids = new Set();
        for (const item of items) {
            if (!item || typeof item.id !== 'string' || ids.has(item.id) || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2400) { throw new TypeError('行身份重复或原文无效'); }
            ids.add(item.id);
        }
        this.cancel();
        const token = this.#run;
        const controller = new AbortController();
        this.#controller = controller;
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, {once: true});
        if (signal?.aborted) { controller.abort(); }
        const live = () => token === this.#run && !controller.signal.aborted;
        /** @type {TranslationRow[]} */
        const output = [];
        let nativeCalls = 0;
        /**
         * @param {TranslationItem} i
         * @returns {string}
         */
        const keyOf = (i) => JSON.stringify([i.text, i.context ?? '', target, model, effort, promptVersion]);
        /** @type {TranslationItem[]} */
        const pending = [];
        for (const item of items) {
            const cached = cacheEnabled ? this.#cache.get(keyOf(item)) : void 0;
            if (typeof cached === 'string') {
                /** @type {TranslationRow} */
                const row = {...item, translation: cached, state: 'cached'};
                output.push(row);
                if (live()) { onItem(row); }
            } else {
                pending.push(item);
            }
        }
        try {
            // No larger than 8 rows / 6000 chars per model request.
            for (let n = 0; n < pending.length;) {
                if (!live()) { break; }
                /** @type {TranslationItem[]} */
                const batch = [];
                let chars = 0;
                while (n < pending.length && batch.length < 8 && chars + pending[n].text.length <= 6000) {
                    chars += pending[n].text.length;
                    batch.push(pending[n++]);
                }
                /** @type {{id?: unknown, translation?: unknown}[]} */
                let response;
                try {
                    nativeCalls++;
                    const raw = await this.#adapter({items: batch, target, config: {model, effort}, promptVersion, signal: controller.signal});
                    if (!live()) { break; }
                    const list = Array.isArray(raw) ? /** @type {unknown[]} */ (raw) : null;
                    if (!list) { throw new Error('翻译回执 ID 不匹配'); }
                    response = list.map((r) => /** @type {{id?: unknown, translation?: unknown}} */ (r && typeof r === 'object' ? r : {}));
                    if (response.length > batch.length || new Set(response.map((r) => r?.id)).size !== response.length || response.some((r) => !batch.some((b) => b.id === r?.id))) { throw new Error('翻译回执 ID 不匹配'); }
                } catch (error) {
                    if (!live()) { break; }
                    // Failure is retained per row; no automatic resubmit.
                    for (const i of batch) {
                        /** @type {TranslationRow} */
                        const row = {...i, state: 'failed', error: error instanceof Error ? error.message : String(error)};
                        output.push(row);
                        onItem(row);
                    }
                    continue;
                }
                for (const item of batch) {
                    const text = response.find((r) => r.id === item.id)?.translation;
                    const ok = typeof text === 'string' && Boolean(text.trim()) && text.length <= 6000;
                    /** @type {TranslationRow} */
                    const row = ok ? {...item, state: 'translated', translation: text} : {...item, state: 'failed', error: '本行未收到有效译文'};
                    if (ok && cacheEnabled) {
                        this.#cache.set(keyOf(item), text);
                        while (this.#cache.size > 1000) { this.#cache.delete(/** @type {string} */ (this.#cache.keys().next().value)); }
                    }
                    output.push(row);
                    onItem(row);
                }
            }
            return {items: output, nativeCalls, cancelled: !live()};
        } finally {
            signal?.removeEventListener('abort', abort);
            if (token === this.#run) { this.#controller = null; }
        }
    }
}
