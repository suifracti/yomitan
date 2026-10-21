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

// Free caption translation services. No account or key of the learner is used:
// Google is the public web-page translation endpoint Chrome itself uses, Microsoft is
// Edge's free endpoint, and Chrome's built-in Translator runs on this device.
// Every function returns one translation per input text, in order, or throws.
import {readResponseJson} from '../core/json.js';

/** Public key embedded in Chrome's own page translation; not a learner credential. */
const GOOGLE_KEY = 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520';
const GOOGLE_URL = 'https://translate-pa.googleapis.com/v1/translateHtml';
const MICROSOFT_AUTH_URL = 'https://edge.microsoft.com/translate/auth';
const MICROSOFT_URL = 'https://api-edge.cognitive.microsofttranslator.com/translate';

/** @type {Record<string, string>} */
const ENTITIES = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&nbsp;': ' '};

/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * The HTML endpoint may return entities and stray tags; keep plain text only.
 * @param {string} text
 * @returns {string}
 */
export function plainFromHtml(text) {
    return text.replaceAll(/<[^>]*>/g, '')
        .replaceAll(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (entity) => ENTITIES[entity] ?? entity)
        .replaceAll(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .trim();
}

/**
 * @param {unknown} rows
 * @param {number} count
 * @param {string} service
 * @returns {string[]}
 * @throws {Error}
 */
function checked(rows, count, service) {
    if (!Array.isArray(rows) || rows.length !== count || rows.some((row) => typeof row !== 'string' || !row.trim())) {
        throw new Error(`${service}没有逐句返回译文，原文已保留。`);
    }
    return rows;
}

/**
 * @param {Response} response
 * @param {string} service
 * @throws {Error}
 */
function ensureOk(response, service) {
    if (response.status === 429) { throw new Error(`${service}暂时限流，请稍后再试或换一种服务。`); }
    if (!response.ok) { throw new Error(`${service}不可用（HTTP ${response.status}），可换一种服务。`); }
}

/**
 * @param {string[]} texts
 * @param {{source?: string, target?: string, signal?: AbortSignal, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<string[]>}
 */
export async function googleTranslate(texts, {source = 'en', target = 'zh', signal, fetchImpl = fetch} = {}) {
    const response = await fetchImpl(GOOGLE_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json+protobuf', 'X-Goog-API-Key': GOOGLE_KEY},
        body: JSON.stringify([[texts.map(escapeHtml), source, target === 'zh' ? 'zh-CN' : target], 'te_lib']),
        signal,
    });
    ensureOk(response, 'Google 翻译');
    const body = /** @type {unknown} */ (await readResponseJson(response));
    const rows = /** @type {unknown} */ (Array.isArray(body) ? body[0] : null);
    return checked(Array.isArray(rows) ? rows.map((row) => (typeof row === 'string' ? plainFromHtml(row) : row)) : rows, texts.length, 'Google 翻译');
}

/** @type {{token: string, expires: number}|null} */
let microsoftToken = null;

/**
 * @param {string[]} texts
 * @param {{source?: string, target?: string, signal?: AbortSignal, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<string[]>}
 */
export async function microsoftTranslate(texts, {source = 'en', target = 'zh', signal, fetchImpl = fetch} = {}) {
    if (!microsoftToken || microsoftToken.expires < Date.now()) {
        const auth = await fetchImpl(MICROSOFT_AUTH_URL, {signal});
        ensureOk(auth, '微软翻译');
        const token = (await auth.text()).trim();
        if (!token) { throw new Error('微软翻译没有发放临时令牌，可换一种服务。'); }
        // Edge tokens last ten minutes; refresh a little early.
        microsoftToken = {token, expires: Date.now() + 8 * 60 * 1000};
    }
    const url = `${MICROSOFT_URL}?from=${encodeURIComponent(source)}&to=${encodeURIComponent(target === 'zh' ? 'zh-Hans' : target)}&api-version=3.0`;
    const response = await fetchImpl(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${microsoftToken.token}`},
        body: JSON.stringify(texts.map((text) => ({Text: text}))),
        signal,
    });
    if (response.status === 401) { microsoftToken = null; }
    ensureOk(response, '微软翻译');
    const body = /** @type {unknown} */ (await readResponseJson(response));
    const rows = Array.isArray(body) ? body.map((row) => /** @type {{translations?: {text?: unknown}[]}} */ (row)?.translations?.[0]?.text) : null;
    return checked(rows, texts.length, '微软翻译');
}

/** @typedef {{translate: (text: string, options?: {signal?: AbortSignal}) => Promise<string>}} BuiltInTranslator */

/** @type {Map<string, Promise<BuiltInTranslator>>} */
const builtIn = new Map();

/**
 * Whether Chrome's on-device Translator can run in this page.
 * @param {string} [source]
 * @returns {Promise<'available'|'downloadable'|'downloading'|'unavailable'>}
 */
export async function chromeTranslatorStatus(source = 'en') {
    const api = /** @type {{availability?: (o: {sourceLanguage: string, targetLanguage: string}) => Promise<string>}|undefined} */ (/** @type {Record<string, unknown>} */ (globalThis).Translator);
    if (!api?.availability) { return 'unavailable'; }
    try {
        const status = await api.availability({sourceLanguage: source, targetLanguage: 'zh'});
        return /** @type {'available'|'downloadable'|'downloading'|'unavailable'} */ (['available', 'downloadable', 'downloading'].includes(status) ? status : 'unavailable');
    } catch {
        return 'unavailable';
    }
}

/**
 * Chrome's on-device translation. The first use may download a language model, which
 * Chrome only allows right after a click.
 * @param {string[]} texts
 * @param {{source?: string, target?: string, signal?: AbortSignal}} [options]
 * @returns {Promise<string[]>}
 * @throws {Error}
 */
export async function chromeTranslate(texts, {source = 'en', target = 'zh', signal} = {}) {
    const api = /** @type {{create?: (o: {sourceLanguage: string, targetLanguage: string}) => Promise<BuiltInTranslator>}|undefined} */ (/** @type {Record<string, unknown>} */ (globalThis).Translator);
    if (!api?.create) { throw new Error('这个 Chrome 版本没有内置翻译，可换一种服务。'); }
    const key = `${source}:${target}`;
    let translator = builtIn.get(key);
    if (!translator) {
        translator = api.create({sourceLanguage: source, targetLanguage: target});
        builtIn.set(key, translator);
        translator.catch(() => builtIn.delete(key));
    }
    let ready;
    try {
        ready = await translator;
    } catch (error) {
        throw new Error(`Chrome 内置翻译未就绪：${error instanceof Error ? error.message : String(error)}。首次使用请在面板里点一次翻译以下载语言模型。`);
    }
    /** @type {string[]} */
    const rows = [];
    for (const text of texts) {
        if (signal?.aborted) { throw new Error('已取消'); }
        rows.push((await ready.translate(text, {signal})).trim());
    }
    return checked(rows, texts.length, 'Chrome 内置翻译');
}

/** @type {Record<import('./subtitle-prefs.js').SubtitleEngine, string>} */
export const ENGINE_LABELS = {
    chrome: 'Chrome 内置翻译',
    apple: 'Apple 翻译',
    google: 'Google 翻译',
    microsoft: '微软翻译',
    model: '你的模型',
};
