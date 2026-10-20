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

/*
 * "I know this word, but not in this sentence." When the looked-up word is already
 * familiar (or partly known, or recently forgotten), the card asks where the learner
 * is stuck, with one click each: a new sense, a fixed phrase, the sentence structure,
 * or a momentary slip. Nothing is saved or carded by the hint itself; it only records
 * the event (when the bridge supports it) and prepares the card panel. An optional
 * "AI 判断" button asks the model which sense this is, only when clicked.
 * Also shows how often the word was met on other pages recently (local counts).
 */
import {ENCOUNTERS_KEY, recentEncounters, wordInfo} from '../study/word-marks.js';
import {WORD_STATUS_KEY} from '../study/study-data.js';

/** @typedef {'newSense'|'collocation'|'structure'|'recall'} MissKind */
/** @typedef {{key: string, gloss: string, s: string}} Sense */

const STUCK_STATES = new Set(['familiar', 'known', 'partial', 'shaky']);
const STATE_LABELS = {new: '刚保存', learning: '在学', shaky: '卡住过', familiar: '已熟悉', known: '已会', partial: '部分会'};

/**
 * The words after `word` in the sentence, as a guess for the phrase.
 * @param {string} sentence
 * @param {string} word
 * @returns {string}
 */
export function guessPhrase(sentence, word) {
    const tokens = sentence.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
    const at = tokens.findIndex((token) => token.toLowerCase() === word.toLowerCase());
    return at < 0 || !tokens[at + 1] ? word : `${tokens[at]} ${tokens[at + 1]}`.toLowerCase();
}

/**
 * @param {object} options
 * @param {Document} options.doc
 * @param {() => import('study').LibraryEntry} options.getEntry
 * @param {(action: string, data?: Record<string, unknown>) => Promise<unknown>} options.call
 * @param {() => boolean} options.isCurrent
 * @param {(kind: MissKind, detail: {supported: boolean, senseKey: string, phrase: string, gloss: string}) => void} options.onChoice
 * @returns {HTMLElement} Hidden until there is something to say.
 */
export function mountStuckHint({doc, getEntry, call, isCurrent, onChoice}) {
    const box = doc.createElement('div');
    box.className = 'study-stuck scan-disable';
    box.hidden = true;
    const encounters = doc.createElement('p');
    encounters.className = 'study-stuck-met';
    encounters.hidden = true;
    const panel = doc.createElement('div');
    panel.className = 'study-stuck-panel';
    panel.hidden = true;
    const question = doc.createElement('p');
    question.className = 'study-stuck-question';
    const senses = doc.createElement('p');
    senses.className = 'study-stuck-senses';
    senses.hidden = true;
    const buttons = doc.createElement('div');
    buttons.className = 'study-stuck-choices';
    buttons.setAttribute('role', 'group');
    buttons.setAttribute('aria-label', '这句里卡在哪');
    const phraseRow = doc.createElement('div');
    phraseRow.className = 'study-stuck-phrase';
    phraseRow.hidden = true;
    const phraseInput = doc.createElement('input');
    phraseInput.type = 'text';
    phraseInput.setAttribute('aria-label', '搭配或短语');
    phraseInput.maxLength = 60;
    const phraseOk = doc.createElement('button');
    phraseOk.type = 'button';
    phraseOk.textContent = '按这个搭配学';
    phraseRow.append(phraseInput, phraseOk);
    const result = doc.createElement('p');
    result.className = 'study-stuck-result';
    result.setAttribute('role', 'status');
    panel.append(question, senses, buttons, phraseRow, result);
    box.append(encounters, panel);

    /** @type {Sense[]} */
    let known = [];
    let supported = false;

    /** @returns {string} */
    const gloss = () => {
        const entry = getEntry();
        return /AI 辅助解释/.test(entry.explanationSource || '') ? (entry.meaning || '').split('\n')[0].slice(0, 40) : '';
    };

    /**
     * @param {MissKind} kind
     * @param {string} [phrase]
     */
    const choose = (kind, phrase = '') => {
        for (const button of buttons.querySelectorAll('button')) { button.setAttribute('aria-pressed', String(button.dataset.stuck === kind)); }
        const entry = getEntry();
        const senseKey = known.length === 1 ? known[0].key : '';
        if (supported) {
            void call('libraryContextMiss', {word: entry.word,
                lemma: entry.lemma || entry.word,
                language: entry.language ?? 'en',
                kind,
                ...(senseKey ? {senseKey} : {}),
                sentence: entry.sentence ?? '',
                url: entry.url ?? '',
                ...(typeof entry.videoTime === 'number' ? {videoTime: entry.videoTime} : {})}).catch(() => {});
        }
        const messages = {
            newSense: supported ? '按新意思来学：「记住它」和制卡会存成这个词的新义项，原来学会的意思不受影响。' : '已按新意思准备卡片（本机桥更新后会单独记成新义项）。',
            collocation: supported ? `按搭配「${phrase}」来学：保存和制卡都针对这个搭配，并关联到 ${entry.word}。` : `已准备「${phrase}」的搭配卡（本机桥更新后会单独记成搭配条目）。`,
            structure: '词没问题，难在句子：已准备「句子英→中」卡；这个词的掌握程度不变。',
            recall: supported ? '已记下这次没认出，这个词会先标成“卡住过”；不建卡。' : '这次只是一时没认出，不建卡（本机桥更新后会计入掌握度）。',
        };
        result.textContent = messages[kind];
        onChoice(kind, {supported, senseKey, phrase, gloss: gloss()});
    };

    for (const [kind, label, title] of /** @type {[MissKind, string, string][]} */ ([
        ['newSense', '新意思', '这个词在这里是我没学过的意思'],
        ['collocation', '搭配/短语', '卡在固定搭配或短语动词，例如 run into'],
        ['structure', '句子结构', '词都认识，句子看不懂'],
        ['recall', '一时没认出', '其实会，只是一下没反应过来'],
    ])) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.dataset.stuck = kind;
        button.textContent = label;
        button.title = title;
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
            if (kind === 'collocation') {
                phraseRow.hidden = false;
                phraseInput.value = guessPhrase(getEntry().sentence ?? '', getEntry().word);
                phraseInput.focus();
                return;
            }
            phraseRow.hidden = true;
            choose(kind);
        });
        buttons.append(button);
    }
    phraseOk.addEventListener('click', () => {
        const phrase = phraseInput.value.trim().replaceAll(/\s+/g, ' ').toLowerCase();
        if (!/^[a-z][a-z'’ -]*[a-z]$/.test(phrase) || !phrase.includes(' ')) {
            result.textContent = '请写成两个词以上的英文搭配，例如 run into。';
            return;
        }
        phraseRow.hidden = true;
        choose('collocation', phrase);
    });
    phraseInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { phraseOk.click(); }
    });

    // Optional: ask the model which sense this is. Only on click; never automatic.
    const ai = doc.createElement('button');
    ai.type = 'button';
    ai.className = 'study-stuck-ai';
    ai.textContent = 'AI 判断';
    ai.title = '让模型比对这句和你学过的意思（会消耗额度）';
    ai.hidden = true;
    ai.addEventListener('click', () => {
        const entry = getEntry();
        ai.disabled = true;
        result.textContent = '正在比对义项…';
        void (async () => {
            const config = /** @type {{model: string, effort: string}} */ (await call('subtitleSettings'));
            const answer = /** @type {{match?: string, confidence?: number}} */ (await call('senseMatch', {word: entry.word, sentence: entry.sentence ?? '', contextMeaning: gloss(), config: {model: config.model, effort: config.effort}}));
            if (!isCurrent()) { return; }
            const sense = known.find((item) => item.key === answer.match);
            const sure = typeof answer.confidence === 'number' ? `（把握 ${Math.round(answer.confidence * 100)}%）` : '';
            result.textContent = answer.match === 'new' ? `AI 认为这是一个新意思${sure}，可以点「新意思」。` : (sense ? `AI 认为这就是你学过的「${sense.gloss}」${sure}，可能只是一时没认出。` : 'AI 没有给出明确判断。');
            buttons.querySelector(`[data-stuck=${answer.match === 'new' ? 'newSense' : 'recall'}]`)?.classList.add('is-suggested');
        })().catch((error) => {
            if (isCurrent()) { result.textContent = `AI 判断未完成：${error instanceof Error ? error.message : String(error)}`; }
        }).finally(() => { ai.disabled = false; });
    });
    buttons.append(ai);

    void (async () => {
        if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) { return; }
        const entry = getEntry();
        if ((entry.language ?? 'en') !== 'en') { return; }
        const stored = /** @type {Record<string, unknown>} */ (await chrome.storage.local.get([WORD_STATUS_KEY, ENCOUNTERS_KEY]));
        if (!isCurrent()) { return; }
        const status = /** @type {{words?: Record<string, unknown>}|undefined} */ (stored[WORD_STATUS_KEY]);
        const info = wordInfo(entry.lemma || entry.word, status?.words ?? {}) ?? wordInfo(entry.word, status?.words ?? {});
        const met = recentEncounters(/** @type {Record<string, {days?: Record<string, {n: number, sites: string[]}>}>} */ (stored[ENCOUNTERS_KEY] ?? {}), info?.word ?? entry.word.toLowerCase());
        if (met.times > 1) {
            encounters.textContent = `最近 7 天在 ${met.sites} 个网站遇到 ${met.times} 次`;
            encounters.hidden = false;
            box.hidden = false;
        }
        if (!info || !STUCK_STATES.has(info.s)) { return; }
        question.textContent = `这个词你学过（${STATE_LABELS[/** @type {keyof typeof STATE_LABELS} */ (info.s)] ?? '已学'}${info.gloss ? `：${info.gloss}` : ''}）。这句里卡在哪？`;
        panel.hidden = false;
        box.hidden = false;
        try {
            const answer = /** @type {{senses?: Sense[]}} */ (await call('libraryWordSenses', {word: info.word, language: 'en'}));
            if (!isCurrent()) { return; }
            known = Array.isArray(answer.senses) ? answer.senses.filter((sense) => sense && typeof sense.key === 'string') : [];
            supported = true;
            ai.hidden = false;
            if (known.length > 0) {
                senses.textContent = `学过的意思：${known.map((sense) => `${sense.gloss}（${STATE_LABELS[/** @type {keyof typeof STATE_LABELS} */ (sense.s)] ?? sense.s}）`).join(' · ')}`;
                senses.hidden = false;
            }
        } catch { /* An older bridge: the choices still prepare cards. */ }
    })().catch(() => {});
    return box;
}
