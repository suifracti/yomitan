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

// The caption sidebar's look and its list. Long tracks (hour-long talks, podcasts)
// render progressively: every row has a sized placeholder at once, and its real
// nodes are built when they come near the visible area or when the reader needs
// that row (seek, follow, reveal). Short tracks render at once.

import {wordInfo} from './word-marks.js';

export const ROOT_ID = 'study-yt-reader';

// Exclusion only: common function words are not a vocabulary/difficulty scale.
const FUNCTION_WORDS = new Set(`a an the this that these those i me my mine myself we us our ours ourselves you your yours yourself yourselves
he him his himself she her hers herself it its itself they them their theirs themselves one ones oneself who whom whose what which
whoever whomever whatever whichever here there where when why how all any both each either enough every everybody everyone everything
neither nobody none no nothing other others some somebody someone something such several much many more most less least few fewer little
another own same so than too very just only also even still yet already ever never not yes nor
am is are was were be being been have has had having do does did doing done can could may might must shall should will would ought need dare
about above across after against along amid among around as at before behind below beneath beside besides between beyond by concerning
despite down during except for from in inside into like near of off on onto out outside over past per round since through throughout
thru till to toward towards under underneath unlike until unto up upon versus via with within without
and or but because if although though while whereas unless whether once since whenever wherever lest plus
s aint aren't can't couldn't didn't doesn't don't hadn't hasn't haven't isn't mustn't needn't shan't shouldn't wasn't weren't won't wouldn't
i'm i've i'll i'd you're you've you'll you'd he's he'll he'd she's she'll she'd it's it'll it'd we're we've we'll we'd they're they've they'll they'd
that's there's what's who's let's lets well oh ah uh um please okay ok indeed instead else therefore thus hence`.split(/\s+/));

const EAGER_ROWS = 150;
const CHUNK = 50;
const ESTIMATED_ROW = 58;

// Colors come from js/study/study-tokens.css (linked on mount); the fallbacks keep
// the panel readable if the token sheet has not loaded yet. Everything stays
// under the panel root so the YouTube page itself is untouched.
export const SIDEBAR_STYLE = `
#${ROOT_ID}{--r-fg:var(--st-ink,var(--yt-spec-text-primary,#1f2430));--r-muted:var(--st-muted,var(--yt-spec-text-secondary,#5a6172));--r-line:var(--st-line,var(--yt-spec-10-percent-layer,#e6e3dc));--r-tint:var(--st-tint,#f3f1ec);--r-accent:var(--st-accent,#3b4a8c);--r-mark:var(--st-mark,rgb(255 214 92 / 45%));
margin:0 0 16px;border:1px solid var(--r-line);border-radius:10px;background:var(--st-paper,transparent);color:var(--r-fg);font:14px/1.5 var(--st-sans,Roboto,Arial,sans-serif);overflow:hidden}
#${ROOT_ID} .r-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:8px 12px}
#${ROOT_ID} .r-toolbar{display:flex;align-items:center;gap:6px;padding:0 10px 8px;white-space:nowrap}
#${ROOT_ID} .r-toolbar button.r-btn{padding:3px 6px;flex-shrink:0}
#${ROOT_ID} .r-progress{flex:1;min-width:0;color:var(--r-muted);font-size:11px;white-space:normal}
#${ROOT_ID} .r-difficulty{color:var(--r-muted);font-size:11px}
#${ROOT_ID} .r-star{margin-left:4px;color:var(--r-muted);font-size:11px;align-self:center}
#${ROOT_ID} .r-recommend{padding:8px 12px;border-bottom:1px solid var(--r-line)}
#${ROOT_ID} .r-recommend strong{font-size:12px}
#${ROOT_ID} .r-recommend-item{padding:8px 0;border-bottom:1px solid var(--r-line)}
#${ROOT_ID} .r-recommend-text{margin:4px 0;font-size:13px;line-height:1.5}
#${ROOT_ID} .r-recommend mark{background:var(--r-mark);color:inherit;border-radius:2px}
#${ROOT_ID} .r-recommend button+button{margin-left:6px}
#${ROOT_ID} .r-title{flex:1 1 auto;font-weight:600;font-size:13px}
#${ROOT_ID} .r-status{min-width:0;padding:0 12px 6px;color:var(--r-muted);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
#${ROOT_ID} .r-status[data-mode=loop]{color:var(--r-accent)}
#${ROOT_ID} button.r-btn{font:inherit;font-size:12px;color:var(--r-accent);background:transparent;border:1px solid var(--r-line);border-radius:6px;padding:3px 10px;cursor:pointer;transition:background-color 120ms,border-color 120ms}
#${ROOT_ID} button.r-btn:hover:not(:disabled){border-color:var(--r-accent);background:var(--r-tint)}
#${ROOT_ID} button.r-btn:disabled{opacity:.5;cursor:default}
#${ROOT_ID} button[hidden]{display:none}
#${ROOT_ID} button:focus-visible{outline:2px solid var(--r-accent);outline-offset:1px}
#${ROOT_ID} .r-list{position:relative;max-height:min(60vh,520px);overflow:auto;overscroll-behavior:contain;border-top:1px solid var(--r-line)}
#${ROOT_ID} .r-list:empty{display:none}
#${ROOT_ID} .r-cue{position:relative;display:grid;grid-template-columns:46px minmax(0,1fr) auto;column-gap:6px;padding:7px 8px 7px 0;border-left:3px solid transparent}
#${ROOT_ID} .r-cue.is-current{background:var(--r-tint);border-left-color:var(--r-accent)}
#${ROOT_ID} .r-cue.is-lookup .r-text{text-decoration:underline 2px var(--r-mark);text-underline-offset:4px}
#${ROOT_ID} .r-cue.is-looping{border-left-color:var(--r-accent);background:var(--r-tint)}
#${ROOT_ID} .r-time{grid-column:1;border:0;background:none;padding:0 4px;color:var(--r-muted);font:12px/24px var(--st-sans,Roboto,Arial,sans-serif);font-variant-numeric:tabular-nums;cursor:pointer;text-align:right;align-self:start}
#${ROOT_ID} .r-time::before{content:attr(data-time)}
#${ROOT_ID} .r-time:hover{color:var(--r-accent)}
#${ROOT_ID} .r-text{grid-column:2;margin:0;font-family:var(--st-serif,Georgia,serif);font-size:15px;line-height:1.6;white-space:pre-line;overflow-wrap:anywhere;user-select:text}
#${ROOT_ID} .r-translation{grid-column:2;margin:2px 0 0;color:var(--r-fg);font-size:14px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
#${ROOT_ID} .r-translation:empty{display:none}
#${ROOT_ID} .r-tools{grid-column:3;grid-row:1;align-self:start;display:flex;gap:4px;opacity:0;transition:opacity 120ms}
#${ROOT_ID} .r-cue:hover .r-tools,#${ROOT_ID} .r-cue.is-current .r-tools,#${ROOT_ID} .r-cue.is-looping .r-tools,#${ROOT_ID} .r-tools:focus-within{opacity:1}
#${ROOT_ID} .r-loop{font:inherit;font-size:11px;line-height:20px;color:var(--r-muted);background:none;border:1px solid transparent;border-radius:6px;padding:1px 6px;cursor:pointer}
#${ROOT_ID} .r-loop:hover{color:var(--r-accent);border-color:var(--r-line)}
#${ROOT_ID} .r-loop[aria-pressed=true]{color:var(--r-accent);border-color:var(--r-accent)}
#${ROOT_ID} .r-tabs{display:flex;gap:14px;padding:0 12px;border-top:1px solid var(--r-line)}
#${ROOT_ID} .r-tab{padding:6px 0 5px;border:0;border-bottom:2px solid transparent;background:none;color:var(--r-muted);font:inherit;font-size:12px;cursor:pointer}
#${ROOT_ID} .r-tab[aria-selected=true]{color:var(--r-fg);border-bottom-color:var(--r-accent);font-weight:600}
#${ROOT_ID} .r-list[hidden],#${ROOT_ID} .r-words[hidden]{display:none}
#${ROOT_ID} .r-words{max-height:min(60vh,520px);overflow:auto;border-top:1px solid var(--r-line)}
#${ROOT_ID} .r-words-note{margin:0;padding:12px;color:var(--r-muted);font-size:12px}
#${ROOT_ID} .r-word{display:grid;grid-template-columns:46px auto minmax(0,1fr);column-gap:6px;align-items:baseline;padding:7px 8px 7px 0;border-bottom:1px solid var(--r-line)}
#${ROOT_ID} .r-word-text{font-family:var(--st-serif,Georgia,serif);font-size:15px}
#${ROOT_ID} .r-word-meta{color:var(--r-muted);font-size:11px;text-align:right}
#${ROOT_ID} .r-summary{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:10px 12px;color:var(--r-muted);font-size:12px}
#${ROOT_ID} .r-summary a{color:var(--r-accent)}
#${ROOT_ID} .r-word-sentence{grid-column:2/-1;margin:2px 0 0;color:var(--r-muted);font-size:13px;line-height:1.5;overflow-wrap:anywhere}
#${ROOT_ID} button.r-more{padding:3px 8px;letter-spacing:.1em}
#${ROOT_ID} .r-menu{display:flex;flex-wrap:wrap;gap:6px 14px;padding:8px 12px;border-top:1px solid var(--r-line);font-size:12px;color:var(--r-fg)}
#${ROOT_ID} .r-menu[hidden]{display:none}
#${ROOT_ID} .r-switch{display:inline-flex;align-items:center;gap:5px;cursor:pointer}
#${ROOT_ID} .r-switch input{margin:0;accent-color:var(--r-accent)}
#${ROOT_ID} .r-engine{display:inline-flex;align-items:center;gap:6px;flex:1 0 100%}
#${ROOT_ID} .r-engine select{font:inherit;font-size:12px;color:var(--r-fg);background:var(--st-sheet,transparent);border:1px solid var(--r-line);border-radius:6px;padding:2px 6px}
#${ROOT_ID} .r-downloads{display:flex;flex-wrap:wrap;gap:6px;flex:1 0 100%}
#${ROOT_ID} .r-source{display:inline-flex;align-items:center;gap:6px;flex:1 0 100%}
#${ROOT_ID} .r-source[hidden]{display:none}
#${ROOT_ID} .r-offset{display:inline-flex;align-items:center;gap:4px;flex:1 0 100%}
#${ROOT_ID} .r-offset button{font:inherit;font-size:11px;color:var(--r-accent);background:none;border:1px solid var(--r-line);border-radius:5px;padding:1px 6px;cursor:pointer}
#${ROOT_ID} .r-offset output{min-width:4.5em;text-align:center;font-variant-numeric:tabular-nums}
#${ROOT_ID} .r-status[data-mode=shadow]{color:var(--r-accent)}
#${ROOT_ID} .r-source select{max-width:100%;font:inherit;font-size:12px;color:var(--r-fg);background:var(--st-sheet,transparent);border:1px solid var(--r-line);border-radius:6px;padding:2px 6px}
#${ROOT_ID}.is-drop{outline:2px dashed var(--r-accent);outline-offset:-4px}
#${ROOT_ID}.r-blur .r-translation:not(.is-revealed){filter:blur(5px);cursor:pointer;transition:filter 120ms}
#${ROOT_ID}.r-blur .r-cue:hover .r-translation{filter:none}
#${ROOT_ID}.r-mono .r-translation{display:none}
#${ROOT_ID} .r-cue.is-flash{animation:r-flash 1.2s ease-out}
@keyframes r-flash{from{background:var(--r-mark)}to{background:transparent}}
@media (prefers-reduced-motion:reduce){#${ROOT_ID} *{transition:none;animation:none}}
#${ROOT_ID} .r-chunk{display:block}
`;

/**
 * @template T
 */
export class CaptionList {
    /**
     * @param {(item: T, index: number) => HTMLElement} makeRow Builds one row.
     * @param {(id: string, row: HTMLElement) => void} paintRow Applies current/lookup/loop states to a new row.
     */
    constructor(makeRow, paintRow) {
        /** @type {Map<string, HTMLElement>} Rows that exist in the DOM, by id. */
        this.rows = new Map();
        /** @type {(item: T, index: number) => HTMLElement} */
        this._makeRow = makeRow;
        /** @type {(id: string, row: HTMLElement) => void} */
        this._paintRow = paintRow;
        /** @type {(T & {id: string})[]} */
        this._items = [];
        /** @type {Map<string, number>} */
        this._index = new Map();
        /** @type {HTMLElement[]} */
        this._chunks = [];
        /** @type {IntersectionObserver|null} */
        this._observer = null;
    }

    /**
     * @param {HTMLElement} list
     * @param {(T & {id: string})[]} items
     */
    render(list, items) {
        this._observer?.disconnect();
        this._observer = null;
        this.rows.clear();
        this._items = items;
        this._index = new Map(items.map((item, index) => [item.id, index]));
        this._chunks = [];
        if (items.length <= EAGER_ROWS || typeof IntersectionObserver !== 'function') {
            list.replaceChildren(...items.map((item, index) => this._build(item, index)));
            return;
        }
        this._observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) { this._fill(/** @type {HTMLElement} */ (entry.target)); }
            }
        }, {root: list, rootMargin: '900px 0px'});
        for (let start = 0; start < items.length; start += CHUNK) {
            const chunk = document.createElement('div');
            chunk.className = 'r-chunk';
            chunk.dataset.start = String(start);
            chunk.style.height = `${Math.min(CHUNK, items.length - start) * ESTIMATED_ROW}px`;
            this._chunks.push(chunk);
            this._observer.observe(chunk);
        }
        list.replaceChildren(...this._chunks);
    }

    /**
     * The row for an id, building its part of the list if needed.
     * @param {string} id
     * @returns {HTMLElement|undefined}
     */
    ensure(id) {
        const existing = this.rows.get(id);
        if (existing) { return existing; }
        const index = this._index.get(id);
        if (index === void 0) { return void 0; }
        const chunk = this._chunks[Math.floor(index / CHUNK)];
        if (chunk) { this._fill(chunk); }
        return this.rows.get(id);
    }

    /** @param {HTMLElement} chunk */
    _fill(chunk) {
        if (chunk.dataset.filled) { return; }
        chunk.dataset.filled = '1';
        this._observer?.unobserve(chunk);
        const start = Number(chunk.dataset.start);
        const rows = this._items.slice(start, start + CHUNK).map((item, offset) => this._build(item, start + offset));
        chunk.replaceChildren(...rows);
        chunk.style.height = '';
    }

    /**
     * @param {T & {id: string}} item
     * @param {number} index
     * @returns {HTMLElement}
     */
    _build(item, index) {
        const row = this._makeRow(item, index);
        this.rows.set(item.id, row);
        this._paintRow(item.id, row);
        return row;
    }
}

/**
 * Saved words only; no frequency table or invented difficulty levels.
 * @param {import('./subtitle-session.js').SubtitleSession} session
 * @param {Record<string, unknown>} words
 * @param {{word: string, sentence: string}[]} [cardContexts]
 * @returns {{recommended: Set<string>, items: {word: string, gloss: string, term: string, cueId: string}[], learning: number, wpm: number}}
 */
export function learningCaptions(session, words, cardContexts = []) {
    const normalize = (text) => text.toLowerCase().replaceAll(/\s+/g, ' ').trim();
    const carded = new Set(cardContexts.map((row) => JSON.stringify([wordInfo(row.word, words)?.word ?? row.word.toLowerCase(), normalize(row.sentence)])));
    /** @type {Map<string, {word: string, gloss: string, term: string, cueId: string, preferred: boolean}>} */
    const byWord = new Map();
    const learning = new Set();
    /** @type {Set<string>} */
    const recommended = new Set();
    let total = 0;
    for (const cue of session.cues) {
        const tokens = cue.text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? [];
        total += tokens.length;
        /** @type {Map<string, {word: string, gloss: string, term: string, cueId: string}>} */
        const inLine = new Map();
        for (const token of tokens) {
            if (FUNCTION_WORDS.has(token.toLowerCase().replaceAll('’', "'"))) { continue; }
            const info = wordInfo(token, words);
            if (info && FUNCTION_WORDS.has(info.word)) { continue; }
            if (info && (['new', 'learning', 'shaky', 'partial'].includes(info.s) || info.newSense)) {
                inLine.set(info.word, {word: info.word, gloss: info.gloss || '', term: token, cueId: cue.id});
                learning.add(info.word);
            }
        }
        if (tokens.length >= 5 && tokens.length <= 20 && inLine.size === 1) {
            const item = [...inLine.values()][0];
            if (carded.has(JSON.stringify([item.word, normalize(cue.text)]))) { continue; }
            recommended.add(cue.id);
            const preferred = tokens.length >= 8 && tokens.length <= 15;
            if (!byWord.has(item.word) || (preferred && !byWord.get(item.word).preferred)) {
                byWord.set(item.word, {...item, preferred});
            }
        }
    }
    const duration = session.cues.length > 0 ? (Math.max(...session.cues.map((cue) => cue.endMs)) - session.cues[0].startMs) / 60000 : 0;
    return {recommended, items: [...byWord.values()].slice(0, 10), learning: learning.size, wpm: duration > 0 ? Math.round(total / duration) : 0};
}
