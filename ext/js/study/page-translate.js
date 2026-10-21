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
import {chromeTranslate} from './free-translators.js';
import {readSubtitlePrefs, writeSubtitlePrefs} from './subtitle-prefs.js';
import {studyCall} from './study-client.js';
import {TextToSpeechAudio} from '../media/text-to-speech-audio.js';
import {confirmTranslation} from './translation-confirm.js';
import {WORD_MARKS_KEY} from './study-data.js';

export const PAGE_PREFS_KEY = 'studyPageTranslation';

/** @typedef {{mode:'bilingual'|'translation',sites:string[],auto:boolean,selection:'button'|'auto'|'off',hoverKey:string}} PagePrefs */
/** @type {PagePrefs} */
const DEFAULTS = {mode: 'bilingual', sites: [], auto: false, selection: 'button', hoverKey: 'Alt'};
const SKIP = `${DEFAULT_IGNORE_SELECTOR},${DEFAULT_KEEP_SELECTOR},input,textarea,select,[contenteditable]:not([contenteditable=false]),.scan-disable,.study-page-translation,#study-yt-reader,#study-yt-overlay,#movie_player,#study-web-layer,#study-web-dock`;
const STYLE = '.study-original-hidden{display:none!important}.study-page-translation{color:var(--st-muted,#6b7280);font-size:.92em;line-height:1.6;margin:4px 0 10px;white-space:pre-wrap}.study-page-translation{position:relative}.study-page-translation[data-only=true]:hover:before{content:attr(data-original);position:absolute;bottom:100%;left:0;z-index:2147482999;max-width:90vw;width:max-content;box-sizing:border-box;padding:8px 12px;border:1px solid #dce2eb;border-radius:8px;background:var(--st-paper,#fbfaf7);color:var(--st-ink,#263248);font-size:14px;white-space:normal;box-shadow:0 3px 16px #0003;pointer-events:none}.study-page-error{cursor:pointer}.study-page-tools{position:fixed;z-index:2147483000;padding:10px;border:1px solid #dce2eb;border-radius:10px;background:var(--st-paper,#fbfaf7);color:var(--st-ink,#263248);box-shadow:0 4px 20px #0003;font:14px/1.6 sans-serif;max-width:min(420px,90vw)}.study-page-tools button{font:inherit;cursor:pointer;margin:3px}';

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
 * @returns {Promise<string>}
 */
async function translateText(text) {
    const prefs = await readSubtitlePrefs();
    const config = /** @type {import('study').StudyConfig} */ (await studyCall('subtitleSettings'));
    const declared = document.documentElement.lang.split('-')[0] || 'en';
    const language = declared === 'zh' ? 'en' : declared;
    const result = [];
    for (let offset = 0; offset < text.length; offset += 2200) {
        const part = text.slice(offset, offset + 2200);
        if (prefs.engine === 'chrome') {
            result.push((await chromeTranslate([part], {source: language}))[0]);
        } else {
            const reply = /** @type {{items:{translation:string}[]}} */ (await studyCall('subtitleTranslate', {requestId: crypto.randomUUID(), language, items: [{id: 'page', text: part}], config: {model: config.model, effort: config.effort}}));
            result.push(reply.items[0].translation);
        }
    }
    return result.join('\n');
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
        /** @type {HTMLElement|null} */
        this.selectionUi = null;
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
            if (this.prefs.selection === 'off') { this.selectionUi?.remove(); }
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
        const version = this.version;
        try {
            if (!manual && !await this.approve()) { return; }
            if (version !== this.version || !original.isConnected) { return; }
            const result = await this.requestText(text);
            if ((this.active || manual) && version === this.version && original.isConnected && this.source(original) === text) { this.render(original, text, result, manual); }
        } catch {
            if ((this.active || manual) && version === this.version && original.isConnected && this.source(original) === text) {
                this.render(original, text, '这段没翻译成功 · 点击重试', manual);
                const row = this.rows.get(original);
                if (row) {
                    row.node.classList.add('study-page-error');
                    row.node.onclick = () => { void this.translateNode(original, manual); };
                    original.classList.remove('study-original-hidden');
                }
            }
        } finally {
            this.pending.delete(original);
            if (this.active && original.isConnected && this.source(original) !== text) { this.scan(original); }
        }
    }

    /** Selection and paragraph hover share requests, rendering and original-node restoration. */
    bindSelection() {
        document.addEventListener('pointerover', (event) => { this.pointer = event.target instanceof Element ? event.target : null; });
        document.addEventListener('selectionchange', () => this.showSelection());
        document.addEventListener('keydown', (event) => { this.hoverKeyOnly = event.key === this.prefs.hoverKey && !event.ctrlKey && !event.metaKey && (!event.altKey || event.key === 'Alt') && !this.editing(event.target); });
        document.addEventListener('keyup', (event) => {
            if (event.key !== this.prefs.hoverKey || !this.hoverKeyOnly || this.editing(event.target)) { return; }
            this.hoverKeyOnly = false;
            const original = this.pointer?.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,div');
            if (!original || original.closest(SKIP)) { return; }
            if (this.rows.has(original)) {
                this.restore(original);
            } else {
                void this.translateNode(original, true);
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
        ui.className = 'study-page-tools scan-disable';
        const box = range.getBoundingClientRect();
        Object.assign(ui.style, {left: `${Math.max(8, Math.min(innerWidth - 300, box.left))}px`, top: `${Math.max(8, Math.min(innerHeight - 160, box.bottom + 8))}px`, maxHeight: '70vh', overflow: 'auto'});
        ui.onmousedown = (event) => event.preventDefault();
        document.documentElement.append(ui);
        this.selectionUi = ui;
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.textContent = '译';
        trigger.onclick = () => { void this.openSelection(text, ui); };
        ui.append(trigger);
        if (this.prefs.selection === 'auto') { trigger.click(); }
    }

    /**
     * @param {string} text
     * @param {HTMLElement} ui
     */
    async openSelection(text, ui) {
        ui.textContent = '翻译中…';
        try {
            const translation = await this.requestText(text);
            if (!ui.isConnected) { return; }
            ui.replaceChildren();
            const source = document.createElement('p');
            source.textContent = text;
            ui.append(source);
            this.render(source, text, translation, true);
            for (const label of ['复制', '朗读', '记住这句']) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = label;
                button.onclick = () => {
                    void (async () => {
                        if (label === '复制') {
                            await navigator.clipboard.writeText(translation);
                            button.textContent = '已复制';
                        }
                        if (label === '朗读') {
                            const voice = speechSynthesis.getVoices().find((v) => /^en/i.test(v.lang));
                            if (voice) {
                                await new TextToSpeechAudio(text, voice).play();
                            } else {
                                button.textContent = '英语声音还没准备好，请再点一次';
                            }
                        }
                        if (label === '记住这句') {
                            button.disabled = true;
                            await studyCall('pageSentenceSave', {sentence: text, translation});
                            button.textContent = '已记住';
                        }
                    })().catch((error) => { button.disabled = false; button.textContent = `没完成：${String(error)}`; });
                };
                ui.append(button);
            }
        } catch { ui.textContent = '没翻译成功，请重新选中后点「译」。'; }
    }

    /** @returns {Promise<void>} */
    async toggle() {
        if (this.active) {
            this.stop();
            return;
        }
        if (!await this.approve()) { return; }
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
        ++this.version;
        this.io?.disconnect();
        this.mo?.disconnect();
        for (const original of this.rows.keys()) { this.restore(original); }
        this.pending = new WeakSet();
        this.selectionUi?.remove();
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
    const site = query('page-site');
    const sites = /** @type {HTMLTextAreaElement|null} */ (root.querySelector('#page-sites'));
    const marks = query('page-marks');
    const video = query('page-video');
    const selection = /** @type {HTMLSelectElement|null} */ (root.querySelector('#page-selection'));
    const hoverKey = query('page-hover-key');
    const button = root.querySelector('#page-toggle');
    const host = tab?.url && /^https?:/.test(tab.url) ? new URL(tab.url).hostname : '';
    const paint = async () => {
        const prefs = await readPagePrefs();
        if (engine) {
            engine.value = (await readSubtitlePrefs()).engine;
            engine.dispatchEvent(new Event('study-ui-sync'));
        }
        const hint = root.querySelector('#page-selection-hint');
        if (hint) { hint.textContent = `选中句子点「译」；鼠标停在段落上按 ${prefs.hoverKey} 翻译这一段`; }
        if (selection) {
            selection.value = prefs.selection;
            selection.dispatchEvent(new Event('study-ui-sync'));
        }
        if (hoverKey) { hoverKey.value = prefs.hoverKey; }
        if (mode) {
            mode.value = prefs.mode;
            mode.dispatchEvent(new Event('study-ui-sync'));
        }
        if (auto) { auto.checked = prefs.auto; }
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
    hoverKey?.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab') {
            event.preventDefault();
            void writePagePrefs({hoverKey: event.key});
        }
    });
    mode?.addEventListener('change', () => { void writePagePrefs({mode: /** @type {PagePrefs['mode']} */ (mode.value)}); });
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
