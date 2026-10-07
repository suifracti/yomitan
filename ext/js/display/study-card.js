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

/** @param {import('./display.js').Display} display */
export function prepareStudyCard(display) {
    const inner = document.querySelector('.content-body-inner');
    const autoSize = /** @type {?HTMLInputElement} */ (document.querySelector('#study-auto-size'));
    if (!(inner instanceof HTMLElement) || !autoSize) { return; }
    let manual = false;
    let generation = 0;
    let pending = false;
    const fit = async () => {
        const token = generation;
        const id = display.parentPopupId;
        if (!id || manual || !autoSize.checked || document.documentElement.dataset.isResizing === 'true') { return; }
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
    autoSize.addEventListener('change', () => {
        manual = false;
        schedule();
    });
    const handle = document.querySelector('#frame-resizer-handle');
    for (const event of ['mousedown', 'touchstart']) {
        handle?.addEventListener(event, () => { manual = true; }, {capture: true, passive: true});
    }
    display.on('contentUpdateStart', () => {
        ++generation;
        manual = false;
    });
    display.on('contentUpdateEntry', ({element, dictionaryEntry}) => {
        if (dictionaryEntry.type !== 'term' || !(element instanceof HTMLElement)) { return; }
        element.classList.add('study-entry');
        appendStudyContext(element, display.history.state?.sentence ?? null, display.query);
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
    display.on('contentUpdateComplete', schedule);
}
