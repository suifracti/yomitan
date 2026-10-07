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

/**
 *
 * @param {string} action
 * @param {object} [data]
 * @returns {Promise<unknown>}
 */
export async function studyCall(action, data = {}) {
    const response = /** @type {{ok?: boolean, value?: unknown, error?: string}} */ (await chrome.runtime.sendMessage({studyAction: action, data}));
    if (response?.ok !== true) {
        throw new Error(response?.error ?? '学习组件未加载；请重新加载扩展并刷新网页。');
    }
    return response.value;
}

/** @type {import('study').NativeCall} */
export function nativeStudyCall(payload) {
    const port = chrome.runtime.connectNative('com.suifracti.study_translator');
    let settled = false;
    /** @type {(value: import('study').NativeResult) => void} */
    let finish;
    /** @type {Promise<import('study').NativeResult>} */
    const promise = new Promise((resolve) => {
        finish = resolve;
    });
    const timeout = setTimeout(() => {
        done({ok: false, error: '本机请求超时，请重试。'});
    }, 110000);
    /**
     * @param {import('study').NativeResult} value
     */
    function done(value) {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(timeout);
        finish(value);
        port.disconnect();
    }
    /** @param {unknown} value */
    const receive = (value) => { done(/** @type {import('study').NativeResult} */ (value)); };
    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message;
        done({ok: false, error: error ? '未连接本机翻译桥；请运行安装包中的安装 command。' : '本机连接已断开。'});
    });
    port.postMessage(payload);
    return {promise,
        cancel: () => {
            done({ok: false, error: '已取消；已消耗额度无法撤回。'});
        }};
}
