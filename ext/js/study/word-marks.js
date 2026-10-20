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

/*
 * Quiet marks on words the learner has saved, on any page. It uses the CSS Custom
 * Highlight API, so the page's text nodes, layout and selection stay untouched:
 * learning words get a thin dotted underline, words already used in stage-3 cards a
 * fainter solid one. Inputs, editors, code and our own learning UI are skipped.
 */
import {safePerformance} from '../core/safe-performance.js';
import {WORD_MARKS_KEY, WORD_STATUS_KEY} from './study-data.js';

const STYLE_ID = 'study-word-marks-style';
const STYLE = `
::highlight(study-learning){text-decoration:underline dotted 1.5px rgb(217 169 28 / 85%);text-underline-offset:3px}
::highlight(study-known){text-decoration:underline solid 1px rgb(63 140 90 / 45%);text-underline-offset:3px}
`;
const MAX_RANGES = 6000;
const SKIP = 'script,style,noscript,textarea,input,select,option,code,pre,kbd,samp,svg,math,[contenteditable=""],[contenteditable="true"],.scan-disable,#study-yt-panel';
const WORD = /[A-Za-z][A-Za-z'’-]*[A-Za-z]/g;

/**
 * The saved word a page token belongs to, using simple English inflections.
 * @param {string} token
 * @param {Record<string, string>} words lowercase word -> status
 * @returns {string} '' when the token is not a saved word.
 */
export function statusFor(token, words) {
    const word = token.toLowerCase().replaceAll('’', '\'');
    if (Object.hasOwn(words, word)) { return words[word]; }
    /** @type {string[]} */
    const bases = [];
    const strip = (/** @type {string} */ suffix, /** @type {string} */ add = '') => {
        if (word.length > suffix.length + 2 && word.endsWith(suffix)) { bases.push(word.slice(0, -suffix.length) + add); }
    };
    for (const [suffix, add] of [['\'s', ''], ['ies', 'y'], ['ied', 'y'], ['ier', 'y'], ['iest', 'y'], ['es', ''], ['s', ''], ['ed', ''], ['ed', 'e'], ['d', ''], ['ing', ''], ['ing', 'e'], ['er', ''], ['est', ''], ['ly', '']]) {
        strip(suffix, add);
    }
    // running -> run, stopped -> stop
    bases.push(...bases.filter((base) => /([b-df-hj-np-tv-z])\1$/.test(base)).map((base) => base.slice(0, -1)));
    for (const base of bases) {
        if (Object.hasOwn(words, base)) { return words[base]; }
    }
    return '';
}

/**
 * @param {string} host
 * @param {string[]} excluded
 * @returns {boolean}
 */
export function siteExcluded(host, excluded) {
    return excluded.some((rule) => {
        const domain = rule.trim().toLowerCase().replace(/^\*\./, '');
        return domain.length > 0 && (host === domain || host.endsWith(`.${domain}`));
    });
}

export class WordMarks {
    constructor() {
        /** @type {Record<string, string>} */
        this._words = {};
        /** @type {Map<Text, Range[]>} */
        this._ranges = new Map();
        /** @type {(Node|TreeWalker)[]} Nodes to scan, or walkers paused mid-way. */
        this._queue = [];
        /** @type {boolean} */
        this._prune = false;
        /** @type {number} */
        this._count = 0;
        /** @type {boolean} */
        this._enabled = false;
        /** @type {MutationObserver|null} */
        this._observer = null;
        /** @type {number} */
        this._timer = 0;
        /** @type {{learning: Highlight, known: Highlight}|null} */
        this._highlights = null;
    }

    /** */
    async start() {
        const registry = /** @type {{highlights?: Map<string, Highlight>}} */ (/** @type {unknown} */ (globalThis.CSS));
        if (!registry?.highlights || typeof Highlight !== 'function' || typeof chrome === 'undefined' || !chrome.storage?.local) { return; }
        await this._load();
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && (changes[WORD_STATUS_KEY] || changes[WORD_MARKS_KEY])) { void this._load(); }
        });
    }

    /** Reads the switch, the excluded sites and the word list, then rebuilds. */
    async _load() {
        const stored = /** @type {Record<string, unknown>} */ (await chrome.storage.local.get([WORD_MARKS_KEY, WORD_STATUS_KEY]));
        const marks = /** @type {{enabled?: unknown, excluded?: unknown}|undefined} */ (stored[WORD_MARKS_KEY]);
        const status = /** @type {{words?: unknown}|undefined} */ (stored[WORD_STATUS_KEY]);
        const excluded = Array.isArray(marks?.excluded) ? marks.excluded.filter((item) => typeof item === 'string') : [];
        const words = status?.words && typeof status.words === 'object' ? /** @type {Record<string, string>} */ (status.words) : {};
        this._enabled = marks?.enabled !== false && Object.keys(words).length > 0 && !siteExcluded(location.hostname, excluded);
        this._words = words;
        this._reset();
        if (!this._enabled || !document.body) { return; }
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = STYLE;
            (document.head ?? document.documentElement).append(style);
        }
        const registry = /** @type {{highlights: Map<string, Highlight>}} */ (/** @type {unknown} */ (CSS));
        this._highlights = {learning: new Highlight(), known: new Highlight()};
        registry.highlights.set('study-learning', this._highlights.learning);
        registry.highlights.set('study-known', this._highlights.known);
        this._observer = new MutationObserver((records) => {
            for (const record of records) {
                if (record.type === 'characterData') {
                    this._queue.push(record.target);
                } else {
                    this._queue.push(...record.addedNodes);
                    if (record.removedNodes.length > 0) { this._prune = true; }
                }
            }
            this._schedule();
        });
        this._observer.observe(document.body, {childList: true, subtree: true, characterData: true});
        this._queue.push(document.body);
        this._schedule();
    }

    /** */
    _reset() {
        this._observer?.disconnect();
        this._observer = null;
        this._queue = [];
        this._ranges.clear();
        this._count = 0;
        if (this._highlights) {
            this._highlights.learning.clear();
            this._highlights.known.clear();
        }
    }

    /** Works in idle slices so long pages never stall scrolling or typing. */
    _schedule() {
        if (this._timer) { return; }
        const run = (/** @type {{timeRemaining?: () => number}} */ deadline) => {
            this._timer = 0;
            const until = safePerformance.now() + Math.max(4, Math.min(12, deadline?.timeRemaining?.() ?? 8));
            if (this._prune) {
                this._prune = false;
                for (const text of this._ranges.keys()) {
                    if (!text.isConnected) { this._forget(text); }
                }
            }
            while (this._queue.length > 0 && safePerformance.now() < until && this._count < MAX_RANGES) {
                const item = /** @type {Node|TreeWalker} */ (this._queue.shift());
                this._scan(item, until);
            }
            if (this._queue.length > 0 && this._count < MAX_RANGES) { this._schedule(); }
        };
        this._timer = typeof requestIdleCallback === 'function' ? requestIdleCallback(run, {timeout: 800}) : window.setTimeout(() => run({}), 50);
    }

    /**
     * @param {Node|TreeWalker} item
     * @param {number} until
     */
    _scan(item, until) {
        if (!this._highlights) { return; }
        let walker;
        if (item instanceof TreeWalker) {
            walker = item;
        } else {
            if (!item.isConnected) { return; }
            if (item.nodeType === Node.TEXT_NODE) {
                this._mark(/** @type {Text} */ (item));
                return;
            }
            if (!(item instanceof Element) || item.closest(SKIP)) { return; }
            walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
                acceptNode: (node) => (node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
            });
        }
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            this._mark(/** @type {Text} */ (node));
            // Large pages continue from exactly here in the next idle slice.
            if (safePerformance.now() >= until || this._count >= MAX_RANGES) {
                this._queue.unshift(walker);
                return;
            }
        }
    }

    /** @param {Text} node */
    _mark(node) {
        const highlights = this._highlights;
        if (!highlights || node.parentElement?.closest(SKIP)) { return; }
        this._forget(node);
        const text = node.data;
        if (text.length < 2 || !/[A-Za-z]/.test(text)) { return; }
        /** @type {Range[]} */
        const ranges = [];
        for (const match of text.matchAll(WORD)) {
            const status = statusFor(match[0], this._words);
            if (!status) { continue; }
            const range = new Range();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            (status === 'known' ? highlights.known : highlights.learning).add(range);
            ranges.push(range);
            if (++this._count >= MAX_RANGES) { break; }
        }
        if (ranges.length > 0) { this._ranges.set(node, ranges); }
    }

    /** @param {Node} node */
    _forget(node) {
        const highlights = this._highlights;
        if (!highlights) { return; }
        const drop = (/** @type {Text} */ text) => {
            for (const range of this._ranges.get(text) ?? []) {
                highlights.learning.delete(range);
                highlights.known.delete(range);
                --this._count;
            }
            this._ranges.delete(text);
        };
        if (node.nodeType === Node.TEXT_NODE) {
            drop(/** @type {Text} */ (node));
            return;
        }
        for (const text of this._ranges.keys()) {
            if (!text.isConnected || node.contains(text)) { drop(text); }
        }
    }
}

/**
 * Starts page colouring once per top-level page.
 * @returns {WordMarks}
 */
export function startWordMarks() {
    const marks = new WordMarks();
    void marks.start();
    return marks;
}
