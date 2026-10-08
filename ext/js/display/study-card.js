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
import {studyCall} from '../study/study-client.js';

/**
 * Display-only context: never treats a dictionary example as the user's source.
 * @param {HTMLElement} entry
 * @param {?{text: string, offset: number}} sentence
 * @param {string} query
 */
export function appendStudyContext(entry, sentence, query) {
    if (!sentence || !sentence.text.trim() || sentence.text.trim() === query.trim()) { return; }
    const d = entry.ownerDocument;
    const context = d.createElement('details');
    context.className = 'study-source';
    context.open = true;
    const label = d.createElement('summary');
    label.textContent = '来自当前页面';
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
    /** @param {string} view */
    const setView = (view) => { document.documentElement.dataset.studyView = detail ? 'detail' : view; };
    setView('compact');
    const detailButton = document.querySelector('#study-open-detail');
    detailButton?.addEventListener('click', () => {
        const state = display.history.state;
        const selected = display.selectedIndex > 0 ? display.dictionaryEntries[display.selectedIndex] : null;
        const selectedWord = selected?.type === 'term' ? selected.headwords[0]?.term ?? display.query : display.query;
        const editor = document.querySelector('.study-source-editor');
        const contextEditor = document.querySelectorAll('.study-source-editor')[1];
        const options = display.getOptionsContext?.();
        const sentence = editor instanceof HTMLTextAreaElement ? editor.value : state?.sentence?.text ?? display.query;
        const contextText = contextEditor instanceof HTMLTextAreaElement ? contextEditor.value : state?.sentence?.adjacent ?? '';
        detailButton.textContent = '正在打开…';
        detailButton.setAttribute('disabled', '');
        void studyCall('openDetail', {word: selectedWord,
            sentence,
            offset: state?.sentence?.offset ?? 0,
            context: contextText,
            url: state?.url,
            title: state?.documentTitle,
            videoTime: state?.videoTime,
            profileIndex: options && 'index' in options ? options.index : void 0}).then(() => {
            detailButton.textContent = '固定详解 ↗';
        }).catch((error) => {
            detailButton.textContent = '重试打开详解 ↗';
            detailButton.setAttribute('title', error instanceof Error ? error.message : '无法打开');
        })
            .finally(() => { detailButton.removeAttribute('disabled'); });
    });
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
        manual = false;
        translation.cancel();
        setView('compact');
        for (const dispose of dictionaryViews) { dispose(); }
        dictionaryViews = [];
        if (context instanceof HTMLElement) {
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
                const pronunciation = phonetic.cloneNode(true);
                if (pronunciation instanceof HTMLElement) { pronunciation.classList.add('study-quick-phonetic'); }
                element.querySelector('.entry-header')?.append(pronunciation);
            }
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
                setView('expanded');
                expand(true);
            });
            element.prepend(toggle);
        }
        if (detail) {
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
        } else {
            const meaning = element.querySelector('[data-sc-study-role=meaning]');
            const quick = document.createElement('div');
            quick.className = 'study-quick-meaning';
            const rows = meaning ? [...meaning.children].filter((r) => !(r instanceof HTMLElement) || r.dataset.scStudyRole !== 'label') : [];
            for (const row of rows.slice(0, 3)) { quick.append(row.cloneNode(true)); }
            if (quick.childNodes.length === 0) {
                const gloss = element.querySelector('.gloss-content');
                const text = document.createElement('p');
                text.textContent = gloss?.textContent?.slice(0, 200) ?? '完整释义请打开固定详解。';
                quick.append(text);
            }
            const caption = document.createElement('span');
            caption.className = 'study-quick-label';
            caption.textContent = '常用义 · 完整义项与例句在固定详解';
            quick.append(caption);
            element.querySelector('.entry-body')?.before(quick);
        }
        const audio = element.querySelector('.actions [data-action="play-audio"]');
        const sources = element.querySelector('.study-audio-sources');
        const word = dictionaryEntry.headwords[0]?.term;
        if (word) {
            const link = document.createElement('a');
            link.className = 'study-online-dictionary scan-disable';
            link.href = `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}#English`;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = 'Wiktionary · 更多释义 ↗';
            link.title = '在线词典；内容不包含在离线词库中';
            element.append(link);
        }
        sources?.addEventListener('click', () => {
            audio?.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true}));
        });
    });
    display.on('contentUpdateComplete', () => {
        if (context instanceof HTMLElement) {
            context.replaceChildren();
            const sentence = display.history.state?.sentence ?? null;
            appendStudyContext(context, sentence, display.query);
            if (sentence && sentence.text.trim() && sentence.text.trim() !== display.query.trim()) {
                context.hidden = false;
                translation.render(context, sentence.text, display.query, {contextSelected: detail, url: display.history.state?.url, title: display.history.state?.documentTitle, context: sentence.adjacent, videoTime: display.history.state?.videoTime});
            }
        }
        schedule();
    });
}
