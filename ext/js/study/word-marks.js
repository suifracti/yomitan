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
import './study-ui.js';
import {readResponseJson} from '../core/json.js';
import {FUNCTION_WORDS} from './caption-sidebar.js';
import {studyCall} from './study-client.js';
import {youtubeStudyContext} from './youtube-study-context.js';
import {safePerformance} from '../core/safe-performance.js';
import {WORD_MARKS_KEY, WORD_STATUS_KEY} from './study-data.js';

export const ENCOUNTERS_KEY = 'studyEncounters';

const STYLE_ID = 'study-word-marks-style';
const TIP_ID = 'study-word-gloss';
const STYLE = `
::highlight(study-possible){text-decoration:underline dashed 1px rgb(130 140 160 / 28%);text-underline-offset:3px}
::highlight(study-learning){text-decoration:underline dotted 1.5px rgb(217 169 28 / 85%);text-underline-offset:3px}
::highlight(study-shaky){text-decoration:underline dotted 1.5px rgb(214 92 72 / 75%);text-underline-offset:3px}
::highlight(study-familiar){text-decoration:underline solid 1px rgb(63 140 90 / 28%);text-underline-offset:3px}
::highlight(study-partial){text-decoration:underline dotted 1px rgb(120 120 120 / 45%);text-underline-offset:3px}
#${TIP_ID}{position:fixed;z-index:2147483000;max-width:280px;padding:3px 8px;border-radius:6px;background:rgb(28 28 30 / 92%);color:#f4f1ea;font:13px/1.4 -apple-system,'PingFang SC',sans-serif;pointer-events:auto;box-shadow:0 2px 8px rgb(0 0 0 / 25%)}
#${TIP_ID} button{font:inherit;color:inherit;background:none;border:1px solid #777;border-radius:4px;margin-left:6px;padding:2px 5px;cursor:pointer}
#${TIP_ID}[hidden]{display:none}
`;
const MAX_RANGES = 6000;
const VIDEO_UI = '#movie_player,#study-yt-overlay,#study-yt-reader,#study-web-layer,#study-web-dock,video,.html5-video-player';
const SKIP = 'script,style,noscript,textarea,input,select,option,code,pre,kbd,samp,svg,math,[contenteditable=""],[contenteditable="true"],.scan-disable,#study-yt-panel';
const WORD = /[A-Za-z][A-Za-z'’-]*[A-Za-z]/g;
/** @type {Record<string, 'learning'|'shaky'|'familiar'|'partial'|'possible'|''>} Highlight for each status; '' = not marked. */
const TIER_OF = {new: 'learning', learning: 'learning', shaky: 'shaky', familiar: 'familiar', partial: 'partial', known: '', ignored: '', possible: 'possible'};
/** Statuses that count as "still learning" for encounters. */
const COUNTED = new Set(['new', 'learning', 'shaky', 'partial']);

/** @typedef {{s: string, gloss?: string, iv?: number, lapses?: number, senses?: number, newSense?: boolean, manualKnown?: boolean}} WordInfo */
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
    if (value && typeof value === 'object' && typeof (/** @type {{s?: unknown}} */(value)).s === 'string') {
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
    if (irregular && irregular !== word) {
        forms.push(irregular);
    }
    const strip = (/** @type {string} */ suffix, /** @type {string} */ add = '') => {
        if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
            forms.push(word.slice(0, -suffix.length) + add);
        }
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
            if (info) {
                return {...info, word: form};
            }
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
        if (Object.keys(days).length > 0) {
            next[word] = {days};
        }
    }
    for (const word of words) {
        const days = next[word]?.days ?? {};
        const entry = days[today] ?? {n: 0, sites: []};
        entry.n += 1;
        if (!entry.sites.includes(site) && entry.sites.length < 20) {
            entry.sites.push(site);
        }
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
        if (key < oldest) {
            continue;
        }
        times += entry.n;
        for (const site of entry.sites) {
            sites.add(site);
        }
    }
    return {times, sites: sites.size};
}

/** @typedef {{word:string,sentence:string,meaning:string}} PageWord */
/** @typedef {PageWord & {node:Text,box?:HTMLInputElement,ignored?:boolean}} PageCandidate */
/** @typedef {{known:string[],ignored:string[]}} KnownWords */
export class WordMarks {
    constructor() {
        /** @type {Record<string, unknown>} */
        this._words = {};
        /** @type {Record<string,[number,number]>} */
        this._levels = {};
        /** @type {Record<string,string>} */
        this._glosses = {};
        /**
         *
         */
        this._level = 2;
        /**
         *
         */
        this._possible = true;
        /**
         *
         */
        this._shortcuts = true;
        /**
         *
         */
        this._levelsLoaded = false;
        /**
         *
         */
        this._glossesLoaded = false;
        /** @type {Map<string,PageCandidate>} */
        this._candidates = new Map();
        /**
         *
         */
        this._hoverPoint = {x: 0, y: 0};
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
        const registry = /** @type {{highlights?: Map<string, Highlight>}} */ (/** @type {unknown} */(globalThis.CSS));
        if (!registry?.highlights || typeof Highlight !== 'function' || typeof chrome === 'undefined' || !chrome.storage?.local) {
            return;
        }
        await this._load();
        chrome.runtime.onMessage?.addListener((message, _sender, reply) => {
            if (!message.studyPageWords) {
                return;
            }
            if (message.studyPageWords === 'open') {
                void this.openPageWords();
            }
            reply({count: this.pageWords().length});
        });
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && (changes[WORD_STATUS_KEY] || changes[WORD_MARKS_KEY] || changes.studyKnownWords)) {
                void this._load();
            }
        });
    }

    /** Reads the switches, the excluded sites and the word list, then rebuilds. */
    async _load() {
        const stored = /** @type {Record<string, unknown>} */ (await chrome.storage.local.get([WORD_MARKS_KEY, WORD_STATUS_KEY, 'studyKnownWords']));
        const marks = /** @type {{enabled?: unknown, excluded?: unknown, tiers?: Partial<Tiers>, hover?: unknown, encounters?: unknown,level?:string,possible?:boolean,shortcuts?:boolean}|undefined} */ (stored[WORD_MARKS_KEY]);
        const status = /** @type {{words?: unknown, phrases?: unknown}|undefined} */ (stored[WORD_STATUS_KEY]);
        const excluded = Array.isArray(marks?.excluded) ? marks.excluded.filter((item) => typeof item === 'string') : [];
        const savedWords = status?.words && typeof status.words === 'object' ? /** @type {Record<string, unknown>} */ (status.words) : {};
        const words = {...savedWords};
        const manual = /** @type {KnownWords} */ (stored.studyKnownWords || {known: [], ignored: []});
        for (const word of manual.known) {
            words[word] = {...normalizeInfo(words[word]), s: 'known', manualKnown: true};
        }
        for (const word of manual.ignored) {
            words[word] = {...normalizeInfo(words[word]), s: 'ignored'};
        }
        this._level = (/** @type {Record<string,number>} */({gk: 2, cet4: 3, cet6: 4, ky: 5, ielts: 7}))[marks?.level || 'gk'];
        this._possible = marks?.possible !== false;
        this._shortcuts = marks?.shortcuts !== false;
        const phrases = status?.phrases && typeof status.phrases === 'object' ? /** @type {Record<string, unknown>} */ (status.phrases) : {};
        this._tiers = {learning: true, shaky: true, familiar: true, partial: true};
        for (const key of /** @type {(keyof Tiers)[]} */ (['learning', 'shaky', 'familiar', 'partial'])) {
            if (typeof marks?.tiers?.[key] === 'boolean') {
                this._tiers[key] = marks.tiers[key];
            }
        }
        this._hover = marks?.hover !== false;
        this._encounters = marks?.encounters !== false;
        this._enabled = marks?.enabled !== false && !siteExcluded(location.hostname, excluded);
        this._words = words;
        this._phrases = new Map();
        for (const [key, value] of Object.entries(phrases)) {
            const info = normalizeInfo(value);
            const parts = key.toLowerCase().split(/\s+/).filter(Boolean);
            if (!info || parts.length < 2) {
                continue;
            }
            const list = this._phrases.get(parts[0]) ?? [];
            list.push({rest: parts.slice(1), key, info});
            this._phrases.set(parts[0], list);
        }
        const pageText = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
        let english = false;
        if (this._enabled && this._possible && !this._levelsLoaded) {
            for (let text = pageText.nextNode(); text; text = pageText.nextNode()) {
                if (!text.parentElement?.closest(SKIP) && /[A-Za-z]{2,}/.test(text.textContent || '')) {
                    english = true;
                    break;
                }
            }
        }
        if (english) {
            try {
                this._levels = await readResponseJson(await fetch(chrome.runtime.getURL('data/study/word-levels.json')));
                this._levelsLoaded = true;
            } catch { /* Stored words still work when the bundled level table cannot be read. */ }
        }
        this._reset();
        if (!this._enabled || !document.body) {
            return;
        }
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = STYLE;
            (document.head ?? document.documentElement).append(style);
        }
        const registry = /** @type {{highlights: Map<string, Highlight>}} */ (/** @type {unknown} */(CSS));
        this._highlights = {possible: new Highlight(), learning: new Highlight(), shaky: new Highlight(), familiar: new Highlight(), partial: new Highlight()};
        for (const [name, highlight] of Object.entries(this._highlights)) {
            registry.highlights.set(`study-${name}`, highlight);
        }
        this._observer = new MutationObserver((records) => {
            for (const record of records) {
                if (record.type === 'characterData') {
                    this._queue.push(record.target);
                } else {
                    this._queue.push(...record.addedNodes);
                    if (record.removedNodes.length > 0) {
                        this._prune = true;
                    }
                }
            }
            this._schedule();
        });
        this._observer.observe(document.body, {childList: true, subtree: true, characterData: true});
        this._queue.push(document.body);
        this._schedule();
        if (!this._hoverBound) {
            this._bindHover();
        }
    }

    /** */
    _reset() {
        this._observer?.disconnect();
        this._observer = null;
        this._queue = [];
        this._ranges.clear();
        this._candidates.clear();
        this._count = 0;
        if (this._highlights) {
            for (const highlight of Object.values(this._highlights)) {
                highlight.clear();
            }
        }
        this._hideTip();
    }

    /** Works in idle slices so long pages never stall scrolling or typing. */
    _schedule() {
        if (this._timer) {
            return;
        }
        const run = (/** @type {{timeRemaining?: () => number}} */ deadline) => {
            this._timer = 0;
            const until = safePerformance.now() + Math.max(4, Math.min(12, deadline?.timeRemaining?.() ?? 8));
            if (this._prune) {
                this._prune = false;
                for (const text of this._ranges.keys()) {
                    if (!text.isConnected) {
                        this._forget(text);
                    }
                }
            }
            while (this._queue.length > 0 && safePerformance.now() < until && this._count < MAX_RANGES) {
                const item = /** @type {Node|TreeWalker} */ (this._queue.shift());
                this._scan(item, until);
            }
            if (this._queue.length > 0 && this._count < MAX_RANGES) {
                this._schedule();
            }
        };
        this._timer = typeof requestIdleCallback === 'function' ? requestIdleCallback(run, {timeout: 800}) : window.setTimeout(() => run({}), 50);
    }

    /**
     * @param {Node|TreeWalker} item
     * @param {number} until
     */
    _scan(item, until) {
        if (!this._highlights) {
            return;
        }
        let walker;
        if (item instanceof TreeWalker) {
            walker = item;
        } else {
            if (!item.isConnected) {
                return;
            }
            if (item.nodeType === Node.TEXT_NODE) {
                this._mark(/** @type {Text} */ (item));
                return;
            }
            if (!(item instanceof Element) || item.closest(SKIP)) {
                return;
            }
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
        return tier && (tier === 'possible' ? this._possible : this._tiers[tier]) && this._highlights ? this._highlights[tier] : null;
    }

    /** @param {Text} node */
    _mark(node) {
        if (!this._highlights || node.parentElement?.closest(SKIP)) {
            return;
        }
        this._forget(node);
        const text = node.data;
        if (text.length < 2 || !/[A-Za-z]/.test(text)) {
            return;
        }
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
            if (COUNTED.has(info.s)) {
                this._meet(word);
            }
            const highlight = this._highlightFor(info);
            if (!highlight) {
                return;
            }
            const range = new Range();
            range.setStart(node, start);
            range.setEnd(node, end);
            highlight.add(range);
            this._rangeInfo.set(range, {word, gloss: info.gloss || ''});
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
            let info = wordInfo(token[0], this._words);
            if (!info && this._possible) {
                const word = wordForms(token[0]).find((w) => Object.hasOwn(this._levels, w));
                const level = word ? this._levels[word] : null;
                if (word && level && !FUNCTION_WORDS.has(word) && !FUNCTION_WORDS.has(token[0].toLowerCase()) &&
                (level[0] ? level[0] > this._level : level[1] > 8000)) {
                    info = {word, s: 'possible', gloss: this._glosses[word] || ''};
                    const sentence = this._sentence(node, start);
                    this._candidates.set(word, {word, sentence, meaning: info.gloss || '', node});
                }
            }
            if (info) {
                add(start, start + token[0].length, info, info.word);
            }
        }
        if (ranges.length > 0) {
            this._ranges.set(node, ranges);
        }
    }

    /**
     * @param {RegExpMatchArray[]} tokens
     * @param {number} i
     * @param {string} text
     * @returns {{length: number, key: string, info: WordInfo}|null}
     */
    _phraseAt(tokens, i, text) {
        if (this._phrases.size === 0) {
            return null;
        }
        for (const form of wordForms(tokens[i][0])) {
            for (const candidate of this._phrases.get(form) ?? []) {
                const matched = candidate.rest.every((part, offset) => {
                    const next = tokens[i + offset + 1];
                    const previous = tokens[i + offset];
                    if (!next || next[0].toLowerCase() !== part) {
                        return false;
                    }
                    const gap = text.slice(/** @type {number} */ (previous.index) + previous[0].length, next.index);
                    return /^[\s-]{1,3}$/.test(gap);
                });
                if (matched) {
                    return {length: candidate.rest.length + 1, key: candidate.key, info: candidate.info};
                }
            }
        }
        return null;
    }

    /** @param {Node} node */
    _forget(node) {
        const highlights = this._highlights;
        if (!highlights) {
            return;
        }
        const drop = (/** @type {Text} */ text) => {
            for (const range of this._ranges.get(text) ?? []) {
                for (const highlight of Object.values(highlights)) {
                    highlight.delete(range);
                }
                --this._count;
            }
            this._ranges.delete(text);
        };
        if (node.nodeType === Node.TEXT_NODE) {
            drop(/** @type {Text} */ (node));
            return;
        }
        for (const text of this._ranges.keys()) {
            if (!text.isConnected || node.contains(text)) {
                drop(text);
            }
        }
    }

    /**
     * Counts a learning word once per page; written in small batches.
     * @param {string} word
     */
    _meet(word) {
        if (!this._encounters || this._met.has(word)) {
            return;
        }
        this._met.add(word);
        this._pendingMet.push(word);
        if (this._metTimer) {
            return;
        }
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
            this._hoverPoint = {x: event.clientX, y: event.clientY};
            if (!this._hover || !this._enabled) {
                return;
            }
            if (this._tip && !this._tip.hidden) {
                const box = this._tip.getBoundingClientRect();
                if (event.clientX >= box.left - 12 && event.clientX <= box.right + 12 && event.clientY >= box.top - 12 && event.clientY <= box.bottom + 12) {
                    return;
                }
            }
            if (Math.abs(event.clientX - x) + Math.abs(event.clientY - y) > 6) {
                this._hideTip();
            }
            x = event.clientX;
            y = event.clientY;
            clearTimeout(this._tipTimer);
            this._tipTimer = window.setTimeout(() => this._showTipAt(x, y), 600);
        }, {passive: true});
        document.addEventListener('keydown', (event) => {
            if (!this._shortcuts || !this._enabled || event.ctrlKey || event.altKey || event.metaKey || event.repeat || (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable=false])')) || !['k', 'l', 'i'].includes(event.key.toLowerCase())) {
                return;
            }
            if (document.elementFromPoint(this._hoverPoint.x, this._hoverPoint.y)?.closest(VIDEO_UI)) {
                return;
            }
            const item = this._pointWord(this._hoverPoint.x, this._hoverPoint.y);
            if (!item) {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.key.toLowerCase() === 'l') {
                this._remember([item]);
            } else {
                void this._manualMark(item.word, event.key.toLowerCase() === 'i' ? 'ignored' : 'known');
            }
        }, true);
        for (const type of ['pointerdown', 'keydown', 'scroll', 'blur']) {
            window.addEventListener(type, (event) => {
                if (event.target instanceof Node && this._tip?.contains(event.target) && ['pointerdown', 'keydown'].includes(type)) {
                    return;
                }
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
        const position = /** @type {{caretPositionFromPoint?: (x: number, y: number) => {offsetNode: Node, offset: number}|null}} */ (/** @type {unknown} */(document)).caretPositionFromPoint?.(x, y);
        const node = position?.offsetNode;
        if (!node || node.nodeType !== Node.TEXT_NODE) {
            return;
        }
        const range = (this._ranges.get(/** @type {Text} */ (node)) ?? []).find((item) => item.startOffset <= position.offset && position.offset <= item.endOffset);
        const info = range ? this._rangeInfo.get(range) : void 0;
        if (!range || !info) {
            return;
        }
        const box = range.getBoundingClientRect();
        if (x < box.left - 2 || x > box.right + 2 || y < box.top - 2 || y > box.bottom + 2) {
            return;
        }
        if (!this._tip?.isConnected) {
            this._tip = document.createElement('div');
            this._tip.id = TIP_ID;
            this._tip.className = 'scan-disable';
            this._tip.setAttribute('role', 'dialog');
            this._tip.setAttribute('aria-label', '已保存的词');
            document.documentElement.append(this._tip);
        }
        const known = document.createElement('button');
        known.type = 'button';
        known.textContent = '✓ 认识了';
        known.onclick = () => {
            known.disabled = true;
            void markWordKnown(info.word).catch(() => { known.disabled = false; });
        };
        const lookup = document.createElement('button');
        lookup.type = 'button';
        lookup.textContent = '查词';
        lookup.onclick = () => {
            this._hideTip();
            void youtubeStudyContext.openCard?.(range.cloneRange(), false).catch(() => {});
        };
        const page = document.createElement('button');
        page.type = 'button';
        page.textContent = `本页生词（${this.pageWords().length}）`;
        page.onclick = () => void this.openPageWords();
        const keys = document.createElement('small');
        keys.style.display = 'block';
        keys.textContent = 'K 认识 · L 记住 · I 忽略';
        this._tip.replaceChildren([info.word, info.gloss].filter(Boolean).join(' · '), known, lookup, page, keys);
        this._tip.hidden = false;
        const height = this._tip.getBoundingClientRect().height;
        const top = box.bottom + 6 + height > innerHeight ? Math.max(4, box.top - height - 6) : box.bottom + 6;
        Object.assign(this._tip.style, {left: `${Math.max(4, Math.min(innerWidth - 284, box.left))}px`, top: `${top}px`});
    }

    /**
     *
     * @param {Text} node
     * @param {number} offset
     * @returns {string}
     */
    _sentence(node, offset) {
        const text = node.data;
        const start = Math.max(text.lastIndexOf('.', offset - 1), text.lastIndexOf('!', offset - 1), text.lastIndexOf('?', offset - 1), text.lastIndexOf('\n', offset - 1)) + 1;
        const rest = text.slice(offset).search(/[.!?\n]/);
        return text.slice(start, rest < 0 ? text.length : offset + rest + 1).trim().slice(0, 2400);
    }

    /**
     *
     * @param {number} x
     * @param {number} y
     * @returns {PageWord|null}
     */
    _pointWord(x, y) {
        const position = (/** @type {{caretPositionFromPoint?:(x:number,y:number)=>{offsetNode:Node,offset:number}|null}} */(/** @type {unknown} */(document))).caretPositionFromPoint?.(x, y);
        const node = position?.offsetNode;
        if (!position || !(node instanceof Text) || node.parentElement?.closest(SKIP)) {
            return null;
        }
        const token = [...node.data.matchAll(WORD)].find((m) => m.index <= position.offset && position.offset <= m.index + m[0].length);
        if (!token) {
            return null;
        }
        const range = document.createRange();
        range.setStart(node, token.index);
        range.setEnd(node, token.index + token[0].length);
        const box = range.getBoundingClientRect();
        if (x < box.left || x > box.right || y < box.top || y > box.bottom) {
            return null;
        }
        const word = wordInfo(token[0], this._words)?.word || wordForms(token[0]).find((w) => this._levels[w]) || token[0].toLowerCase();
        return {word, sentence: this._sentence(node, token.index), meaning: this._glosses[word] || ''};
    }

    /**
     *
     */
    /** @returns {PageCandidate[]} */
    pageWords() { return [...this._candidates.values()].filter((r) => r.node.isConnected && !wordInfo(r.word, this._words)); }
    /**
     *
     * @param {string} word
     * @param {'known'|'ignored'} type
     */
    async _manualMark(word, type) {
        const stored = /** @type {KnownWords} */ (await studyCall('knownWords').catch(() => ({known: [], ignored: []})));
        const old = wordInfo(word, this._words);
        try {
            await (type === 'known' ? studyCall('libraryMarkKnown', {word, known: true}) : studyCall('knownWords', {ignored: {add: [word]}}));
            this._notice(type === 'known' ? '已标为认识' : '已忽略', async () => {
                if (type === 'known') {
                    await studyCall('libraryMarkKnown', {word, known: old?.manualKnown === true});
                }
                await studyCall('knownWords', {known: {add: stored.known.includes(word) ? [word] : [], remove: stored.known.includes(word) ? [] : [word]}, ignored: {add: stored.ignored.includes(word) ? [word] : [], remove: stored.ignored.includes(word) ? [] : [word]}});
            });
        } catch (error) {
            this._notice(`没有保存：${error instanceof Error ? error.message : '请重试。'}`);
        }
    }

    /**
     *
     * @param {string} text
     * @param {()=>unknown} [undo]
     * @param {()=>Promise<unknown>} [commit]
     */
    _notice(text, undo, commit) {
        const notice = document.createElement('div');
        notice.className = 'scan-disable';
        notice.setAttribute('role', 'status');
        notice.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);padding:10px 16px;border-radius:8px;background:#263248;color:white;z-index:2147483646;font:14px sans-serif';
        const timer = setTimeout(() => {
            if (commit) {
                notice.textContent = '正在保存笔记…';
                void commit().then(() => notice.remove(), (error) => {
                    notice.textContent = `没有保存：${error instanceof Error ? error.message : '请重试。'}`;
                    setTimeout(() => notice.remove(), 5000);
                });
            } else {
                notice.remove();
            }
        }, 5000);
        notice.append(text);
        if (undo) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = '撤销';
            button.onclick = () => {
                clearTimeout(timer);
                Promise.resolve(undo()).then(() => notice.remove(), (error) => {
                    notice.textContent = `没能撤销：${error instanceof Error ? error.message : '请重试。'}`;
                });
            };
            notice.append(' · ', button);
        }
        document.documentElement.append(notice);
    }

    /**
     *
     * @param {PageWord[]} items
     * @param {()=>unknown} [undo]
     */
    _remember(items, undo = () => {}) {
        this._notice('已记住，5 秒后保存笔记', undo, async () => {
            await studyCall('knownWords', {known: {remove: items.map((r) => r.word)}, ignored: {remove: items.map((r) => r.word)}});
            await studyCall('pageWordsSave', {items: items.map(({word, sentence, meaning}) => ({word, sentence, meaning}))});
        });
    }

    /**
     *
     */
    async openPageWords() {
        if (!this._glossesLoaded) {
            try {
                this._glosses = await readResponseJson(await fetch(chrome.runtime.getURL('data/study/word-glosses.json')));
                this._glossesLoaded = true;
            } catch { /* The list can still show words and their sentences. */ }
        }
        document.getElementById('study-page-words')?.remove();
        const panel = document.createElement('aside');
        panel.id = 'study-page-words';
        panel.className = 'scan-disable st-scope';
        panel.style.cssText = 'position:fixed;right:12px;top:12px;bottom:12px;width:min(380px,calc(100vw - 24px));box-sizing:border-box;overflow:auto;padding:18px;background:var(--st-paper,#fbfaf7);color:var(--st-ink,#263248);border:1px solid #dce2eb;border-radius:12px;z-index:2147483001;font:14px/1.6 sans-serif;box-shadow:0 5px 25px #0003';
        const title = document.createElement('h3');
        title.textContent = `本页生词（${this.pageWords().length}）`;
        const close = document.createElement('button');
        close.textContent = '关闭';
        close.onclick = () => panel.remove();
        const note = document.createElement('p');
        note.textContent = '只勾不认识的，其余会标为认识。忽略的词以后不再提示。';
        panel.append(title, close, note);
        const rows = this.pageWords();
        for (const row of rows) {
            row.meaning = this._glosses[row.word] || row.meaning;
        }
        for (const row of rows) {
            const item = document.createElement('section');
            item.style.cssText = 'padding:10px 0;border-top:1px solid #dce2eb';
            const label = document.createElement('label');
            const box = document.createElement('input');
            box.type = 'checkbox';
            row.box = box;
            label.append(box, `${row.word} · ${row.meaning || '词典暂无简义'}`);
            const sentence = document.createElement('p');
            sentence.textContent = row.sentence;
            sentence.style.cssText = 'font-size:12px;color:#758095';
            const ignore = document.createElement('button');
            ignore.textContent = '忽略';
            ignore.onclick = () => {
                row.ignored = true;
                item.remove();
                void this._manualMark(row.word, 'ignored');
            };
            item.append(label, sentence, ignore);
            panel.append(item);
        }
        const done = document.createElement('button');
        done.textContent = '完成';
        panel.append(done);
        done.onclick = async () => {
            done.disabled = true;
            try {
                const words = rows.filter((r) => !r.ignored && !(/** @type {HTMLInputElement} */ (r.box)).checked).map((r) => r.word);
                const old = /** @type {KnownWords} */ (await studyCall('knownWords'));
                await studyCall('knownWords', {known: {add: words}});
                const undo = () => studyCall('knownWords', {known: {remove: words.filter((w) => !old.known.includes(w))}});
                const learning = rows.filter((r) => !r.ignored && (/** @type {HTMLInputElement} */ (r.box)).checked);
                if (learning.length > 0) {
                    this._remember(learning, undo);
                } else {
                    this._notice('已标为认识', undo);
                }
                panel.remove();
            } catch (error) {
                note.textContent = `没有保存：${error instanceof Error ? error.message : '请重试。'}`;
                done.disabled = false;
            }
        };
        document.documentElement.append(panel);
    }

    /** */
    _hideTip() {
        if (this._tip) {
            this._tip.hidden = true;
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

let knownNoticeTimer = 0;

/**
 * Mark only the learner's saved word; Anki cards and scheduling are untouched.
 * @param {string} word
 * @param {boolean} [known]
 */
export async function markWordKnown(word, known = true) {
    const notice = document.getElementById('study-known-notice') || document.createElement('div');
    notice.id = 'study-known-notice';
    notice.className = 'scan-disable';
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:2147483646;max-width:90%;padding:8px 12px;border-radius:8px;background:var(--st-ink,#243047);color:var(--st-paper,#fff);font:13px/1.5 sans-serif;box-shadow:0 2px 12px #0003';
    document.documentElement.append(notice);
    clearTimeout(knownNoticeTimer);
    notice.textContent = '正在保存标记…';
    try {
        await studyCall('libraryMarkKnown', {word, known});
        const undo = document.createElement('button');
        undo.type = 'button';
        undo.textContent = '撤销';
        undo.style.cssText = 'margin-left:6px;color:inherit;background:none;border:1px solid currentColor;border-radius:4px;font:inherit;cursor:pointer';
        undo.onclick = () => {
            undo.disabled = true;
            void markWordKnown(word, !known).catch(() => {});
        };
        notice.replaceChildren(known ? '已标为认识 · ' : '已改回在学 · ', undo);
    } catch (error) {
        notice.textContent = `标记没有保存：${error instanceof Error ? error.message : '请再试一次。'}`;
        throw error;
    } finally {
        knownNoticeTimer = window.setTimeout(() => notice.remove(), 5000);
    }
}
