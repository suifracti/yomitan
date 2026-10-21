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

/** @type {Promise<boolean>|null} */
let pending = null;

/**
 * A non-blocking, study-styled cost prompt shared by page and caption translation.
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export function confirmTranslation(message) {
    if (pending) { return pending; }
    pending = new Promise((resolve) => {
        const bar = document.createElement('section');
        bar.className = 'study-translation-confirm scan-disable';
        bar.dataset.studyUi = '';
        bar.setAttribute('role', 'alertdialog');
        bar.setAttribute('aria-label', '确认翻译费用');
        bar.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;box-sizing:border-box;max-width:calc(100vw - 24px);width:680px;padding:12px 16px;border:1px solid var(--st-line,#dce2eb);border-radius:10px;background:var(--st-paper,#fbfaf7);color:var(--st-ink,#263248);font:14px/1.6 sans-serif;box-shadow:0 4px 20px #0003;display:flex;align-items:center;gap:12px;flex-wrap:wrap';
        const text = document.createElement('span');
        text.textContent = message;
        text.style.flex = '1 1 360px';
        bar.append(text);
        for (const [label, yes] of /** @type {[string,boolean][]} */ ([['继续', true], ['取消', false]])) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.style.cssText = 'font:inherit;cursor:pointer;padding:5px 14px;border:1px solid #dce2eb;border-radius:6px;background:var(--st-sheet,#fff);color:var(--st-accent,#505ead)';
            button.onclick = () => {
                bar.remove();
                pending = null;
                resolve(yes);
            };
            bar.append(button);
        }
        document.documentElement.append(bar);
    });
    return pending;
}
