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

/**
 *
 * @param {HTMLElement} output
 * @param {import('study').Result} result
 * @param {boolean} cached
 */
export function renderStudyResult(output, result, cached) {
    const d = output.ownerDocument;
    output.replaceChildren();
    const status = d.createElement('span');
    status.className = 'study-cache-label';
    status.textContent = cached ? 'AI · 已缓存' : 'AI · 本次生成';
    const translation = d.createElement('p');
    translation.className = 'study-ai-translation';
    translation.textContent = result.translation;
    const meaning = d.createElement('p');
    meaning.className = 'study-ai-meaning';
    meaning.textContent = result.meaning;
    const details = d.createElement('details');
    details.className = 'study-ai-details';
    details.open = d.documentElement.dataset.studyDetail === 'true';
    const summary = d.createElement('summary');
    summary.textContent = '查看用法分析';
    const notes = d.createElement('p');
    notes.textContent = result.notes || '没有额外用法提示。';
    details.append(summary, notes);
    output.append(status, translation, meaning, details);
}

/**
 * @returns {{cancel: () => void, render: (container: HTMLElement, sentence: string, word: string, source?: {url?: string, title?: string, context?: string, videoTime?: number, contextSelected?: boolean}) => void}}
 */
export function prepareStudyTranslation() {
    let generation = 0;
    /** @type {?ReturnType<typeof setTimeout>} */
    let poll = null;
    // Detach the view only. Background request survives accidental mouse-out, without a new call.
    const cancel = () => {
        ++generation;
        if (poll !== null) {
            clearTimeout(poll);
            poll = null;
        }
    };
    return {cancel,
        render: (container, sentence, word, source = {}) => {
            cancel();
            const version = generation;
            const d = container.ownerDocument;
            const edit = d.createElement('details');
            edit.className = 'study-edit-source';
            const label = d.createElement('summary');
            label.textContent = '调整原句 / 补充语境';
            const editor = d.createElement('textarea');
            editor.className = 'study-source-editor';
            editor.maxLength = 2400;
            editor.value = sentence.slice(0, 2400);
            editor.setAttribute('aria-label', '原句（最多 2400 字）');
            const context = d.createElement('textarea');
            context.className = 'study-source-editor';
            context.maxLength = 1200;
            context.value = source.contextSelected ? source.context?.slice(0, 1200) ?? '' : '';
            context.placeholder = '可选：前后句或相邻字幕，最多 1200 字。不默认发送全文。';
            context.setAttribute('aria-label', '补充语境（可选）');
            const useContext = d.createElement('button');
            useContext.type = 'button';
            useContext.textContent = source.context ? '带上相邻句' : '暂无可读取的相邻句，可手动补充';
            useContext.disabled = !source.context;
            useContext.addEventListener('click', () => {
                context.value = source.context?.slice(0, 1200) ?? '';
                void restore();
            });
            edit.append(label, editor, useContext, context);
            const actions = d.createElement('div');
            actions.className = 'study-translation-actions';
            const output = d.createElement('div');
            output.className = 'study-translation-output';
            output.setAttribute('role', 'status');
            const notice = d.createElement('p');
            notice.className = 'study-privacy-note';
            notice.textContent = d.documentElement.dataset.studyDetail === 'true' ? '点击发送原句、查词及所选语境/偏好；缓存有效 30 天。' : 'AI 点击才发送所选句/词 · 缓存 30 天';
            /** @type {HTMLButtonElement[]} */
            const buttons = [];
            let busy = false;
            let requestId = 0;
            const lookup = () => ({sentence: editor.value.trim(), word, context: context.value.trim()});
            const reset = () => {
                busy = false;
                stop.hidden = true;
                for (const b of buttons) {
                    b.disabled = false;
                }
            };
            const restore = async () => {
                if (version !== generation) {
                    return;
                }
                const id = ++requestId;
                try {
                    const response = /** @type {{result?: import('study').Result, translation?: string, busy?: boolean}} */ (await studyCall('peek', lookup()));
                    if (version !== generation || id !== requestId) {
                        return;
                    }
                    if (response.result) {
                        renderStudyResult(output, response.result, true);
                        reset();
                    } else if (response.busy) {
                        busy = true;
                        for (const b of buttons) { b.disabled = true; }
                        output.textContent = '这句正在生成，回来后继续显示；不会重新调用。';
                        stop.hidden = false;
                        poll = setTimeout(() => {
                            void restore();
                        }, 700);
                    } else {
                        output.replaceChildren();
                        if (response.translation) {
                            const text = d.createElement('p');
                            text.className = 'study-ai-translation';
                            text.textContent = response.translation;
                            const cached = d.createElement('span');
                            cached.className = 'study-cache-label';
                            cached.textContent = 'AI · 同句译文已缓存（此词用法尚未生成）';
                            output.append(cached, text);
                        }
                        reset();
                    }
                } catch { /* Offline/legacy background: dictionary lookup stays available. */ }
            };
            for (const [mode, title] of [['translate', '翻译原句'], ['explain', '解释用法']]) {
                const button = d.createElement('button');
                button.type = 'button';
                button.dataset.studyTranslate = mode;
                button.textContent = title;
                buttons.push(button);
                actions.append(button);
                button.addEventListener('click', () => {
                    if (busy) {
                        return;
                    }
                    const payload = lookup();
                    if (!payload.sentence || payload.sentence.length > 2400 || word.length > 128) {
                        output.textContent = '请先补全原句（最多 2400 字）。';
                        return;
                    }
                    const id = ++requestId;
                    if (poll !== null) {
                        clearTimeout(poll);
                        poll = null;
                    }
                    busy = true;
                    stop.hidden = false;
                    for (const b of buttons) {
                        b.disabled = true;
                    }
                    output.textContent = '正在连接本机 AI…';
                    // Native permission request remains synchronously initiated by the user's click.
                    void chrome.permissions.request({permissions: ['nativeMessaging']}).then(async (allowed) => {
                        if (version !== generation || id !== requestId) {
                            return;
                        }
                        if (!allowed) {
                            throw new Error('未授予本机通信权限；普通查词仍可用。');
                        }
                        const response = /** @type {{result: import('study').Result, cached: boolean}} */ (await studyCall('generate', {...payload, mode}));
                        if (version !== generation || id !== requestId) {
                            return;
                        }
                        renderStudyResult(output, response.result, response.cached);
                        reset();
                    }).catch((error) => {
                        if (version !== generation || id !== requestId) {
                            return;
                        }
                        output.textContent = error instanceof Error ? error.message : '翻译未完成。';
                        reset();
                    });
                });
            }
            const stop = d.createElement('button');
            stop.type = 'button';
            stop.hidden = true;
            stop.textContent = '取消';
            stop.addEventListener('click', () => {
                ++requestId;
                if (poll !== null) {
                    clearTimeout(poll);
                    poll = null;
                }
                void studyCall('cancel', lookup()).catch(() => {});
                output.textContent = '已取消（已消耗额度无法撤回）。';
                reset();
            });
            const save = d.createElement('button');
            save.type = 'button';
            save.textContent = '☆ 收藏语境';
            save.addEventListener('click', () => {
                void studyCall('saveWord', {...lookup(), url: source.url, title: source.title, videoTime: source.videoTime}).then(() => {
                    save.textContent = '✓ 已收藏';
                }, () => {
                    save.textContent = '收藏失败，重试';
                });
            });
            editor.addEventListener('change', () => {
                void restore();
            });
            context.addEventListener('change', () => {
                void restore();
            });
            actions.append(stop, save);
            container.append(output, actions, edit, notice);
            void restore();
        }};
}
