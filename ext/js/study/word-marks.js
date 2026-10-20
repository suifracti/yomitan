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
 * Highlight API, so the page's text nodes, layout and selection stay untouched.
 * Tiers (see docs/roadmap-2026-10.md, libraryWordStatus v2): learning and new get a
 * thin dotted amber underline, shaky a light red one, familiar a very faint line,
 * partly known words (some senses still in progress) a faint dotted grey one;
 * fully known words are left alone. Saved phrases (run into) are marked as a whole.
 * Optional extras: a one-line gloss after resting the pointer on a mark, and a local
 * count of how often learning words are met in the wild (no URLs or sentences kept).
 * Inputs, editors, code and our own learning UI are skipped.
 */
import {safePerformance} from '../core/safe-performance.js';
import {WORD_MARKS_KEY, WORD_STATUS_KEY} from './study-data.js';

export const ENCOUNTERS_KEY = 'studyEncounters';

const STYLE_ID = 'study-word-marks-style';
const TIP_ID = 'study-word-gloss';
const STYLE = `
::highlight(study-learning){text-decoration:underline dotted 1.5px rgb(217 169 28 / 85%);text-underline-offset:3px}
::highlight(study-shaky){text-decoration:underline dotted 1.5px rgb(214 92 72 / 75%);text-underline-offset:3px}
::highlight(study-familiar){text-decoration:underline solid 1px rgb(63 140 90 / 28%);text-underline-offset:3px}
::highlight(study-partial){text-decoration:underline dotted 1px rgb(120 120 120 / 45%);text-underline-offset:3px}
#${TIP_ID}{position:fixed;z-index:2147483000;max-width:280px;padding:3px 8px;border-radius:6px;background:rgb(28 28 30 / 92%);color:#f4f1ea;font:13px/1.4 -apple-system,'PingFang SC',sans-serif;pointer-events:none;box-shadow:0 2px 8px rgb(0 0 0 / 25%)}
#${TIP_ID}[hidden]{display:none}
`;
const MAX_RANGES = 6000;
const SKIP = 'script,style,noscript,textarea,input,select,option,code,pre,kbd,samp,svg,math,[contenteditable=""],[contenteditable="true"],.scan-disable,#study-yt-panel';
const WORD = /[A-Za-z][A-Za-z'’-]*[A-Za-z]/g;
/** @type {Record<string, 'learning'|'shaky'|'familiar'|'partial'|''>} Highlight for each status; '' = not marked. */
const TIER_OF = {new: 'learning', learning: 'learning', shaky: 'shaky', familiar: 'familiar', partial: 'partial', known: ''};
/** Statuses that count as "still learning" for encounters. */
const COUNTED = new Set(['new', 'learning', 'shaky', 'partial']);

/** @typedef {{s: string, gloss?: string, iv?: number, lapses?: number, senses?: number}} WordInfo */
/** @typedef {{learning: boolean, shaky: boolean, familiar: boolean, partial: boolean}} Tiers */

/**
 * Old lists store a plain status string; v2 stores an object.
 * @param {unknown} value
 * @returns {WordInfo|null}
 */
export function normalizeInfo(value) {
    if (typeof value === 'string') {
        // v1 "known" meant a stage-3 card existed; senses were not tracked, so treat it as fully known.
        return value ? {s: value} : null;
    }
    if (value && typeof value === 'object' && typeof (/** @type {{s?: unknown}} */ (value)).s === 'string') {
        const info = /** @type {WordInfo} */ (value);
        return {...info, gloss: typeof info.gloss === 'string' ? info.gloss.slice(0, 40) : void 0};
    }
    return null;
}

// Common irregular forms -> base (past and past participle), space-separated pairs.
const IRREGULAR = new Map(`ran:run run:run went:go gone:go came:come took:take taken:take made:make got:get gotten:get gave:give given:give
saw:see seen:see knew:know known:know thought:think brought:bring bought:buy caught:catch taught:teach fought:fight sought:seek
found:find told:tell sold:sell held:hold stood:stand understood:understand left:leave felt:feel kept:keep slept:sleep met:meet
meant:mean sent:send spent:spend built:build lent:lend lost:lose paid:pay said:say laid:lay led:lead read:read heard:hear
wrote:write written:write rode:ride ridden:ride drove:drive driven:drive rose:rise risen:rise broke:break broken:break spoke:speak
spoken:speak chose:choose chosen:choose froze:freeze frozen:freeze woke:wake woken:wake began:begin begun:begin drank:drink drunk:drink
sang:sing sung:sing swam:swim swum:swim rang:ring rung:ring sank:sink sunk:sink ate:eat eaten:eat fell:fall fallen:fall
forgot:forget forgotten:forget got:get grew:grow grown:grow threw:throw thrown:throw blew:blow blown:blow flew:fly flown:fly
drew:draw drawn:draw wore:wear worn:wear tore:tear torn:tear bore:bear borne:bear swore:swear sworn:swear hid:hide hidden:hide
bit:bite bitten:bite shook:shake shaken:shake struck:strike stuck:stick sat:sit won:win hung:hang dug:dig fed:feed fled:flee
bled:bleed bred:breed led:lead shot:shoot lit:light slid:slide spun:spin stole:steal stolen:steal mistook:mistake undertook:undertake
overcame:overcome withdrew:withdraw was:be were:be been:be had:have did:do done:do children:child men:man women:woman
people:person feet:foot teeth:tooth mice:mouse geese:goose better:good best:good worse:bad worst:bad`.split(/\s+/).map((pair) => /** @type {[string, string]} */ (pair.split(':'))));

/**
 * The token itself and the simple English base forms it may come from.
 * @param {string} token
 * @returns {string[]}
 */
export function wordForms(token) {
    const word = token.toLowerCase().replaceAll('’', '\'');
    const forms = [word];
    const irregular = IRREGULAR.get(word);
    if (irregular && irregular !== word) { forms.push(irregular); }
    const strip = (/** @type {string} */ suffix, /** @type {string} */ add = '') => {
        if (word.length > suffix.length + 2 && word.endsWith(suffix)) { forms.push(word.slice(0, -suffix.length) + add); }
    };
    for (const [suffix, add] of [['\'s', ''], ['ies', 'y'], ['ied', 'y'], ['ier', 'y'], ['iest', 'y'], ['es', ''], ['s', ''], ['ed', ''], ['ed', 'e'], ['d', ''], ['ing', ''], ['ing', 'e'], ['er', ''], ['est', ''], ['ly', '']]) {
        strip(suffix, add);
    }
    // running -> run, stopped -> stop
    forms.push(...forms.filter((base) => /([b-df-hj-np-tv-z])\1$/.test(base)).map((base) => base.slice(0, -1)));
    return forms;
}

/**
 * The saved word a page token belongs to, using simple English inflections.
 * @param {string} token
 * @param {Record<string, unknown>} words lowercase word -> status (string) or WordInfo
 * @returns {string} The stored status, '' when the token is not a saved word.
 */
export function statusFor(token, words) {
    return wordInfo(token, words)?.s ?? '';
}

/**
 * @param {string} token
 * @param {Record<string, unknown>} words
 * @returns {(WordInfo & {word: string})|null}
 */
export function wordInfo(token, words) {
    for (const form of wordForms(token)) {
        if (Object.hasOwn(words, form)) {
            const info = normalizeInfo(words[form]);
            if (info) { return {...info, word: form}; }
        }
    }
    return null;
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

/**
 * Short, non-reversible tag for a site, so encounter counts never store domains.
 * @param {string} host
 * @returns {string}
 */
export function siteTag(host) {
    let hash = 0x811C9DC5;
    for (const char of host) {
        hash ^= char.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

/**
 * @param {Date} date
 * @returns {string}
 */
function day(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Adds one page's sightings to the stored counts and drops days older than 30.
 * @param {Record<string, {days?: Record<string, {n: number, sites: string[]}>}>} all
 * @param {string[]} words
 * @param {string} site
 * @param {Date} [now]
 * @returns {Record<string, {days: Record<string, {n: number, sites: string[]}>}>}
 */
export function addEncounters(all, words, site, now = new Date()) {
    const today = day(now);
    const oldest = day(new Date(now.getTime() - 30 * 86400000));
    /** @type {Record<string, {days: Record<string, {n: number, sites: string[]}>}>} */
    const next = {};
    for (const [word, row] of Object.entries(all)) {
        const days = Object.fromEntries(Object.entries(row?.days ?? {}).filter(([key]) => key >= oldest));
        if (Object.keys(days).length > 0) { next[word] = {days}; }
    }
    for (const word of words) {
        const days = next[word]?.days ?? {};
        const entry = days[today] ?? {n: 0, sites: []};
        entry.n += 1;
        if (!entry.sites.includes(site) && entry.sites.length < 20) { entry.sites.push(site); }
        days[today] = entry;
        next[word] = {days};
    }
    return next;
}

/**
 * How often a word was met recently, for the word card.
 * @param {Record<string, {days?: Record<string, {n: number, sites: string[]}>}>} all
 * @param {string} word
 * @param {number} [span] days
 * @param {Date} [now]
 * @returns {{times: number, sites: number}}
 */
export function recentEncounters(all, word, span = 7, now = new Date()) {
    const oldest = day(new Date(now.getTime() - (span - 1) * 86400000));
    let times = 0;
    const sites = new Set();
    for (const [key, entry] of Object.entries(all[word.toLowerCase()]?.days ?? {})) {
        if (key < oldest) { continue; }
        times += entry.n;
        for (const site of entry.sites) { sites.add(site); }
    }
    return {times, sites: sites.size};
}

export class WordMarks {
    constructor() {
        /** @type {Record<string, unknown>} */
        this._words = {};
        /** @type {Map<string, {rest: string[], key: string, info: WordInfo}[]>} Saved phrases by their first word. */
        this._phrases = new Map();
        /** @type {Map<Text, Range[]>} */
        this._ranges = new Map();
        /** @type {WeakMap<Range, {word: string, gloss: string}>} */
        this._rangeInfo = new WeakMap();
        /** @type {(Node|TreeWalker)[]} Nodes to scan, or walkers paused mid-way. */
        this._queue = [];
        /** @type {boolean} */
        this._prune = false;
        /** @type {number} */
        this._count = 0;
        /** @type {boolean} */
        this._enabled = false;
        /** @type {Tiers} */
        this._tiers = {learning: true, shaky: true, familiar: true, partial: true};
        /** @type {boolean} */
        this._hover = true;
        /** @type {boolean} */
        this._encounters = true;
        /** @type {Set<string>} Learning words already counted on this page. */
        this._met = new Set();
        /** @type {string[]} */
        this._pendingMet = [];
        /** @type {number} */
        this._metTimer = 0;
        /** @type {MutationObserver|null} */
        this._observer = null;
        /** @type {number} */
        this._timer = 0;
        /** @type {Record<string, Highlight>|null} */
        this._highlights = null;
        /** @type {HTMLElement|null} */
        this._tip = null;
        /** @type {number} */
        this._tipTimer = 0;
        /** @type {boolean} */
        this._hoverBound = false;
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

    /** Reads the switches, the excluded sites and the word list, then rebuilds. */
    async _load() {
        const stored = /** @type {Record<string, unknown>} */ (await chrome.storage.local.get([WORD_MARKS_KEY, WORD_STATUS_KEY]));
        const marks = /** @type {{enabled?: unknown, excluded?: unknown, tiers?: Partial<Tiers>, hover?: unknown, encounters?: unknown}|undefined} */ (stored[WORD_MARKS_KEY]);
        const status = /** @type {{words?: unknown, phrases?: unknown}|undefined} */ (stored[WORD_STATUS_KEY]);
        const excluded = Array.isArray(marks?.excluded) ? marks.excluded.filter((item) => typeof item === 'string') : [];
        const words = status?.words && typeof status.words === 'object' ? /** @type {Record<string, unknown>} */ (status.words) : {};
        const phrases = status?.phrases && typeof status.phrases === 'object' ? /** @type {Record<string, unknown>} */ (status.phrases) : {};
        this._tiers = {learning: true, shaky: true, familiar: true, partial: true};
        for (const key of /** @type {(keyof Tiers)[]} */ (['learning', 'shaky', 'familiar', 'partial'])) {
            if (typeof marks?.tiers?.[key] === 'boolean') { this._tiers[key] = marks.tiers[key]; }
        }
        this._hover = marks?.hover !== false;
        this._encounters = marks?.encounters !== false;
        this._enabled = marks?.enabled !== false && Object.keys(words).length + Object.keys(phrases).length > 0 && !siteExcluded(location.hostname, excluded);
        this._words = words;
        this._phrases = new Map();
        for (const [key, value] of Object.entries(phrases)) {
            const info = normalizeInfo(value);
            const parts = key.toLowerCase().split(/\s+/).filter(Boolean);
            if (!info || parts.length < 2) { continue; }
            const list = this._phrases.get(parts[0]) ?? [];
            list.push({rest: parts.slice(1), key, info});
            this._phrases.set(parts[0], list);
        }
        this._reset();
        if (!this._enabled || !document.body) { return; }
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = STYLE;
            (document.head ?? document.documentElement).append(style);
        }
        const registry = /** @type {{highlights: Map<string, Highlight>}} */ (/** @type {unknown} */ (CSS));
        this._highlights = {learning: new Highlight(), shaky: new Highlight(), familiar: new Highlight(), partial: new Highlight()};
        for (const [name, highlight] of Object.entries(this._highlights)) { registry.highlights.set(`study-${name}`, highlight); }
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
        if (this._hover && !this._hoverBound) { this._bindHover(); }
    }

    /** */
    _reset() {
        this._observer?.disconnect();
        this._observer = null;
        this._queue = [];
        this._ranges.clear();
        this._count = 0;
        if (this._highlights) {
            for (const highlight of Object.values(this._highlights)) { highlight.clear(); }
        }
        this._hideTip();
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

    /**
     * @param {WordInfo} info
     * @returns {Highlight|null}
     */
    _highlightFor(info) {
        const tier = TIER_OF[info.s] ?? 'learning';
        return tier && this._tiers[tier] && this._highlights ? this._highlights[tier] : null;
    }

    /** @param {Text} node */
    _mark(node) {
        if (!this._highlights || node.parentElement?.closest(SKIP)) { return; }
        this._forget(node);
        const text = node.data;
        if (text.length < 2 || !/[A-Za-z]/.test(text)) { return; }
        const tokens = [...text.matchAll(WORD)];
        /** @type {Range[]} */
        const ranges = [];
        /**
         * @param {number} start
         * @param {number} end
         * @param {WordInfo} info
         * @param {string} word
         */
        const add = (start, end, info, word) => {
            if (COUNTED.has(info.s)) { this._meet(word); }
            const highlight = this._highlightFor(info);
            if (!highlight) { return; }
            const range = new Range();
            range.setStart(node, start);
            range.setEnd(node, end);
            highlight.add(range);
            if (info.gloss) { this._rangeInfo.set(range, {word, gloss: info.gloss}); }
            ranges.push(range);
            ++this._count;
        };
        for (let i = 0; i < tokens.length && this._count < MAX_RANGES; ++i) {
            const token = tokens[i];
            const start = /** @type {number} */ (token.index);
            // A saved phrase (run into, ran into) is marked as one piece.
            const phrase = this._phraseAt(tokens, i, text);
            if (phrase) {
                const last = tokens[i + phrase.length - 1];
                add(start, /** @type {number} */ (last.index) + last[0].length, phrase.info, phrase.key);
                i += phrase.length - 1;
                continue;
            }
            const info = wordInfo(token[0], this._words);
            if (info) { add(start, start + token[0].length, info, info.word); }
        }
        if (ranges.length > 0) { this._ranges.set(node, ranges); }
    }

    /**
     * @param {RegExpMatchArray[]} tokens
     * @param {number} i
     * @param {string} text
     * @returns {{length: number, key: string, info: WordInfo}|null}
     */
    _phraseAt(tokens, i, text) {
        if (this._phrases.size === 0) { return null; }
        for (const form of wordForms(tokens[i][0])) {
            for (const candidate of this._phrases.get(form) ?? []) {
                const matched = candidate.rest.every((part, offset) => {
                    const next = tokens[i + offset + 1];
                    const previous = tokens[i + offset];
                    if (!next || next[0].toLowerCase() !== part) { return false; }
                    const gap = text.slice(/** @type {number} */ (previous.index) + previous[0].length, next.index);
                    return /^[\s-]{1,3}$/.test(gap);
                });
                if (matched) { return {length: candidate.rest.length + 1, key: candidate.key, info: candidate.info}; }
            }
        }
        return null;
    }

    /** @param {Node} node */
    _forget(node) {
        const highlights = this._highlights;
        if (!highlights) { return; }
        const drop = (/** @type {Text} */ text) => {
            for (const range of this._ranges.get(text) ?? []) {
                for (const highlight of Object.values(highlights)) { highlight.delete(range); }
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

    /**
     * Counts a learning word once per page; written in small batches.
     * @param {string} word
     */
    _meet(word) {
        if (!this._encounters || this._met.has(word)) { return; }
        this._met.add(word);
        this._pendingMet.push(word);
        if (this._metTimer) { return; }
        this._metTimer = window.setTimeout(() => {
            this._metTimer = 0;
            const words = this._pendingMet.splice(0);
            void chrome.storage.local.get(ENCOUNTERS_KEY).then((stored) => {
                const all = /** @type {Record<string, {days?: Record<string, {n: number, sites: string[]}>}>} */ (stored[ENCOUNTERS_KEY] ?? {});
                return chrome.storage.local.set({[ENCOUNTERS_KEY]: addEncounters(all, words, siteTag(location.hostname))});
            }).catch(() => {});
        }, 4000);
    }

    /** A one-line gloss after the pointer rests on a mark; any key, click or scroll hides it. */
    _bindHover() {
        this._hoverBound = true;
        let x = 0;
        let y = 0;
        document.addEventListener('pointermove', (event) => {
            if (!this._hover || !this._enabled) { return; }
            if (Math.abs(event.clientX - x) + Math.abs(event.clientY - y) > 6) { this._hideTip(); }
            x = event.clientX;
            y = event.clientY;
            clearTimeout(this._tipTimer);
            this._tipTimer = window.setTimeout(() => this._showTipAt(x, y), 600);
        }, {passive: true});
        for (const type of ['pointerdown', 'keydown', 'scroll', 'blur']) {
            window.addEventListener(type, () => {
                clearTimeout(this._tipTimer);
                this._hideTip();
            }, {capture: true, passive: true});
        }
    }

    /**
     * @param {number} x
     * @param {number} y
     */
    _showTipAt(x, y) {
        const position = /** @type {{caretPositionFromPoint?: (x: number, y: number) => {offsetNode: Node, offset: number}|null}} */ (/** @type {unknown} */ (document)).caretPositionFromPoint?.(x, y);
        const node = position?.offsetNode;
        if (!node || node.nodeType !== Node.TEXT_NODE) { return; }
        const range = (this._ranges.get(/** @type {Text} */ (node)) ?? []).find((item) => item.startOffset <= position.offset && position.offset <= item.endOffset);
        const info = range ? this._rangeInfo.get(range) : void 0;
        if (!range || !info) { return; }
        const box = range.getBoundingClientRect();
        if (x < box.left - 2 || x > box.right + 2 || y < box.top - 2 || y > box.bottom + 2) { return; }
        if (!this._tip?.isConnected) {
            this._tip = document.createElement('div');
            this._tip.id = TIP_ID;
            this._tip.className = 'scan-disable';
            this._tip.setAttribute('aria-hidden', 'true');
            document.documentElement.append(this._tip);
        }
        this._tip.textContent = `${info.word} · ${info.gloss}`;
        this._tip.hidden = false;
        const top = box.bottom + 6 + 28 > innerHeight ? box.top - 30 : box.bottom + 6;
        Object.assign(this._tip.style, {left: `${Math.max(4, Math.min(innerWidth - 284, box.left))}px`, top: `${top}px`});
    }

    /** */
    _hideTip() {
        if (this._tip) { this._tip.hidden = true; }
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
