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
import {enhanceStudyUi} from '../study/study-ui.js';
import {Application} from '../application.js';
import {Frontend} from '../app/frontend.js';
import {PopupFactory} from '../app/popup-factory.js';
import {ThemeController} from '../app/theme-controller.js';
import {HotkeyHandler} from '../input/hotkey-handler.js';
import {escapeRegExp} from '../core/utilities.js';
import {blankStudyWord} from '../display/study-card-kinds.js';
import {studyCall} from '../study/study-client.js';
import {sourceKey} from '../study/study-journal.js';
import {timedUrl, videoListenUrl} from '../study/media-key.js';
import {YOUTUBE_HOSTS} from '../study/media-rules.js';
import {markWordKnown, normalizeInfo, wordInfo} from '../study/word-marks.js';
import {WORD_STATUS_KEY, AUTO_SYNC_STATE_KEY, canOfferUseCard, cardReceipt, createResumeUrl, createSourceLibraryUrl, parseLegacySourceLocator, savedAudioAttachment} from '../study/study-data.js';

export {createResumeUrl} from '../study/study-data.js';

const PAGE_SIZE = 10;
const SENTENCE_PRACTICE_LIMIT = 5;

/** @typedef {import('study').LibraryRecord & {favorite?: boolean, learningState?: string, syncState?: string | {status?: string}, conflicts?: {key: string, local: unknown, remote: unknown}[], reconcileState?: 'checking'|'verified'|'failed', reconcileError?: string}} StudyLibraryRecord */
/** @typedef {import('study').SavedWord & {language?: string, libraryId?: string, syncPending?: boolean}} LocalSavedWord */
/** @typedef {{id: string, articleHref?: string, entry: Parameters<typeof createResumeUrl>[0]['entry'] & {word: string, sentence: string, sense: {gloss: string}}}} SensePracticeItem */
/** @typedef {{row: StudyLibraryRecord, text: string, answer: string, hint: string}} SentencePrompt */

/**
 * @param {unknown} value
 * @returns {number[]}
 */
function noteIds(value) {
    if (!value || typeof value !== 'object') { return []; }
    const record = /** @type {{noteId?: unknown, cards?: unknown}} */ (value);
    const ids = [record.noteId, ...(Array.isArray(record.cards) ? record.cards.map((card) => (card && typeof card === 'object' ? /** @type {{noteId?: unknown}} */ (card).noteId : null)) : [])];
    return /** @type {number[]} */ ([...new Set(ids.filter((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0))]);
}

/**
 * @param {unknown} value
 * @param {string} category
 * @returns {boolean}
 */
export function matchesCategory(value, category) {
    if (!value || typeof value !== 'object') { return false; }
    const record = /** @type {Partial<StudyLibraryRecord>} */ (value);
    const syncState = typeof record.syncState === 'string' ? record.syncState : '';
    switch (category) {
        case 'manual-known': return record.manualKnown === true;
        case 'favorites': return record.favorite === true;
        case 'saved': return record.vaultSaved === true && record.learningState !== 'favorite-only';
        case 'linked': return noteIds(record).length > 0 || record.ankiState === 'linked';
        case 'anki-only': return syncState === 'anki-only';
        case 'pending': return cardReceipt(record).needsAttention;
        default: return true;
    }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function plainText(value) {
    if (typeof value === 'string') { return value; }
    if (value === null || typeof value === 'undefined') { return ''; }
    try {
        return JSON.stringify(value) ?? '';
    } catch {
        return '（无法显示）';
    }
}

/**
 * @param {{url?: string, videoTime?: number}} entry
 * @param {string} title
 * @param {string} [articleHref] The bridge's optional direct link to the saved sentence.
 * @param {string} [libraryUrl] The library page base for an optional related-source link.
 * @returns {HTMLElement | null}
 */
export function createSourceLine(entry, title, articleHref = '', libraryUrl = '') {
    let name = title.trim();
    let href = '';
    try {
        const url = new URL(entry.url);
        if (url.protocol === 'file:') {
            name = decodeURIComponent(url.pathname.split('/').pop());
        } else if (['http:', 'https:'].includes(url.protocol)) {
            const host = url.hostname.replace(/^www\./, '');
            const platform = YOUTUBE_HOSTS.has(url.hostname) ? 'YouTube' : host;
            name = name ? `${platform} · ${name}` : platform;
            href = articleHref || timedUrl(url.href, entry.videoTime).url;
            if (Number.isFinite(entry.videoTime) && entry.videoTime >= 0) {
                const seconds = Math.floor(entry.videoTime);
                name += ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
            }
        }
    } catch { /* A title without a usable URL remains plain text. */ }
    if (!name) { return null; }
    const line = document.createElement('p'); line.className = 'study-library-source';
    line.append('来源：');
    const text = document.createElement(href ? 'a' : 'strong');
    text.textContent = name + (href ? ' ↗' : '');
    if (text instanceof HTMLAnchorElement) {
        text.href = href;
        text.target = '_blank'; text.rel = 'noopener noreferrer';
    }
    line.append(text);
    if (href && libraryUrl) {
        const related = document.createElement('a');
        related.href = createSourceLibraryUrl(entry.url ?? '', libraryUrl);
        related.textContent = '同来源原句 ↗';
        related.target = '_blank';
        related.rel = 'noopener noreferrer';
        line.append(' · ', related);
    }
    return line;
}

/**
 * @param {unknown} value
 * @returns {StudyLibraryRecord[]}
 */
function normalizeRecords(value) {
    if (Array.isArray(value)) { return /** @type {StudyLibraryRecord[]} */ (value); }
    if (!value || typeof value !== 'object') { return []; }
    const result = /** @type {{items?: unknown, entries?: unknown}} */ (value);
    const rows = Array.isArray(result.items) ? result.items : result.entries;
    return Array.isArray(rows) ? /** @type {StudyLibraryRecord[]} */ (rows) : [];
}

/**
 * @param {unknown} value
 * @returns {LocalSavedWord[]}
 */
function normalizeSavedWords(value) {
    return Array.isArray(value) ? /** @type {LocalSavedWord[]} */ (value) : [];
}

/**
 * @param {unknown} value
 * @param {string} id
 * @returns {?StudyLibraryRecord}
 */
function normalizeRecord(value, id) {
    if (!value || typeof value !== 'object') { return null; }
    const result = /** @type {{id?: string, items?: unknown, record?: unknown}} */ (value);
    if (result.id === id) { return /** @type {StudyLibraryRecord} */ (value); }
    const rows = normalizeRecords(value);
    return rows.find((row) => row.id === id) ?? (result.record && typeof result.record === 'object' && /** @type {{id?: string}} */ (result.record).id === id ? /** @type {StudyLibraryRecord} */ (result.record) : null);
}

/**
 * @param {StudyLibraryRecord|LocalSavedWord} record
 * @param {string} query
 * @returns {boolean}
 */
function matchesSearch(record, query) {
    if (!query) { return true; }
    // Local-only favorites, or a bridge too old to search its index.
    const entry = 'entry' in record ? record.entry : record;
    /** @type {(string|undefined)[]} */
    const fields = [entry.word, entry.sentence, entry.title, (entry.url || '').split(/[?#]/, 1)[0]];
    if ('entry' in record) {
        const e = record.entry;
        const legacy = parseLegacySourceLocator(e.context);
        fields.push(e.lemma, e.sense?.gloss, e.meaning, e.translation, legacy ? plainText(legacy.title) : e.context, record.path);
    }
    const values = fields.map((value) => (value || '').toLocaleLowerCase());
    return query.toLocaleLowerCase().split(/\s+/u).every((part) => values.some((value) => value.includes(part)));
}

/**
 * @param {StudyLibraryRecord} record
 * @returns {string}
 */
function stateSummary(record) {
    const receipt = cardReceipt(record);
    if (receipt.repair) { return receipt.text; }
    if (record.vaultSaved && record.learningState !== 'favorite-only' && !receipt.needsAttention && noteIds(record).length === 0 && !record.cards?.length) { return '只存了笔记，还没有复习卡'; }
    if (record.reconcileState === 'checking') { return '正在确认最近的保存和复习状态…'; }
    const labels = [];
    const isFavorite = record.learningState === 'favorite-only' && record.favorite !== false;
    switch (isFavorite ? 'favorite' : record.vaultSaved) {
        case 'favorite': labels.push('已加入待学收藏'); break;
        case true:
            labels.push('笔记已保存');
            if (record.favorite === true) { labels.push('已收藏'); }
            break;
        case false: labels.push('笔记尚未保存'); break;
        default: labels.push('笔记状态待确认'); break;
    }
    labels.push(`Anki · ${receipt.text}`);
    if (record.syncState === 'paused') { labels.push('同步已暂停'); }
    if (record.reconcileState === 'failed') { labels.push('未核对最新状态'); }
    if (record.error) { labels.push(`需留意：${record.error}`); }
    if (record.reconcileError) { labels.push(record.reconcileError); }
    return labels.join(' · ');
}

/**
 * @param {string|null|undefined} path
 * @param {unknown} subtitleLocator
 * @param {?Record<string, unknown>} legacyLocator
 * @returns {?HTMLElement}
 */
function makeTechnicalDetails(path, subtitleLocator, legacyLocator) {
    if (!path && !subtitleLocator && !legacyLocator) { return null; }
    const details = document.createElement('details');
    details.className = 'study-library-technical-details';
    const summary = document.createElement('summary');
    summary.textContent = '查看记录详情';
    details.append(summary);
    if (path) {
        const pathElement = document.createElement('p');
        pathElement.className = 'study-library-path';
        pathElement.textContent = `笔记位置：${path}`;
        details.append(pathElement);
    }
    for (const [labelText, value] of [['原始字幕定位资料', subtitleLocator], ['原始来源定位资料', legacyLocator]]) {
        if (!value) { continue; }
        const label = document.createElement('p');
        label.textContent = labelText;
        const data = document.createElement('pre');
        data.className = 'study-library-locator';
        try {
            data.textContent = JSON.stringify(value, null, 2) ?? '';
        } catch {
            data.textContent = '定位资料无法显示。';
        }
        details.append(label, data);
    }
    return details;
}

/**
 * Writes the sentence with the studied word marked, without parsing any HTML.
 * @param {HTMLElement} element
 * @param {string} sentence
 * @param {string} word
 * @param {boolean} [wholeWord]
 */
function writeSentence(element, sentence, word, wholeWord = false) {
    if (typeof sentence !== 'string') { sentence = ''; }
    let at = -1;
    if (word) {
        at = wholeWord ?
            sentence.search(new RegExp(`(?<!\\w)${escapeRegExp(word)}(?!\\w)`, 'i')) :
            sentence.toLocaleLowerCase().indexOf(word.toLocaleLowerCase());
    }
    if (at < 0) {
        element.textContent = sentence;
        return;
    }
    const mark = document.createElement('mark');
    mark.textContent = sentence.slice(at, at + word.length);
    element.replaceChildren(sentence.slice(0, at), mark, sentence.slice(at + word.length));
}

/**
 * @param {HTMLElement} answer
 * @param {SensePracticeItem} row
 * @param {boolean} [includeContext]
 */
function appendPracticeSource(answer, row, includeContext = false) {
    const {entry} = row;
    const legacy = parseLegacySourceLocator(entry.context);
    if (includeContext && entry.context && !legacy) {
        const context = document.createElement('p');
        context.textContent = entry.context;
        answer.append(context);
    }
    const source = createSourceLine(entry, entry.title || (typeof legacy?.title === 'string' ? legacy.title : ''), row.articleHref);
    if (source) { answer.append(source); }
    const resume = document.createElement('a');
    resume.textContent = '继续学习 ↗';
    resume.href = createResumeUrl(row, chrome.runtime.getURL('/search.html'));
    resume.target = '_blank';
    resume.rel = 'noopener noreferrer';
    answer.append(resume);
}

/**
 * A short, local exercise: compare with the learner's own saved meaning, not a model's answer.
 * @param {HTMLElement} panel
 * @param {SensePracticeItem[]} pair
 * @param {boolean} [examples]
 */
function showSensePractice(panel, pair, examples = false) {
    const heading = document.createElement('h2');
    heading.textContent = examples ? '同一个意思，在这两句里怎么用？' : '这两句里的词，各是什么意思？';
    heading.tabIndex = -1;
    const help = document.createElement('p');
    help.textContent = examples ? '对照原句，留意这个词和哪些词搭配、分别用在什么场景。' : '先按原句选，选完看你当时记下的意思。';
    const questions = document.createElement('div');
    questions.className = 'study-library-practice-questions';
    const labels = pair.map(({entry}) => entry.sense.gloss);
    if (!examples && Math.random() < 0.5) { labels.reverse(); }
    for (const row of pair) {
        const {entry} = row;
        const question = document.createElement('article');
        const sentence = document.createElement('p');
        sentence.lang = 'en';
        sentence.className = 'study-library-practice-quote';
        writeSentence(sentence, entry.sentence, entry.word, true);
        const answer = document.createElement('div');
        answer.className = 'study-library-practice-answer';
        question.append(sentence);
        questions.append(question);
        if (examples) {
            answer.textContent = `当时记的是「${entry.sense.gloss}」。`;
            appendPracticeSource(answer, row, true);
            question.append(answer);
            continue;
        }
        const choices = document.createElement('div');
        choices.className = 'study-library-practice-choices';
        answer.tabIndex = -1;
        for (const label of labels) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.addEventListener('click', () => {
                const saved = entry.sense.gloss;
                answer.textContent = label === saved ? `你当时记的是「${saved}」。` : `你选了「${label}」，这句你当时记的是「${saved}」。`;
                appendPracticeSource(answer, row);
                choices.replaceWith(answer);
                answer.focus();
            }, {once: true});
            choices.append(button);
        }
        question.append(choices);
    }
    panel.replaceChildren(heading, help, questions);
    panel.hidden = false;
    heading.focus();
}

/**
 * @param {StudyLibraryRecord[]} rows
 * @param {SentencePrompt[]} picked
 * @param {boolean} dictation
 * @returns {SentencePrompt[]}
 */
function sentencePrompts(rows, picked, dictation) {
    const prompts = [...picked];
    const seen = new Set(picked.map(({text}) => text));
    for (const row of rows) {
        if (prompts.length >= SENTENCE_PRACTICE_LIMIT) { break; }
        const {entry} = row;
        if (!matchesCategory(row, 'saved') || !entry?.sentence || !entry.word || !/^en(?:-|$)/i.test(entry.language || 'en')) { continue; }
        if (dictation) {
            if (!savedAudioAttachment(row) || seen.has(entry.sentence)) { continue; }
            seen.add(entry.sentence);
            prompts.push({row, text: entry.sentence, answer: entry.sentence, hint: ''});
            continue;
        }
        const facts = {word: entry.word, sentence: entry.sentence, forms: []};
        const {text, answers} = blankStudyWord(facts);
        if (answers.length !== 1 || seen.has(text)) { continue; }
        seen.add(text);
        const hint = blankStudyWord(facts, entry.sense?.gloss || entry.meaning || '').text.trim().slice(0, 160);
        prompts.push({row, text, answer: answers[0], hint});
    }
    return prompts;
}

/**
 * Align matching words in order so one omission does not mark the rest of the sentence.
 * @param {string} written
 * @param {string} original
 * @returns {{written: {start: number, end: number}[], original: {start: number, end: number}[]}}
 */
function differingWords(written, original) {
    const words = (/** @type {string} */ text) => Array.from(text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu), (hit) => {
        const [word] = hit;
        const start = hit.index;
        return {start, end: start + word.length, key: word.normalize('NFC').toLowerCase().replaceAll('’', "'")};
    });
    const left = words(written);
    const right = words(original);
    const result = {written: /** @type {{start: number, end: number}[]} */ ([]), original: /** @type {{start: number, end: number}[]} */ ([])};
    if (left.length === right.length && left.every(({key}, i) => key === right[i].key)) { return result; }
    const shared = Array.from({length: left.length + 1}, () => new Uint16Array(right.length + 1));
    for (let i = left.length - 1; i >= 0; --i) {
        for (let j = right.length - 1; j >= 0; --j) {
            shared[i][j] = left[i].key === right[j].key ? 1 + shared[i + 1][j + 1] : Math.max(shared[i + 1][j], shared[i][j + 1]);
        }
    }
    for (let i = 0, j = 0; i < left.length || j < right.length;) {
        if (i < left.length && j < right.length && left[i].key === right[j].key) {
            ++i;
            ++j;
        } else if (j === right.length || (i < left.length && shared[i + 1][j] >= shared[i][j + 1])) {
            result.written.push(left[i++]);
        } else {
            result.original.push(right[j++]);
        }
    }
    return result;
}

/**
 * @param {HTMLElement} line
 * @param {string} text
 * @param {{start: number, end: number}[]} offsets
 */
function markDictation(line, text, offsets) {
    line.replaceChildren();
    let at = 0;
    for (const {start, end} of offsets) {
        line.append(text.slice(at, start), Object.assign(document.createElement('mark'), {textContent: text.slice(start, end)}));
        at = end;
    }
    line.append(text.slice(at));
}

/**
 * @param {HTMLElement} panel
 * @param {SentencePrompt[]} prompts
 * @param {boolean} dictation
 * @param {(row: StudyLibraryRecord, report?: (message: string) => void) => HTMLButtonElement | null} makeAudioButton
 * @param {() => void} stopAudio
 */
function showSentencePractice(panel, prompts, dictation, makeAudioButton, stopAudio) {
    const heading = document.createElement('h2');
    heading.tabIndex = -1;
    let queue = prompts;
    let index = 0;
    let retrying = false;
    /** @type {Set<SentencePrompt>} */
    const missed = new Set();
    const show = () => {
        if (index === queue.length) {
            heading.textContent = '本轮结束';
            panel.replaceChildren(heading, Object.assign(document.createElement('p'), {textContent: '可返回学习库继续找原句。这轮不保存成绩。'}));
            if (missed.size > 0) {
                const retry = Object.assign(document.createElement('button'), {type: 'button', textContent: `重听没对上的 ${missed.size} 句`});
                retry.onclick = () => {
                    queue = [...missed];
                    missed.clear();
                    index = 0;
                    retrying = true;
                    show();
                };
                panel.append(retry);
            }
            heading.focus();
            return;
        }
        const prompt = queue[index];
        const {row, text, answer, hint} = prompt;
        const title = dictation ? '练原声听写' : '练原句填空';
        heading.textContent = `${retrying ? '重听没对上的' : title} · ${index + 1} / ${queue.length}`;
        const quote = document.createElement('p');
        quote.lang = 'en';
        quote.className = 'study-library-practice-quote';
        quote.textContent = text;
        const clue = Object.assign(document.createElement('p'), {textContent: dictation ? '先听录音，写下听到的整句。大小写和标点不计。' : (hint ? `你当时的提示：${hint}` : '想想你当时在这里读到的用法。')});
        const form = document.createElement('form');
        form.className = 'study-library-practice-choices';
        const label = Object.assign(document.createElement('label'), {htmlFor: 'study-library-cloze-answer', textContent: dictation ? '写下听到的原句' : '填原句里的词或短语'});
        const input = dictation ? Object.assign(document.createElement('textarea'), {rows: 3}) : Object.assign(document.createElement('input'), {type: 'text'});
        input.id = label.htmlFor;
        input.lang = 'en';
        input.autocomplete = 'off';
        input.required = true;
        input.spellcheck = false;
        if (dictation) { input.maxLength = 2400; }
        input.setAttribute('autocapitalize', 'none');
        const check = Object.assign(document.createElement('button'), {type: 'submit', textContent: '核对原文'});
        const reveal = Object.assign(document.createElement('button'), {type: 'button', textContent: dictation ? '直接看原句' : '直接看答案'});
        const advance = () => {
            stopAudio();
            ++index;
            show();
        };
        const showAnswer = (/** @type {string} */ guess = '') => {
            const normalize = (/** @type {string} */ value) => value.trim().toLowerCase()
                .replaceAll('’', "'")
                .replaceAll(/\s+/g, ' ');
            const difference = dictation && guess ? differingWords(guess, answer) : null;
            const agrees = Boolean(guess) && (difference ? difference.written.length + difference.original.length === 0 : normalize(guess) === normalize(answer));
            if (dictation) {
                if (difference && !agrees) {
                    missed.add(prompt);
                    const comparison = document.createElement('div');
                    comparison.className = 'study-library-dictation';
                    const written = document.createElement('p');
                    written.className = quote.className;
                    written.lang = 'en';
                    markDictation(written, guess, difference.written);
                    markDictation(quote, answer, difference.original);
                    comparison.append(
                        Object.assign(document.createElement('small'), {textContent: '你的听写'}),
                        written,
                        Object.assign(document.createElement('small'), {textContent: '原句'}),
                        quote,
                    );
                    form.before(comparison);
                } else {
                    form.before(quote);
                }
                if (row.entry.translation) { form.before(Object.assign(document.createElement('p'), {textContent: row.entry.translation})); }
            } else {
                writeSentence(quote, row.entry.sentence, answer, true);
            }
            const different = dictation ? '划线的是两边没对上的词，可以再听一次。' : '和原句用词不同。';
            const prefix = guess ? (agrees ? '和原句一致。' : different) : '';
            const feedback = document.createElement('p');
            feedback.tabIndex = -1;
            feedback.className = 'study-library-practice-answer';
            feedback.textContent = dictation ? (prefix || '这是这段录音对应的原句。') : `${prefix}原句用的是「${answer}」。`;
            const actions = document.createElement('div');
            actions.className = 'study-library-practice-choices';
            const resume = document.createElement('a');
            resume.textContent = '继续学习 ↗';
            resume.href = createResumeUrl(row, chrome.runtime.getURL('/search.html'));
            resume.target = '_blank';
            resume.rel = 'noopener noreferrer';
            const next = Object.assign(document.createElement('button'), {type: 'button', textContent: index + 1 === queue.length ? '完成这轮' : '下一句'});
            next.dataset.clozeNext = '';
            next.onclick = advance;
            actions.append(next, resume);
            form.replaceWith(feedback, actions);
            feedback.focus();
        };
        form.onsubmit = (event) => {
            event.preventDefault();
            const guess = input.value.trim();
            if (guess) { showAnswer(guess); }
        };
        reveal.onclick = () => showAnswer();
        form.append(label, input, check, reveal);
        if (dictation) {
            form.append(Object.assign(document.createElement('button'), {type: 'button', textContent: '跳过', onclick: advance}));
        }
        const audioStatus = document.createElement('span');
        audioStatus.setAttribute('role', 'status');
        const listen = makeAudioButton(row, (message) => { audioStatus.textContent = message; });
        panel.replaceChildren(heading);
        if (!dictation) { panel.append(quote); }
        panel.append(clue);
        if (listen) {
            const tools = document.createElement('div');
            tools.className = 'study-library-practice-choices';
            tools.append(listen, audioStatus);
            panel.append(tools);
        }
        panel.append(form);
        input.focus();
    };
    panel.hidden = false;
    show();
}

/**
 * Rows stay compact for scanning; the toggle reveals context, record details
 * and the less frequent actions in place.
 * @param {HTMLElement} article
 * @param {HTMLElement} actions
 * @param {() => void} [onClose]
 */
function addDetailToggle(article, actions, onClose) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'study-library-detail-toggle';
    toggle.textContent = '详情';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
        const open = article.dataset.open !== 'true';
        article.dataset.open = `${open}`;
        toggle.setAttribute('aria-expanded', `${open}`);
        toggle.textContent = open ? '收起' : '详情';
        if (!open) { onClose?.(); }
    });
    actions.querySelector('.study-library-primary-action')?.after(toggle);
}

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * Extension pages do not receive the web content-script wrapper, so install the same
 * Frontend scanner/popup pair explicitly for the study-library page.
 * @param {Application} application
 * @returns {Promise<void>}
 */
export async function prepareStudyLibraryLookup(application) {
    const hotkeyHandler = new HotkeyHandler();
    hotkeyHandler.prepare(application.crossFrame);

    const popupFactory = new PopupFactory(application);
    popupFactory.prepare();

    const {browser} = await application.api.getEnvironmentInfo();
    const frontend = new Frontend({
        application,
        popupFactory,
        depth: 0,
        parentPopupId: null,
        parentFrameId: null,
        useProxyPopup: false,
        pageType: 'web',
        canUseWindowPopup: true,
        allowRootFramePopupProxy: true,
        childrenSupported: true,
        hotkeyHandler,
        browser,
    });
    await frontend.prepare();
}

/**
 * Optional today strip, refreshed when this page is explicitly loaded/refreshed.
 * @returns {Promise<void>}
 */
export async function refreshToday() {
    const line = document.getElementById('study-library-today');
    const open = /** @type {HTMLButtonElement} */ (document.getElementById('study-library-open-anki'));
    try {
        const today = /** @type {{due: number, reviewed: number, paused?: boolean}} */ (await studyCall('ankiToday'));
        line.hidden = open.hidden = today.paused === true;
        line.textContent = today.paused ? '' : (today.due === 0 ? '今天的复习已完成' : `今天还有 ${today.due} 张 · 已复习 ${today.reviewed}`);
        open.onclick = () => {
            void studyCall('ankiOpen').catch(() => { line.textContent = '未能打开 Anki，请先启动 Anki 后再试。'; });
        };
    } catch { line.hidden = open.hidden = true; }
}

/**
 * @returns {Promise<void>}
 */
async function initializePage() {
    await Application.main(true, async (application) => {
        const themeController = new ThemeController(document.documentElement);
        themeController.prepare();
        /** @type {Parameters<typeof canOfferUseCard>[1]} */
        let upgrades;
        try {
            upgrades = (await chrome.storage.local.get(AUTO_SYNC_STATE_KEY))[AUTO_SYNC_STATE_KEY];
        } catch { /* The reminder is optional. */ }
        try {
            const optionsFull = await application.api.optionsGetFull();
            const {profiles, profileCurrent} = optionsFull;
            const defaultProfile = (profileCurrent >= 0 && profileCurrent < profiles.length) ? profiles[profileCurrent] : null;
            if (defaultProfile !== null) {
                themeController.theme = defaultProfile.options.general.popupTheme;
                themeController.siteOverride = true;
                themeController.updateTheme();
            }
        } catch { /* Keep the browser-preferred fallback if profile options are unavailable. */ }
        const status = byId('study-library-status');
        const oldUpdates = document.getElementById('study-library-old-updates');
        const oldText = oldUpdates?.querySelector('textarea');
        const list = byId('study-library-list');
        const search = /** @type {HTMLInputElement} */ (document.getElementById('study-library-search'));
        const searchLabel = search.labels?.[0];
        const more = /** @type {HTMLButtonElement} */ (document.getElementById('study-library-more'));
        const practiceButton = byId('study-library-practice-button');
        const clozeButton = byId('study-library-cloze-button');
        const dictationButton = byId('study-library-dictation-button');
        const listenSource = /** @type {HTMLButtonElement} */ (byId('study-library-listen-source'));
        const practice = byId('study-library-practice');
        let lookupWarning = '';
        /** @param {string} text */
        const setStatus = (text) => { status.textContent = lookupWarning ? `${text} · 选词查词未就绪：${lookupWarning}` : text; };
        /** @type {AudioContext|null} */
        let savedAudio = null;
        /** @type {HTMLButtonElement|null} */
        let audioButton = null;
        const clearSavedAudio = () => {
            if (savedAudio) { void savedAudio.close().catch(() => {}); }
            if (audioButton) {
                audioButton.textContent = '播放已存原声';
                audioButton.disabled = false;
            }
            savedAudio = audioButton = null;
        };
        window.addEventListener('pagehide', clearSavedAudio);
        /**
         * @param {string} id
         * @param {HTMLButtonElement} button
         * @param {(message: string) => void} report
         * @returns {Promise<void>}
         */
        async function playSavedAudio(id, button, report) {
            const stopping = button === audioButton;
            clearSavedAudio();
            if (stopping) { return; }
            const context = new AudioContext();
            savedAudio = context;
            audioButton = button;
            button.disabled = true;
            try {
                await context.resume();
                if (savedAudio !== context) { return; }
                const {parts} = /** @type {{parts: string[]}} */ (await studyCall('libraryAudioRead', {id}));
                if (savedAudio !== context) { return; }
                const bytes = parts.map((part) => Uint8Array.from(atob(part), (character) => character.charCodeAt(0)));
                const audio = await context.decodeAudioData(await new Blob(bytes).arrayBuffer());
                if (savedAudio !== context) { return; }
                const source = context.createBufferSource();
                source.buffer = audio;
                source.connect(context.destination);
                source.addEventListener('ended', () => {
                    if (savedAudio === context) { clearSavedAudio(); }
                });
                source.start();
                button.textContent = '停止播放';
                button.disabled = false;
            } catch (error) {
                if (savedAudio !== context) { return; }
                clearSavedAudio();
                const detail = error instanceof Error && error.name === 'Error' ? error.message : '播放不了这段原声。';
                report(`${detail} 可打开原笔记检查附件。`);
            }
        }
        /**
         * @param {StudyLibraryRecord} record
         * @param {(message: string) => void} [report]
         * @returns {HTMLButtonElement | null}
         */
        function makeSavedAudioButton(record, report) {
            if (!matchesCategory(record, 'saved') || !savedAudioAttachment(record)) { return null; }
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = '播放已存原声';
            button.onclick = () => {
                report?.('');
                void playSavedAudio(record.id, button, report ?? setStatus);
            };
            return button;
        }
        oldUpdates?.querySelector('button')?.addEventListener('click', async () => {
            if (!oldText) { return; }
            try {
                await navigator.clipboard.writeText(oldText.value);
                setStatus('旧问答已复制；请粘贴到核对过的笔记。');
            } catch {
                oldText.focus();
                oldText.select();
                setStatus('已选中旧问答，请用复制快捷键。');
            }
        });
        /** @param {import('study').PendingSyncTask[]} pending */
        const showOldUpdates = (pending) => {
            if (!oldUpdates || !oldText) { return; }
            const held = pending.filter((task) => task.reviewOnly);
            oldUpdates.hidden = held.length === 0;
            const summary = oldUpdates.querySelector('summary');
            if (summary) { summary.textContent = `有 ${held.length} 项旧问答需核对`; }
            oldText.value = held.map(({entry, turns}, i) => {
                const saved = [entry?.word, entry?.sentence, entry?.title, entry?.url, entry?.context, entry?.meaning, entry?.translation, entry?.notes];
                const conversation = (turns ?? []).flatMap((turn) => [
                    turn.question && `问：${turn.question}`,
                    turn.meaning,
                    turn.translation,
                    turn.notes,
                    turn.feedback === 'understood' ? '本人反馈：这次懂了' : (turn.feedback === 'unclear' ? '本人反馈：仍没懂' : ''),
                ]);
                return [`旧补充 ${i + 1}`, ...new Set([...saved, ...conversation].filter(Boolean))].join('\n');
            }).join('\n\n');
        };
        void prepareStudyLibraryLookup(application).catch((error) => {
            lookupWarning = error instanceof Error ? error.message : '请刷新页面再试。';
            setStatus('学习库仍可使用');
        });
        /** @type {Map<string, StudyLibraryRecord>} */
        const records = new Map();
        /** @type {LocalSavedWord[]} */
        let savedWords = [];
        let savedRead = 0;
        let savedReadError = '';
        let syncPendingError = '';
        let pendingSyncCount = 0;
        let listError = '';
        let total = 0;
        let needsAttention = 0;
        let offset = 0;
        let loading = false;
        /** @type {boolean|null} Latest queued reset; true for a read-only search. */
        let queuedSearch = null;
        let loaded = false;
        const requested = new URL(location.href).searchParams;
        const requestedSource = requested.get('source') || '';
        search.value = (requested.get('query') || '').slice(0, 240);
        const sourceTab = /** @type {?HTMLButtonElement} */ (document.querySelector('[data-library-category="source"]'));
        const articleUrl = /^https?:\/\//.test(requestedSource) && requestedSource.length <= 2000 ? requestedSource : '';
        const practiceWord = !articleUrl && requested.get('practice') === 'word' ? search.value.trim() : '';
        let openRequestedPractice = Boolean(practiceWord);
        let category = articleUrl ? 'source' : 'all';
        if (articleUrl && sourceTab) {
            sourceTab.hidden = false;
            sourceTab.setAttribute('aria-pressed', 'true');
            document.querySelector('[data-library-category="all"]')?.setAttribute('aria-pressed', 'false');
        }
        let canSearch = false;
        let listedQuery = '';
        let listedCategory = 'all';
        let searchTimer = 0;
        /** @type {SensePracticeItem[]} */
        let practicePair = [];
        let compareExamples = false;
        const practiceLabel = () => (compareExamples ? '用旧原句看用法' : '用旧原句辨词义');
        /** @type {SentencePrompt[]} */
        let cloze = [];
        /** @type {SentencePrompt[]} */
        let dictation = [];
        /** @type {{button: HTMLElement, label: string} | null} */
        let sentenceSearch = null;
        const sentenceButtons = [clozeButton, dictationButton];
        const moreScopedPrompts = () => {
            if (!['source', 'recent-recall'].includes(category) || loading || listError || offset >= total) { return false; }
            return listedCategory === category && (!canSearch || listedQuery === search.value.trim());
        };
        const cancelSentenceSearch = () => {
            if (!sentenceSearch) { return; }
            sentenceSearch.button.textContent = sentenceSearch.label;
            sentenceSearch = null;
        };
        /** @type {HTMLElement|null} */
        let activePractice = null;
        let sourceVideoId = '';
        listenSource.addEventListener('click', () => {
            if (!sourceVideoId) { return; }
            listenSource.disabled = true;
            void studyCall('openVideoListening', {id: sourceVideoId, wholeVideo: true})
                .catch((error) => setStatus(error instanceof Error ? error.message : '没能打开原视频。'))
                .finally(() => { listenSource.disabled = false; });
        });

        /** @returns {void} */
        function closePractice() {
            if (activePractice) { clearSavedAudio(); }
            practice.hidden = true;
            practice.replaceChildren();
            activePractice = null;
            list.hidden = status.hidden = search.hidden = false;
            if (searchLabel) { searchLabel.hidden = false; }
            practiceButton.textContent = practiceLabel();
            clozeButton.textContent = '练原句填空';
            dictationButton.textContent = '练原声听写';
            for (const button of [practiceButton, ...sentenceButtons]) { button.setAttribute('aria-expanded', 'false'); }
        }
        /**
         * @param {HTMLElement} button
         * @param {() => void} show
         */
        function togglePractice(button, show) {
            const closing = activePractice === button;
            cancelSentenceSearch();
            closePractice();
            if (closing) {
                render();
                return;
            }
            clearSavedAudio();
            activePractice = button;
            list.hidden = status.hidden = more.hidden = true;
            listenSource.hidden = true;
            search.hidden = sentenceButtons.includes(button);
            if (searchLabel) { searchLabel.hidden = search.hidden; }
            button.textContent = search.hidden ? '返回学习库' : '返回搜索结果';
            button.setAttribute('aria-expanded', 'true');
            show();
        }
        practiceButton.addEventListener('click', () => togglePractice(practiceButton, () => showSensePractice(practice, practicePair, compareExamples)));

        /**
         * @param {HTMLElement} button
         * @returns {Promise<void>}
         */
        async function startSentencePractice(button) {
            if (sentenceSearch?.button === button) {
                cancelSentenceSearch();
                setStatus('已取消找题，原列表保留。');
                return;
            }
            cancelSentenceSearch();
            const listening = button === dictationButton;
            /**
             * @param {SentencePrompt[]} prompts
             * @returns {void}
             */
            const open = (prompts) => togglePractice(button, () => showSentencePractice(practice, prompts, listening, makeSavedAudioButton, clearSavedAudio));
            let prompts = listening ? dictation : cloze;
            if (activePractice === button || (!listening && (prompts.length >= SENTENCE_PRACTICE_LIMIT || !moreScopedPrompts()))) {
                open(prompts);
                return;
            }
            const request = {button, label: listening ? '练原声听写' : '练原句填空'};
            sentenceSearch = request;
            button.textContent = '取消找题';
            const scope = category;
            const url = scope === 'source' ? articleUrl : '';
            setStatus(listening ? '正在找带原声的原句…' : '正在找可练的原句…');
            const query = search.value.trim();
            const indexed = canSearch;
            const base = {language: 'en', scope, url, title: ''};
            let failed = false;
            try {
                if (listening) {
                    const found = await studyCall('libraryList', {...base, practice: 'dictation', ...(query ? {query} : {})});
                    prompts = sentencePrompts(normalizeRecords(found), [], true);
                } else {
                    const end = total;
                    let next = offset;
                    while (prompts.length < SENTENCE_PRACTICE_LIMIT && next < end) {
                        const payload = {...base, offset: next, ...(indexed && query ? {query} : {})};
                        const page = normalizeRecords(await studyCall('libraryList', payload));
                        if (sentenceSearch !== request) { return; }
                        if (page.length === 0) { break; }
                        next += page.length;
                        prompts = sentencePrompts(indexed ? page : page.filter((row) => matchesSearch(row, query)), prompts, false);
                    }
                }
            } catch { failed = true; }
            if (sentenceSearch !== request) { return; }
            cancelSentenceSearch();
            if (prompts.length > 0) {
                open(prompts);
            } else if (listening) {
                setStatus(failed ? '暂时没能查到更多录音。可多加载一些记录，再试听写。' : '这里没有能练听写的录音。可以换个分类或清空搜索再试。');
            } else {
                setStatus(failed ? '后面的原句没有读到，可以再试一次。' : '这次没找到能做成填空的原句，可以继续看记录。');
            }
        }
        for (const button of sentenceButtons) {
            button.addEventListener('click', () => { void startSentencePractice(button); });
        }

        /** @returns {Promise<void>} */
        async function refreshSavedWords() {
            const request = ++savedRead;
            try {
                const next = normalizeSavedWords(await studyCall('saved'));
                if (request !== savedRead) { return; }
                const previous = savedWords;
                savedWords = next;
                for (const saved of previous) {
                    if (!savedWords.some((row) => row.id === saved.id)) { updateLoadedFavorite(saved, false); }
                }
                for (const saved of savedWords) { updateLoadedFavorite(saved, true); }
                savedReadError = '';
            } catch (error) {
                if (request !== savedRead) { return; }
                savedReadError = error instanceof Error ? error.message : '本地收藏读取失败。';
            }
            render();
        }

        /**
         * @param {LocalSavedWord} saved
         * @returns {StudyLibraryRecord[]}
         */
        function matchingRecordsForSaved(saved) {
            const key = sourceKey({...saved, url: saved.sourceUrl ?? saved.url});
            return [...records.values()].filter((record) => (saved.libraryId && record.id === saved.libraryId) || sourceKey(record.entry) === key);
        }

        /**
         * @param {LocalSavedWord} saved
         * @returns {boolean}
         */
        function hasNativeFavorite(saved) {
            return matchingRecordsForSaved(saved).some((record) => record.favorite === true || (record.favorite !== false && record.learningState === 'favorite-only'));
        }

        /**
         * @param {LocalSavedWord} saved
         * @param {boolean} favorite
         * @returns {void}
         */
        function updateLoadedFavorite(saved, favorite) {
            for (const record of matchingRecordsForSaved(saved)) { record.favorite = favorite; }
        }

        /**
         * @param {StudyLibraryRecord} record
         * @returns {?HTMLElement}
         */
        function renderConflicts(record) {
            const conflicts = Array.isArray(record.conflicts) ? record.conflicts : [];
            if (conflicts.length === 0) { return null; }
            const section = document.createElement('section');
            section.className = 'study-library-conflicts';
            const heading = document.createElement('h3');
            heading.textContent = '字段冲突：选择要保留的一侧';
            const description = document.createElement('p');
            description.textContent = '本地指 Obsidian，远端指 Anki；只提交这里逐字段选择的结果。';
            section.append(heading, description);
            /** @type {{field: HTMLFieldSetElement, key: string}[]} */
            const groups = [];
            for (const [index, conflict] of conflicts.entries()) {
                if (!conflict || typeof conflict.key !== 'string') { continue; }
                const field = document.createElement('fieldset');
                const legend = document.createElement('legend');
                legend.textContent = conflict.key;
                field.append(legend);
                for (const [side, label] of [['local', '保留 Obsidian 本地'], ['remote', '保留 Anki 远端']]) {
                    const wrapper = document.createElement('label');
                    wrapper.className = 'study-library-choice';
                    const radio = document.createElement('input');
                    radio.type = 'radio';
                    radio.name = `conflict-${record.id}-${index}`;
                    radio.value = side;
                    radio.required = true;
                    const value = document.createElement('code');
                    value.textContent = plainText(side === 'local' ? conflict.local : conflict.remote);
                    wrapper.append(radio, document.createTextNode(`${label}：`), value);
                    field.append(wrapper);
                }
                groups.push({field, key: conflict.key});
                section.append(field);
            }
            if (groups.length > 0) {
                const resolve = document.createElement('button');
                resolve.type = 'button';
                resolve.textContent = '应用冲突选择';
                resolve.addEventListener('click', () => {
                    void (async () => {
                        /** @type {Record<string, 'local'|'remote'>} */
                        const resolutions = {};
                        for (const {field, key} of groups) {
                            const selected = field.querySelector('input:checked');
                            if (!(selected instanceof HTMLInputElement)) {
                                setStatus(`请先为「${key}」选择保留本地或远端。`);
                                return;
                            }
                            resolutions[key] = selected.value === 'remote' ? 'remote' : 'local';
                        }
                        resolve.disabled = true;
                        await refreshOne(record.id, {resolutions});
                    })().catch((error) => setStatus(error instanceof Error ? error.message : '冲突处理未完成。'))
                        .finally(() => { resolve.disabled = false; });
                });
                section.append(resolve);
            }
            return section;
        }

        /**
         * @param {StudyLibraryRecord} record
         * @returns {HTMLElement}
         */
        function makeCard(record) {
            const article = document.createElement('article');
            article.className = 'study-library-record';
            article.dataset.recordId = record.id;
            const top = document.createElement('div');
            top.className = 'study-library-record-heading';
            const title = document.createElement('h2');
            title.textContent = record.entry?.word || (record.syncState === 'anki-only' ? '这张卡没有留下原词' : '(未命名记录)');
            if (record.entry?.sense?.gloss) { title.append(` · ${record.entry.sense.gloss}`); }
            const state = document.createElement('p');
            state.className = 'study-library-state';
            state.textContent = stateSummary(record);
            const hit = record.searchHit;
            const snippet = hit?.text.toLocaleLowerCase() || '';
            const hitWord = snippet.includes(listedQuery.toLocaleLowerCase()) ?
listedQuery :
                listedQuery.split(/\s+/u).find((part) => snippet.includes(part.toLocaleLowerCase())) || '';
            if (hit && !['单词', '原形'].includes(hit.label) && hit.text !== record.entry?.sentence && hit.text !== record.entry?.title) {
                const clue = document.createElement('span');
                clue.className = 'study-library-match';
                writeSentence(clue, hit.text, hitWord);
                clue.prepend(`${hit.label}：`);
                state.prepend(clue);
            }
            top.append(title, state);
            article.append(top);
            if (record.entry?.sentence) {
                const sentence = document.createElement('p');
                sentence.className = 'study-library-sentence';
                writeSentence(sentence, record.entry.sentence, hit?.label === '原句' ? hitWord : record.entry.word || '');
                article.append(sentence);
            }
            const legacyLocator = parseLegacySourceLocator(record.entry?.context);
            if (record.entry?.context && !legacyLocator) {
                const context = document.createElement('p');
                context.className = 'study-library-context';
                context.textContent = record.entry.context;
                article.append(context);
            }
            const libraryUrl = category === 'source' ? '' : chrome.runtime.getURL('/study-library.html');
            const sourceLine = createSourceLine(record.entry ?? {}, record.entry?.title?.trim() || (typeof legacyLocator?.title === 'string' ? legacyLocator.title : ''), record.articleHref, libraryUrl);
            if (sourceLine) { article.append(sourceLine); }
            const technicalDetails = makeTechnicalDetails(record.path, record.entry?.subtitleSource, legacyLocator);
            if (technicalDetails) { article.append(technicalDetails); }
            const actions = document.createElement('div');
            actions.className = 'study-library-actions';
            const resume = document.createElement('a');
            resume.className = 'study-library-primary-action';
            resume.href = createResumeUrl(record, chrome.runtime.getURL('/search.html'));
            resume.target = '_blank';
            resume.rel = 'noopener noreferrer';
            resume.textContent = '继续学习 ↗';
            actions.append(resume);
            if (record.syncState !== 'anki-only' && videoListenUrl(record.entry)) {
                const listen = document.createElement('button');
                listen.type = 'button';
                listen.textContent = '回视频听这句';
                listen.onclick = () => {
                    listen.disabled = true;
                    void studyCall('openVideoListening', {id: record.id})
                        .catch((error) => setStatus(error instanceof Error ? error.message : '没能打开视频。可点原来的来源链接。'))
                        .finally(() => { listen.disabled = false; });
                };
                actions.append(listen);
            }
            const listenSaved = makeSavedAudioButton(record);
            if (listenSaved) { actions.append(listenSaved); }
            if (record.audioContextChanged) {
                actions.append(Object.assign(document.createElement('small'), {textContent: '原句或来源已改，旧录音仍在笔记里。'}));
            }
            const cardUrl = new URL(resume.href);
            cardUrl.searchParams.set('studyAddCard', '1');
            const useLink = document.createElement('a');
            useLink.href = cardUrl.href;
            useLink.target = resume.target; useLink.rel = resume.rel;
            useLink.textContent = '选会用卡 ↗';
            useLink.title = '有一张卡的复习间隔已满 21 天。打开这条原句，先看草稿再决定。';
            useLink.dataset.useCardFor = record.id;
            useLink.hidden = !canOfferUseCard(record, upgrades);
            actions.append(useLink);
            const reset = document.createElement('button'); reset.type = 'button';
            reset.textContent = '改回在学';
            reset.dataset.resetKnown = '';
            reset.hidden = !record.manualKnown;
            reset.onclick = () => {
                reset.disabled = true;
                void markWordKnown(record.entry.word, false).then(() => {
                    for (const row of records.values()) {
                        if ((row.entry.lemma || row.entry.word).toLowerCase() === (record.entry.lemma || record.entry.word).toLowerCase()) { row.manualKnown = false; }
                    }
                    if (category === 'manual-known') {
                        void loadPage(true);
                    } else { paintLearningActions(); }
                }).catch((error) => {
                    setStatus(error instanceof Error ? error.message : '标记没有保存，请重试。');
                })
                    .finally(() => { reset.disabled = false; });
            };
            actions.append(reset);
            if (record.openUrl) {
                const note = document.createElement('a');
                note.href = record.openUrl;
                note.target = '_blank';
                note.rel = 'noopener noreferrer';
                note.textContent = '打开原笔记 ↗';
                actions.append(note);
            }
            const ids = noteIds(record);
            if (ids.length > 0) {
                const anki = document.createElement('button');
                anki.type = 'button';
                anki.textContent = 'Anki 查看';
                anki.addEventListener('click', () => {
                    anki.disabled = true;
                    void application.api.viewNotes(ids, 'browse', false)
                        .catch((error) => setStatus(error instanceof Error ? `Anki 尚未打开或卡片不可用：${error.message}` : 'Anki 查看未完成。'))
                        .finally(() => { anki.disabled = false; });
                });
                actions.append(anki);
            }
            const favorite = document.createElement('button');
            favorite.type = 'button';
            favorite.textContent = record.favorite ? '★ 已收藏' : '☆ 收藏';
            favorite.setAttribute('aria-pressed', `${record.favorite === true}`);
            favorite.addEventListener('click', () => {
                favorite.disabled = true;
                void studyCall('libraryFavorite', {id: record.id, language: 'en', favorite: record.favorite !== true}).then((value) => {
                    const updated = normalizeRecord(value, record.id);
                    if (updated) {
                        records.set(record.id, updated);
                    } else {
                        record.favorite = record.favorite !== true;
                    }
                    render();
                    setStatus((updated?.favorite ?? record.favorite) ? '已收藏到学习库。' : '已从学习库收藏中移除。');
                }).catch((error) => setStatus(error instanceof Error ? error.message : '收藏状态未改变。'))
                    .finally(() => { favorite.disabled = false; });
            });
            actions.append(favorite);
            const refresh = document.createElement('button');
            refresh.type = 'button';
            refresh.textContent = '刷新 / 同步';
            refresh.addEventListener('click', () => {
                refresh.disabled = true;
                void refreshOne(record.id).catch((error) => setStatus(error instanceof Error ? error.message : '同步尚未完成。')).finally(() => { refresh.disabled = false; });
            });
            actions.append(refresh);
            if (record.syncState === 'anki-only') {
                resume.remove(); favorite.remove();
                refresh.remove();
            }
            addDetailToggle(article, actions, () => {
                if (audioButton && article.contains(audioButton)) { clearSavedAudio(); }
            });
            const createCard = () => {
                window.open(cardUrl.href, '_blank', 'noopener');
            };
            const originalWord = record.syncState === 'anki-only' && !record.entry?.word ? document.createElement('input') : null;
            if (originalWord) {
                originalWord.placeholder = '填入原来学的词'; originalWord.setAttribute('aria-label', originalWord.placeholder);
                originalWord.required = true; originalWord.maxLength = 128;
                actions.append(originalWord);
            }
            /**
             * @param {string} label
             * @param {'unlink'|'recreate'|'select'|'restore'|'ignore'} choice
             * @param {number|null|undefined} [noteId]
             */
            const repair = (label, choice, noteId = record.noteId) => {
                const button = document.createElement('button'); button.type = 'button';
                button.textContent = label;
                button.onclick = () => {
                    if (choice === 'restore' && originalWord && !originalWord.reportValidity()) { return; }
                    button.disabled = true;
                    const restore = {
                        ...(choice === 'restore' && originalWord ? {word: originalWord.value.trim()} : {}),
                        ...(choice === 'restore' && record.confirmRestoreTo ? {targetId: record.confirmRestoreTo.targetId} : {}),
                    };
                    void studyCall(
                        record.syncState === 'anki-only' ? 'libraryOrphan' : 'libraryRepair',
                        record.syncState === 'anki-only' ? {noteId, choice, ...restore} : {id: record.id, choice, ...(choice === 'select' ? {noteId} : {})},
                    )
                        .then(async () => {
                            if (label === '重新制卡') { createCard(); }
                            await loadPage(true);
                        })
                        .catch((error) => { setStatus(error instanceof Error ? error.message : '还没处理成功。请打开 Anki，刷新列表后再试。'); button.disabled = false; });
                };
                actions.append(button);
            };
            switch (record.syncState) {
                case 'missing':
                    repair('重新制卡', 'recreate'); repair('只保留笔记', 'unlink');
                    break;
                case 'ambiguous':
                    for (const candidate of record.candidates || []) { repair(`关联：${candidate.front}`, 'select', candidate.noteId); }
                    break;
                case 'anki-only':
                    if (record.confirmRestoreTo) {
                        const location = document.createElement('p');
                        location.className = 'study-library-state';
                        location.textContent = `找不到原保存位置。要存到这里吗？ ${record.confirmRestoreTo.path}`;
                        article.append(location);
                    }
                    repair(record.confirmRestoreTo ? '重建到这个文件夹' : '用卡片内容重建笔记', 'restore'); repair('忽略', 'ignore');
                    break;
                default:
                    if (noteIds(record).length === 0 && !record.cards?.length) {
                        const button = document.createElement('button'); button.type = 'button';
                        button.textContent = '制卡'; button.onclick = createCard;
                        actions.append(button);
                    }
            }
            article.append(actions);
            const conflicts = renderConflicts(record);
            if (conflicts) { article.append(conflicts); }
            return article;
        }

        /**
         * @param {LocalSavedWord} saved
         * @returns {HTMLElement}
         */
        function makeLocalFavoriteCard(saved) {
            const article = document.createElement('article');
            article.className = 'study-library-record study-library-local-favorite';
            article.dataset.recordId = saved.id;
            const title = document.createElement('h2');
            title.textContent = saved.word || '(未命名收藏)';
            const state = document.createElement('p');
            state.className = 'study-library-state';
            state.textContent = saved.syncPending ? '已收藏待学 · 正等待同步确认' : '已收藏待学 · 尚未确认笔记和复习状态';
            article.append(title, state);
            const sentence = document.createElement('p');
            sentence.className = 'study-library-sentence';
            writeSentence(sentence, saved.sentence, saved.word || '');
            article.append(sentence);
            const legacyLocator = parseLegacySourceLocator(saved.context);
            if (saved.context && !legacyLocator) {
                const context = document.createElement('p');
                context.className = 'study-library-context';
                context.textContent = saved.context;
                article.append(context);
            }
            const sourceLine = createSourceLine(saved, saved.title?.trim() || (typeof legacyLocator?.title === 'string' ? legacyLocator.title : ''));
            if (sourceLine) { article.append(sourceLine); }
            const technicalDetails = makeTechnicalDetails(null, null, legacyLocator);
            if (technicalDetails) { article.append(technicalDetails); }
            const actions = document.createElement('div');
            actions.className = 'study-library-actions';
            const resume = document.createElement('a');
            resume.className = 'study-library-primary-action';
            resume.href = createResumeUrl({entry: saved}, chrome.runtime.getURL('/search.html'));
            resume.target = '_blank';
            resume.rel = 'noopener noreferrer';
            resume.textContent = '继续学习 ↗';
            actions.append(resume);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = '取消收藏';
            remove.addEventListener('click', () => {
                remove.disabled = true;
                void studyCall('removeWord', {id: saved.id}).then(async () => {
                    updateLoadedFavorite(saved, false);
                    await refreshSavedWords();
                    setStatus('已取消收藏；原有笔记和复习卡仍保留。');
                }).catch((error) => setStatus(error instanceof Error ? `取消收藏未完成：${error.message}` : '取消收藏未完成；原收藏仍保留。'))
                    .finally(() => { remove.disabled = false; });
            });
            actions.append(remove);
            const sync = document.createElement('button');
            sync.type = 'button';
            sync.dataset.localFavoriteSync = saved.id;
            sync.textContent = saved.syncPending ? '重试同步收藏' : '同步收藏';
            sync.addEventListener('click', () => { void syncLocalFavorite(saved, sync); });
            actions.append(sync);
            addDetailToggle(article, actions);
            article.append(actions);
            return article;
        }

        /**
         * @param {LocalSavedWord} saved
         * @param {HTMLButtonElement} button
         * @returns {Promise<void>}
         */
        async function syncLocalFavorite(saved, button) {
            button.disabled = true;
            setStatus('正在同步这条本地收藏；不会调用模型或创建复习卡。');
            try {
                await studyCall('saveWord', {
                    language: saved.language ?? 'en',
                    word: saved.word,
                    sentence: saved.sentence,
                    context: saved.context ?? '',
                    url: saved.sourceUrl ?? saved.url ?? '',
                    title: saved.title ?? '',
                    ...(typeof saved.videoTime === 'number' ? {videoTime: saved.videoTime} : {}),
                });
                await loadPage(true);
                setStatus('已提交这条收藏同步；请以刷新后的 Obsidian / Anki 状态为准。');
            } catch (error) {
                setStatus(error instanceof Error ? `本地收藏未同步：${error.message}` : '本地收藏未同步；原收藏仍保留。');
            } finally {
                button.disabled = false;
            }
        }

        /** @returns {void} */
        function render() {
            clearSavedAudio();
            list.replaceChildren();
            const query = search.value.trim();
            const waiting = (canSearch || category === 'recent-recall') && (query !== listedQuery || category !== listedCategory);
            practiceButton.hidden = waiting || Boolean(listError) || category !== 'all' || practicePair.length !== 2;
            if (activePractice !== practiceButton) { practiceButton.textContent = practiceLabel(); }
            const rows = waiting ? [] : [...records.values()].filter((record) => matchesCategory(record, category) && (canSearch || matchesSearch(record, query)));
            sourceVideoId = category === 'source' && !loading && !listError ?
                rows.find((row) => matchesCategory(row, 'saved') && videoListenUrl(row.entry))?.id ?? '' :
                '';
            const practiceRows = category === 'all' && practiceWord && query === practiceWord ?
                rows.filter(({entry}) => (entry?.lemma || entry?.word)?.toLowerCase() === practiceWord.toLowerCase()) :
                rows;
            cloze = loading || listError ? [] : sentencePrompts(practiceRows, [], false);
            dictation = loading || listError ? [] : sentencePrompts(practiceRows, [], true);
            clozeButton.hidden = cloze.length === 0 && !moreScopedPrompts() && (activePractice !== clozeButton || loading || Boolean(listError));
            const canOfferDictation = total > 0 || dictation.length > 0 || activePractice === dictationButton;
            dictationButton.hidden = waiting || loading || Boolean(listError) || category === 'anki-only' || !canOfferDictation;
            if (activePractice?.hidden) { closePractice(); }
            listenSource.hidden = !sourceVideoId || !practice.hidden;
            const localRows = category === 'favorites' ? savedWords.filter((saved) => !hasNativeFavorite(saved) && matchesSearch(saved, query)) : [];
            if (rows.length + localRows.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'study-library-empty';
                if (category === 'favorites' && savedReadError) {
                    empty.textContent = `本地收藏读取失败，不能确认是否为空：${savedReadError}`;
                } else if (listError) {
                    empty.textContent = `学习库未能核对，不能确认此分类为空：${listError}`;
                } else if (waiting) {
                    empty.textContent = '正在学习库里找…';
                } else if (loaded && category === 'source' && !query) {
                    empty.textContent = '还没有在这页记过的原句。读到想留下的句子时，可以点词卡里的「记住它」。';
                } else if (loaded && category === 'recent-recall' && !query) {
                    empty.textContent = '这里显示近 30 天在已存原句上点过「一时没认出」的记录。还没有可显示的原句。';
                } else if (loaded) {
                    empty.textContent = query && canSearch ? '这个分类没有匹配的记录。试试单词、中文义或原句。' : (query ? '已加载的记录里没有匹配结果。' : '这个分类暂时没有已读取的记录。');
                } else {
                    empty.textContent = '正在读取学习库…';
                }
                list.append(empty);
            } else {
                for (const record of rows) { list.append(makeCard(record)); }
                for (const saved of localRows) { list.append(makeLocalFavoriteCard(saved)); }
            }
            const pending = document.querySelector('[data-library-category=pending]');
            if (pending) { pending.textContent = `需处理 ${Math.max(needsAttention, [...records.values()].filter((row) => matchesCategory(row, 'pending')).length)}`; }
            more.hidden = !practice.hidden || loading || waiting || offset >= total;
            more.disabled = loading;
            if (query && !listError) {
                if (!canSearch && loaded) {
                    setStatus(offset < total ? '当前只能搜索已加载的记录。可加载更多，或更新本机桥后搜索整个学习库。' : '已搜索当前分类中读到的所有记录。');
                } else if (waiting) {
                    setStatus('正在学习库里找…');
                } else if (loaded) {
                    setStatus(`当前分类找到 ${total} 条，已显示 ${rows.length} 条${localRows.length > 0 ? `，另有 ${localRows.length} 条本地收藏` : ''}。`);
                }
            }
        }

        /**
         * @param {string} id
         * @param {{resolutions?: Record<string, 'local'|'remote'>}} [options]
         * @returns {Promise<void>}
         */
        async function refreshOne(id, options = {}) {
            setStatus('正在刷新该条记录的 Obsidian / Anki 状态…');
            const previous = records.get(id);
            try {
                const value = await studyCall('libraryReconcile', {id, language: previous?.entry?.language ?? 'en', ...options});
                const updated = normalizeRecord(value, id);
                if (!updated) { throw new Error('刷新没有返回这条记录。'); }
                records.set(id, {...updated, reconcileState: 'verified'});
                render();
                setStatus(Array.isArray(updated.conflicts) && updated.conflicts.length > 0 ? `已读取 ${updated.conflicts.length} 个字段冲突，请逐项选择。` : '该条记录已刷新。');
            } catch (error) {
                const message = error instanceof Error ? error.message : '刷新失败。';
                if (previous) { records.set(id, {...previous, reconcileState: 'failed', reconcileError: message}); }
                render();
                setStatus(`该条记录未核对最新状态，保留了原显示：${message}`);
            }
        }

        /**
         * @param {boolean} reset
         * @param {boolean} [searchOnly] Typing or clearing a search never reconciles notes.
         */
        async function loadPage(reset, searchOnly = false) {
            cancelSentenceSearch();
            if (loading) {
                if (reset) { queuedSearch = searchOnly; }
                return;
            }
            loading = true;
            const query = search.value.trim();
            const tab = category;
            const indexed = canSearch;
            const readOnly = searchOnly || Boolean(query) || ['manual-known', 'source', 'recent-recall'].includes(tab);
            const obsolete = () => queuedSearch !== null || tab !== category || (canSearch && query !== search.value.trim());
            if (reset && !readOnly) { void refreshToday(); }
            more.disabled = true;
            setStatus(reset ? '正在读取学习库…' : '正在读取下一页…');
            render();
            const start = reset ? 0 : offset;
            syncPendingError = '';
            try {
                if (!readOnly) {
                    try {
                        const result = await studyCall('syncPending');
                        const pending = /** @type {import('study').PendingSyncTask[]} */ (Array.isArray(result) ? result : []);
                        showOldUpdates(pending);
                        pendingSyncCount = pending.filter((task) => !task.reviewOnly).length;
                    } catch (error) {
                        syncPendingError = error instanceof Error ? error.message : '待同步队列检查失败。';
                    }
                }
                if (obsolete()) { return; }
                if ((!loaded || !readOnly) && tab !== 'source') { await refreshSavedWords(); }
                if (obsolete()) { return; }
                const scope = indexed || ['pending', 'anki-only', 'manual-known', 'source', 'recent-recall'].includes(tab) ? tab : 'all';
                const value = await studyCall('libraryList', {language: 'en', url: scope === 'source' ? articleUrl : '', title: '', scope, offset: start, ...(indexed && (query || searchOnly) ? {query} : {})});
                const result = /** @type {{total?: number, needsAttention?: number, canSearch?: boolean, practicePair?: SensePracticeItem[], practiceExamples?: SensePracticeItem[]}|null} */ (value);
                canSearch = result?.canSearch === true;
                if (!indexed && canSearch && (search.value.trim() || scope !== category)) { queuedSearch = true; }
                if (obsolete()) { return; }
                const page = normalizeRecords(value).slice(0, PAGE_SIZE);
                if (reset) {
                    records.clear();
                    const contrast = result?.practicePair ?? [];
                    const examples = result?.practiceExamples ?? [];
                    compareExamples = contrast.length !== 2 && examples.length === 2;
                    practicePair = compareExamples ? examples : contrast;
                    if (!practice.hidden) { closePractice(); }
                }
                listedQuery = query;
                listedCategory = tab;
                for (const record of page) {
                    if (record && typeof record.id === 'string') { records.set(record.id, readOnly ? record : {...record, reconcileState: 'checking'}); }
                }
                total = typeof result?.total === 'number' && Number.isFinite(result.total) ? result.total : start + page.length;
                needsAttention = result?.needsAttention ?? 0;
                offset = start + page.length;
                loaded = true;
                listError = '';
                const target = value && typeof value === 'object' ? /** @type {{target?: {deck?: string, model?: string}}} */ (value).target : null;
                render();
                if (readOnly) {
                    if (!query) { setStatus(`已读取 ${records.size} / ${total} 条。`); }
                    return;
                }
                for (const record of page) {
                    if (obsolete()) { return; }
                    if (!record || typeof record.id !== 'string') { continue; }
                    if (record.syncState === 'anki-only' || category === 'manual-known') {
                        records.set(record.id, record); continue;
                    }
                    try {
                        const latest = await studyCall('libraryReconcile', {id: record.id, language: record.entry?.language ?? 'en'});
                        if (obsolete()) { return; }
                        const reconciled = normalizeRecord(latest, record.id);
                        if (!reconciled) { throw new Error('刷新没有返回这条记录。'); }
                        records.set(record.id, {...reconciled, manualKnown: record.manualKnown, reconcileState: 'verified'});
                    } catch (error) {
                        if (obsolete()) { return; }
                        records.set(record.id, {...record, reconcileState: 'failed', reconcileError: error instanceof Error ? error.message : '刷新失败。'});
                    }
                    render();
                }
                const unchecked = page.filter((record) => records.get(record.id)?.reconcileState === 'failed').length;
                let syncLabel = '待同步队列已检查';
                if (syncPendingError) {
                    syncLabel = `待同步队列未能核对：${syncPendingError}`;
                } else if (pendingSyncCount > 0) {
                    syncLabel = `仍有 ${pendingSyncCount} 项待同步`;
                }
                const checkLabel = unchecked > 0 ? `本页 ${unchecked} 条未核对最新状态` : `本页 ${page.length} 条已逐条核对`;
                setStatus(`已读取 ${records.size} / ${total} 条 · ${syncLabel} · ${checkLabel}${target?.deck ? ` · 牌组：${target.deck}` : ''}${target?.model ? ` · 模板：${target.model}` : ''}${savedReadError ? ` · 本地收藏读取失败：${savedReadError}` : ''}`);
            } catch (error) {
                if (obsolete()) { return; }
                listError = error instanceof Error ? error.message : '学习库读取失败。';
                if (tab === 'recent-recall' && listError === '学习列表范围无效。') { listError = '本机桥还不能读最近卡点。更新后再试。'; }
                setStatus(`${listError}${loaded ? ' 上次已读取的记录仍保留。' : ' 未读到记录，不代表学习库为空。'}${savedWords.length > 0 ? ` 本地收藏仍有 ${savedWords.length} 条。` : ''}`);
            } finally {
                loading = false;
                render();
                if (queuedSearch !== null) {
                    const read = queuedSearch;
                    queuedSearch = null;
                    void loadPage(true, read);
                } else if (openRequestedPractice) {
                    openRequestedPractice = false;
                    if (!obsolete() && !listError && tab === 'all' && query === practiceWord) {
                        if (!practiceButton.hidden) {
                            practiceButton.click();
                        } else if (!clozeButton.hidden) {
                            clozeButton.click();
                        } else {
                            setStatus('这次没找到能练的旧原句。可以看下方记录，或读到合适的句子时点「记住它」。');
                        }
                    }
                }
            }
        }

        const exportSavedButton = /** @type {HTMLButtonElement|null} */ (document.getElementById('study-library-export-saved'));
        const clearSavedButton = /** @type {HTMLButtonElement|null} */ (document.getElementById('study-library-clear-saved'));
        exportSavedButton?.addEventListener('click', () => {
            exportSavedButton.disabled = true;
            void (async () => {
                const saved = normalizeSavedWords(await studyCall('saved'));
                const url = URL.createObjectURL(new Blob([JSON.stringify({format: 'study-saved-v1', saved}, null, 2)], {type: 'application/json'}));
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = '英语学习-收藏语境.json';
                anchor.click();
                setTimeout(() => URL.revokeObjectURL(url), 30000);
                setStatus(`已导出 ${saved.length} 条扩展中已收集收藏；包含已读取的同步收藏，未加载的原生收藏不会自动读入。`);
            })().catch((error) => setStatus(error instanceof Error ? `收藏导出未完成：${error.message}` : '收藏导出未完成。'))
                .finally(() => { exportSavedButton.disabled = false; });
        });
        clearSavedButton?.addEventListener('click', () => {
            // eslint-disable-next-line no-alert
            if (!confirm('清空扩展中已收集的收藏（包含已读取的同步收藏）？未加载的原生收藏不在内。只取消收藏标记，保留 Obsidian 笔记和 Anki 卡片。')) { return; }
            clearSavedButton.disabled = true;
            if (exportSavedButton) { exportSavedButton.disabled = true; }
            void (async () => {
                const saved = normalizeSavedWords(await studyCall('saved'));
                if (saved.length === 0) {
                    await refreshSavedWords();
                    setStatus('当前没有扩展中已收集的收藏；笔记和复习卡不受影响。');
                    return;
                }
                let removed = 0;
                /** @type {string[]} */
                const failed = [];
                for (const row of saved) {
                    try {
                        await studyCall('removeWord', {id: row.id});
                        updateLoadedFavorite(row, false);
                        removed++;
                    } catch {
                        failed.push(row.word || '未命名收藏');
                    }
                }
                await refreshSavedWords();
                if (failed.length > 0) {
                    const first = failed[0];
                    setStatus(`已移除 ${removed} 条 · ${failed.length} 条未完成，仍保留${first ? `（如：${first}）` : ''}。已关联的星标等待同步确认；笔记和卡片未删除。`);
                } else {
                    setStatus(`已移除 ${removed} 条收藏标记；已关联的星标等待同步确认。笔记和卡片未删除。`);
                }
            })().catch((error) => setStatus(error instanceof Error ? `收藏清理未完成，原收藏仍保留：${error.message}` : '收藏清理未完成，原收藏仍保留。'))
                .finally(() => {
                    clearSavedButton.disabled = false;
                    if (exportSavedButton) { exportSavedButton.disabled = false; }
                });
        });

        for (const button of document.querySelectorAll('[data-library-category]')) {
            button.addEventListener('click', () => {
                openRequestedPractice = false;
                category = /** @type {HTMLElement} */ (button).dataset.libraryCategory ?? 'all';
                for (const tab of document.querySelectorAll('[data-library-category]')) {
                    tab.setAttribute('aria-pressed', `${tab === button}`);
                }
                void loadPage(true);
            });
        }
        search.addEventListener('input', (event) => {
            cancelSentenceSearch();
            openRequestedPractice = false;
            window.clearTimeout(searchTimer);
            render();
            if (canSearch && !(/** @type {InputEvent} */ (event)).isComposing) {
                searchTimer = window.setTimeout(() => { void loadPage(true, true); }, 180);
            }
        });
        more.addEventListener('click', () => { void loadPage(false); });
        document.getElementById('study-library-refresh')?.addEventListener('click', () => { void loadPage(true); });
        /**
         * Keep the row and its inputs in place when only a learning action changes.
         * @returns {void}
         */
        function paintLearningActions() {
            for (const article of /** @type {NodeListOf<HTMLElement>} */ (list.querySelectorAll('article[data-record-id]'))) {
                const row = records.get(article.dataset.recordId || '');
                if (!row) { continue; }
                const useLink = /** @type {?HTMLAnchorElement} */ (article.querySelector('a[data-use-card-for]'));
                const reset = /** @type {?HTMLButtonElement} */ (article.querySelector('button[data-reset-known]'));
                if (useLink) { useLink.hidden = !canOfferUseCard(row, upgrades); }
                if (reset) { reset.hidden = !row.manualKnown; }
            }
        }
        chrome.storage?.onChanged?.addListener((changes, area) => {
            if (area === 'local' && changes[AUTO_SYNC_STATE_KEY]) {
                upgrades = changes[AUTO_SYNC_STATE_KEY].newValue;
                paintLearningActions();
            }
            if (area === 'local' && changes[WORD_STATUS_KEY]) {
                const change = /** @type {{oldValue?: {words?: Record<string, unknown>}, newValue?: {words?: Record<string, unknown>}}} */ (changes[WORD_STATUS_KEY]);
                const words = change.newValue?.words || {};
                for (const row of records.values()) { row.manualKnown = wordInfo(row.entry?.word || '', words)?.manualKnown === true; }
                if (category === 'manual-known') {
                    const before = change.oldValue?.words || {};
                    const membershipChanged = Object.keys({...before, ...words}).some((word) => Boolean(normalizeInfo(before[word])?.manualKnown) !== Boolean(normalizeInfo(words[word])?.manualKnown));
                    if (membershipChanged) { void loadPage(true); }
                }
                paintLearningActions();
            }
            if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, 'studySavedWordsV1')) {
                void refreshSavedWords();
            }
        });
        await loadPage(true);
        enhanceStudyUi(document.body);
    });
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined') { void initializePage(); }
