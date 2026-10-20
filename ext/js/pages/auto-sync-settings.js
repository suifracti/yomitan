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

import {AUTO_SYNC_KEY, AUTO_SYNC_STATE_KEY} from '../study/study-data.js';

/**
 * Plain-language summary of the last automatic pass.
 * @param {unknown} value
 * @returns {string}
 */
export function describeAutoSync(value) {
    const state = /** @type {{at?: number, synced?: number, conflicts?: number, paused?: string, error?: string, first?: boolean, upgrade?: unknown[]}|undefined} */ (value);
    if (!state?.at) { return '还没有运行过；开启后约 30 秒内开始。'; }
    const time = new Date(state.at).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'});
    if (state.error) { return `${time} 未完成：${state.error}`; }
    const parts = [state.first ? `${time} 已建立基线，之后只同步改动` : `${time} 检查完毕 · 同步了 ${state.synced ?? 0} 条`];
    if (state.conflicts) { parts.push(`${state.conflicts} 条有冲突，请到学习库选择`); }
    if (state.paused) { parts.push(state.paused); }
    if (Array.isArray(state.upgrade) && state.upgrade.length > 0) { parts.push(`${state.upgrade.length} 个词可以加“会用”卡`); }
    return parts.join(' · ');
}

/**
 * @param {ParentNode} root
 */
export async function prepareAutoSyncSettings(root) {
    const box = /** @type {HTMLInputElement|null} */ (root.querySelector('#auto-sync-enabled'));
    const state = /** @type {HTMLElement|null} */ (root.querySelector('#auto-sync-state'));
    if (!box || !state || typeof chrome === 'undefined' || !chrome.storage?.local) { return; }
    const stored = /** @type {Record<string, unknown>} */ (await chrome.storage.local.get([AUTO_SYNC_KEY, AUTO_SYNC_STATE_KEY]));
    box.checked = /** @type {{enabled?: unknown}|undefined} */ (stored[AUTO_SYNC_KEY])?.enabled !== false;
    state.textContent = box.checked ? describeAutoSync(stored[AUTO_SYNC_STATE_KEY]) : '已关闭；只在打开词卡或学习库时同步。';
    box.addEventListener('change', () => {
        void chrome.storage.local.set({[AUTO_SYNC_KEY]: {enabled: box.checked}}).then(() => {
            state.textContent = box.checked ? '已开启，约 30 秒内运行。' : '已关闭；只在打开词卡或学习库时同步。';
        });
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[AUTO_SYNC_STATE_KEY] && box.checked) { state.textContent = describeAutoSync(changes[AUTO_SYNC_STATE_KEY].newValue); }
    });
}
