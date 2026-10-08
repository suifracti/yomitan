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

import {studyCall} from '../study/study-client.js';

/**
 * @param {HTMLElement} output
 * @param {import('study').DictionaryLookup} lookup
 * @param {import('study').DictionaryResult} result
 * @param {boolean} cached
 */
export function renderDictionaryTranslation(output, lookup, result, cached) {
    const d = output.ownerDocument;
    output.replaceChildren();
    const label = d.createElement('p');
    label.className = 'study-cache-label';
    label.textContent = cached ? 'AI 辅助中文 · 已缓存' : 'AI 辅助中文 · 本次生成';
    output.append(label);
    for (const [i, source] of lookup.items.entries()) {
        const row = d.createElement('div');
        row.className = 'study-bilingual-row';
        const original = d.createElement('p');
        original.textContent = source.text;
        const chinese = d.createElement('p');
        chinese.className = 'study-sense-translation';
        chinese.textContent = result.items[i].translation;
        row.append(original, chinese);
        output.append(row);
    }
}

/**
 * @param {HTMLElement} element
 * @returns {string}
 */
export function dictionaryText(element) {
    const clone = element.cloneNode(true);
    const win = element.ownerDocument.defaultView;
    if (!win || !(clone instanceof win.HTMLElement)) { return ''; }
    for (const node of clone.querySelectorAll('summary, .study-sense-translation, [data-sc-content=example-sentence-c]')) { node.remove(); }
    for (const examples of clone.querySelectorAll('[data-sc-content=details-entry-examples]')) {
        for (const extra of [...examples.querySelectorAll('[data-sc-content=extra-info]')].slice(1)) { extra.remove(); }
    }
    for (const block of clone.querySelectorAll('div, br')) { block.prepend('\n'); }
    return (clone.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}

/**
 * Inline in the same card; paging and peeking never call a model.
 * @param {HTMLElement} entry
 * @param {string} word
 * @returns {() => void}
 */
export function prepareStudyDictionary(entry, word) {
    const d = entry.ownerDocument;
    const raw = [...entry.querySelectorAll('[data-sc-content=glosses]>li')];
    const candidates = raw.length > 0 ? raw : [...entry.querySelectorAll('[data-sc-study-role=english]>div>div, [data-sc-study-role=english]>div:not(:has(div))')];
    const senses = candidates.filter((n) => n instanceof HTMLElement).map((node, i) => ({node: /** @type {HTMLElement} */ (node), id: `${i}`, text: dictionaryText(/** @type {HTMLElement} */ (node))}));
    if (senses.length === 0) { return () => {}; }
    for (const details of entry.querySelectorAll('[data-sc-content=details-entry-examples]')) {
        if (!(details instanceof HTMLDetailsElement)) { continue; }
        details.open = true;
        const summary = details.querySelector('summary');
        if (summary) { summary.textContent = '例句'; }
        const extras = [...details.querySelectorAll(':scope>[data-sc-content=extra-info]')];
        if (extras.length > 1) {
            for (const extra of extras.slice(1)) { /** @type {HTMLElement} */ (extra).hidden = true; }
            const more = d.createElement('button');
            more.type = 'button';
            more.className = 'study-example-more scan-disable';
            more.textContent = `另 ${extras.length - 1} 个例句`;
            more.addEventListener('click', () => {
                const show = /** @type {HTMLElement} */ (extras[1]).hidden;
                for (const extra of extras.slice(1)) { /** @type {HTMLElement} */ (extra).hidden = !show; }
                more.textContent = show ? '收起额外例句' : `另 ${extras.length - 1} 个例句`;
            });
            details.append(more);
        }
    }
    /** @type {{node: HTMLElement, id: string, text: string}[][]} */
    const pages = [];
    for (const sense of senses) {
        const last = pages.at(-1);
        if (!last || last.length >= 3 || last.reduce((n, s) => n + Math.min(s.text.length, 1800), 0) + Math.min(sense.text.length, 1800) > 4000) {
            pages.push([sense]);
        } else {
            last.push(sense);
        }
    }
    const bar = d.createElement('div');
    bar.className = 'study-dictionary-controls scan-disable';
    const prev = d.createElement('button'),
        next = d.createElement('button'),
        translate = d.createElement('button'),
        stop = d.createElement('button');
    for (const b of [prev, next, translate, stop]) { b.type = 'button'; }
    prev.textContent = '上一组';
    next.textContent = '下一组';
    translate.textContent = 'AI 中文 · 本组';
    stop.textContent = '取消';
    stop.hidden = true;
    const label = d.createElement('span'),
        status = d.createElement('span');
    label.className = 'study-sense-count';
    status.className = 'study-dictionary-status';
    status.setAttribute('role', 'status');
    bar.append(label, prev, next, translate, stop, status);
    entry.querySelector('.entry-body')?.prepend(bar);
    let page = 0,
        version = 0,
        active = true;
    /** @type {?ReturnType<typeof setTimeout>} */
    let poll = null;
    /** @type {?import('study').DictionaryLookup} */
    let running = null;
    const lookup = () => ({word, items: pages[page].map(({id, text}) => ({id, text: text.slice(0, 1800)}))});
    /**
     * @param {import('study').DictionaryResult} result
     * @param {boolean} cached
     */
    const paint = (result, cached) => {
        for (const [i, sense] of pages[page].entries()) {
            sense.node.querySelector(':scope>.study-sense-translation')?.remove();
            const row = d.createElement('p');
            row.className = 'study-sense-translation';
            const badge = d.createElement('span');
            badge.className = 'study-ai-badge';
            badge.textContent = 'AI 辅助中文';
            row.append(badge, d.createTextNode(result.items[i].translation));
            sense.node.append(row);
        }
        status.textContent = (cached ? '已缓存' : '本次生成') + (pages[page].some((s) => s.text.length > 1800) ? ' · 超长段仅翻译前 1800 字，原文保留' : ' · 义项与首个例句');
        stop.hidden = true;
        translate.disabled = false;
    };
    const restore = async () => {
        const token = ++version;
        if (poll !== null) {
            clearTimeout(poll);
            poll = null;
        }
        try {
            const value = /** @type {{result: ?import('study').DictionaryResult, busy: boolean}} */ (await studyCall('dictionaryPeek', lookup()));
            if (!active || token !== version) { return; }
            if (value.result) {
                paint(value.result, true);
            } else if (value.busy) {
                translate.disabled = true;
                stop.hidden = false;
                running = lookup();
                status.textContent = '本组正在生成，不重复调用';
                poll = setTimeout(() => { void restore(); }, 700);
            } else {
                translate.disabled = false;
                stop.hidden = true;
                status.textContent = pages[page].some((s) => s.text.length > 1800) ? '超长段仅发送前 1800 字；不发送网页' : '点击翻译本组义项与首个例句，不发送网页';
            }
        } catch { if (active && token === version) { status.textContent = '缓存不可用；原英文仍可阅读。'; } }
    };
    const show = () => {
        for (const s of senses) { s.node.dataset.studySenseHidden = `${!pages[page].includes(s)}`; }
        // Do not leave empty dictionary/POS groups on the current page.
        for (const definition of entry.querySelectorAll('.definition-item')) {
            const rows = definition.querySelectorAll('[data-study-sense-hidden]');
            if (rows.length > 0) { /** @type {HTMLElement} */ (definition).hidden = ![...rows].some((r) => /** @type {HTMLElement} */ (r).dataset.studySenseHidden === 'false'); }
        }
        prev.disabled = page === 0; next.disabled = page === pages.length - 1;
        prev.hidden = next.hidden = pages.length === 1;
        label.textContent = `英英 ${page + 1}/${pages.length} · ${senses.length} 义`;
        void restore();
    };
    prev.addEventListener('click', () => {
        --page;
        show();
    });
    next.addEventListener('click', () => {
        ++page;
        show();
    });
    translate.addEventListener('click', () => {
        const payload = lookup(),
            token = ++version;
        if (poll !== null) {
            clearTimeout(poll);
            poll = null;
        }
        translate.disabled = true;
        stop.hidden = false;
        running = payload;
        status.textContent = '正在翻译本组…';
        void chrome.permissions.request({permissions: ['nativeMessaging']}).then(async (allowed) => {
            if (!active || token !== version) { return; }
            if (!allowed) { throw new Error('未授予本机通信权限。'); }
            const value = /** @type {{result: import('study').DictionaryResult, cached: boolean}} */ (await studyCall('dictionaryGenerate', payload));
            if (active && token === version) { paint(value.result, value.cached); }
        }).catch((error) => {
            if (!active || token !== version) { return; }
            translate.disabled = false;
            stop.hidden = true;
            status.textContent = error instanceof Error ? error.message : '翻译失败；原英文保留。';
        });
    });
    stop.addEventListener('click', () => {
        ++version;
        if (poll !== null) {
            clearTimeout(poll);
            poll = null;
        }
        if (running) { void studyCall('dictionaryCancel', running).catch(() => {}); }
        translate.disabled = false;
        stop.hidden = true;
        status.textContent = '已取消（已消耗额度无法撤回）';
    });
    show();
    return () => {
        active = false;
        ++version;
        if (poll !== null) { clearTimeout(poll); }
    };
}
