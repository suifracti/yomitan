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

import {WORD_MARKS_KEY, WORD_STATUS_KEY} from '../study/study-data.js';

/**
 * Page colouring switch and excluded sites; changes apply to open tabs at once.
 * @param {ParentNode} root
 */
export async function prepareWordMarkSettings(root) {
    const box = /** @type {HTMLInputElement|null} */ (root.querySelector('#word-marks-enabled'));
    const excluded = /** @type {HTMLTextAreaElement|null} */ (root.querySelector('#word-marks-excluded'));
    const state = /** @type {HTMLElement|null} */ (root.querySelector('#word-marks-state'));
    if (!box || !excluded || !state || typeof chrome === 'undefined' || !chrome.storage?.local) { return; }
    const stored = /** @type {Record<string, unknown>} */ (await chrome.storage.local.get([WORD_MARKS_KEY, WORD_STATUS_KEY]));
    const marks = /** @type {{enabled?: unknown, excluded?: unknown}|undefined} */ (stored[WORD_MARKS_KEY]);
    box.checked = marks?.enabled !== false;
    excluded.value = Array.isArray(marks?.excluded) ? marks.excluded.filter((item) => typeof item === 'string').join('\n') : '';
    const words = /** @type {{words?: Record<string, string>}|undefined} */ (stored[WORD_STATUS_KEY])?.words ?? {};
    const values = Object.values(words);
    state.textContent = values.length > 0 ?
        `当前 ${values.filter((v) => v === 'learning').length} 个学习中、${values.filter((v) => v === 'known').length} 个已会用。` :
        '还没有读到生词列表；本机桥连上后约 5 分钟内更新。';
    const save = () => {
        const sites = excluded.value.split('\n').map((line) => line.trim()).filter(Boolean)
            .slice(0, 200);
        void chrome.storage.local.set({[WORD_MARKS_KEY]: {enabled: box.checked, excluded: sites}}).then(() => {
            state.textContent = '已保存，已打开的网页会立即更新。';
        });
    };
    box.addEventListener('change', save);
    excluded.addEventListener('change', save);
}
