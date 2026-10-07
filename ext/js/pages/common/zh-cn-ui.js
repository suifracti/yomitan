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

/* Visible text only. No changes to settings values, input values, links or dictionary data. */
import {fetchJson} from '../../core/fetch-utilities.js';

const skipped = 'script,style,textarea,input,pre,code,[contenteditable="true"],.dictionary-title,.profile-name';

/**
 * @param {string} value
 * @param {Record<string, string>} translations
 * @returns {string}
 */
export function translateLabel(value, translations) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    const translated = translations[normalized];
    if (typeof translated !== 'string') { return value; }
    const leading = value.match(/^\s*/)?.[0] ?? '';
    const trailing = value.match(/\s*$/)?.[0] ?? '';
    return leading + translated + trailing;
}
/**
 * @param {Record<string, string>} translations
 * @param {Node} root
 */
function translateTree(translations, root) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode()) !== null) {
        if (node.parentElement?.closest(skipped)) { continue; }
        const value = node.nodeValue ?? '';
        const next = translateLabel(value, translations);
        if (next !== value) { node.nodeValue = next; }
    }
    if (root instanceof Element || root instanceof Document) {
        for (const element of root.querySelectorAll('[title],[aria-label],[placeholder]')) {
            if (element.closest('pre,code,[contenteditable="true"]')) { continue; }
            for (const attr of ['title', 'aria-label', 'placeholder']) {
                const value = element.getAttribute(attr);
                if (value !== null) { element.setAttribute(attr, translateLabel(value, translations)); }
            }
        }
    }
}
if (typeof document !== 'undefined') {
    const translations = /** @type {Record<string, string>} */ (await fetchJson('/data/zh-cn-ui.json'));
    document.documentElement.lang = 'zh-CN';
    translateTree(translations, document);
    document.title = translateLabel(document.title, translations);
    let pending = false;
    new MutationObserver(() => {
        if (pending) { return; }
        pending = true;
        queueMicrotask(() => {
            pending = false;
            translateTree(translations, document);
        });
    }).observe(document.body, {childList: true, subtree: true, characterData: true});
}
