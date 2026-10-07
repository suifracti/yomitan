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

// No automatic model calls, storage, URL upload or Anki mutation.
/** @returns {{cancel: () => void, render: (container: HTMLElement, sentence: string, word: string) => void}} */
export function prepareStudyTranslation() {
    /** @type {?chrome.runtime.Port} */
    let port = null;
    let generation = 0;
    const cancel = () => {
        ++generation;
        port?.disconnect();
        port = null;
    };
    return {
        cancel,
        render: (container, sentence, word) => {
            cancel();
            const version = generation;
            const edit = document.createElement('details');
            edit.className = 'study-edit-source';
            const label = document.createElement('summary');
            label.textContent = '编辑原句';
            const editor = document.createElement('textarea');
            editor.className = 'study-source-editor';
            editor.maxLength = 2400;
            editor.value = sentence.slice(0, 2400);
            editor.setAttribute('aria-label', '待翻译原句；网页提取可能不完整，可手动修正');
            const hint = document.createElement('p');
            hint.textContent = '网页提取可能不完整；可先补全原句。';
            edit.append(label, editor, hint);
            const actions = document.createElement('div');
            actions.className = 'study-translation-actions';
            const output = document.createElement('div');
            output.className = 'study-translation-output';
            output.setAttribute('role', 'status');
            const notice = document.createElement('p');
            notice.className = 'study-privacy-note';
            notice.textContent = '点击才发送原句＋查词内容至本机 Codex，使用账号额度。';
            /** @type {HTMLButtonElement[]} */
            const buttons = [];
            let busy = false;
            let requestId = 0;
            const reset = () => {
                busy = false;
                stop.hidden = true;
                for (const button of buttons) { button.disabled = false; }
            };
            for (const [mode, title] of [['translate', '翻译原句'], ['explain', '解释这里的用法']]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.dataset.studyTranslate = mode;
                button.textContent = title;
                buttons.push(button);
                actions.append(button);
                button.addEventListener('click', () => {
                    if (busy) { return; }
                    const text = editor.value.trim();
                    if (!text || text.length > 2400 || word.length > 128) {
                        output.textContent = '请提供 1–2400 字的原句，查词内容不超过 128 字。';
                        return;
                    }
                    const request = ++requestId;
                    busy = true;
                    stop.hidden = false;
                    for (const b of buttons) { b.disabled = true; }
                    output.textContent = '正在连接本机 Codex…';
                    // request must start in the click handler to preserve browser user activation.
                    void chrome.permissions.request({permissions: ['nativeMessaging']}).then((allowed) => {
                        if (version !== generation || request !== requestId) { return; }
                        if (!allowed) { throw new Error('未授予本机通信权限；查词仍可使用。'); }
                        const connection = chrome.runtime.connectNative('com.suifracti.study_translator');
                        port = connection;
                        /** @param {unknown} responseValue */
                        const receive = (responseValue) => {
                            const response = /** @type {{ok?: boolean, error?: string, result?: {translation?: string, meaning?: string, notes?: string}}} */ (responseValue);
                            if (version !== generation || request !== requestId) { return; }
                            if (response?.ok !== true || !response.result) {
                                output.textContent = response?.error || '本机翻译返回了无效结果。';
                            } else {
                                const {translation, meaning, notes} = response.result;
                                output.textContent = '';
                                for (const [heading, value] of [['AI 原句翻译', translation], ['AI 语境解释', meaning], ['用法提示', notes]]) {
                                    if (typeof value !== 'string' || !value.trim()) { continue; }
                                    const row = document.createElement('p');
                                    const strong = document.createElement('strong');
                                    strong.textContent = heading ?? '';
                                    row.append(strong, document.createElement('br'), value.slice(0, 5000));
                                    output.append(row);
                                }
                                if (!output.textContent) { output.textContent = 'AI 未返回文本。'; }
                            }
                            port = null;
                            connection.disconnect();
                            reset();
                        };
                        connection.onMessage.addListener(receive);
                        connection.onDisconnect.addListener(() => {
                            const error = chrome.runtime.lastError?.message;
                            if (version !== generation || request !== requestId || port !== connection) { return; }
                            port = null;
                            output.textContent = error ? '未连接本机翻译桥。请运行安装包中的“安装本机翻译桥.command”，然后重试。' : '翻译连接已断开，可重试。';
                            reset();
                        });
                        connection.postMessage({action: mode, sentence: text, word});
                    }).catch((error) => {
                        if (version !== generation || request !== requestId) { return; }
                        output.textContent = error instanceof Error ? error.message : '无法连接本机翻译。';
                        reset();
                    });
                });
            }
            const stop = document.createElement('button');
            stop.type = 'button';
            stop.hidden = true;
            stop.textContent = '取消';
            stop.addEventListener('click', () => {
                ++requestId;
                if (port) {
                    const connection = port;
                    port = null;
                    connection.disconnect();
                }
                output.textContent = '已取消（已经消耗的账号额度无法撤回）。';
                reset();
            });
            actions.append(stop);
            container.append(edit, actions, output, notice);
        },
    };
}
