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

import './study-ui.js';
import {visitTranslationTargets} from './vendor/kiss/translationTargets.js';
import {runTranslationTasks} from './vendor/kiss/translationTasks.js';
import {DEFAULT_SELECTOR, DEFAULT_IGNORE_SELECTOR, DEFAULT_KEEP_SELECTOR} from './vendor/kiss/default-selectors.js';
import {chromeTranslate} from './free-translators.js';
import {readSubtitlePrefs, writeSubtitlePrefs} from './subtitle-prefs.js';
import {studyCall} from './study-client.js';
import {WORD_MARKS_KEY} from './study-data.js';

export const PAGE_PREFS_KEY = 'studyPageTranslation';

/** @typedef {{mode:'bilingual'|'translation',sites:string[],auto:boolean,selection:'button'|'auto'|'off',hoverKey:string}} PagePrefs */
/** @type {PagePrefs} */
const DEFAULTS = {mode: 'bilingual', sites: [], auto: false, selection: 'button', hoverKey: 'Alt'};
const SKIP = `${DEFAULT_IGNORE_SELECTOR},${DEFAULT_KEEP_SELECTOR},input,textarea,select,[contenteditable]:not([contenteditable=false]),.scan-disable,.study-page-translation,#study-yt-reader,#study-yt-overlay`;
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
    const language = document.documentElement.lang.split('-')[0] || 'en';
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
        /** @type {Map<Element,{node:HTMLElement,text:string}>} */
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
    }

    /** Connect only this document; no background page scanning. */
    async start() {
        const style = document.createElement('style');
        style.textContent = STYLE;
        document.head.append(style);
        this.prefs = await readPagePrefs();
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
        if (engine !== 'model') { return true; }
        const config = /** @type {import('study').StudyConfig} */ (await studyCall('subtitleSettings'));
        const key = JSON.stringify([engine, config.model, config.effort]);
        if (this.consent === key) { return true; }
        const size = Math.ceil((document.body.textContent?.length || 0) / 3);
        // eslint-disable-next-line no-alert -- Explicit consent before model billing.
        if (!window.confirm(`翻译会使用 AI 模型。这页大约消耗 ${size} Token；只翻进入视口的内容。继续吗？`)) { return false; }
        this.consent = key;
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

    /** @param {Element} root */
    scan(root) {
        visitTranslationTargets(root, {autoScan: 'true',
            selector: DEFAULT_SELECTOR,
            ignoreSelector: SKIP,
            isBlock: (/** @type {Element} */ node) => !['', 'inline', 'inline-block', 'contents'].includes(getComputedStyle(node).display),
            hasText: (/** @type {Element} */ node) => [...node.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()),
            wrapperClass: 'study-page-translation'}, (/** @type {Element} */ node) => {
            if (node === document.body || [...node.children].some((child) => !child.matches(SKIP) && !['', 'inline', 'inline-block', 'contents'].includes(getComputedStyle(child).display))) { return; }
            if (!this.rows.has(node) && !this.pending.has(node) && /[A-Za-z]{2,}/.test(this.source(node))) { this.io?.observe(node); }
        });
    }

    /** Switch presentation without replacing, moving or serializing original nodes. */
    paint() {
        for (const [original, row] of this.rows) {
            original.classList.toggle('study-original-hidden', this.prefs.mode === 'translation' && !row.node.classList.contains('study-page-error'));
            row.node.dataset.only = String(this.prefs.mode === 'translation');
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
     */
    render(original, text, translation) {
        this.restore(original);
        const node = document.createElement('div');
        node.className = 'study-page-translation scan-disable';
        node.lang = 'zh-CN';
        node.textContent = translation;
        node.dataset.original = text;
        original.after(node);
        this.rows.set(original, {node, text});
        this.paint();
    }

    /** @param {Element} original */
    async translateNode(original) {
        const text = this.source(original);
        if (!text || !/[A-Za-z]{2,}/.test(text) || (text.match(/[\u3400-\u9fff]/g)?.length || 0) > text.length / 5 || this.pending.has(original)) { return; }
        this.pending.add(original);
        const version = this.version;
        try {
            const prefs = await readSubtitlePrefs();
            const config = /** @type {import('study').StudyConfig} */ (await studyCall('subtitleSettings'));
            const key = JSON.stringify([text, prefs.engine, config.model, config.effort]);
            let task = this.cache.get(key);
            if (!task) {
                task = this.translate(text);
                this.cache.set(key, task);
                task.catch(() => this.cache.delete(key));
            }
            const result = await runTranslationTasks([() => task]);
            if (this.active && version === this.version && original.isConnected) { this.render(original, text, result[0]); }
        } catch {
            if (this.active && version === this.version && original.isConnected) {
                this.render(original, text, '这段没翻译成功 · 点击重试');
                const row = this.rows.get(original);
                if (row) {
                    row.node.classList.add('study-page-error');
                    row.node.onclick = () => { void this.translateNode(original); };
                    original.classList.remove('study-original-hidden');
                }
            }
        } finally { this.pending.delete(original); }
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
            for (const record of records) {
                const root = record.target instanceof Element ? record.target : record.target.parentElement;
                if (!root || root.closest(SKIP)) { continue; }
                if (this.rows.has(root) && this.rows.get(root)?.text !== this.source(root)) { this.restore(root); }
                for (const node of record.addedNodes) {
                    if (node instanceof Element && !node.closest(SKIP)) {
                        this.scan(node);
                    }
                }
                if (record.type === 'characterData' || [...record.addedNodes].some((n) => n.nodeType === Node.TEXT_NODE)) { this.scan(root); }
            }
        });
        this.mo.observe(document.body, {childList: true, subtree: true, characterData: true});
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
    const auto = query('page-auto');
    const site = query('page-site');
    const sites = /** @type {HTMLTextAreaElement|null} */ (root.querySelector('#page-sites'));
    const marks = query('page-marks');
    const video = query('page-video');
    const button = root.querySelector('#page-toggle');
    const host = tab?.url && /^https?:/.test(tab.url) ? new URL(tab.url).hostname : '';
    const paint = async () => {
        const prefs = await readPagePrefs();
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
                button.textContent = r.error || (r.active ? '显示原文' : '翻译本页');
            }, () => {
                button.textContent = '请先刷新这个网页';
            });
        }
    });
    if (tab?.id && button) {
        void chrome.tabs.sendMessage(tab.id, {studyPage: 'state'}, {frameId: 0}).then((/** @type {{active:boolean}} */ r) => {
            button.textContent = r.active ? '显示原文' : '翻译本页';
        }, () => {});
    }
    chrome.storage.onChanged.addListener(() => { void paint(); });
    await paint();
}
