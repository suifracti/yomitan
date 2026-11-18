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

import {savedStudyRecordId} from '../study/study-data.js';

/** @typedef {{question: string, editors: string[], editOpen: boolean, page: string}} Draft */
/** @typedef {{word: string, identity: string, parked: boolean, details: import('display').ContentDetails, draft?: Draft}} WordTab */
/** @typedef {{tabs: WordTab[], current?: WordTab, pending?: WordTab}} WordSession */
/** @type {WeakMap<object, WordSession>} */
const sessions = new WeakMap();

/**
 * @param {string} word
 * @param {import('display').HistoryState} state
 * @returns {string}
 */
function tabIdentity(word, state) {
    return JSON.stringify([word, state.sentence?.text, state.url, state.videoTime, savedStudyRecordId(state, word)]);
}

/**
 * In-memory reading tabs, not saved learning records or a second Display.
 * @param {import('./display.js').Display} display
 * @param {HTMLElement} nav
 * @param {() => void} reveal
 * @returns {{key: WordTab, park: () => void, hasTabs: () => boolean, restored: boolean, dispose: () => void}}
 */
export function bindStudyWordTabs(display, nav, reveal) {
    let session = sessions.get(display);
    if (!session) {
        session = {tabs: []};
        sessions.set(display, session);
        // This event precedes every DOM clear, including parent clear-mode lookups.
        display.on('contentWillChange', () => capture(display));
    }
    const store = session;
    const state = display.history.state ?? {};
    const identity = tabIdentity(display.query, state);
    const pending = store.pending?.identity === identity ? store.pending : void 0;
    const restored = Boolean(pending);
    let tab = pending ?? store.tabs.find((item) => item.identity === identity);
    store.pending = void 0;
    store.tabs = store.tabs.filter((item) => item.parked || item === tab);
    if (!tab) {
        const params = Object.fromEntries(new URLSearchParams(location.search));
        params.type ??= 'terms'; params.query = display.query;
        tab = {word: display.query,
            identity,
            parked: false,
            details: {
                focus: true,
                historyMode: 'overwrite',
                params,
                state: {...state},
                content: {...display.history.content},
            }};
        store.tabs.push(tab);
    }
    store.current = tab;
    const current = tab;
    const draft = current.draft;
    if (draft) {
        const question = document.querySelector('.study-followup');
        if (question instanceof HTMLTextAreaElement) {
            question.value = draft.question; question.dispatchEvent(new Event('input', {bubbles: true}));
        }
        const edit = document.querySelector('.study-more-actions');
        if (edit instanceof HTMLDetailsElement) { edit.open = draft.editOpen; }
        for (const [index, field] of document.querySelectorAll('.study-more-actions textarea').entries()) {
            if (field instanceof HTMLTextAreaElement && index < draft.editors.length) {
                field.value = draft.editors[index];
                field.dispatchEvent(new Event('change', {bubbles: true}));
                field.dispatchEvent(new Event('input', {bubbles: true}));
            }
        }
        if (draft.page === '2') { document.querySelector('.sf-tabs button:last-child')?.dispatchEvent(new MouseEvent('click', {bubbles: true})); }
    }
    const render = () => {
        nav.replaceChildren();
        for (const item of store.tabs) {
            const group = document.createElement('span');
            group.className = 'sf-word-tab';
            const select = document.createElement('button');
            select.type = 'button';
            select.className = 'sf-pane-button scan-disable';
            const stored = item.details.state?.savedRecordEntry;
            const gloss = savedStudyRecordId(item.details.state, item.word) ? (stored?.sense?.gloss || stored?.meaning || '') : '';
            const compact = gloss.trim().replace(/\s+/g, ' ');
            const title = compact ? `${item.word} · ${compact.slice(0, 24)}${compact.length > 24 ? '…' : ''}` : item.word;
            select.dataset.studyWordTab = ''; select.textContent = title;
            select.setAttribute('aria-label', `切回单词 ${title}`);
            select.title = title;
            select.setAttribute('aria-pressed', String(item === current));
            select.onclick = () => {
                if (item === current) {
                    reveal(); return;
                }
                current.parked = true;
                capture(display); store.pending = item;
                display.setContent(item.details);
            };
            group.append(select);
            const close = document.createElement('button');
            close.type = 'button'; close.className = 'sf-word-tab-close scan-disable';
            close.textContent = '×';
            close.setAttribute('aria-label', `关闭单词 ${title}`);
            close.title = '关闭这个词卡，不删除笔记或卡片';
            close.onclick = () => {
                store.tabs = store.tabs.filter((other) => other !== item);
                if (item === current && store.tabs.length > 0) {
                    store.pending = store.tabs[store.tabs.length - 1];
                    display.setContent(store.pending.details);
                } else if (item === current) {
                    store.current = void 0;
                    display.close();
                } else { render(); }
            };
            group.append(close);
            nav.append(group);
        }
    };
    const context = nav.ownerDocument.getElementById('study-context');
    /** @param {Event} event */
    const confirmed = (event) => {
        const row = /** @type {CustomEvent<import('study').LibraryRecord | undefined>} */ (event).detail;
        const savedState = current.details.state;
        if (current !== store.current || !savedState || savedState.sentence?.studySubtitle || !row?.vaultSaved) { return; }
        if (!/^[a-f0-9]{32}$/.test(row.id) || row.entry.word.toLocaleLowerCase() !== current.word.toLocaleLowerCase()) { return; }
        // Keep the original poster/cue of a parked card. A corrected source stays in
        // its draft; only a receipt for this exact source may change its saved identity.
        const {entry} = row;
        const at = typeof savedState.videoTime === 'number' ? Math.floor(savedState.videoTime) : void 0;
        if (entry.sentence.trim() !== savedState.sentence?.text.trim() || (entry.url || '') !== (savedState.url || '') ||
        entry.videoTime !== at) { return; }
        const turns = row.turnIds ?? (savedState.savedRecordId === row.id ? savedState.savedRecordTurnIds : []);
        savedState.savedRecordId = row.id;
        savedState.savedRecordWord = entry.word;
        savedState.savedRecordEntry = entry;
        savedState.savedRecordTurnIds = turns;
        savedState.studySentenceTranslation = entry.translation || void 0;
        current.identity = tabIdentity(current.word, savedState);
        render();
    };
    context?.addEventListener('study-saved', confirmed);
    render();
    return {key: current,
        restored,
        park: () => { current.parked = true; },
        hasTabs: () => store.tabs.some((item) => item.parked) || store.tabs.length > 1,
        dispose: () => context?.removeEventListener('study-saved', confirmed)};
}

/** @param {import('./display.js').Display} display */
function capture(display) {
    const current = sessions.get(display)?.current;
    if (!current) { return; }
    const question = document.querySelector('.study-followup');
    const edit = document.querySelector('.study-more-actions');
    if (!(question instanceof HTMLTextAreaElement) && !(edit instanceof HTMLDetailsElement)) { return; }
    current.draft = {
        question: question instanceof HTMLTextAreaElement ? question.value : '',
        editors: [...document.querySelectorAll('.study-more-actions textarea')].map((field) => /** @type {HTMLTextAreaElement} */ (field).value),
        editOpen: edit instanceof HTMLDetailsElement && edit.open,
        page: document.querySelector('.study-focus-shell')?.getAttribute('data-panel') ?? '0',
    };
}
