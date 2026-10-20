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
import {normalizeInfo} from '../study/word-marks.js';

/**
 * Page colouring: switch, tiers, hover gloss, encounter counting and excluded sites.
 * Changes apply to open tabs at once.
 * @param {ParentNode} root
 */
export async function prepareWordMarkSettings(root) {
    const box = /** @type {HTMLInputElement|null} */ (root.querySelector('#word-marks-enabled'));
    const excluded = /** @type {HTMLTextAreaElement|null} */ (root.querySelector('#word-marks-excluded'));
    const hover = /** @type {HTMLInputElement|null} */ (root.querySelector('#word-marks-hover'));
    const encounters = /** @type {HTMLInputElement|null} */ (root.querySelector('#word-marks-encounters'));
    const state = /** @type {HTMLElement|null} */ (root.querySelector('#word-marks-state'));
    if (!box || !excluded || !state || typeof chrome === 'undefined' || !chrome.storage?.local) { return; }
    const tierBoxes = /** @type {HTMLInputElement[]} */ ([...root.querySelectorAll('input[data-word-tier]')]);
    const stored = /** @type {Record<string, unknown>} */ (await chrome.storage.local.get([WORD_MARKS_KEY, WORD_STATUS_KEY]));
    const marks = /** @type {{enabled?: unknown, excluded?: unknown, tiers?: Record<string, unknown>, hover?: unknown, encounters?: unknown}|undefined} */ (stored[WORD_MARKS_KEY]);
    box.checked = marks?.enabled !== false;
    if (hover) { hover.checked = marks?.hover !== false; }
    if (encounters) { encounters.checked = marks?.encounters !== false; }
    for (const tier of tierBoxes) { tier.checked = marks?.tiers?.[tier.dataset.wordTier ?? ''] !== false; }
    excluded.value = Array.isArray(marks?.excluded) ? marks.excluded.filter((item) => typeof item === 'string').join('\n') : '';
    const status = /** @type {{words?: Record<string, unknown>, phrases?: Record<string, unknown>}|undefined} */ (stored[WORD_STATUS_KEY]);
    /** @type {Record<string, number>} */
    const counts = {};
    for (const value of Object.values(status?.words ?? {})) {
        const s = normalizeInfo(value)?.s ?? '';
        counts[s] = (counts[s] ?? 0) + 1;
    }
    const phraseCount = Object.keys(status?.phrases ?? {}).length;
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    state.textContent = total > 0 ?
        `当前 ${(counts.new ?? 0) + (counts.learning ?? 0)} 个学习中${counts.shaky ? `、${counts.shaky} 个卡住过` : ''}${counts.partial ? `、${counts.partial} 个部分会` : ''}${counts.familiar ? `、${counts.familiar} 个已熟悉` : ''}、${counts.known ?? 0} 个已会${phraseCount ? `，另有 ${phraseCount} 个搭配` : ''}。（同一个词的原形和变形分别计数）` :
        '还没有读到生词列表；本机桥连上后约 5 分钟内更新。';
    const save = () => {
        const sites = excluded.value.split('\n').map((line) => line.trim()).filter(Boolean)
            .slice(0, 200);
        const tiers = Object.fromEntries(tierBoxes.map((tier) => [tier.dataset.wordTier ?? '', tier.checked]));
        void chrome.storage.local.set({[WORD_MARKS_KEY]: {enabled: box.checked, excluded: sites, tiers, hover: hover?.checked !== false, encounters: encounters?.checked !== false}}).then(() => {
            state.textContent = '已保存，已打开的网页会立即更新。';
        });
    };
    for (const input of [box, excluded, hover, encounters, ...tierBoxes]) { input?.addEventListener('change', save); }
}
