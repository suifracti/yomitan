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

import {visitTranslationTargets} from './vendor/kiss/translationTargets.js';
import {runTranslationTasks} from './vendor/kiss/translationTasks.js';
import {DEFAULT_SELECTOR, DEFAULT_IGNORE_SELECTOR, DEFAULT_KEEP_SELECTOR} from './vendor/kiss/default-selectors.js';
import {chromeTranslate, chromeTranslatorStatus} from './free-translators.js';
import {fillEngineSelect} from './translation-engines.js';
import {readSubtitlePrefs, writeSubtitlePrefs, onSubtitlePrefsChanged} from './subtitle-prefs.js';
import {studyCall} from './study-client.js';
import {TextToSpeechAudio} from '../media/text-to-speech-audio.js';
import {menuSelect} from './study-ui.js';
import {confirmTranslation} from './translation-confirm.js';
import {mountTranslationBall} from './translation-ball.js';
import {WORD_MARKS_KEY} from './study-data.js';

export const PAGE_PREFS_KEY = 'studyPageTranslation';

/** @typedef {{mode:'bilingual'|'translation',sites:string[],auto:boolean,selection:'button'|'auto'|'off',hoverKey:string,selectionDisplay:'inline'|'card',ball:boolean,ballSites:Record<string,{hidden?:boolean,y?:number}>}} PagePrefs */
/** @type {PagePrefs} */
const DEFAULTS = {mode: 'bilingual', sites: [], auto: false, selection: 'button', hoverKey: 'Alt', selectionDisplay: 'inline', ball: true, ballSites: {}};
const SKIP = `${DEFAULT_IGNORE_SELECTOR},${DEFAULT_KEEP_SELECTOR},input,textarea,select,[contenteditable]:not([contenteditable=false]),.scan-disable,.study-page-translation,#study-yt-reader,#study-yt-overlay,#movie_player,#study-web-layer,#study-web-dock`;
const STYLE = '.study-selection-trigger{position:fixed;z-index:2147483000;width:24px;height:24px;padding:0}.study-selection-trigger button{display:block;width:24px;height:24px;padding:0;border:0;border-radius:50%;background:var(--st-accent,#505ead);color:white;font:12px sans-serif;cursor:pointer}.study-selection-translation{border-left:2px solid var(--st-line,#dce2eb);padding-left:10px}.study-selection-actions{display:none;gap:2px;float:right}.study-selection-translation:hover .study-selection-actions,.study-selection-translation:focus-within .study-selection-actions,.study-selection-card .study-selection-actions{display:inline-flex}.study-selection-actions button,.study-selection-card header>button{all:unset;cursor:pointer;font:14px/1.4 sans-serif;padding:4px}.study-selection-card{width:360px;box-sizing:border-box;max-width:calc(100vw - 16px)}.study-selection-card header{display:flex;align-items:center;gap:4px}.study-selection-card .study-ui-select{flex:1;min-width:0}.study-selection-source{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-size:13px;color:var(--st-muted,#6b7280)}.study-selection-source.is-expanded{display:block}.study-selection-card .study-page-translation{font-size:15px;color:var(--st-ink,#263248)}.study-page-flash{animation:study-page-flash .9s ease-out}@keyframes study-page-flash{from{background:var(--st-accent-soft,#e8eaff)}to{background:transparent}}.study-original-hidden{display:none!important}.study-page-translation{color:var(--st-muted,#6b7280);font-size:.92em;line-height:1.6;margin:4px 0 10px;white-space:pre-wrap}.study-page-translation{position:relative}.study-page-translation[data-only=true]:hover:before{content:attr(data-original);position:absolute;bottom:100%;left:0;z-index:2147482999;max-width:90vw;width:max-content;box-sizing:border-box;padding:8px 12px;border:1px solid #dce2eb;border-radius:8px;background:var(--st-paper,#fbfaf7);color:var(--st-ink,#263248);font-size:14px;white-space:normal;box-shadow:0 3px 16px #0003;pointer-events:none}.study-page-error{cursor:pointer}.study-page-tools{position:fixed;z-index:2147483000;padding:10px;border:1px solid #dce2eb;border-radius:10px;background:var(--st-paper,#fbfaf7);color:var(--st-ink,#263248);box-shadow:0 4px 20px #0003;font:14px/1.6 sans-serif;max-width:min(420px,90vw)}.study-page-tools button{font:inherit;cursor:pointer;margin:3px}';

/** @returns {Promise<PagePrefs>} */
export async function readPagePrefs() {
    const prefs = /** @type {Partial<PagePrefs>} */ ((await chrome.storage.local.get(PAGE_PREFS_KEY))[PAGE_PREFS_KEY]);
    return {...DEFAULTS, ...prefs};
}

/** @param {Partial<PagePrefs>} patch */
export async function writePagePrefs(patch) {
    await chrome.storage.local.set({[PAGE_PREFS_KEY]: {...await readPagePrefs(), ...patch}});
}

/**
 * The same translation engine used by captions and sentence cards.
 * @param {string} text
 * @param {{language?:string,target?:string}} [options]
 * @returns {Promise<string>}
 */
async function translateText(text, {language, target = 'zh'} = {}) {
    const prefs = await readSubtitlePrefs();
    const config = /** @type {import('study').StudyConfig} */ (await studyCall('subtitleSettings'));
    const declared = document.documentElement.lang.split('-')[0] || 'en';
    language ||= declared === 'zh' ? 'en' : declared;
    const result = [];
    for (let offset = 0; offset < text.length; offset += 2200) {
        const part = text.slice(offset, offset + 2200);
        if (prefs.engine === 'chrome') {
            const status = await chromeTranslatorStatus(language);
            if (status !== 'available') {
                throw new Error(status === 'unavailable' ?
                    '这个 Chrome 版本没有内置翻译，请换用 Google 免费翻译。' :
                    'Chrome 内置翻译还没下载语言包，请先到设置里点「测试所选服务」完成下载，或换用 Google 免费翻译。');
            }
            result.push((await chromeTranslate([part], {source: language, target}))[0]);
        } else {
            const reply = /** @type {{items:{translation:string}[]}} */ (await studyCall('subtitleTranslate', {requestId: crypto.randomUUID(), language, target, items: [{id: 'page', text: part}], config: {model: config.model, effort: config.effort}}));
            result.push(reply.items[0].translation);
        }
    }
    return result.join('\n');
}

/**
 * The learner needs to see why a service did not answer, not a generic failure.
 * @param {unknown} error
 * @returns {string}
 */
function reasonOf(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.replaceAll(/\s+/g, ' ').trim().slice(0, 160);
}

export class PageTranslate {
    /** @param {{translate?:(text:string)=>Promise<string>}} [options] */
    constructor({translate = translateText} = {}) {
        /**
         *
         */
        this.translate = translate;
        /**
         *
         */
        this.active = false;
        /**
         *
         */
        this.prefs = {...DEFAULTS};
        /** @type {Map<Element,{node:HTMLElement,text:string,snapshot:string,manual:boolean}>} */
        this.rows = new Map();
        /** @type {Map<string,Promise<string>>} */
        this.cache = new Map();
        /** @type {WeakSet<Element>} */
        this.pending = new WeakSet();
        /** @type {IntersectionObserver|null} */
        this.io = null;
        /** @type {MutationObserver|null} */
        this.mo = null;
        /**
         *
         */
        this.version = 0;
        /**
         *
         */
        this.consent = '';
        /** @type {Element|null} */
        this.pointer = null;
        /** Mouse location for sentence-level hover translation. */
        this.point = {x: 0, y: 0};
        /** In-flight page requests, used by the floating ball. */
        this.busy = 0;
        /** @type {HTMLElement|null} */
        this.selectionUi = null;
        /** @type {HTMLElement|null} */
        this.selectionCard = null;
        /**
         *
         */
        this.selectionText = '';
        /**
         *
         */
        this.hoverKeyOnly = false;
    }

    /** Connect only this document; no background page scanning. */
    async start() {
        const style = document.createElement('style');
        style.textContent = STYLE;
        document.head.append(style);
        this.prefs = await readPagePrefs();
        this.bindSelection();
        mountTranslationBall(this, writePagePrefs);
        onSubtitlePrefsChanged((prefs) => {
            const select = /** @type {HTMLSelectElement|null|undefined} */ (this.selectionCard?.querySelector('select'));
            if (select) { fillEngineSelect(select, prefs.engine); }
        });
        chrome.runtime.onMessage.addListener((message, _sender, reply) => {
            const action = (/** @type {Record<string,unknown>} */ (message)).studyPage;
            if (typeof action !== 'string') { return false; }
            if (action === 'toggle') {
                void this.toggle().then(() => reply({active: this.active}), (error) => reply({error: String(error)}));
                return true;
            }
            reply({active: this.active});
            return false;
        });
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes[PAGE_PREFS_KEY]) { return; }
            const prefs = /** @type {PagePrefs} */ (changes[PAGE_PREFS_KEY].newValue);
            this.prefs = {...DEFAULTS, ...prefs};
            this.paint();
            if (this.prefs.selection === 'off') {
                this.selectionUi?.remove();
                this.closeSelectionCard();
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyA' && !this.editing(event.target)) {
                event.preventDefault();
                void this.toggle();
            }
        });
        if (this.prefs.sites.includes(location.hostname) || (this.prefs.auto && /^en(?:-|$)/i.test(document.documentElement.lang))) {
            await this.toggle();
        }
    }

    /**
     * @param {EventTarget|null} target
     * @returns {boolean}
     */
    editing(target) {
        return target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable]:not([contenteditable=false])'));
    }

    /** @returns {Promise<boolean>} */
    async approve() {
        const {engine} = await readSubtitlePrefs();
        if (engine !== 'model' || this.consent === location.origin) { return true; }
        if (await studyCall('pageTranslationConsent') === true) {
            this.consent = location.origin;
            return true;
        }
        let text = '';
        this.scan(document.body, (node) => {
            const box = node.getBoundingClientRect();
            if (box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth) { text += this.source(node); }
        });
        const size = Math.ceil(text.length / 3);
        if (!await confirmTranslation(`当前屏幕待翻内容约 ${size.toLocaleString()} Token。往下滚动还会继续翻译新内容。是否继续？`)) { return false; }
        await studyCall('pageTranslationConsent', {approve: true});
        this.consent = location.origin;
        return true;
    }

    /**
     * @param {Element} element
     * @returns {string}
     */
    source(element) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const parts = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.parentElement?.closest(SKIP)) { parts.push(node.textContent || ''); }
        }
        return parts.join(' ').replaceAll(/\s+/g, ' ').trim();
    }

    /**
     * @param {Element} root
     * @param {(node:Element)=>void} [collect]
     */
    scan(root, collect) {
        visitTranslationTargets(root, {autoScan: 'true',
            selector: DEFAULT_SELECTOR,
            ignoreSelector: SKIP,
            isBlock: (/** @type {Element} */ node) => !['none', '', 'inline', 'inline-block', 'contents'].includes(getComputedStyle(node).display),
            hasText: (/** @type {Element} */ node) => [...node.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()),
            wrapperClass: 'study-page-translation'}, (/** @type {Element} */ leaf) => {
            let node = leaf;
            while (node.parentElement && ['', 'inline', 'inline-block', 'contents'].includes(getComputedStyle(node).display)) { node = node.parentElement; }
            if (node === document.body || [...node.children].some((child) => !child.matches(SKIP) && !['none', '', 'inline', 'inline-block', 'contents'].includes(getComputedStyle(child).display))) { return; }
            if (!this.rows.has(node) && !this.pending.has(node) && /[A-Za-z]{2,}/.test(this.source(node))) {
                if (collect) {
                    collect(node);
                } else {
                    this.io?.observe(node);
                }
            }
        });
    }

    /** Switch presentation without replacing, moving or serializing original nodes. */
    paint() {
        document.dispatchEvent(new Event('study-page-change'));
        for (const [original, row] of this.rows) {
            original.classList.toggle('study-original-hidden', this.prefs.mode === 'translation' && !row.manual && !row.node.classList.contains('study-page-error'));
            row.node.dataset.only = String(this.prefs.mode === 'translation' && !row.manual);
        }
    }

    /** @param {Element} original */
    restore(original) {
        this.rows.get(original)?.node.remove();
        this.rows.delete(original);
        original.classList.remove('study-original-hidden');
    }

    /**
     * @param {Element} original
     * @param {string} text
     * @param {string} translation
     * @param {boolean} [manual]
     * @returns {HTMLElement}
     */
    render(original, text, translation, manual = false) {
        this.restore(original);
        const node = document.createElement('div');
        node.className = 'study-page-translation scan-disable';
        node.lang = 'zh-CN';
        node.textContent = translation;
        node.dataset.original = text;
        original.after(node);
        this.rows.set(original, {node, text, snapshot: this.source(original), manual});
        this.paint();
        return node;
    }

    /**
     * @param {string} text
     * @returns {Promise<string>}
     */
    async requestText(text) {
        const prefs = await readSubtitlePrefs();
        const config = /** @type {import('study').StudyConfig} */ (await studyCall('subtitleSettings'));
        const key = JSON.stringify([text, prefs.engine, config.model, config.effort]);
        let task = this.cache.get(key);
        if (!task) {
            task = this.translate(text);
            this.cache.set(key, task);
            task.catch(() => this.cache.delete(key));
        }
        return (await runTranslationTasks([() => task]))[0];
    }

    /**
     * @param {Element} original
     * @param {boolean} [manual]
     */
    async translateNode(original, manual = false) {
        const text = this.source(original);
        if (!text || !/[A-Za-z]{2,}/.test(text) || (text.match(/[\u3400-\u9fff]/g)?.length || 0) > text.length / 5 || this.pending.has(original)) { return; }
        this.pending.add(original);
        ++this.busy;
        document.dispatchEvent(new Event('study-page-change'));
        const version = this.version;
        try {
            if (!manual && !await this.approve()) { return; }
            if (version !== this.version || !original.isConnected) { return; }
            const result = await this.requestText(text);
            if ((this.active || manual) && version === this.version && original.isConnected && this.source(original) === text) { this.render(original, text, result, manual); }
        } catch (error) {
            if ((this.active || manual) && version === this.version && original.isConnected && this.source(original) === text) {
                this.render(original, text, `这段没翻译成功：${reasonOf(error)} · 点击重试`, manual);
                const row = this.rows.get(original);
                if (row) {
                    row.node.classList.add('study-page-error');
                    row.node.onclick = () => { void this.translateNode(original, manual); };
                    original.classList.remove('study-original-hidden');
                }
            }
        } finally {
            this.pending.delete(original);
            --this.busy;
            document.dispatchEvent(new Event('study-page-change'));
            if (this.active && original.isConnected && this.source(original) !== text) { this.scan(original); }
        }
    }

    /** Selection and sentence hover share requests, rendering and original-node restoration. */
    bindSelection() {
        document.addEventListener('pointerdown', (event) => {
            const card = this.selectionCard;
            if (card && card.dataset.pinned !== 'true' && event.target instanceof Node && !card.contains(event.target)) { this.closeSelectionCard(); }
        });
        document.addEventListener('pointermove', (event) => {
            this.pointer = event.target instanceof Element ? event.target : null;
            this.point = {x: event.clientX, y: event.clientY};
        });
        document.addEventListener('selectionchange', () => this.showSelection());
        document.addEventListener('keydown', (event) => { this.hoverKeyOnly = event.key === this.prefs.hoverKey && !event.ctrlKey && !event.metaKey && (!event.altKey || event.key === 'Alt') && !this.editing(event.target); });
        document.addEventListener('keyup', (event) => {
            if (event.key !== this.prefs.hoverKey || !this.hoverKeyOnly || this.editing(event.target)) { return; }
            this.hoverKeyOnly = false;
            const original = this.pointer?.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,div');
            if (!original || original.closest(SKIP)) { return; }
            const caret = document.caretRangeFromPoint(this.point.x, this.point.y);
            if (!caret || !original.contains(caret.startContainer)) { return; }
            const prefix = document.createRange();
            prefix.selectNodeContents(original);
            prefix.setEnd(caret.startContainer, caret.startOffset);
            const offset = prefix.toString().length;
            const sentence = [...(original.textContent || '').matchAll(/[^.!?]+[.!?]*|[.!?]+/g)].find((m) => m.index + m[0].length > offset)?.[0].trim();
            if (!sentence) { return; }
            if (this.rows.get(original)?.text === sentence) {
                this.restore(original);
            } else if (this.selectionCard && this.selectionCard.querySelector('.study-selection-source')?.textContent === sentence) {
                this.closeSelectionCard();
            } else {
                const ui = document.createElement('div');
                ui.style.left = `${this.point.x}px`;
                ui.style.top = `${this.point.y + 20}px`;
                document.body.append(ui);
                void this.openSelection(sentence, ui, original);
            }
        });
    }

    /** Show nothing for a single word or an editable selection. */
    showSelection() {
        const selection = window.getSelection();
        const text = selection?.toString().trim() || '';
        if (this.editing(document.activeElement) || !selection?.rangeCount || this.prefs.selection === 'off' || (text.match(/\p{L}+/gu)?.length || 0) < 2) {
            this.selectionUi?.remove();
            return;
        }
        const range = selection.getRangeAt(0);
        const element = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
        if (!element || element.closest(SKIP) || this.editing(selection.anchorNode?.parentElement || null) || this.editing(selection.focusNode?.parentElement || null)) { return; }
        if (text === this.selectionText && this.selectionUi?.isConnected) { return; }
        this.selectionText = text;
        this.selectionUi?.remove();
        const ui = document.createElement('div');
        ui.className = 'study-selection-trigger scan-disable';
        const box = [...range.getClientRects()].at(-1) || range.getBoundingClientRect();
        Object.assign(ui.style, {left: `${Math.max(4, Math.min(innerWidth - 32, box.right + 5))}px`, top: `${Math.max(4, Math.min(innerHeight - 32, box.bottom + 5))}px`});
        let original = selection.focusNode instanceof Element ? selection.focusNode : selection.focusNode?.parentElement || element;
        while (original.parentElement && ['', 'inline', 'inline-block', 'contents'].includes(getComputedStyle(original).display)) { original = original.parentElement; }
        ui.onmousedown = (event) => event.preventDefault();
        document.documentElement.append(ui);
        this.selectionUi = ui;
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.textContent = '译';
        trigger.title = '翻译选中文字';
        trigger.setAttribute('aria-label', trigger.title);
        trigger.onclick = () => { void this.openSelection(text, ui, original); };
        ui.append(trigger);
        if (this.prefs.selection === 'auto') { trigger.click(); }
    }

    /** Close just the floating result, without changing any source paragraph. */
    closeSelectionCard() {
        for (const original of this.rows.keys()) {
            if (this.selectionCard?.contains(original)) { this.restore(original); }
        }
        this.selectionCard?.remove();
        this.selectionCard = null;
    }

    /**
     * @param {string} text
     * @param {HTMLElement} ui
     * @param {Element} original
     */
    async openSelection(text, ui, original) {
        const existing = this.rows.get(original);
        if (existing && !existing.manual && !existing.node.classList.contains('study-page-error')) {
            existing.node.classList.remove('study-page-flash');
            void existing.node.offsetWidth;
            existing.node.classList.add('study-page-flash');
            ui.remove();
            return;
        }
        const inline = this.prefs.selectionDisplay !== 'card';
        this.selectionUi = null;
        if (inline) {
            ui.remove();
        } else {
            this.closeSelectionCard();
            this.selectionCard = ui;
            ui.className = 'study-page-tools study-selection-card scan-disable';
            ui.dataset.studyUi = '';
            ui.style.maxHeight = '70vh';
            ui.style.overflow = 'auto';
            ui.style.left = `${Math.max(8, Math.min(innerWidth - 368, Number.parseFloat(ui.style.left)))}px`;
            ui.style.top = `${Math.max(8, Math.min(innerHeight - 300, Number.parseFloat(ui.style.top)))}px`;
            ui.replaceChildren();
            const header = document.createElement('header');
            const engine = document.createElement('select');
            engine.setAttribute('aria-label', '翻译服务');
            fillEngineSelect(engine, (await readSubtitlePrefs()).engine);
            engine.onchange = () => { void writeSubtitlePrefs({engine: /** @type {import('./subtitle-prefs.js').SubtitleEngine} */ (engine.value)}); };
            const pin = Object.assign(document.createElement('button'), {type: 'button', textContent: '📌', title: '固定'});
            pin.setAttribute('aria-pressed', 'false');
            pin.onclick = () => {
                ui.dataset.pinned = String(ui.dataset.pinned !== 'true');
                pin.setAttribute('aria-pressed', ui.dataset.pinned);
            };
            const close = Object.assign(document.createElement('button'), {type: 'button', textContent: '✕', title: '关闭'});
            close.onclick = () => this.closeSelectionCard();
            header.append(engine, pin, close);
            ui.append(header);
            menuSelect(engine);
            const source = document.createElement('p');
            source.className = 'study-selection-source';
            source.textContent = text;
            const expand = Object.assign(document.createElement('button'), {type: 'button', textContent: '显示全部', hidden: true});
            expand.onclick = () => {
                source.classList.toggle('is-expanded');
                expand.textContent = source.classList.contains('is-expanded') ? '收起原文' : '显示全部';
            };
            ui.append(source, expand);
            requestAnimationFrame(() => { expand.hidden = source.scrollHeight <= source.clientHeight + 1; });
            original = source;
        }
        this.render(original, text, '翻译中…', true);
        const waiting = this.rows.get(original);
        try {
            const translation = await this.requestText(text);
            if (!original.isConnected || this.rows.get(original) !== waiting) { return; }
            const node = this.render(original, text, translation, true);
            if (inline) { node.classList.add('study-selection-translation'); }
            const tools = document.createElement('span');
            tools.className = 'study-selection-actions';
            for (const [icon, label] of [['🔊', '朗读'], ['⧉', '复制'], ['☆', '记住这句'], ['✕', '收起']]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = icon;
                button.title = label;
                button.setAttribute('aria-label', label);
                button.onclick = (event) => {
                    event.stopPropagation();
                    void (async () => {
                        if (label === '复制') {
                            await navigator.clipboard.writeText(translation);
                            button.textContent = '✓';
                        }
                        if (label === '朗读') {
                            const voice = speechSynthesis.getVoices().find((v) => /^en/i.test(v.lang));
                            if (voice) {
                                await new TextToSpeechAudio(text, voice).play();
                            } else {
                                button.title = '英语声音还没准备好，请再点一次';
                            }
                        }
                        if (label === '记住这句') {
                            button.disabled = true;
                            await studyCall('pageSentenceSave', {sentence: text, translation});
                            button.textContent = '★';
                            button.title = '已记住';
                        }
                        if (label === '收起') {
                            if (inline) {
                                this.restore(original);
                            } else {
                                this.closeSelectionCard();
                            }
                        }
                    })().catch((error) => {
                        button.disabled = false;
                        button.title = `没完成：${String(error)}`;
                    });
                };
                tools.append(button);
            }
            node.append(tools);
        } catch (error) {
            if (waiting && this.rows.get(original) === waiting) { waiting.node.textContent = `没翻译成功：${reasonOf(error)}，请重新选中后点「译」。`; }
        }
    }

    /** @returns {Promise<void>} */
    async toggle() {
        if (this.active) {
            this.stop();
            return;
        }
        if (!await this.approve()) { return; }
        for (const [original, row] of this.rows) {
            if (row.manual && !original.closest('.study-selection-card')) { this.restore(original); }
        }
        this.active = true;
        ++this.version;
        this.io = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    this.io?.unobserve(entry.target);
                    void this.translateNode(entry.target);
                }
            }
        });
        this.mo = new MutationObserver((records) => {
            for (const original of this.rows.keys()) {
                if (!original.isConnected) { this.restore(original); }
            }
            /** @type {Set<Element>} */
            const roots = new Set();
            for (const record of records) {
                const root = record.target instanceof Element ? record.target : record.target.parentElement;
                if (!root || root.closest(SKIP)) { continue; }
                const changed = [...record.addedNodes, ...record.removedNodes];
                if (record.type === 'childList' && changed.every((node) => node instanceof Element && node.matches('.study-page-translation'))) { continue; }
                let host = root;
                for (let parent = root; parent; parent = parent.parentElement) {
                    const row = this.rows.get(parent);
                    if (row && row.snapshot !== this.source(parent)) {
                        this.restore(parent);
                        host = parent;
                        break;
                    }
                }
                for (const node of record.addedNodes.length > 0 ? record.addedNodes : [host]) {
                    let block = node instanceof Element ? node : host;
                    if (block.closest(SKIP)) { continue; }
                    while (block.parentElement && ['', 'inline', 'inline-block', 'contents'].includes(getComputedStyle(block).display)) { block = block.parentElement; }
                    roots.add(block);
                }
            }
            for (const root of roots) { this.scan(root); }
        });
        this.mo.observe(document.body, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'open']});
        this.scan(document.body);
    }

    /** Restore page markup; late translation replies cannot reinsert content. */
    stop() {
        this.active = false;
        document.dispatchEvent(new Event('study-page-change'));
        ++this.version;
        this.io?.disconnect();
        this.mo?.disconnect();
        for (const original of this.rows.keys()) { this.restore(original); }
        this.pending = new WeakSet();
        this.selectionUi?.remove();
        this.closeSelectionCard();
    }
}

/**
 * Shared popup/settings controls, backed by the same preferences.
 * @param {ParentNode} root
 * @param {chrome.tabs.Tab} [tab]
 */
export async function preparePageControls(root, tab) {
    const query = (/** @type {string} */ id) => /** @type {HTMLInputElement|null} */ (root.querySelector(`#${id}`));
    const mode = /** @type {HTMLSelectElement|null} */ (root.querySelector('#page-mode'));
    const engine = /** @type {HTMLSelectElement|null} */ (root.querySelector('#page-engine'));
    const auto = query('page-auto');
    const ball = query('page-ball');
    const site = query('page-site');
    const sites = /** @type {HTMLTextAreaElement|null} */ (root.querySelector('#page-sites'));
    const marks = query('page-marks');
    const video = query('page-video');
    const selection = /** @type {HTMLSelectElement|null} */ (root.querySelector('#page-selection'));
    const hoverKey = query('page-hover-key');
    const display = /** @type {HTMLSelectElement|null} */ (root.querySelector('#page-selection-display'));
    const button = root.querySelector('#page-toggle');
    const host = tab?.url && /^https?:/.test(tab.url) ? new URL(tab.url).hostname : '';
    const paint = async () => {
        const prefs = await readPagePrefs();
        if (engine) {
            fillEngineSelect(engine, (await readSubtitlePrefs()).engine);
        }
        const hint = root.querySelector('#page-selection-hint');
        if (hint) { hint.textContent = `选中句子点「译」；鼠标停在句子上按 ${prefs.hoverKey} 翻译这一句`; }
        if (selection) {
            selection.value = prefs.selection;
            selection.dispatchEvent(new Event('study-ui-sync'));
        }
        if (hoverKey) { hoverKey.value = prefs.hoverKey; }
        if (display) {
            display.value = prefs.selectionDisplay;
            display.dispatchEvent(new Event('study-ui-sync'));
        }
        if (mode) {
            mode.value = prefs.mode;
            mode.dispatchEvent(new Event('study-ui-sync'));
        }
        if (auto) { auto.checked = prefs.auto; }
        if (ball) { ball.checked = prefs.ball; }
        if (site) {
            site.checked = prefs.sites.includes(host);
            site.disabled = !host;
        }
        if (sites) { sites.value = prefs.sites.join('\n'); }
        if (marks) {
            const setting = /** @type {{enabled?:boolean}|undefined} */ ((await chrome.storage.local.get(WORD_MARKS_KEY))[WORD_MARKS_KEY]);
            marks.checked = setting?.enabled !== false;
        }
        if (video) { video.checked = (await readSubtitlePrefs()).enabled; }
    };
    engine?.addEventListener('change', () => { void writeSubtitlePrefs({engine: /** @type {import('./subtitle-prefs.js').SubtitleEngine} */ (engine.value)}); });
    selection?.addEventListener('change', () => { void writePagePrefs({selection: /** @type {PagePrefs['selection']} */ (selection.value)}); });
    display?.addEventListener('change', () => { void writePagePrefs({selectionDisplay: /** @type {PagePrefs['selectionDisplay']} */ (display.value)}); });
    hoverKey?.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab') {
            event.preventDefault();
            void writePagePrefs({hoverKey: event.key});
        }
    });
    mode?.addEventListener('change', () => { void writePagePrefs({mode: /** @type {PagePrefs['mode']} */ (mode.value)}); });
    ball?.addEventListener('change', () => { void writePagePrefs({ball: ball.checked}); });
    auto?.addEventListener('change', () => { void writePagePrefs({auto: auto.checked}); });
    site?.addEventListener('change', () => { void readPagePrefs().then((p) => writePagePrefs({sites: [...p.sites.filter((s) => s !== host), ...(site.checked ? [host] : [])]})); });
    sites?.addEventListener('change', () => { void writePagePrefs({sites: sites.value.split(/\s+/).filter(Boolean)}); });
    marks?.addEventListener('change', () => {
        void chrome.storage.local.get(WORD_MARKS_KEY).then((data) => {
            const prior = /** @type {Record<string,unknown>} */ (data[WORD_MARKS_KEY]);
            return chrome.storage.local.set({[WORD_MARKS_KEY]: {...prior, enabled: marks.checked}});
        });
    });
    video?.addEventListener('change', () => { void writeSubtitlePrefs({enabled: video.checked}); });
    button?.addEventListener('click', () => {
        if (tab?.id) {
            void chrome.tabs.sendMessage(tab.id, {studyPage: 'toggle'}, {frameId: 0}).then((/** @type {{error?:string,active:boolean}} */ r) => {
                button.textContent = r?.error || (r?.active ? '显示原文' : '翻译本页');
            }, () => {
                button.textContent = '请先刷新这个网页';
            });
        }
    });
    if (tab?.id && button) {
        void chrome.tabs.sendMessage(tab.id, {studyPage: 'state'}, {frameId: 0}).then((/** @type {{active:boolean}} */ r) => {
            button.textContent = r?.active ? '显示原文' : '翻译本页';
        }, () => {});
    }
    chrome.storage.onChanged.addListener(() => { void paint(); });
    await paint();
}

export {translateText};
