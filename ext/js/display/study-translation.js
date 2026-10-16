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
import {studyCall} from '../study/study-client.js';
import {mountStudyLibrary} from './study-library.js';

/** @type {WeakMap<HTMLElement, {term: string, text: string, offset: number}>} */
const sourceHighlightSelections = new WeakMap();

/**
 * @param {HTMLElement} output
 * @param {import('study').Result} result
 * @param {boolean} cached
 */
export function renderStudyResult(output, result, cached) {
    const d = output.ownerDocument;
    output.replaceChildren();
    const status = d.createElement('span');
    status.className = 'study-cache-label';
    status.textContent = cached ? 'AI · 已缓存' : 'AI 回答';
    output.append(status);
    for (const [key, name] of [['translation', 'translation'], ['meaning', 'meaning'], ['notes', 'notes']]) {
        const p = d.createElement('p');
        p.className = `study-ai-${name}`;
        p.textContent = result[/** @type {keyof import('study').Result} */ (key)];
        p.hidden = !p.textContent;
        output.append(p);
    }
}
/**
 * @param {import('study').Usage | undefined} usage
 * @returns {string}
 */
function usageText(usage) {
    if (usage?.status === 'cached') {
        return '缓存命中 · 本次没有调用模型';
    }
    if (typeof usage?.totalTokens !== 'number') {
        return 'Token 未报告（不代表 0）';
    }
    return `Token ${usage.totalTokens.toLocaleString()} · 输入 ${usage.inputTokens?.toLocaleString() ?? '?'} / 输出 ${usage.outputTokens?.toLocaleString() ?? '?'}${usage.status === 'completed' ? '' : ' · 未完整结束，数值可能不全'}`;
}

/**
 * Keep the originally selected term highlighted after editing the source.
 * Preserve the marked occurrence when it is unchanged; if it moved, only
 * recover an unambiguous whole-word occurrence. Never guess among duplicates.
 * @param {HTMLElement} target
 * @param {string} text
 */
export function updateStudySourcePreview(target, text) {
    const oldMark = target.querySelector('mark');
    const selection = sourceHighlightSelections.get(target);
    // Keep the selected term even when an ambiguous edit temporarily removes <mark>.
    const term = oldMark?.textContent ?? selection?.term ?? '';
    if (!term) {
        target.textContent = text;
        return;
    }
    const previous = target.textContent ?? '';
    let priorOffset = selection?.text === previous ? selection.offset : -1;
    if (oldMark) {
        priorOffset = 0;
        for (const node of target.childNodes) {
            if (node === oldMark) { break; }
            priorOffset += node.textContent?.length ?? 0;
        }
    }
    const lowerText = text.toLowerCase();
    const lowerTerm = term.toLowerCase();
    /**
     * @param {number} offset
     * @returns {boolean}
     */
    const validAt = (offset) => {
        if (offset < 0 || lowerText.slice(offset, offset + term.length) !== lowerTerm) { return false; }
        const word = /[\p{L}\p{N}_]/u;
        if (offset > 0 && word.test(text[offset - 1])) { return false; }
        const end = offset + term.length;
        return end === text.length || !word.test(text[end]);
    };
    let offset = -1;
    let prefix = 0;
    while (prefix < Math.min(previous.length, text.length) && previous[prefix] === text[prefix]) {
        ++prefix;
    }
    if (priorOffset >= 0 && priorOffset + term.length <= prefix && validAt(priorOffset)) {
        offset = priorOffset;
    } else {
        // A matching, unchanged suffix identifies the original occurrence
        // even if the user inserts text at the beginning of the sentence.
        let suffix = 0;
        while (suffix < Math.min(previous.length, text.length) &&
        previous[previous.length - 1 - suffix] === text[text.length - 1 - suffix]) {
            ++suffix;
        }
        const shifted = priorOffset + text.length - previous.length;
        if (priorOffset >= 0 && priorOffset >= previous.length - suffix && validAt(shifted)) {
            offset = shifted;
        } else {
            // After a full rewrite, do not choose an arbitrary duplicate.
            const first = lowerText.indexOf(lowerTerm);
            if (validAt(first) && !lowerText.slice(first + 1).includes(lowerTerm)) {
                offset = first;
            }
        }
    }
    // Store the selection separately from the DOM so unique later edits can
    // recover the highlight even after a temporarily ambiguous sentence.
    sourceHighlightSelections.set(target, {term, text, offset});
    if (offset < 0) {
        target.textContent = text;
        return;
    }
    const mark = target.ownerDocument.createElement('mark');
    mark.textContent = text.slice(offset, offset + term.length);
    target.replaceChildren(text.slice(0, offset), mark, text.slice(offset + term.length));
}

/**
 * @returns {{cancel: () => void, render: (container: HTMLElement, sentence: string, word: string, source?: {subtitleSnapshot?: import('../app/frontend.js').StudySubtitle, mediaRange?: import('study').MediaRange, language?: string, lemma?: string, reading?: string, dictionaryNotes?: string, capture?: import('study').CaptureMedia, url?: string, title?: string, context?: string, videoTime?: number, contextSelected?: boolean, meaning?: string}) => void}}
 */
export function prepareStudyTranslation() {
    let generation = 0;
    let cleanup = () => {};
    /** @type {?ReturnType<typeof setTimeout>} */
    let poll = null;
    const cancel = () => {
        ++generation;
        cleanup();
        cleanup = () => {};
        if (poll !== null) {
            clearTimeout(poll);
            poll = null;
        }
    };
    return {cancel,
        render: (container, sentence, word, source = {}) => {
            cancel();
            const version = generation;
            const isCurrent = () => version === generation;
            const d = container.ownerDocument;
            if (source.subtitleSnapshot) {
                // Subtitle UI carries only a session reference; every action is authorized by private backend state.
                const s = source.subtitleSnapshot;
                const evidence = d.createElement('p');
                evidence.className = 'study-subtitle-source';
                evidence.dataset.studySubtitle = JSON.stringify(s);
                const language = s.language === 'en' ? '英语' : (s.language === 'ja' ? '日语' : '语言未识别');
                const ms = s.originalStartMs;
                const time = typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ?
                    `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` :
'时间未识别';
                evidence.textContent = `${language}字幕 · ${time}${s.trackName ? ` · ${s.trackName}` : ''}`;
                const details = d.createElement('details');
                details.className = 'study-subtitle-details scan-disable';
                const label = d.createElement('summary');
                label.textContent = '字幕来源与时间';
                const raw = d.createElement('p');
                raw.style.whiteSpace = 'pre-wrap';
                raw.style.overflowWrap = 'anywhere';
                raw.textContent = `原始时间：${s.originalStartMs ?? '?'}–${s.originalEndMs ?? '?'} ms
偏移：${s.subtitleOffsetMs ?? '?'} ms · 回放：${s.playbackSeconds ?? '?'} 秒
轨道：${s.trackIndex} ${s.trackName ?? ''} · 字幕：${s.cueIndex}
选词：${s.word} [${s.selectionStart}, ${s.selectionEnd})
来源：${s.url ?? '未确认视频页面'}`;
                details.append(label, raw);
                const gate = d.createElement('p');
                gate.className = 'study-request-status';
                gate.textContent = s.language === 'ja' ?
'日语字幕目前可以查词，尚未接入学习保存。' :
                    '这条字幕尚未接入学习，目前可以查词；请在 asbplayer 选择英文字幕轨道。';
                container.append(evidence, details, gate);
                if (s.sourceConfirmed !== true || s.language !== 'en' || !s.queryId) { return; }
                gate.textContent = '围绕这句继续问；点「记住它」保存完整理解，只留必要复习卡。';
                const makeButton = (/** @type {string} */ caption) => {
                    const b = d.createElement('button');
                    b.type = 'button';
                    b.className = 'scan-disable';
                    b.textContent = caption;
                    return b;
                };
                const ask = makeButton('问 AI');
                ask.dataset.studyCueAsk = 'true';
                const stop = makeButton('取消');
                stop.dataset.studyCueCancel = 'true';
                stop.hidden = true;
                const save = makeButton('记住它');
                save.dataset.studyCueSave = 'true';
                const back = makeButton('回到视频原句');
                back.dataset.studyCueReturn = 'true';
                const question = d.createElement('input');
                question.type = 'text';
                question.maxLength = 500;
                question.className = 'study-followup scan-disable';
                question.placeholder = '本句哪里不懂？回车追问';
                question.setAttribute('aria-label', '当前可信字幕追问');
                const output = d.createElement('div');
                output.className = 'study-conversation';
                const status = d.createElement('p');
                status.className = 'study-request-status';
                status.setAttribute('role', 'status');
                const actions = d.createElement('div');
                actions.className = 'study-translation-actions';
                actions.append(ask, stop, save, back);
                container.append(actions, question, status, output);
                let busy = true;
                let operation = 0;
                let requestId = '';
                const lock = (/** @type {boolean} */ value) => {
                    busy = value;
                    ask.disabled = value;
                    save.disabled = value;
                    back.disabled = value;
                };
                /**
                 * @param {string} action
                 * @param {{question?: string, requestId?: string}} [extra]
                 * @returns {Promise<unknown>}
                 */
                const call = async (action, extra = {}) => {
                    const r = /** @type {{ok?: boolean, error?: string, value?: unknown}} */ (await chrome.runtime.sendMessage({studyCueAction: true, data: {queryId: s.queryId, action, ...extra}}));
                    if (r?.ok !== true) { throw new Error(r?.error ?? '当前字幕来源不可用；没有保存。'); }
                    return r.value;
                };
                const refresh = async () => {
                    const r = /** @type {{turns: import('study').LearningTurn[]}} */ (await call('open'));
                    if (!isCurrent()) { return; }
                    output.replaceChildren();
                    for (const turn of r.turns) {
                        const q = d.createElement('p');
                        q.className = 'study-user-question';
                        q.textContent = turn.question || '理解本句';
                        const answer = d.createElement('div');
                        renderStudyResult(answer, turn, false);
                        output.append(q, answer);
                    }
                };
                cleanup = () => {
                    if (requestId) { void call('cancel', {requestId}).catch(() => {}); }
                };
                lock(true);
                void refresh().then(() => {
                    if (isCurrent()) {
                        lock(false);
                    }
                }, (e) => {
                    if (isCurrent()) { status.textContent = e instanceof Error ? e.message : '来源校验失败。'; }
                });
                ask.addEventListener('click', () => {
                    if (busy) { return; }
                    const id = ++operation;
                    requestId = crypto.randomUUID();
                    const activeId = requestId;
                    const submitted = question.value.trim();
                    lock(true);
                    stop.hidden = false;
                    status.textContent = '正在理解本句…已完成问答保留。';
                    void call('generate', {question: submitted, requestId: activeId}).then(async () => {
                        if (!isCurrent() || operation !== id) { return; }
                        if (question.value.trim() === submitted) { question.value = ''; }
                        await refresh();
                        if (isCurrent() && operation === id) { status.textContent = '可以继续追问，或点“记住它”保存并择要复习。'; }
                    }).catch((e) => {
                        if (isCurrent() && operation === id) { status.textContent = e instanceof Error ? e.message : '回答未完成。'; }
                    })
                        .finally(() => {
                            if (isCurrent() && operation === id) {
                                requestId = '';
                                stop.hidden = true;
                                lock(false);
                            }
                        });
                });
                stop.addEventListener('click', () => {
                    const activeId = requestId;
                    ++operation;
                    requestId = '';
                    void call('cancel', {requestId: activeId}).catch(() => {});
                    status.textContent = '已取消；此前完成的问答保留，未发送草稿不会保存。';
                    stop.hidden = true;
                    lock(false);
                });
                question.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' && !event.isComposing && !event.repeat && !event.shiftKey && !busy) {
                        event.preventDefault();
                        ask.click();
                    }
                });
                back.addEventListener('click', () => {
                    if (busy) { return; }
                    lock(true);
                    void call('return').then(() => {
                        if (isCurrent()) { status.textContent = '已回到原句；问答与未发送草稿保留。'; }
                    }).catch((e) => {
                        if (isCurrent()) { status.textContent = e instanceof Error ? e.message : '来源已改变，未跳转。'; }
                    })
                        .finally(() => { if (isCurrent()) { lock(false); } });
                });
                save.addEventListener('click', () => {
                    if (busy) { return; }
                    const id = ++operation;
                    lock(true);
                    status.textContent = '保存完整学习过程并判断必要复习…';
                    void call('remember').then((value) => {
                        const row = /** @type {import('study').LibraryRecord} */ (value);
                        if (isCurrent() && operation === id) {
                            status.textContent = row.ankiState === 'pending' ? '学习记录已保留；复习送卡尚未确认，可重试。' : (row.reviewDraft?.cards.length === 0 ? '学习记录已保存；本次判断无需新增复习卡。' : '学习记录与必要复习已确认。');
                            if (row.ankiEnabled === false) { status.textContent = '笔记已保存 · Anki 未启用'; }
                        }
                    }).catch((e) => {
                        if (isCurrent() && operation === id) { status.textContent = e instanceof Error ? e.message : '保存回执未确认；已提交意图保留。'; }
                    })
                        .finally(() => { if (isCurrent() && operation === id) { lock(false); } });
                });
                return;
            }
            /**
             * @param {string} title
             * @returns {HTMLButtonElement}
             */
            const button = (title) => {
                const b = d.createElement('button');
                b.type = 'button';
                b.textContent = title;
                b.className = 'scan-disable';
                return b;
            };
            const actions = d.createElement('div');
            actions.className = 'study-translation-actions';
            const ask = button('问 AI');
            ask.dataset.studyTranslate = 'explain';
            const stop = button('取消');
            stop.hidden = true;
            actions.append(ask, stop);
            const status = d.createElement('p');
            status.className = 'study-request-status';
            status.setAttribute('role', 'status');
            const output = d.createElement('div');
            output.className = 'study-translation-output';
            const history = d.createElement('details');
            history.className = 'study-conversation-history scan-disable';
            history.hidden = true;
            const historyLabel = d.createElement('summary');
            historyLabel.textContent = '问答历史';
            history.append(historyLabel, output);
            const question = d.createElement('textarea');
            question.rows = 2;
            question.maxLength = 500;
            question.className = 'study-followup scan-disable';
            question.placeholder = '哪里没懂？继续问…';
            question.setAttribute('aria-label', '关于当前词句的追问');
            // The source line deserves its own translation, not a translated
            // dictionary paragraph. Reuse completed QA; never auto-call a model.
            const sourceBox = d.querySelector('.study-reading-anchor .study-source') ?? container.querySelector('.study-source');
            const hasRealSentence = sourceBox?.querySelector('.study-source-label')?.textContent === '当前原句' &&
                sentence.trim() !== word.trim();
            const translateSentence = hasRealSentence ? button('翻译本句') : null;
            const sentenceChinese = hasRealSentence ? d.createElement('span') : null;
            if (translateSentence && sentenceChinese) {
                translateSentence.dataset.studyTranslateSentence = 'true';
                const row = d.createElement('div');
                row.className = 'study-source-translation-row scan-disable';
                sentenceChinese.className = 'study-source-translation';
                sentenceChinese.hidden = true;
                sentenceChinese.setAttribute('lang', 'zh-CN');
                row.append(translateSentence, sentenceChinese);
                sourceBox?.append(row);
            }
            /** @param {import('study').LearningTurn[]} turns */
            const paintSentenceTranslation = (turns) => {
                if (!sentenceChinese || !translateSentence) { return; }
                const answer = [...turns].reverse().find((turn) => typeof turn.translation === 'string' && turn.translation.trim());
                const text = answer?.translation?.trim() ?? '';
                sentenceChinese.textContent = text;
                sentenceChinese.hidden = !text;
                translateSentence.hidden = Boolean(text);
            };
            const more = d.createElement('details');
            more.className = 'study-more-actions';
            const moreLabel = d.createElement('summary');
            moreLabel.className = 'scan-disable';
            moreLabel.textContent = '调整原句 / 补充语境';
            const editor = d.createElement('textarea');
            editor.className = 'study-source-editor scan-disable';
            editor.maxLength = 2400;
            editor.value = sentence.slice(0, 2400);
            editor.setAttribute('aria-label', '原句');
            const context = d.createElement('textarea');
            context.className = 'study-source-editor scan-disable';
            context.maxLength = 1200;
            context.value = source.contextSelected ? source.context?.slice(0, 1200) ?? '' : '';
            context.placeholder = '可选：前后句或相邻字幕，不默认发送全文';
            context.setAttribute('aria-label', '补充语境');
            const useContext = button(source.context ? '带上相邻句' : '暂无可读取的相邻句');
            useContext.disabled = !source.context;
            more.append(moreLabel, editor, useContext, context);
            const tokens = d.createElement('details');
            tokens.className = 'study-token-summary';
            const tokenLabel = d.createElement('summary');
            tokenLabel.className = 'study-token-count scan-disable';
            tokenLabel.textContent = 'Token 用量';
            const tokenBody = d.createElement('p');
            const globalButton = button('查看两工具累计用量');
            const globalBody = d.createElement('p');
            tokens.append(tokenLabel, tokenBody, globalButton, globalBody);
            tokenLabel.title = '展开查看用量；不会调用模型。';
            let busy = false,
                requestId = 0;
            /** @type {?import('study').Result} */
            let latest = null;
            let latestSource = '';
            const lookup = () => ({...(source.lemma ? {lemma: source.lemma} : {}), language: source.language ?? 'en', ...(source.dictionaryNotes ? {dictionaryNotes: source.dictionaryNotes} : {}), sentence: editor.value.trim(), word, context: context.value.trim(), question: question.value.trim(), url: source.url ?? '', title: source.title ?? '', ...(source.videoTime !== void 0 ? {videoTime: source.videoTime} : {})});
            /** @type {(import('study').Lookup & {url: string, title: string, videoTime?: number, lemma?: string}) | null} */
            let activePayload = null;
            // Draft input is NOT conversation identity. Typing a new question never erases the previous answer.
            const identity = () => JSON.stringify({...lookup(), question: ''});
            /** @param {boolean} value */
            const lock = (value) => {
                busy = value;
                ask.disabled = value;
                if (translateSentence) { translateSentence.disabled = value; }
                stop.hidden = !value;
            };
            // Only show answers already completed for this exact source. The
            // learner can read the answer next to the sentence without scrolling
            // past unrelated dictionary details or spending another model call.
            /** @param {import('study').LearningTurn|null} turn */
            const updatePinnedExplanation = (turn) => {
                const pinned = /** @type {?HTMLElement} */ (d.querySelector('.study-reading-ai-context'));
                if (!pinned) { return; }
                const meaning = typeof turn?.meaning === 'string' ? turn.meaning.trim() : '';
                const notes = typeof turn?.notes === 'string' ? turn.notes.trim() : '';
                const questionText = typeof turn?.question === 'string' ? turn.question.trim() : '';
                const explanation = meaning || notes;
                const text = pinned.querySelector('.study-reading-ai-text');
                if (text) { text.textContent = explanation; }
                pinned.hidden = !explanation;
                const more = /** @type {?HTMLDetailsElement} */ (pinned.querySelector('.study-reading-ai-more'));
                const full = more?.querySelector('.study-reading-ai-full');
                if (!more || !full) { return; }
                // Keep the open state when refreshing the same answer, but reset
                // it when the learner moves on to a new question.
                if (pinned.dataset.previewTurnId !== (turn?.id ?? '')) {
                    more.open = false;
                    pinned.dataset.previewTurnId = turn?.id ?? '';
                }
                full.replaceChildren();
                const addLine = (label, content) => {
                    if (!content) { return; }
                    const p = d.createElement('p');
                    const heading = d.createElement('strong');
                    heading.textContent = label;
                    p.append(heading, d.createTextNode(content));
                    full.append(p);
                };
                addLine('我的问题：', questionText);
                addLine('这里的含义：', meaning);
                if (notes && notes !== meaning) { addLine('补充说明：', notes); }
                more.hidden = !explanation || (!questionText && !notes && meaning.length <= 150);
            };
            const refresh = async () => {
                const identityAtRead = identity();
                const turns = /** @type {import('study').LearningTurn[]} */ (await studyCall('journalConversation', lookup()));
                if (!isCurrent() || identityAtRead !== identity() || !Array.isArray(turns)) {
                    return;
                }
                const opened = new Set([...output.querySelectorAll('details[open]')].map((e) => /** @type {HTMLElement} */ (e).dataset.turnId));
                const oldLast = output.lastElementChild?.getAttribute('data-turn-id');
                output.replaceChildren();
                history.hidden = turns.length === 0;
                historyLabel.textContent = `问答历史 · ${turns.length} 轮（含理解反馈）`;
                latest = turns.at(-1) ?? null;
                latestSource = identity();
                paintSentenceTranslation(turns);
                updatePinnedExplanation([...turns].reverse().find((turn) => (turn.meaning ?? '').trim() || (turn.notes ?? '').trim()) ?? null);
                for (const [index, turn] of turns.entries()) {
                    const panel = d.createElement('details');
                    panel.className = 'study-conversation-turn';
                    panel.dataset.turnId = turn.id;
                    panel.open = opened.has(turn.id) || (index === turns.length - 1 && oldLast !== turn.id);
                    const label = d.createElement('summary');
                    label.className = 'scan-disable';
                    label.textContent = `第 ${index + 1} 轮 · ${turn.question || '理解当前词句'} · ${turn.saved ? '已保存' : '待保存'}`;
                    const mine = d.createElement('p');
                    mine.className = 'study-user-question';
                    mine.textContent = `我：${turn.question || '请解释这句话和这个词的用法'}`;
                    const answer = d.createElement('div');
                    answer.className = 'study-turn-answer';
                    renderStudyResult(answer, turn, turn.usage?.status === 'cached');
                    const usage = d.createElement('p');
                    usage.className = 'study-turn-usage';
                    usage.textContent = usageText(turn.usage);
                    const feedback = d.createElement('div');
                    feedback.className = 'study-learning-actions study-feedback';
                    const feedbackStatus = d.createElement('p');
                    feedbackStatus.className = 'study-feedback-status';
                    feedbackStatus.setAttribute('role', 'status');
                    const choices = [['understood', '这次懂了'], ['unclear', '仍然不懂']];
                    /** @type {HTMLButtonElement[]} */
                    const feedbackButtons = [];
                    /** @param {string} value */
                    const select = (value) => {
                        for (const b of feedbackButtons) {
                            b.setAttribute('aria-pressed', String(b.dataset.feedback === value));
                        }
                    };
                    for (const [value, title] of choices) {
                        const b = button(title);
                        b.dataset.feedback = value;
                        feedbackButtons.push(b);
                        b.addEventListener('click', () => {
                            if (b.getAttribute('aria-pressed') === 'true') {
                                return;
                            }
                            for (const x of feedbackButtons) {
                                x.disabled = true;
                            }
                            void studyCall('journalFeedback', {...lookup(), turnId: turn.id, question: turn.question, feedback: value}).then(() => {
                                if (!isCurrent()) {
                                    return;
                                }
                                select(value);
                                feedbackStatus.textContent = `已选择“${title}”，点“记住它”同步。`;
                                label.textContent = `第 ${index + 1} 轮 · ${turn.question || '理解当前词句'} · 待保存`;
                            }).catch((e) => {
                                feedbackStatus.textContent = e instanceof Error ? e.message : '反馈未保存';
                            })
                                .finally(() => {
                                    for (const x of feedbackButtons) {
                                        x.disabled = false;
                                    }
                                });
                        });
                        feedback.append(b);
                    }
                    select(turn.feedback);
                    panel.append(label, mine, answer, usage, feedback, feedbackStatus);
                    output.append(panel);
                }
                if (turns.length === 0) {
                    output.textContent = '';
                }
                const usages = /** @type {import('study').Usage[]} */ (await studyCall('conversationUsage', lookup()));
                if (!isCurrent() || identityAtRead !== identity() || !Array.isArray(usages)) {
                    return;
                }
                const total = usages.reduce((n, u) => n + (u.totalTokens ?? 0), 0);
                const unknown = usages.filter((u) => typeof u.totalTokens !== 'number' || u.status !== 'completed').length;
                tokenLabel.textContent = `Token ${total.toLocaleString()}${unknown ? ' · 部分未知' : ''}`;
                tokenBody.textContent = `本对话 ${usages.length} 次请求 · 输入 ${usages.reduce((n, u) => n + (u.inputTokens ?? 0), 0).toLocaleString()} / 输出 ${usages.reduce((n, u) => n + (u.outputTokens ?? 0), 0).toLocaleString()}${unknown ? ` · ${unknown} 次不完整` : ''}`;
                tokenLabel.title = tokenBody.textContent;
            };
            const restore = async () => {
                if (!isCurrent()) {
                    return;
                }
                const id = ++requestId;
                try {
                    await refresh();
                    const requested = lookup();
                    const response = /** @type {{result?: import('study').Result, busy?: boolean}} */ (await studyCall('peek', requested));
                    if (!isCurrent() || id !== requestId || JSON.stringify(requested) !== JSON.stringify(lookup())) {
                        return;
                    }
                    activePayload = response.busy ? requested : null;
                    lock(Boolean(response.busy));
                    if (response.busy) {
                        status.textContent = '正在生成，已有回答保留；不会重新调用。';
                        poll = setTimeout(() => {
                            void restore();
                        }, 700);
                    } else {
                        status.textContent = '';
                    }
                } catch {
                    status.textContent = '暂时无法读取本机问答；普通查词仍可用。';
                }
            };
            /**
             * @param {'explain'|'translate'} mode
             */
            const runGeneration = (mode) => {
                if (busy) { return; }
                const payload = mode === 'translate' ? {...lookup(), question: ''} : lookup();
                const conversation = identity();
                if (!payload.sentence || payload.sentence.length > 2400 || word.length > 128) {
                    status.textContent = '请先补全原句（最多 2400 字）。';
                    return;
                }
                const id = ++requestId;
                if (poll !== null) {
                    clearTimeout(poll);
                    poll = null;
                }
                activePayload = payload;
                lock(true);
                status.textContent = mode === 'translate' ? '正在翻译当前原句…' : '正在连接本机 AI…已有回答保留在下方。';
                void chrome.permissions.request({permissions: ['nativeMessaging']}).then(async (allowed) => {
                    // Drop a dictionary translation that is holding the single native lock.
                    await studyCall('cancel', payload);
                    if (!isCurrent() || id !== requestId) { return; }
                    if (!allowed) { throw new Error('未授予本机通信权限；普通查词仍可用。'); }
                    await studyCall('generate', {...payload, mode});
                    if (!isCurrent() || id !== requestId) { return; }
                    if (conversation === identity()) {
                        if (mode === 'explain' && question.value.trim() === payload.question) {
                            question.value = '';
                        }
                        await refresh();
                    }
                    status.textContent = mode === 'translate' ?
                        '原句译文已显示；可以继续追问。' :
                        '点“记住它”留下这次学习；也可以继续问。';
                }).catch((e) => {
                    if (isCurrent() && id === requestId) {
                        status.textContent = e instanceof Error ? e.message : '请求未完成，用量可能未知。';
                        void refresh().catch(() => {});
                    }
                }).finally(() => {
                    if (isCurrent() && id === requestId) {
                        activePayload = null;
                        const blocked = /已有翻译正在进行/.test(status.textContent);
                        lock(false);
                        if (blocked) { stop.hidden = false; }
                    }
                });
            };
            ask.addEventListener('click', () => runGeneration('explain'));
            translateSentence?.addEventListener('click', () => runGeneration('translate'));
            stop.addEventListener('click', () => {
                ++requestId;
                if (poll !== null) {
                    clearTimeout(poll);
                    poll = null;
                }
                const target = activePayload ?? lookup();
                activePayload = null;
                void studyCall('cancel', target).catch(() => {});
                status.textContent = '已取消。已消耗的 Token 不能撤回；未报告部分无法确知。';
                lock(false);
                void refresh().catch(() => {});
            });
            question.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.isComposing && !event.repeat && !event.shiftKey && !busy) {
                    event.preventDefault();
                    ask.click();
                }
            });
            editor.addEventListener('input', () => {
                updatePinnedExplanation(null);
                if (sentenceChinese) { sentenceChinese.hidden = true; }
                if (translateSentence) { translateSentence.hidden = editor.value.trim() === word.trim(); }
            });
            context.addEventListener('input', () => { updatePinnedExplanation(''); });
            editor.addEventListener('change', () => {
                // PR1 keeps the source inside this context/entry; the newer
                // reading-anchor layout is not present in every candidate.
                const original = container.querySelector('.study-source p') ??
                container.closest('.study-entry')?.querySelector('.study-source p') ??
                d.querySelector('.study-reading-anchor .study-source p');
                if (original instanceof HTMLElement) {
                    updateStudySourcePreview(original, editor.value);
                }
                updatePinnedExplanation(null);
                void restore();
            });
            context.addEventListener('change', () => {
                updatePinnedExplanation(null);
                void restore();
            });
            useContext.addEventListener('click', () => {
                context.value = source.context?.slice(0, 1200) ?? '';
                updatePinnedExplanation(null);
                void restore();
            });
            const onSaved = () => {
                if (isCurrent()) {
                    void refresh().catch(() => {});
                    if (!globalButton.disabled && globalBody.textContent) {
                        globalButton.click();
                    }
                }
            };
            container.addEventListener('study-saved', onSaved);
            cleanup = () => {
                container.removeEventListener('study-saved', onSaved);
            };
            globalButton.addEventListener('click', () => {
                globalButton.disabled = true;
                void chrome.permissions.request({permissions: ['nativeMessaging']}).then(async (allowed) => {
                    if (!allowed) {
                        throw new Error('需要本机通信权限才能读取用量。');
                    }
                    const stats = /** @type {import('study').UsageStats} */ (await studyCall('usageStats', {}));
                    globalBody.textContent = `两工具累计 ${stats.totalTokens.toLocaleString()} · 输入 ${stats.inputTokens.toLocaleString()} / 输出 ${stats.outputTokens.toLocaleString()}${stats.unknown ? ` · ${stats.unknown} 次不完整` : ''}`;
                    globalBody.title = '从本工具启用统计起，包括词典、字幕、问答和制卡；不是账号总账。';
                }).catch((e) => {
                    globalBody.textContent = e instanceof Error ? e.message : '读取用量失败';
                })
                    .finally(() => {
                        globalButton.disabled = false;
                    });
            });
            const footer = d.createElement('div');
            footer.className = 'study-followup-footer';
            const hint = d.createElement('span');
            hint.textContent = '回车发送 · Shift+回车换行';
            footer.append(hint, tokens);
            container.append(actions, status, history, question, footer, more);
            mountStudyLibrary(container, () => {
                const current = latestSource === identity() ? latest : null;
                const english = container.closest('.study-entry')?.querySelector('.study-primary-english');
                const translated = english?.querySelector('[data-study-translated=true]')?.textContent;
                const dictionaryTranslation = translated ? `词典英文：${english?.querySelector('.study-english-original')?.textContent ?? ''}\nAI 辅助中文：${translated}` : '';

                return {word, ...(dictionaryTranslation ? {dictionaryTranslation} : {}), language: source.language ?? 'en', ...(source.lemma ? {lemma: source.lemma} : {}), ...(source.reading ? {reading: source.reading} : {}), ...(source.dictionaryNotes ? {dictionaryNotes: source.dictionaryNotes} : {}), sentence: editor.value.trim(), context: context.value.trim(), meaning: current?.meaning || source.meaning || '', translation: current?.translation ?? '', notes: current?.notes ?? '', explanationSource: current ? 'AI 辅助解释（非词典原文）' : '词典简释（尚未按语境确认）', url: source.url ?? '', title: source.title ?? '', ...(source.videoTime !== void 0 ? {videoTime: source.videoTime} : {})};
            }, isCurrent);
            for (const control of container.querySelectorAll('button, input, textarea, select, summary')) {
                control.classList.add('scan-disable');
            }
            void restore();
        }};
}
