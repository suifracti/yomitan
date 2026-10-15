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
import {studyPartOfSpeech} from './study-labels.js';

/**
 * One same-frame dictionary peek, without changing the owner's history/context.
 * No bridge, model, journal or Anki actions are mounted in this layer.
 * @param {import('./display.js').Display} display
 * @returns {() => void}
 */
export function prepareStudyMini(display) {
    const d = document;
    /** @type {?HTMLElement} */
    let panel = null;
    /** @type {?HTMLElement} */
    let recentPanel = null;
    /** @type {?Range} */
    let selectedRange = null;
    const close = () => {
        if (panel) { recentPanel = panel; }
        panel?.remove();
        panel = null;
        const selection = d.getSelection();
        if (selectedRange && selection?.rangeCount === 1) {
            const current = selection.getRangeAt(0);
            if (current.startContainer === selectedRange.startContainer && current.startOffset === selectedRange.startOffset &&
            current.endContainer === selectedRange.endContainer && current.endOffset === selectedRange.endOffset) { selection.removeAllRanges(); }
        }
        selectedRange = null;
    };
    const closeLayer = () => {
        if (panel) {
            close();
        } else if (recentPanel) {
            panel = recentPanel;
            recentPanel = null;
            d.body.append(panel);
        } else { display.close(); }
        return true;
    };
    display.registerDirectMessageHandlers?.([['displayToggleStudyLayer', closeLayer]]);
    d.addEventListener('study-shortcut-forward', (event) => {
        if (!display.invokeContentOrigin) { return; }
        event.preventDefault();
        void display.invokeContentOrigin('frontendStudyShortcut', {usePointer: true}).catch(() => {});
    });
    d.addEventListener('study-shortcut-toggle', (event) => {
        closeLayer();
        event.preventDefault();
    });
    d.addEventListener('study-mini-close', (event) => {
        if (!panel) { return; }
        close();
        event.preventDefault();
    });
    d.addEventListener('pointerdown', (event) => {
        if (panel && event.target instanceof Node && !panel.contains(event.target)) { close(); }
    }, true);
    d.addEventListener('study-mini-lookup', (event) => {
        const {query, entries, rect} = /** @type {CustomEvent<import('study').MiniLookup>} */ (event).detail;
        const termEntries = entries.filter((entry) => entry.type === 'term');
        if (!query.trim()) { return; }
        recentPanel = null;
        const selection = d.getSelection();
        selectedRange = selection?.rangeCount === 1 && selection.toString() === query ? selection.getRangeAt(0).cloneRange() : null;
        /** @type {string[]} */
        let meanings = [];
        let fallback = '';
        for (const entry of termEntries.slice(0, 3)) {
            const node = display.displayGenerator.createTermEntry(entry, []);
            const rows = [...node.querySelectorAll('[data-sc-study-role=meaning]>div:not([data-sc-study-role=label])')];
            meanings = rows.map((row) => row.textContent?.trim() ?? '').filter(Boolean);
            if (meanings.length > 0) { break; }
            const gloss = node.querySelector('[data-sc-content=glosses]>li')?.cloneNode(true);
            if (gloss instanceof Element) {
                for (const tag of gloss.querySelectorAll('[data-sc-content=tags], blockquote, details, ol, ul')) { tag.remove(); }
                fallback ||= gloss.textContent?.trim() ?? '';
            }
        }
        if (!panel) {
            panel = d.createElement('section');
            panel.className = 'study-mini';
            panel.setAttribute('aria-label', '卡片内简短查词');
            d.body.append(panel);
        }
        panel.replaceChildren();
        const header = d.createElement('header');
        const word = d.createElement('strong');
        word.textContent = termEntries[0]?.headwords[0]?.term || query;
        word.title = word.textContent;
        const button = d.createElement('button');
        button.type = 'button';
        button.textContent = '×';
        button.setAttribute('aria-label', '关闭简短查词，保留原卡片');
        button.dataset.scanDisable = 'true';
        button.addEventListener('click', close);
        const full = d.createElement('button');
        full.type = 'button';
        full.className = 'study-mini-full scan-disable';
        full.textContent = '完整词卡 ↗';
        full.title = '在独立词典窗口打开，保留当前问答和草稿';
        full.addEventListener('click', () => {
            full.disabled = true;
            void display.application.api.getOrCreateSearchPopup({focus: true, text: query}).then(close).catch(() => {
                full.disabled = false;
                full.textContent = '重试打开 ↗';
            });
        });
        header.append(word, full, button);
        const body = d.createElement('div');
        body.className = 'study-mini-meanings';
        for (const text of meanings.length > 0 ? meanings : [fallback || '本地词典暂无简短释义']) {
            const row = d.createElement('p');
            const match = /^(a\.|adj\.|adv\.|n\.|v\.|vt\.|vi\.|prep\.|pron\.|conj\.|interj\.)\s+/.exec(text);
            if (match) {
                const pos = d.createElement('span');
                pos.className = 'study-mini-pos';
                pos.textContent = `${match[1]} ${studyPartOfSpeech(match[1])}`;
                row.append(pos, ' ', text.slice(match[0].length));
            } else { row.textContent = text; }
            body.append(row);
        }
        panel.append(header, body);
        const width = Math.min(280, Math.max(0, window.innerWidth - 16));
        panel.style.width = `${width}px`;
        const height = panel.getBoundingClientRect().height;
        const left = Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - width - 8));
        const below = (rect?.bottom ?? 40) + 6;
        const top = Math.max(8, Math.min(below + height <= window.innerHeight - 8 ? below : (rect?.top ?? 40) - height - 6, window.innerHeight - height - 8));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        event.preventDefault(); // Frontend must not rebuild the main card.
    });
    return () => {
        close();
        recentPanel = null;
    };
}
