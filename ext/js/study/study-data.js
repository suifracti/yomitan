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

import {parseJson} from '../core/json.js';
import {CARD_CATALOG} from './card-catalog.js';

export const SETTINGS_KEY = 'studySettingsV2';

export const CACHE_KEY = 'studyCacheV2';

/** Saved English words and their learning status, for colouring pages: {at, words: {word: 'learning'|'known'}}. */
export const WORD_STATUS_KEY = 'studyWordStatus';

/** Page colouring switch and excluded sites: {enabled: boolean, excluded: string[]}. */
export const WORD_MARKS_KEY = 'studyWordMarks';

/** Learner switch for automatic two-way sync: {enabled: boolean}. */
export const AUTO_SYNC_KEY = 'studyAutoSync';

/** Last automatic pass: counts, conflicts, pause reason and words ready for production cards. */
export const AUTO_SYNC_STATE_KEY = 'studyAutoSyncState';

export const SAVED_KEY = 'studySavedWordsV1';

export const LOCAL_SYNC_INCOMPLETE_TEXT = '笔记已保存；扩展未更新本地记录，新增问答请手动保存。';

/**
 * Keyboard equivalents for subtitle typography. Compare only, never change the source.
 * @param {string} text
 * @returns {string}
 */
export function foldSearchPunctuation(text) {
    return text.replaceAll(/[‘’]/gu, "'").replaceAll(/[‐‑–—]/gu, '-');
}

/**
 * Reads the attachment reference from the saved note, not the capture in progress.
 * The bridge checks the file itself when playing it or making an audio card.
 * @param {import('study').LibraryRecord | null | undefined} record
 * @returns {import('study').SavedStudyAsset | undefined}
 */
export function savedAudioAttachment(record) {
    const audio = record?.media?.audio;
    return audio?.name && !record?.audioContextChanged ? audio : void 0;
}

/**
 * @param {import('study').LibraryRecord} record
 * @returns {boolean}
 */
export function canSupplementAudio(record) {
    return record.vaultSaved === true && record.learningState !== 'favorite-only' && !record.entry?.subtitleSource && !savedAudioAttachment(record);
}

export const DETAIL_KEY = 'studyDetailSnapshotsV1';

export const DICTIONARY_CACHE_KEY = 'studyDictionaryCacheV1';

/** @type {import('study').StudyConfig} */
export const DEFAULTS = {model: 'gpt-6.1-sol', effort: 'low', autoDictionaryTranslate: false, cacheEnabled: true};

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
    return {
        model,
        effort: effort ?? DEFAULTS.effort,
        autoDictionaryTranslate: v.autoDictionaryTranslate === true,
        practiceEnabled: v.practiceEnabled === true,
        cacheEnabled: v.cacheEnabled !== false,
    };
}

/**
 * @param {unknown} value
 * @throws {Error} Invalid source length or action.
 * @returns {import('study').Lookup}
 */
export function studyLookup(value) {
    const v = /** @type {Partial<import('study').Lookup>} */ (value ?? {});
    const language = v.language ?? 'en';
    if (!['en', 'ja'].includes(language)) { throw new Error('请选择英语或日语配置；不支持的语言不会存入英语库。'); }
    if (typeof v.sentence !== 'string' || typeof v.word !== 'string' || !v.sentence.trim() || !v.word.trim() || v.sentence.length > 2400 || v.word.length > 128) {
        throw new Error('原句须为 1–2400 字，查词内容须为 1–128 字。');
    }
    if (v.context !== void 0 && (typeof v.context !== 'string' || v.context.length > 1200)) {
        throw new Error('补充语境最多 1200 字。');
    }
    if (v.mode !== void 0 && !['translate', 'explain'].includes(v.mode)) {
        throw new Error('只允许翻译或语境解释。');
    }
    if (v.question !== void 0 && (typeof v.question !== 'string' || v.question.length > 500)) { throw new Error('追问最多 500 字。'); }
    if (v.dictionaryNotes !== void 0 && (typeof v.dictionaryNotes !== 'string' || v.dictionaryNotes.length > 4000)) { throw new Error('词典资料最多 4000 字。'); }
    return {language, ...(v.dictionaryNotes ? {dictionaryNotes: v.dictionaryNotes} : {}), sentence: v.sentence.trim(), word: v.word.trim(), context: v.context?.trim() ?? '', mode: v.mode, ...(v.question ? {question: v.question.trim()} : {})};
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
    return typeof v.translation === 'string' && !!v.translation.trim() && typeof v.meaning === 'string' &&
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
    return JSON.stringify([lookup.language === 'ja' ? 'study10-ja' : 'study9',
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
    return JSON.stringify([sentenceKey(lookup, config), lookup.word, lookup.mode ?? 'explain', lookup.question ?? '', ...(lookup.dictionaryNotes ? [lookup.dictionaryNotes] : [])]);
}

/**
 *
 * @param {string} before
 * @param {string} after
 * @returns {string}
 */
export function adjacentSentences(before, after) {
    const previous = before.match(/[^.!?。！？\n]+[.!?。！？]+/g)?.at(-1)?.trim()
        .slice(-550) ?? '';
    const next = after.match(/[^.!?。！？\n]+[.!?。！？]+/)?.[0]?.trim().slice(0, 550) ?? '';
    return [previous ? `前句：${previous}` : '', next ? `后句：${next}` : ''].filter(Boolean).join('\n');
}

/**
 * @param {unknown} value
 * @throws {Error} Invalid dictionary source.
 * @returns {import('study').DictionaryLookup}
 */
export function dictionaryLookup(value) {
    const v = /** @type {import('study').DictionaryLookup} */ (value ?? {});
    if (Object.keys(v).some((k) => !['word', 'items', 'language'].includes(k)) || typeof v.word !== 'string' || !v.word.trim() || v.word.length > 128 ||
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
    if (!['en', 'ja'].includes(v.language ?? 'en')) { throw new Error('不支持的学习语言。'); }
    return {word: v.word.trim(), items, ...(v.language === 'ja' ? {language: v.language} : {})};
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
    const {sentence, word, context} = studyLookup({sentence: v.sentence || v.word, word: v.word, context: v.context, language: v.language});
    let url = '';
    if (typeof v.url === 'string' && v.url.length <= 2000) {
        try {
            const u = new URL(v.url);
            if (['http:', 'https:'].includes(u.protocol)) { url = u.href; }
        } catch { /* No web source. */ }
    }
    const offset = Number.isInteger(v.offset) && v.offset >= 0 && v.offset <= sentence.length ? v.offset : 0;
    return {word,
        ...(v.language === 'ja' ? {language: 'ja'} : {}),
        sentence,
        offset,
        context,
        url,
        title: typeof v.title === 'string' ? v.title.slice(0, 300) : '',
        ...(typeof v.videoTime === 'number' && Number.isFinite(v.videoTime) && v.videoTime >= 0 ? {videoTime: Math.floor(v.videoTime)} : {}),
        ...(Number.isInteger(v.profileIndex) && (v.profileIndex ?? -1) >= 0 ? {profileIndex: v.profileIndex} : {})};
}

// Shared with the native direct-card controls; no learning data is stored here.
export const SAVE_TARGETS_KEY = 'studySaveTargetsV1';

/**
 * Read the note's Anki receipt, not the number of drafts submitted. A saved
 * note and even an addNote attempt are not proof that Anki confirmed a card.
 * @param {Partial<Omit<import('study').LibraryRecord, 'syncState'>> & {syncState?: string|{status?: string}}} record
 * @returns {{text: string, retry: boolean, needsAttention: boolean, repair: boolean}}
 */
export function cardReceipt(record) {
    const cards = Array.isArray(record.cards) ? record.cards : [];
    const state = typeof record.syncState === 'string' ? record.syncState : record.syncState?.status;
    const late = record.ankiState === 'pending' || state === 'pending';
    let progress = record.cardProgress;
    if (!progress) { // Snapshots from before the bridge supplied its receipt counts.
        const linked = record.ankiState === 'linked' || record.ankiState === 'synced';
        const verified = cards.filter((c) => c.noteId && ((c.syncState ?? c.state) === 'synced' || (!(c.syncState ?? c.state) && linked)));
        const ids = new Set(verified.map((c) => c.noteId));
        if (cards.length === 0 && record.noteId && !late && linked) { ids.add(record.noteId); }
        progress = {confirmed: ids.size, waiting: cards.filter((c) => (c.syncState ?? c.state) === 'pending' || (!c.noteId && late)).length};
    }
    const {confirmed, waiting} = progress;
    const problems = {missing: 'Anki 里的卡已被删除',
        ambiguous: `Anki 里有 ${record.candidates?.length ?? 0} 张卡对应这条记录`,
        conflict: '笔记和 Anki 的改动不一样，请在学习库选择保留哪份',
        ['anki-only']: '笔记不见了，Anki 卡还在'};
    const problem = /** @type {Record<string, string>} */ (problems)[state ?? ''];
    const retry = !problem && record.ankiEnabled !== false && (waiting > 0 || (late && Boolean(record.noteId || cards.length > 0)));
    const needsAttention = Boolean(problem || late || waiting || state === 'error' || state === 'failed');
    let text;
    if (problem) {
        text = problem;
    } else if (record.ankiEnabled === false) {
        text = '复习卡已关闭';
    } else if (waiting > 0) {
        text = [confirmed > 0 ? `已确认 ${confirmed} 张` : '', `${waiting} 张未确认`].filter(Boolean).join('，');
    } else if (needsAttention) {
        text = 'Anki 还没确认这次更新';
    } else if (confirmed > 0) {
        text = `已确认 ${confirmed} 张卡`;
    } else {
        text = record.noteId || cards.length > 0 ? '已有关联，尚未核实' : '尚未制卡';
    }
    return {text, retry, needsAttention, repair: Boolean(problem)};
}

/**
 * The ten-minute suggestion can outlive the link or a newly chosen practice card.
 * @param {Parameters<typeof cardReceipt>[0]} record
 * @param {{upgrade?: {id: string}[]}|undefined} state
 * @returns {boolean}
 */
export function canOfferUseCard(record, state) {
    return state?.upgrade?.some(({id}) => id === record.id) === true && record.ankiEnabled !== false &&
    Boolean(record.noteId || record.cardProgress?.confirmed || record.cards?.some((c) => c.noteId)) &&
    !cardReceipt(record).needsAttention && !record.cards?.some((c) => CARD_CATALOG.some(({kind, stage}) => kind === c.kind && stage === 3));
}

/**
 * Recognizes the old article locator stored as JSON in the context field.
 * @param {unknown} value
 * @returns {?Record<string, unknown>}
 */
export function parseLegacySourceLocator(value) {
    if (typeof value !== 'string') { return null; }
    let parsed;
    try {
        parsed = parseJson(value);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return null; }
    const locator = /** @type {Record<string, unknown>} */ (parsed);
    if (locator.kind !== 'article' || typeof locator.title !== 'string' || !Object.prototype.hasOwnProperty.call(locator, 'locator') || !Object.prototype.hasOwnProperty.call(locator, 'position')) { return null; }
    return locator;
}

/**
 * Build a regular dictionary lookup while retaining the saved source context.
 * This deliberately restores ordinary source metadata only; it does not create subtitle authorization.
 * @param {{id?: string, entry?: {word?: string, sentence?: string, context?: string, url?: string, title?: string, videoTime?: number, language?: string}}} record
 * @returns {URLSearchParams}
 */
export function studyResumeParams(record) {
    const entry = record.entry ?? {};
    const word = entry.word ?? '';
    const sentence = entry.sentence ?? word;
    const params = new URLSearchParams({type: 'terms', query: word, full: sentence, offset: `${Math.max(0, sentence.toLocaleLowerCase().indexOf(word.toLocaleLowerCase()))}`, studyResume: '1'});
    params.set('studySourceUrl', entry.url ?? '');
    const legacySource = parseLegacySourceLocator(entry.context);
    const sourceTitle = entry.title?.trim() || (typeof legacySource?.title === 'string' ? legacySource.title.trim() : '');
    params.set('studySourceTitle', sourceTitle);
    params.set('studyContext', legacySource ? '' : (entry.context ?? ''));
    params.set('studyLanguage', entry.language ?? 'en');
    if (record.id) { params.set('studyRecordId', record.id); }
    if (typeof entry.videoTime === 'number' && Number.isFinite(entry.videoTime)) { params.set('studyVideoTime', `${entry.videoTime}`); }
    return params;
}

/**
 * @param {Parameters<typeof studyResumeParams>[0]} record
 * @param {string} searchUrl
 * @returns {string}
 */
export function createResumeUrl(record, searchUrl) {
    return `${searchUrl}?${studyResumeParams(record).toString()}`;
}

/**
 * Keep the stored string for the index; a file URL here is metadata, not a navigation target.
 * @param {string} value
 * @returns {string}
 */
export function librarySource(value) {
    return value.length <= 2000 && /^(?:https?:\/\/|file:\/\/\/[^/])/.test(value) ? value : '';
}

/**
 * @param {string} sourceUrl
 * @param {string} libraryUrl
 * @returns {string}
 */
export function createSourceLibraryUrl(sourceUrl, libraryUrl) {
    const url = new URL(libraryUrl);
    url.searchParams.set('source', sourceUrl);
    return url.href;
}

/**
 * @param {string} word
 * @param {string | URL} libraryUrl
 * @param {boolean} [practice]
 * @returns {string}
 */
export function createWordLibraryUrl(word, libraryUrl, practice = false) {
    const url = new URL(libraryUrl);
    url.searchParams.set('word', word);
    if (practice) { url.searchParams.set('practice', 'word'); }
    return url.href;
}

/**
 * An explicitly opened note in the ordinary lookup view; live subtitle authority is separate.
 * @param {import('display').HistoryState | null | undefined} state
 * @param {string} word
 * @returns {string | undefined}
 */
export function savedStudyRecordId(state, word) {
    if (!state || state.sentence?.studySubtitle) { return; }
    const storedWord = state.savedRecordWord ?? state.savedRecordEntry?.word;
    if (storedWord && storedWord.toLocaleLowerCase() !== word.toLocaleLowerCase()) { return; }
    const id = state.savedRecordId ?? state.sentence?.recordId;
    return typeof id === 'string' && /^[a-f0-9]{32}$/.test(id) ? id : void 0;
}

/**
 * Use the language of the exact read-back record, not the current dictionary or the URL hint.
 * @param {import('display').HistoryState | null | undefined} state
 * @param {string} word
 * @returns {string | undefined}
 */
export function savedStudyLanguage(state, word) {
    const entry = savedStudyRecordId(state, word) ? state?.savedRecordEntry : void 0;
    return entry ? entry.language ?? 'en' : void 0;
}
