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

export const SETTINGS_KEY = 'studySettingsV2';

export const CACHE_KEY = 'studyCacheV2';

export const SAVED_KEY = 'studySavedWordsV1';

export const DETAIL_KEY = 'studyDetailSnapshotsV1';

export const DICTIONARY_CACHE_KEY = 'studyDictionaryCacheV1';

/** @type {import('study').StudyConfig} */
export const DEFAULTS = {model: 'gpt-6.1-sol', effort: 'low', cacheEnabled: true};

export const TTL = 30 * 24 * 60 * 60 * 1000;

export const CACHE_LIMIT = 100;

/**
 * @param {unknown} value
 * @returns {import('study').StudyConfig}
 */
export function studyConfig(value) {
    const v = /** @type {Partial<import('study').StudyConfig>} */ (value ?? {});
    const model = typeof v.model === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(v.model) ? v.model : DEFAULTS.model;
    const effort = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(v.effort ?? '') ? v.effort : DEFAULTS.effort;
    return {model,
        effort: effort ?? DEFAULTS.effort,
        cacheEnabled: v.cacheEnabled !== false};
}

/**
 * @param {unknown} value
 * @throws {Error} Invalid source length or action.
 * @returns {import('study').Lookup}
 */
export function studyLookup(value) {
    const v = /** @type {Partial<import('study').Lookup>} */ (value ?? {});
    if (typeof v.sentence !== 'string' || typeof v.word !== 'string' || !v.sentence.trim() || !v.word.trim() || v.sentence.length > 2400 || v.word.length > 128) {
        throw new Error('原句须为 1–2400 字，查词内容须为 1–128 字。');
    }
    if (v.context !== void 0 && (typeof v.context !== 'string' || v.context.length > 1200)) {
        throw new Error('补充语境最多 1200 字。');
    }
    if (v.mode !== void 0 && !['translate', 'explain'].includes(v.mode)) {
        throw new Error('只允许翻译或语境解释。');
    }
    return {sentence: v.sentence.trim(), word: v.word.trim(), context: v.context?.trim() ?? '', mode: v.mode};
}

/**
 * @param {unknown} value
 * @returns {value is import('study').Result}
 */
export function isStudyResult(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const v = /** @type {import('study').Result} */ (value);
    return typeof v.translation === 'string' && !!v.translation.trim() && typeof v.meaning === 'string' && !!v.meaning.trim() &&
    typeof v.notes === 'string' && [v.translation, v.meaning, v.notes].every((s) => s.length <= 5000);
}

/**
 *
 * @param {import('study').Lookup} lookup
 * @param {import('study').StudyConfig} config
 * @returns {string}
 */
export function sentenceKey(lookup, config) {
    // URL is intentionally absent; changing the source does not waste another translation.
    return JSON.stringify(['study5.1',
        lookup.sentence,
        lookup.context,
        config.model,
        config.effort,
        null]);
}

/**
 *
 * @param {import('study').Lookup} lookup
 * @param {import('study').StudyConfig} config
 * @returns {string}
 */
export function resultKey(lookup, config) {
    return JSON.stringify([sentenceKey(lookup, config), lookup.word, lookup.mode ?? 'explain']);
}

/**
 *
 * @param {string} before
 * @param {string} after
 * @returns {string}
 */
export function adjacentSentences(before, after) {
    const previous = before.match(/[^.!?\n]+[.!?]+/g)?.at(-1)?.trim()
        .slice(-550) ?? '';
    const next = after.match(/[^.!?\n]+[.!?]+/)?.[0]?.trim().slice(0, 550) ?? '';
    return [previous ? `前句：${previous}` : '', next ? `后句：${next}` : ''].filter(Boolean).join('\n');
}

/**
 * @param {unknown} value
 * @throws {Error} Invalid dictionary source.
 * @returns {import('study').DictionaryLookup}
 */
export function dictionaryLookup(value) {
    const v = /** @type {import('study').DictionaryLookup} */ (value ?? {});
    if (Object.keys(v).some((k) => !['word', 'items'].includes(k)) || typeof v.word !== 'string' || !v.word.trim() || v.word.length > 128 ||
    !Array.isArray(v.items) || v.items.length === 0 || v.items.length > 6) { throw new Error('词典翻译每批 1–6 段。'); }
    const ids = new Set();
    let length = 0;
    const items = v.items.map((row) => {
        if (!row || Object.keys(row).some((k) => !['id', 'text'].includes(k)) || typeof row.id !== 'string' || !/^\d{1,6}$/.test(row.id) || ids.has(row.id) ||
        typeof row.text !== 'string' || !row.text.trim() || row.text.length > 1800) { throw new Error('词典段落格式或长度无效。'); }
        ids.add(row.id);
        length += row.text.length;
        return {id: row.id, text: row.text.trim()};
    });
    if (length > 4000) { throw new Error('词典翻译每批最多 4000 字。'); }
    return {word: v.word.trim(), items};
}

/**
 * @param {unknown} value
 * @param {import('study').DictionaryLookup} lookup
 * @returns {value is import('study').DictionaryResult}
 */
export function isDictionaryResult(value, lookup) {
    if (!value || typeof value !== 'object' || Object.keys(value).join(',') !== 'items') { return false; }
    const v = /** @type {import('study').DictionaryResult} */ (value);
    return Array.isArray(v.items) && v.items.length === lookup.items.length && v.items.every((r, i) => r && Object.keys(r).every((k) => ['id', 'translation'].includes(k)) &&
    r.id === lookup.items[i].id && typeof r.translation === 'string' && !!r.translation.trim() && r.translation.length <= 2400);
}

/**
 * @param {import('study').DictionaryLookup} lookup
 * @param {import('study').StudyConfig} config
 * @returns {string}
 */
export function dictionaryKey(lookup, config) {
    return JSON.stringify(['dictionary6', lookup, config.model, config.effort, null]);
}

/**
 * @param {unknown} value
 * @returns {import('study').DetailSource}
 */
export function detailSource(value) {
    const v = /** @type {import('study').DetailSource} */ (value ?? {});
    const {sentence, word, context} = studyLookup({sentence: v.sentence || v.word, word: v.word, context: v.context});
    let url = '';
    if (typeof v.url === 'string' && v.url.length <= 2000) {
        try {
            const u = new URL(v.url);
            if (['http:', 'https:'].includes(u.protocol)) { url = u.href; }
        } catch { /* No web source. */ }
    }
    const offset = Number.isInteger(v.offset) && v.offset >= 0 && v.offset <= sentence.length ? v.offset : 0;
    return {word,
        sentence,
        offset,
        context,
        url,
        title: typeof v.title === 'string' ? v.title.slice(0, 300) : '',
        ...(typeof v.videoTime === 'number' && Number.isFinite(v.videoTime) && v.videoTime >= 0 ? {videoTime: Math.floor(v.videoTime)} : {}),
        ...(Number.isInteger(v.profileIndex) && (v.profileIndex ?? -1) >= 0 ? {profileIndex: v.profileIndex} : {})};
}
