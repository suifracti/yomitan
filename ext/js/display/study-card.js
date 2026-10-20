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
import {timedUrl} from '../study/media-key.js';
import {prepareStudyTranslation} from './study-translation.js';
import {prepareStudyDictionary} from './study-dictionary.js';
import {studyFormLabel, studyPartOfSpeech} from './study-labels.js';
import {prepareStudyMini} from './study-mini.js';
import {studyCall} from '../study/study-client.js';
import {SAVED_KEY} from '../study/study-data.js';

/** @type {WeakMap<HTMLElement, () => void>} */
const readingSourceCleanups = new WeakMap();

/**
 * Display-only context: never treats a dictionary example as the user's source.
 * @param {HTMLElement} entry
 * @param {?{text: string, offset: number, sourceKind?: string}} sentence
 * @param {string} query
 * @param {?{label?: string, title?: string}} [asb]
 */
export function appendStudyContext(entry, sentence, query, asb = null) {
    if (!sentence || !sentence.text.trim()) {
        return;
    }
    const d = entry.ownerDocument;
    const context = d.createElement('div');
    context.className = 'study-source';
    const label = d.createElement('span');
    label.className = 'study-source-label';
    label.textContent = sentence.text.trim() === query.trim() ? '当前单词 · 暂无完整原句' : (sentence.sourceKind === 'dictionary' ? '来自词典解释' : '当前原句');
    context.append(label);
    if (asb?.label) {
        const badge = d.createElement('span');
        badge.className = 'study-asb-badge scan-disable';
        badge.textContent = asb.label;
        badge.title = asb.title || '已读取 asbplayer 字幕时间点';
        context.append(badge);
    }
    const text = d.createElement('p');
    // Prefer the capture's exact offset. If it is stale, only recover a
    // unique whole-word match; never highlight a random repeated occurrence.
    const target = query.trim();
    const lower = sentence.text.toLowerCase();
    const needle = target.toLowerCase();
    const wordChar = (char) => Boolean(char) && /[\p{L}\p{M}\p{N}_]/u.test(char);
    const boundaryMatch = (at) => at >= 0 &&
    lower.slice(at, at + target.length) === needle &&
    !wordChar(sentence.text[at - 1]) && !wordChar(sentence.text[at + target.length]);
    let at = -1;
    if (target && Number.isInteger(sentence.offset) && boundaryMatch(sentence.offset)) {
        at = sentence.offset;
    } else if (target) {
        let start = 0;
        for (;;) {
            const found = lower.indexOf(needle, start);
            if (found < 0) { break; }
            if (boundaryMatch(found)) {
                if (at >= 0) { at = -1; break; } // Ambiguous: do not guess.
                at = found;
            }
            start = found + Math.max(1, needle.length);
        }
    }
    if (at >= 0) {
        text.append(sentence.text.slice(0, at));
        const mark = d.createElement('mark');
        mark.textContent = sentence.text.slice(at, at + target.length);
        text.append(mark, sentence.text.slice(at + target.length));
    } else {
        text.textContent = sentence.text;
    }
    context.append(text);
    entry.append(context);
}

/**
 * Keep the learning question visible independently of dictionary/answer length.
 * @param {HTMLElement} inner
 * @param {HTMLElement} context
 * @param {string} word
 */
export function pinStudyContext(inner, context, word) {
    unpinStudyContext(inner);
    const source = context.querySelector('.study-source');
    if (!source) {
        return;
    }
    const anchor = inner.ownerDocument.createElement('section');
    anchor.className = 'study-reading-anchor';
    const title = inner.ownerDocument.createElement('strong');
    title.textContent = word;
    title.className = 'study-reading-word';
    const d = inner.ownerDocument;
    const meaning = d.createElement('div');
    meaning.className = 'study-reading-meaning';
    const entry = /** @type {?HTMLElement} */ (context.closest('.study-entry'));
    for (const row of entry?.querySelectorAll('.study-primary-meaning>div:not([data-sc-study-role=label])') ?? []) {
        const copy = /** @type {HTMLElement} */ (row.cloneNode(true));
        copy.classList.add('study-reading-sense');
        meaning.append(copy);
    }
    if (entry) {
        entry.dataset.studyPinned = 'true';
    }
    const info = inner.ownerDocument.createElement('div');
    info.className = 'study-reading-info';
    for (const node of entry?.querySelectorAll('.study-metadata>[data-sc-study-role=tags], .study-metadata>[data-study-meta-role=frequency]') ?? []) {
        info.append(node.cloneNode(true));
    }
    anchor.append(title);
    const phonetic = entry?.querySelector('[data-sc-study-role=phonetic]')?.textContent?.trim();
    if (phonetic) {
        const reading = d.createElement('span');
        reading.className = 'study-reading-phonetic';
        reading.textContent = phonetic;
        anchor.append(reading);
    }
    if (info.childElementCount > 0) { anchor.append(info); }
    // The real source and its explanation form one learning focus. General
    // dictionary senses follow them rather than separating the two.
    const aiExplanation = d.createElement('section');
    aiExplanation.className = 'study-reading-ai-context';
    aiExplanation.hidden = true;
    const aiLabel = d.createElement('span');
    aiLabel.className = 'study-reading-caption';
    aiLabel.textContent = '这句话里的意思 · AI 辅助';
    const aiText = d.createElement('p');
    aiText.className = 'study-reading-ai-text';
    const aiMore = d.createElement('details');
    aiMore.className = 'study-reading-ai-more scan-disable';
    const aiMoreLabel = d.createElement('summary');
    aiMoreLabel.textContent = '展开本轮解释';
    const aiFull = d.createElement('div');
    aiFull.className = 'study-reading-ai-full';
    aiMore.append(aiMoreLabel, aiFull);
    aiExplanation.append(aiLabel, aiText, aiMore);
    anchor.append(source, aiExplanation);
    if (meaning.childElementCount > 0) { anchor.append(meaning); }
    // Preview the SAME English sense that is translated. The original DOM stays
    // in the entry header for dictionaryTranslation / Obsidian saving.
    const english = entry?.querySelector('.study-primary-english');
    if (english) {
        const preview = /** @type {HTMLElement} */ (english.cloneNode(true));
        const disclosure = d.createElement('details');
        disclosure.className = 'study-reading-english';
        const summary = d.createElement('summary');
        summary.className = 'scan-disable';
        summary.textContent = '英英原义与辅助中文';
        disclosure.append(summary, preview);
        const previewRetry = preview.querySelector('.study-english-retry');
        previewRetry?.addEventListener('click', () => {
            /** @type {?HTMLButtonElement} */ (entry.querySelector('.study-primary-english .study-english-retry'))?.click();
        });
        anchor.append(disclosure);
    }
    const toolbar = inner.querySelector('.study-toolbar');
    if (toolbar) {
        toolbar.after(anchor);
    } else {
        inner.prepend(anchor);
    }
    // Reuse the existing 36px sticky toolbar when reading deep definitions.
    // A separate overlay would hide word forms and the first line of a sense.
    const toolbarTitle = toolbar?.querySelector('.study-toolbar-title');
    const glance = d.createElement('span');
    glance.className = 'study-toolbar-glance scan-disable';
    glance.hidden = true;
    const glanceWord = d.createElement('strong');
    glanceWord.className = 'study-toolbar-glance-word';
    glanceWord.textContent = word;
    const glanceSource = d.createElement('span');
    glanceSource.className = 'study-toolbar-glance-source';
    glance.append(glanceWord, glanceSource);
    if (toolbarTitle) {
        toolbarTitle.after(glance);
    } else {
        toolbar?.prepend(glance);
    }
    const scroller = d.querySelector('#content-scroll');
    const updateGlanceVisibility = () => {
        if (!anchor.isConnected || !toolbar) { return; }
        const show = anchor.getBoundingClientRect().bottom <= toolbar.getBoundingClientRect().bottom + 1;
        glance.hidden = !show;
        if (toolbarTitle instanceof HTMLElement) { toolbarTitle.hidden = show; }
    };
    scroller?.addEventListener('scroll', updateGlanceVisibility, {passive: true});
    // Long sentences must remain readable without an inner scrolling region.
    // The disclosure shares the source caption's row so it adds no card height.
    const sentenceText = source.querySelector('p');
    const sourceLabel = source.querySelector('.study-source-label');
    const asbBadge = source.querySelector('.study-asb-badge');
    if (sentenceText instanceof HTMLElement && sourceLabel) {
        const heading = d.createElement('div');
        heading.className = 'study-source-heading';
        sourceLabel.before(heading);
        heading.append(sourceLabel);
        if (asbBadge) {
            heading.append(asbBadge);
        }
        const expand = d.createElement('button');
        expand.type = 'button';
        expand.className = 'study-reading-source-expand scan-disable';
        expand.textContent = '展开原句';
        expand.setAttribute('aria-expanded', 'false');
        expand.hidden = true;
        heading.append(expand);
        const refresh = () => {
            if (!expand.isConnected) { return; }
            const sentence = sentenceText.textContent ?? '';
            glanceSource.textContent = sentence;
            glanceSource.title = sentence;
            glance.title = `${word} · ${sentence}`;
            if (expand.getAttribute('aria-expanded') !== 'true') {
                expand.hidden = sentenceText.scrollHeight <= sentenceText.clientHeight + 1;
            }
            updateGlanceVisibility();
        };
        expand.addEventListener('click', () => {
            const open = expand.getAttribute('aria-expanded') !== 'true';
            expand.setAttribute('aria-expanded', `${open}`);
            expand.textContent = open ? '收起原句' : '展开原句';
            anchor.classList.toggle('study-reading-expanded', open);
            if (!open) { refresh(); }
        });
        const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refresh) : null;
        resize?.observe(sentenceText);
        const change = typeof MutationObserver !== 'undefined' ? new MutationObserver(refresh) : null;
        change?.observe(sentenceText, {childList: true, characterData: true, subtree: true});
        readingSourceCleanups.set(anchor, () => {
            resize?.disconnect?.();
            change?.disconnect?.();
            scroller?.removeEventListener('scroll', updateGlanceVisibility);
            if (toolbarTitle instanceof HTMLElement) { toolbarTitle.hidden = false; }
            glance.remove();
        });
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(refresh);
        } else {
            refresh();
        }
    }
}

/**
 * Restore normal headers when their pinned reading context is removed.
 * @param {HTMLElement} inner
 */
export function unpinStudyContext(inner) {
    const anchor = /** @type {?HTMLElement} */ (inner.querySelector('.study-reading-anchor'));
    if (anchor) {
        readingSourceCleanups.get(anchor)?.();
        readingSourceCleanups.delete(anchor);
        anchor.remove();
    }
    for (const entry of inner.querySelectorAll('.study-entry[data-study-pinned]')) {
        delete /** @type {HTMLElement} */ (entry).dataset.studyPinned;
    }
}

/**
 * @param {?Element} entry
 * @returns {string}
 */
function briefDictionaryMeaning(entry) {
    const source = entry?.querySelector('.study-primary-meaning');
    if (!source) { return ''; }
    const copy = /** @type {HTMLElement} */ (source.cloneNode(true));
    copy.querySelector('[data-sc-study-role=label]')?.remove();
    for (const pos of copy.querySelectorAll('.study-pos')) { pos.after(' '); }
    return [...copy.children].map((row) => row.textContent?.trim()).filter(Boolean).join(' · ');
}

/**
 * @param {HTMLElement} entry
 * @returns {string}
 */
export function originalEnglishMeaning(entry) {
    const sense = entry.querySelector('[data-sc-content="glosses"]>li');
    if (!sense) {
        return '';
    }
    const copy = /** @type {HTMLElement} */ (sense.cloneNode(true));
    for (const n of copy.querySelectorAll('blockquote,details,ol,ul,.tag,[data-sc-category="partOfSpeech"],[data-sc-content="tags"],[data-sc-content="tag"],[data-sc-content="extra-info"],.study-sense-translation')) {
        n.remove();
    }
    return (copy.textContent ?? '').trim();
}

/**
 * One short dictionary translation on visible lookup; never a contextual explanation.
 * @param {HTMLElement} entry
 * @param {string} word
 * @param {boolean} [automatic]
 * @returns {() => void}
 */
export function mountOriginalEnglish(entry, word, automatic = true) {
    const english = originalEnglishMeaning(entry);
    if (!english) { return () => {}; }
    const d = entry.ownerDocument;
    const panel = d.createElement('div');
    panel.className = 'study-primary-english';
    // Dictionary order is not contextual disambiguation. Keep this warning
    // with the original EN/CN pair, including its pinned preview and cache hits.
    const caption = d.createElement('span');
    caption.className = 'study-reading-caption';
    caption.textContent = '词典首义 · 未按本句消歧 · 中文仅译此义';
    const original = d.createElement('p');
    original.className = 'study-english-original';
    const tag = entry.querySelector('[data-sc-content="glosses"]>li [data-sc-category="partOfSpeech"]')?.textContent?.trim();
    if (tag) {
        const label = d.createElement('span');
        label.className = 'study-pos-en';
        label.textContent = `${tag.replace(/\.$/, '')}.`;
        const name = studyPartOfSpeech(tag);
        if (name) { label.append(` ${name}`); }
        original.append(label, ' ');
    }
    original.append(english);
    const chinese = d.createElement('p');
    chinese.className = 'study-english-chinese';
    chinese.textContent = '正在读取中文…';
    chinese.title = 'AI 辅助词典翻译，不是按当前原句消歧的解释；用量计入两工具累计。';
    const retry = d.createElement('button');
    retry.type = 'button';
    retry.className = 'study-english-retry scan-disable';
    retry.textContent = '翻译此义';
    retry.hidden = true;
    retry.title = '仅按下按钮才重新调用 AI 翻译当前词典首义；不会重复保存笔记或制卡。';
    panel.append(caption, original, chinese, retry);
    entry.querySelector('.study-primary-meaning')?.after(panel);
    // The pinned reading area is a preview; keep its translation in sync with
    // the original node used by the existing save workflow.
    /**
     * @param {string} text
     * @param {boolean} [translated]
     */
    const showChinese = (text, translated = false) => {
        chinese.textContent = text;
        if (translated) {
            chinese.dataset.studyTranslated = 'true';
        } else {
            delete chinese.dataset.studyTranslated;
        }
        if (entry.dataset.studyPinned === 'true') {
            const preview = /** @type {?HTMLElement} */ (d.querySelector('.study-reading-english .study-english-chinese'));
            if (preview) {
                preview.textContent = text;
                if (translated) {
                    preview.dataset.studyTranslated = 'true';
                } else {
                    delete preview.dataset.studyTranslated;
                }
            }
        }
    };
    let active = true;
    let running = false;
    const lookup = {word, language: 'en', items: [{id: '0', text: english}]};
    /** @param {string} label */
    const showRetry = (label) => {
        retry.hidden = !label;
        retry.textContent = label;
        const preview = entry.dataset.studyPinned === 'true' ? /** @type {?HTMLButtonElement} */ (d.querySelector('.study-reading-english .study-english-retry')) : null;
        if (preview) {
            preview.hidden = retry.hidden;
            preview.textContent = label;
            preview.disabled = retry.disabled;
        }
    };
    /** @param {boolean} userInitiated */
    const generate = (userInitiated) => {
        if (!active || running) { return; }
        running = true;
        retry.disabled = true;
        showRetry('翻译中…');
        showChinese('正在翻译当前词典首义…');
        void (async () => {
            if (userInitiated) {
                const allowed = await chrome.permissions.request({permissions: ['nativeMessaging']});
                if (!allowed) { throw new Error('尚未授权本机 AI 翻译'); }
            }
            const res = /** @type {{result?: import('study').DictionaryResult}} */ (await studyCall('dictionaryGenerate', lookup));
            const translated = res?.result?.items?.find((item) => item.id === '0')?.translation?.trim();
            if (!translated) { throw new Error('这次没有返回中文'); }
            if (active) {
                showChinese(translated, true);
                showRetry('');
            }
        })().catch((error) => {
            if (!active) { return; }
            showChinese('中文暂未完成；原英文仍可阅读。');
            retry.title = error instanceof Error ? error.message : 'AI 翻译未完成，可按需重试';
            showRetry('重试翻译');
        }).finally(() => {
            running = false;
            retry.disabled = false;
            if (active) { showRetry(retry.hidden ? '' : retry.textContent); }
        });
    };
    retry.addEventListener('click', () => { generate(true); });
    void (async () => {
        const cached = /** @type {{result?: import('study').DictionaryResult}} */ (await studyCall('dictionaryPeek', lookup));
        if (!active) { return; }
        const translated = cached?.result?.items?.find((item) => item.id === '0')?.translation?.trim();
        if (translated) { showChinese(translated, true); showRetry(''); return; }
        let auto = false;
        if (automatic && typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
            try {
                const stored = await chrome.storage.local.get('studySettingsV2');
                auto = stored?.studySettingsV2?.autoDictionaryTranslate === true;
            } catch { /* Missing settings stay manual; lookup still works. */ }
        }
        if (english.length > 1500) {
            showChinese('这条释义较长，完整英文保留在词典内。');
            showRetry('');
            return;
        }
        if (!auto) {
            showChinese('词典英英首义可按需翻译。');
            showRetry('翻译此义');
            return;
        }
        const allowed = await chrome.permissions.contains?.({permissions: ['nativeMessaging']});
        if (!active) { return; }
        if (!allowed) {
            showChinese('尚未授权本机翻译，英文原义仍可阅读。');
            showRetry('翻译此义');
            return;
        }
        generate(false);
    })().catch((error) => {
        if (!active) { return; }
        showChinese('词典辅助中文暂不可用，英文原义保留。');
        retry.title = error instanceof Error ? error.message : '读取词典翻译缓存失败';
        showRetry('重试翻译');
    });
    return () => { active = false; };
}

/**
 * @param {import('./display.js').Display} display
 * @param {boolean} [detail]
 */
export function prepareStudyCard(display, detail = false) {
    const inner = document.querySelector('.content-body-inner');
    const autoSize = /** @type {?HTMLInputElement} */ (document.querySelector('#study-auto-size'));
    if (!(inner instanceof HTMLElement) || (!detail && !autoSize)) {
        return;
    }
    document.documentElement.dataset.studyDetail = `${detail}`;
    const closeMini = prepareStudyMini(display);
    /** @type {(() => void)[]} */
    let dictionaryViews = [];
    const context = document.querySelector('#study-context');
    // Only the inputs/actions are scan-disabled, not the user's original sentence.
    context?.classList.remove('scan-disable');
    const translation = prepareStudyTranslation();
    document.documentElement.dataset.studyView = 'single';
    let manual = false;
    let generation = 0;
    let pending = false;
    const toolbar = document.querySelector('.study-toolbar');
    const favorite = toolbar ? document.createElement('button') : null;
    /** @type {import('study').SavedWord|null} */
    let favoriteRow = null;
    /** @type {{word: string, sentence: string, language: string, url: string, title: string, videoTime?: number}|null} */
    let favoriteSource = null;
    const updateFavoriteLabel = () => {
        if (!favorite) { return; }
        const saved = Boolean(favoriteRow);
        const pendingSync = favoriteRow?.syncPending === true;
        favorite.textContent = saved ? '★' : '☆';
        favorite.setAttribute('aria-pressed', String(saved));
        favorite.setAttribute('aria-label', saved ? '取消待学收藏' : '收藏到待学');
        favorite.title = pendingSync ?
                '本地已收藏，Obsidian 待同步；再次点击取消收藏' :
                (saved ? '已收藏到待学，可同步到 Obsidian；再次点击取消收藏' : '收藏到待学，可同步到 Obsidian；不制卡');
    };
    if (favorite) {
        favorite.type = 'button';
        favorite.className = 'study-favorite scan-disable';
        favorite.textContent = '☆';
        favorite.disabled = true;
        favorite.title = '收藏到待学，可同步到 Obsidian；不制卡';
        favorite.setAttribute('aria-label', '收藏到待学');
        favorite.setAttribute('aria-pressed', 'false');
        const before = toolbar?.querySelector('.study-settings, #close-button');
        if (before) {
            before.before(favorite);
        } else {
            toolbar?.append(favorite);
        }
        favorite.addEventListener('click', () => {
            if (!favoriteSource || favorite.disabled) { return; }
            const token = generation;
            const source = favoriteSource;
            const existing = favoriteRow;
            favorite.disabled = true;
            void (existing ? studyCall('removeWord', {id: existing.id}) : studyCall('saveWord', source)).then((value) => {
                if (token !== generation) { return; }
                favoriteRow = existing ? null : /** @type {import('study').SavedWord} */ (value);
                updateFavoriteLabel();
            }).catch((error) => {
                if (token === generation) {
                    favorite.textContent = '!';
                    favorite.title = `收藏未完成：${error instanceof Error ? error.message : '请重试'}`;
                    favorite.setAttribute('aria-label', '收藏未完成，点击重试');
                }
            }).finally(() => { if (token === generation) { favorite.disabled = false; } });
        });
    }
    const refreshFavorite = () => {
        if (!favorite || !favoriteSource) { return; }
        const token = generation;
        const source = favoriteSource;
        let url = '';
        try {
            const link = new URL(source.url);
            if (['http:', 'https:'].includes(link.protocol)) {
                url = (typeof source.videoTime === 'number' ? timedUrl(link.href, Math.max(0, source.videoTime)).url : link.href).slice(0, 2000);
            }
        } catch { /* Local dictionary context has no web URL. */ }
        void studyCall('saved').then((value) => {
            if (token !== generation) { return; }
            favoriteRow = /** @type {import('study').SavedWord[]} */ (value).find((r) => r.word === source.word && r.sentence === source.sentence && r.url === url && (r.language ?? 'en') === source.language) ?? null;
            updateFavoriteLabel();
            favorite.disabled = false;
        }).catch(() => {
            if (token === generation) { favorite.disabled = false; }
        });
    };
    if (typeof chrome !== 'undefined') {
        chrome.storage?.onChanged?.addListener((changes, area) => {
            if (area === 'local' && SAVED_KEY in changes) { refreshFavorite(); }
        });
    }
    const fit = async () => {
        const token = generation;
        const id = display.parentPopupId;
        if (document.documentElement.dataset.studyWorkspace === 'true' || !id || manual || !autoSize || !autoSize.checked || document.documentElement.dataset.isResizing === 'true') {
            return;
        }
        try {
            /** @type {import('popup').ValidSize} */
            const size = await display.invokeParentFrame('popupFactoryGetFrameSize', {id});
            if (document.documentElement.dataset.studyWorkspace === 'true' || token !== generation || manual || !autoSize.checked || !size.valid) {
                return;
            }
            const height = Math.max(160, Math.min(560, Math.ceil(inner.getBoundingClientRect().height + 4)));
            if (Math.abs(size.height - height) < 2) {
                return;
            }
            await display.invokeParentFrame('popupFactorySetFrameSize', {id, width: size.width, height});
        } catch { /* Parent can disappear on navigation;
         resizing must not break lookup. */ }
    };
    const schedule = () => {
        if (pending) {
            return;
        }
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
        handle?.addEventListener(event, () => {
            manual = true;
        }, {capture: true, passive: true});
    }
    const clear = () => {
        closeMini();
        ++generation;
        translation.cancel();
        unpinStudyContext(inner);
        favoriteRow = null;
        favoriteSource = null;
        if (favorite) {
            favorite.disabled = true;
            favorite.textContent = '☆';
            favorite.setAttribute('aria-pressed', 'false');
        }
        for (const dispose of dictionaryViews) {
            dispose();
        }
        dictionaryViews = [];
        document.querySelector('.study-toolbar .study-toolbar-asb')?.remove();
        if (context instanceof HTMLElement) {
            if (context.closest('.study-entry')) {
                document.querySelector('#dictionary-entries')?.before(context);
            }
            context.replaceChildren();
            context.hidden = true;
        }
    };
    display.on('contentUpdateStart', clear);
    display.on('contentClear', clear);
    display.on('contentUpdateEntry', ({element, dictionaryEntry, index}) => {
        if (dictionaryEntry.type !== 'term' || !(element instanceof HTMLElement)) {
            return;
        }
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
                        label.dataset.studyMetaRole = node.dataset.scStudyRole;
                        label.textContent = [...node.children].filter((c) => c.tagName !== 'SUMMARY' && !c.textContent?.startsWith('原数据语料排名')).map((c) => c.textContent).join(' · ')
                            .replace('原数据语料排名，不代表难度或掌握程度。', '')
                            .trim();
                        label.title = node.querySelector('summary')?.textContent ?? '';
                        if (node.dataset.scStudyRole === 'forms') {
                            /** @type {Map<string, string[]>} */
                            const groups = new Map();
                            for (const child of [...node.children].filter((c) => c.tagName !== 'SUMMARY')) {
                                const text = child.textContent?.trim() ?? '';
                                const separator = text.indexOf('：');
                                if (separator < 0) {
                                    if (text) { groups.set(text, []); }
                                    continue;
                                }
                                const name = text.slice(0, separator);
                                const value = text.slice(separator + 1).trim();
                                const names = groups.get(value) ?? [];
                                if (!names.includes(name)) { names.push(name); }
                                groups.set(value, names);
                            }
                            label.replaceChildren();
                            for (const [value, names] of groups) {
                                const form = document.createElement('span');
                                form.className = 'study-form-item';
                                const name = document.createElement('span');
                                name.className = 'study-form-label';
                                name.textContent = names.length > 0 ? `${names.map(studyFormLabel).join(' / ')}：` : '';
                                const text = document.createElement('strong');
                                text.textContent = value;
                                form.append(name, text);
                                label.append(form);
                            }
                        }
                        strip.append(label);
                        node.remove();
                    } else {
                        strip.append(node);
                    }
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
                    const abbreviation = document.createElement('span');
                    abbreviation.className = 'study-pos-en';
                    abbreviation.textContent = match[1];
                    const translated = document.createElement('span');
                    translated.className = 'study-pos-zh';
                    translated.textContent = studyPartOfSpeech(match[1]) || match[1];
                    pos.append(abbreviation, ' ', translated);
                    const definition = document.createElement('span');
                    definition.className = 'study-meaning-text';
                    definition.textContent = text.slice(match[0].length);
                    row.replaceChildren(pos, definition);
                }
            }
        }
        if (!detail) {
            const phonetic = element.querySelector('[data-sc-study-role=phonetic]');
            if (phonetic) {
                const pronunciation = phonetic;
                if (pronunciation instanceof HTMLElement) {
                    pronunciation.classList.add('study-quick-phonetic');
                }
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
            toggle.addEventListener('click', () => {
                expand(element.dataset.studyExpanded !== 'true');
            });
            element.addEventListener('focusin', (event) => {
                if (event.target !== toggle) {
                    expand(true);
                }
            });
            element.addEventListener('study-entry-focus', () => {
                expand(true);
            });
            element.prepend(toggle);
        }
        {
            if (display.getOptions?.()?.general?.language !== 'ja') {
                dictionaryViews.push(mountOriginalEnglish(element, dictionaryEntry.headwords[0]?.term ?? display.query, index === 0));
            }
            for (const disclosure of element.querySelectorAll('[data-sc-study-role=english], [data-sc-study-role=more]')) {
                if (disclosure instanceof HTMLDetailsElement) {
                    const supplement = disclosure.dataset.scStudyRole === 'english' && element.querySelector('[data-sc-content=glosses]') !== null;
                    disclosure.open = !supplement;
                    if (supplement) {
                        disclosure.classList.add('study-extra-english');
                        const summary = disclosure.querySelector('summary');
                        if (summary) {
                            summary.textContent = '原词库英英简释（参考）';
                        }
                    }
                }
            }
            for (const label of element.querySelectorAll('[data-sc-content=summary-entry]')) {
                if (label.textContent === 'Grammar') {
                    label.textContent = '词形与语法';
                }
                if (label.textContent === 'Etymology') {
                    label.textContent = '词源';
                }
            }
            dictionaryViews.push(prepareStudyDictionary(element, dictionaryEntry.headwords[0]?.term ?? display.query, display.getOptions?.()?.general?.language ?? 'en'));
        }
        const body = element.querySelector('.entry-body');
        if (body) {
            const dictionary = document.createElement('details');
            dictionary.className = 'study-dictionary-details';
            const summary = document.createElement('summary');
            summary.textContent = '查词典：完整释义、例句与中文辅助';
            body.before(dictionary);
            dictionary.append(summary);
            dictionary.append(body);
        }
    });
    display.on('contentUpdateComplete', () => {
        try {
            const toolbar = document.querySelector('.study-toolbar');
            const toolbarTitle = toolbar?.querySelector('.study-toolbar-title');
            if (toolbarTitle) {
                toolbarTitle.textContent = display.getOptions?.()?.general?.language === 'ja' ? '日语查词' : '英语查词';
            }
            const settings = toolbar?.querySelector('.study-settings');
            if (settings) {
                settings.href = '/settings.html#learning';
                settings.textContent = '学习设置 ↗';
                settings.title = '打开学习与保存设置';
            }
            toolbar?.querySelector('.study-toolbar-asb')?.remove();
            const asb = display.history.state?.asb;
            if (asb?.label && toolbarTitle) {
                const badge = document.createElement('span');
                badge.className = 'study-asb-badge study-toolbar-asb scan-disable';
                badge.textContent = asb.label;
                badge.title = asb.title || '已读取 asbplayer 字幕时间戳';
                toolbarTitle.after(badge);
            }
            if (context instanceof HTMLElement) {
                context.replaceChildren();
                const extracted = display.history.state?.sentence;
                const sentence = extracted?.text.trim() ? extracted : {text: display.query, offset: 0};
                const header = document.querySelector('.study-entry .entry-header');
                if (header) {
                    header.after(context);
                } else {
                    const entries = document.querySelector('#dictionary-entries');
                    if (entries) {
                        entries.after(context);
                    }
                }
                appendStudyContext(context, sentence, display.query, asb);
                pinStudyContext(inner, context, display.query);
                if (!header && sentence?.text.trim()) {
                    const selected = document.createElement('p');
                    selected.className = 'study-missing-target';
                    selected.textContent = display.query;
                    context.prepend(selected);
                }
                if (sentence.text.trim()) {
                    context.hidden = false;
                    const meaning = briefDictionaryMeaning(document.querySelector('.study-entry'));
                    const mediaToken = display.history.state?.studyMediaToken ?? '';
                    const language = display.getOptions?.()?.general?.language ?? 'en';
                    const first = display.dictionaryEntries?.[0];
                    const head = first?.type === 'term' ? first.headwords[0] : null;
                    let dictionaryNotes = [...(document.querySelector('.study-entry')?.querySelectorAll('[data-sc-content=glosses]>li') ?? [])].slice(0, 4).map((e) => [...e.querySelectorAll('.study-bilingual-original')].map((n) => n.textContent ?? '').join('\n')).join('\n')
                        .slice(0, 3500);
                    if (language === 'ja' && first?.type === 'term') {
                        const lines = first.headwords.map(({term, reading}) => `词典原形：${term}；读音：${reading || '未提供'}`);
                        for (const pronunciation of first.pronunciations) {
                            for (const pitch of pronunciation.pronunciations) {
                                if (pitch.type === 'pitch-accent') {
                                    lines.push(`音调下降位置：${pitch.positions}；来源：${pronunciation.dictionaryAlias || pronunciation.dictionary}`);
                                }
                            }
                        }
                        if (first.pronunciations.length === 0) {
                            lines.push('音调资料未提供，不由 AI 补造。');
                        }
                        for (const candidate of first.inflectionRuleChainCandidates) {
                            lines.push(`活用路径：${candidate.inflectionRules.map((rule) => rule.description || rule.name).join(' → ')}`);
                        }
                        const full = lines.join('\n');
                        dictionaryNotes = full.length > 4000 ? `${full.slice(0, 3950)}\n[本次仅保留部分词典资料，完整条目可在词典查看]` : full;
                    }
                    const sameSavedWord = !display.history.state?.savedRecordWord || display.history.state.savedRecordWord.toLocaleLowerCase() === (display.query ?? '').toLocaleLowerCase();
                    const recordId = sentence?.studySubtitle || !sameSavedWord ? void 0 : (display.history.state?.savedRecordId ?? sentence?.recordId);
                    translation.render(context, sentence.text, display.query, {translation: display.history.state?.studySentenceTranslation, cancelCapture: display.history.state?.studyMediaToken ? (() => display.invokeContentOrigin('frontendCancelStudyMedia', {token: mediaToken})) : void 0, mediaRange: display.history.state?.studyMediaRange, capture: display.history.state?.studyMediaToken ? ((start, duration, options = {}) => display.invokeContentOrigin('frontendCaptureStudyMedia', {token: mediaToken, start, duration, withFrame: options.withFrame === true, withVideo: options.withVideo === true})) : void 0, language, lemma: head?.term, reading: head?.reading, dictionaryNotes, contextSelected: false, url: display.history.state?.url, title: display.history.state?.documentTitle, context: sentence.adjacent, videoTime: display.history.state?.videoTime, recordId, meaning: meaning ? `词典简释（未按当前句消歧）：${meaning}` : ''});
                    const legacy = document.querySelector('.study-entry .note-actions-container');
                    if (legacy instanceof HTMLElement) {
                        // Preserve Yomitan's explicit "add to Anki" action as a
                        // separate choice. DisplayAnki still owns enablement,
                        // deck mapping, duplicate checks and trusted-cue limits.
                        legacy.hidden = false;
                        legacy.title = '快速加卡只发送词典卡；“记住它”才会保留完整学习过程，并按设置决定是否复习。';
                    }
                }
                const subtitleSnapshot = /** @type {(typeof sentence & {studySubtitle?: import('../app/frontend.js').StudySubtitle})} */ (sentence)?.studySubtitle;
                if (sentence?.text.trim() && display.query.trim()) {
                    favoriteSource = {word: subtitleSnapshot?.word || display.query,
                        sentence: sentence.text,
                        language: subtitleSnapshot?.language ?? 'en',
                        url: display.history.state?.url ?? '',
                        title: display.history.state?.documentTitle ?? '',
                        ...(typeof display.history.state?.videoTime === 'number' ? {videoTime: display.history.state.videoTime} : {})};
                    refreshFavorite();
                }
                if (subtitleSnapshot) {
                    for (const action of document.querySelectorAll('[data-action=save-note], [data-action=add-note]')) {
                        if (action instanceof HTMLElement) { action.hidden = true; }
                    }
                }
            }
        } catch (error) {
            console.error('Study card contentUpdateComplete error:', error);
        }
        schedule();
    });
}
