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

import {prepareStudyTranslation} from './study-translation.js';
import {prepareStudyDictionary} from './study-dictionary.js';

/**
 * Display-only context: never treats a dictionary example as the user's source.
 * @param {HTMLElement} entry
 * @param {?{text: string, offset: number, sourceKind?: string}} sentence
 * @param {string} query
 */
export function appendStudyContext(entry, sentence, query) {
    if (!sentence || !sentence.text.trim() || sentence.text.trim() === query.trim()) { return; }
    const d = entry.ownerDocument;
    const context = d.createElement('div');
    context.className = 'study-source';
    const label = d.createElement('span');
    label.className = 'study-source-label';
    label.textContent = sentence.sourceKind === 'dictionary' ? '来自词典解释' : '当前原句';
    const text = d.createElement('p');
    const offset = sentence.offset;
    if (query.length > 0 && Number.isInteger(offset) && offset >= 0 &&
    sentence.text.slice(offset, offset + query.length).toLowerCase() === query.toLowerCase()) {
        text.append(sentence.text.slice(0, offset));
        const mark = d.createElement('mark');
        mark.textContent = sentence.text.slice(offset, offset + query.length);
        text.append(mark, sentence.text.slice(offset + query.length));
    } else {
        text.textContent = sentence.text;
    }
    context.append(label, text);
    entry.append(context);
}

/**
 * @param {import('./display.js').Display} display
 * @param {boolean} [detail]
 */
export function prepareStudyCard(display, detail = false) {
    const inner = document.querySelector('.content-body-inner');
    const autoSize = /** @type {?HTMLInputElement} */ (document.querySelector('#study-auto-size'));
    if (!(inner instanceof HTMLElement) || (!detail && !autoSize)) { return; }
    document.documentElement.dataset.studyDetail = `${detail}`;
    /** @type {(() => void)[]} */
    let dictionaryViews = [];
    const context = document.querySelector('#study-context');
    const translation = prepareStudyTranslation();
    document.documentElement.dataset.studyView = 'single';
    let manual = false;
    let generation = 0;
    let pending = false;
    const fit = async () => {
        const token = generation;
        const id = display.parentPopupId;
        if (!id || manual || !autoSize || !autoSize.checked || document.documentElement.dataset.isResizing === 'true') { return; }
        try {
            /** @type {import('popup').ValidSize} */
            const size = await display.invokeParentFrame('popupFactoryGetFrameSize', {id});
            if (token !== generation || manual || !autoSize.checked || !size.valid) { return; }
            const height = Math.max(160, Math.min(560, Math.ceil(inner.getBoundingClientRect().height + 4)));
            if (Math.abs(size.height - height) < 2) { return; }
            await display.invokeParentFrame('popupFactorySetFrameSize', {id, width: size.width, height});
        } catch { /* Parent can disappear on navigation; resizing must not break lookup. */ }
    };
    const schedule = () => {
        if (pending) { return; }
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            void fit();
        });
    };
    new ResizeObserver(schedule).observe(inner);
    autoSize?.addEventListener('change', () => {
        manual = false;
        schedule();
    });
    const handle = document.querySelector('#frame-resizer-handle');
    for (const event of ['mousedown', 'touchstart']) {
        handle?.addEventListener(event, () => { manual = true; }, {capture: true, passive: true});
    }
    const clear = () => {
        ++generation;
        translation.cancel();
        for (const dispose of dictionaryViews) { dispose(); }
        dictionaryViews = [];
        if (context instanceof HTMLElement) {
            if (context.closest('.study-entry')) { document.querySelector('#dictionary-entries')?.before(context); }
            context.replaceChildren();
            context.hidden = true;
        }
    };
    display.on('contentUpdateStart', clear);
    display.on('contentClear', clear);
    display.on('contentUpdateEntry', ({element, dictionaryEntry, index}) => {
        if (dictionaryEntry.type !== 'term' || !(element instanceof HTMLElement)) { return; }
        element.classList.add('study-entry');
        for (const card of element.querySelectorAll('[data-sc-study-role=card]')) {
            const metadata = card.querySelectorAll('[data-sc-study-role=forms], [data-sc-study-role=tags], [data-sc-study-role=frequency]');
            if (metadata.length > 0) {
                const strip = document.createElement('div');
                strip.className = 'study-metadata';
                for (const node of metadata) {
                    if (node instanceof HTMLDetailsElement) {
                        const label = document.createElement('span');
                        label.className = 'study-meta-text';
                        label.textContent = [...node.children].filter((c) => c.tagName !== 'SUMMARY' && !c.textContent?.startsWith('原数据语料排名')).map((c) => c.textContent).join(' · ')
                            .replace('原数据语料排名，不代表难度或掌握程度。', '')
                            .trim();
                        label.title = node.querySelector('summary')?.textContent ?? '';
                        strip.append(label);
                        node.remove();
                    } else { strip.append(node); }
                }
                const header = element.querySelector('.entry-header');
                if (header) {
                    header.append(strip);
                } else {
                    card.prepend(strip);
                }
            }
            for (const row of card.querySelectorAll('[data-sc-study-role=meaning]>div:not([data-sc-study-role=label])')) {
                const text = row.textContent ?? '';
                const match = /^(a\.|adj\.|adv\.|n\.|v\.|vt\.|vi\.|prep\.|pron\.|conj\.|interj\.)\s+/.exec(text);
                if (match) {
                    const pos = document.createElement('span');
                    pos.className = 'study-pos';
                    pos.textContent = match[1];
                    row.replaceChildren(pos, document.createTextNode(text.slice(match[0].length)));
                }
            }
        }
        if (!detail) {
            const phonetic = element.querySelector('[data-sc-study-role=phonetic]');
            if (phonetic) {
                const pronunciation = phonetic;
                if (pronunciation instanceof HTMLElement) { pronunciation.classList.add('study-quick-phonetic'); }
                element.querySelector('.entry-header')?.append(pronunciation);
            }
        }
        const meaning = element.querySelector('[data-sc-study-role=meaning]');
        if (meaning instanceof HTMLElement) {
            meaning.classList.add('study-primary-meaning');
            element.querySelector('.entry-header')?.append(meaning);
        }
        if (index > 0) {
            element.classList.add('study-secondary');
            element.dataset.studyExpanded = 'false';
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'study-match-toggle scan-disable';
            toggle.textContent = `另一个匹配 · ${dictionaryEntry.headwords.map(({term}) => term).join(' / ')} ▾`;
            toggle.setAttribute('aria-expanded', 'false');
            /** @param {boolean} value */
            const expand = (value) => {
                element.dataset.studyExpanded = `${value}`;
                toggle.setAttribute('aria-expanded', `${value}`);
                schedule();
            };
            toggle.addEventListener('click', () => { expand(element.dataset.studyExpanded !== 'true'); });
            element.addEventListener('focusin', (event) => {
                if (event.target !== toggle) { expand(true); }
            });
            element.addEventListener('study-entry-focus', () => {
                expand(true);
            });
            element.prepend(toggle);
        }
        {
            for (const disclosure of element.querySelectorAll('[data-sc-study-role=english], [data-sc-study-role=more]')) {
                if (disclosure instanceof HTMLDetailsElement) {
                    const supplement = disclosure.dataset.scStudyRole === 'english' && element.querySelector('[data-sc-content=glosses]') !== null;
                    disclosure.open = !supplement;
                    if (supplement) {
                        disclosure.classList.add('study-extra-english');
                        const summary = disclosure.querySelector('summary');
                        if (summary) { summary.textContent = '原词库英英简释（参考）'; }
                    }
                }
            }
            for (const label of element.querySelectorAll('[data-sc-content=summary-entry]')) {
                if (label.textContent === 'Grammar') { label.textContent = '词形与语法'; }
                if (label.textContent === 'Etymology') { label.textContent = '词源'; }
            }
            dictionaryViews.push(prepareStudyDictionary(element, dictionaryEntry.headwords[0]?.term ?? display.query));
        }
        const audio = element.querySelector('.actions [data-action="play-audio"]');
        const sources = element.querySelector('.study-audio-sources');
        sources?.addEventListener('click', () => {
            audio?.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true}));
        });
    });
    display.on('contentUpdateComplete', () => {
        if (context instanceof HTMLElement) {
            context.replaceChildren();
            const sentence = display.history.state?.sentence ?? null;
            const header = document.querySelector('.study-entry .entry-header');
            header?.after(context);
            appendStudyContext(context, sentence, display.query);
            if (sentence && sentence.text.trim() && sentence.text.trim() !== display.query.trim()) {
                context.hidden = false;
                translation.render(context, sentence.text, display.query, {contextSelected: false, url: display.history.state?.url, title: display.history.state?.documentTitle, context: sentence.adjacent, videoTime: display.history.state?.videoTime});
            }
        }
        schedule();
    });
}
