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

/** @type {import('study').StudyConfig} */
export const DEFAULTS = {model: 'gpt-6.1-sol', effort: 'low', level: 'unspecified', goal: 'general', style: 'brief', memoryEnabled: true, cacheEnabled: true};

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
        level: ['unspecified', 'beginner', 'intermediate', 'advanced'].includes(v.level ?? '') ? v.level ?? 'unspecified' : 'unspecified',
        goal: ['general', 'reading', 'listening', 'exam'].includes(v.goal ?? '') ? v.goal ?? 'general' : 'general',
        style: ['brief', 'detailed'].includes(v.style ?? '') ? v.style ?? 'brief' : 'brief',
        memoryEnabled: v.memoryEnabled !== false,
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
        config.memoryEnabled ? [config.level, config.goal, config.style] : null]);
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
