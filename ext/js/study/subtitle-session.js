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

/* View/selection model only. A DOM subtitle or this class is NOT a save permission. */
import {parseTimedText} from './vendor/kiss/youtube-caption-source.js';

/**
 * @typedef {{id: string, sourceIndex: number, startMs: number, endMs: number, text: string}} SubtitleCue
 * @typedef {{id?: string, sourceIndex?: number, startMs: number, endMs: number, text: string}} SubtitleCueInput
 * @typedef {{mediaKey: string, trackKey: string, revision: string, language: string, acquisition: 'provider'|'import'|'fixture', url?: string, trackIndex?: number, trackName?: string}} SubtitleSource
 * @typedef {{sessionKey: string, cueId: string, source: SubtitleSource, word: string, sentence: string, selectionStart: number, selectionEnd: number, originalStartMs: number, originalEndMs: number, subtitleOffsetMs: number}} SubtitleSelection
 * @typedef {{cueIds: string[], text: string, startMs: number, endMs: number}} SubtitleGroup
 */

/**
 * @param {unknown} value
 * @returns {value is number}
 */
const integer = (value) => Number.isSafeInteger(value);

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} [limit]
 * @returns {string}
 * @throws {Error}
 */
function required(value, name, limit = 300) {
    if (typeof value !== 'string' || !value.trim() || value.length > limit) {
        throw new TypeError(`${name} 缺失或超限`);
    }
    return value;
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) { freeze(child); }
        Object.freeze(value);
    }
    return value;
}

/**
 * @param {SubtitleCueInput[]} input
 * @returns {SubtitleCue[]}
 * @throws {Error}
 */
export function normalizeCues(input) {
    if (!Array.isArray(input) || input.length > 5000) { throw new TypeError('字幕需为最多 5000 条的数组'); }
    let total = 0;
    const ids = new Set();
    const result = input.map((c, i) => {
        const id = required(c?.id ?? String(i), 'cue ID', 128);
        if (ids.has(id)) { throw new TypeError('字幕 ID 重复'); }
        ids.add(id);
        if (!integer(c.startMs) || !integer(c.endMs) || c.startMs < 0 || c.endMs <= c.startMs || c.endMs > 604800000) {
            throw new TypeError('字幕时间无效；不能凭下一行或当前播放位置补造');
        }
        const text = required(c.text, '原字幕', 2400);
        total += text.length;
        if (total > 1000000) { throw new TypeError('整轨文本超限；没有截去剩余原文'); }
        // Index is provider order; display sorting does not replace source identity.
        return {id, sourceIndex: integer(c.sourceIndex) ? c.sourceIndex : i, startMs: c.startMs, endMs: c.endMs, text};
    });
    return freeze(result.sort((a, b) => a.startMs - b.startMs || a.sourceIndex - b.sourceIndex));
}

/**
 * @param {string} text YouTube timedtext (json3, srv3 or legacy XML).
 * @returns {SubtitleCue[]}
 * @throws {Error}
 */
export function cuesFromTimedText(text) {
    /** @type {unknown} */
    const parsed = parseTimedText(text);
    const events = /** @type {{tStartMs?: number, dDurationMs?: number, aAppend?: number, segs?: {utf8: string}[]}[]} */ (parsed);
    /** @type {SubtitleCueInput[]} */
    const rows = [];
    for (const [i, e] of events.entries()) {
        if (!e.segs?.some((s) => s.utf8?.trim())) { continue; }
        // Legacy XML stores seconds; only float noise is rounded, absent duration is not invented.
        const start = typeof e.tStartMs === 'number' ? Math.round(e.tStartMs) : Number.NaN;
        const duration = typeof e.dDurationMs === 'number' ? Math.round(e.dDurationMs) : Number.NaN;
        if (!integer(start) || !integer(duration) || duration <= 0) {
            throw new TypeError(`第 ${i + 1} 条含文字但没有有效原始起止时间`);
        }
        if (e.aAppend) { throw new TypeError('此轨含追加式滚动字幕；需先由来源适配器规范化，不能重复制卡'); }
        rows.push({id: String(i), sourceIndex: i, startMs: start, endMs: start + duration, text: e.segs.map((s) => s.utf8).join('')});
    }
    return normalizeCues(rows);
}

/**
 * @param {string} value
 * @returns {number}
 * @throws {Error}
 */
function clock(value) {
    const parts = value.replace(',', '.').split(':');
    if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+(?:\.\d{1,3})?$/.test(p))) { throw new TypeError('时间格式错误'); }
    const sec = Number(parts.pop());
    const min = Number(parts.pop());
    const hr = Number(parts.pop() ?? 0);
    if (min >= 60 || sec >= 60) { throw new TypeError('分钟或秒超出范围'); }
    return Math.round((hr * 3600 + min * 60 + sec) * 1000);
}

/**
 * @param {string} text SRT or WebVTT text.
 * @returns {SubtitleCue[]}
 * @throws {Error}
 */
export function cuesFromVtt(text) {
    if (typeof text !== 'string' || text.length > 2000000) { throw new TypeError('字幕文件过大或不是文本'); }
    /** @type {SubtitleCueInput[]} */
    const cues = [];
    for (const block of text.replace(/^\uFEFF/, '').replaceAll('\r', '').split(/\n\s*\n/)) {
        const lines = block.trim().split('\n');
        if (!block.trim() || /^(WEBVTT|NOTE(?:\s|$)|STYLE$|REGION$)/.test(lines[0])) { continue; }
        const n = lines.findIndex((l) => l.includes('-->'));
        if (n < 0 || n > 1) { throw new TypeError('无法识别字幕块；未忽略异常行'); }
        const match = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines[n]);
        if (!match) { throw new TypeError('字幕时间轴无效'); }
        // WebVTT cue styling is not copied into executable DOM. Source text stays text.
        cues.push({id: String(cues.length), startMs: clock(match[1]), endMs: clock(match[2]), text: lines.slice(n + 1).join('\n')});
    }
    return normalizeCues(cues);
}

/**
 * @param {number} ms
 * @param {boolean} [vtt]
 * @returns {string}
 * @throws {Error}
 */
export function timeLabel(ms, vtt = false) {
    if (!integer(ms) || ms < 0) { throw new TypeError('时间必须为非负整数毫秒'); }
    const h = Math.floor(ms / 3600000);
    const m = Math.floor(ms / 60000) % 60;
    const s = Math.floor(ms / 1000) % 60;
    /**
     * @param {number} n
     * @returns {string}
     */
    const p = (n) => String(n).padStart(2, '0');
    if (vtt) { return `${p(h)}:${p(m)}:${p(s)}.${String(ms % 1000).padStart(3, '0')}`; }
    return `${h ? `${h}:${p(m)}` : Math.floor(ms / 60000)}:${p(s)}`;
}

export class SubtitleSession {
    /** @type {number} */
    #offset = 0;
    /** @type {Map<string, string>} */
    #translations = new Map();
    /** @type {SubtitleSelection|null} */
    #selection = null;

    /**
     * @param {SubtitleSource} source
     * @param {SubtitleCueInput[]|SubtitleCue[]} cues
     */
    constructor(source, cues) {
        required(source?.mediaKey, '媒体身份');
        required(source.trackKey, '轨道身份');
        required(source.revision, '来源版本');
        required(source.language, '源语言', 32);
        if (!['provider', 'import', 'fixture'].includes(source.acquisition)) { throw new TypeError('来源获取方式未标明'); }
        if (source.url && !/^(https?|file):\/\//.test(source.url)) { throw new TypeError('不接受可执行来源链接'); }
        /** @type {Readonly<SubtitleSource>} */
        this.source = freeze({...source});
        /** @type {SubtitleCue[]} */
        this.cues = normalizeCues([...cues]);
        /** @type {string} */
        this.key = JSON.stringify([source.mediaKey, source.trackKey, source.revision, source.language]);
        Object.defineProperties(this, {source: {writable: false}, cues: {writable: false}, key: {writable: false}});
    }

    /** @type {number} */
    get offsetMs() { return this.#offset; }

    /**
     * @param {number} ms
     * @throws {Error}
     */
    setOffset(ms) {
        if (!integer(ms) || Math.abs(ms) > 3600000) { throw new TypeError('偏移须在一小时内，以毫秒明确保存'); }
        this.#offset = ms;
    }

    /**
     * @param {string} id
     * @returns {SubtitleCue}
     * @throws {Error}
     */
    cue(id) {
        const cue = this.cues.find((c) => c.id === id);
        if (!cue) { throw new TypeError('字幕行不存在'); }
        return cue;
    }

    /**
     * @param {number} playbackMs
     * @returns {SubtitleCue[]}
     */
    active(playbackMs) {
        if (!Number.isFinite(playbackMs)) { return []; }
        const raw = playbackMs - this.#offset;
        return this.cues.filter((c) => c.startMs <= raw && raw < c.endMs);
    }

    /**
     * @param {string} id
     * @returns {number}
     * @throws {Error}
     */
    seekSeconds(id) {
        const at = this.cue(id).startMs + this.#offset;
        if (at < 0) { throw new RangeError('偏移后落在媒体开始之前；请调整偏移'); }
        return at / 1000;
    }

    /**
     * @param {string} id
     * @param {number} start
     * @param {number} end
     * @returns {SubtitleSelection}
     * @throws {Error}
     */
    select(id, start, end) {
        const cue = this.cue(id);
        if (!integer(start) || !integer(end) || start < 0 || end <= start || end > cue.text.length) { throw new TypeError('原文选区无效'); }
        const word = cue.text.slice(start, end);
        if (!word.trim() || word.trim() !== word || word.length > 128) { throw new TypeError('请准确选择一个词或表达'); }
        this.#selection = freeze({
            sessionKey: this.key,
            cueId: id,
            source: this.source,
            word,
            sentence: cue.text,
            selectionStart: start,
            selectionEnd: end,
            originalStartMs: cue.startMs,
            originalEndMs: cue.endMs,
            subtitleOffsetMs: this.#offset,
        });
        return this.#selection;
    }

    /** @type {SubtitleSelection|null} */
    get selection() { return this.#selection; }

    /**
     * @param {string} id
     * @param {string} translation
     * @param {string} [expectedSession]
     * @returns {boolean}
     */
    acceptTranslation(id, translation, expectedSession = this.key) {
        this.cue(id);
        if (expectedSession !== this.key) { return false; }
        required(translation, '中文译文', 6000);
        this.#translations.set(id, translation);
        return true;
    }

    /**
     * @param {string} id
     * @returns {string}
     */
    translation(id) {
        this.cue(id);
        return this.#translations.get(id) ?? '';
    }

    /**
     * @returns {{translated: number, total: number}}
     */
    progress() { return freeze({translated: this.#translations.size, total: this.cues.length}); }

    /**
     * Plans a capture range only; it does not prove audio exists or grant save permission.
     * @param {string[]} ids
     * @param {{beforeMs: number, afterMs: number}} [padding]
     * @returns {{sessionKey: string, mediaKey: string, trackKey: string, cueIds: string[], startMs: number, endMs: number, originalCues: SubtitleCue[], captureRequired: true, note: string}}
     * @throws {Error}
     */
    clipPlan(ids, padding) {
        const {beforeMs = 0, afterMs = 0} = padding ?? {};
        if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length) { throw new TypeError('请选择实际字幕行'); }
        const selected = ids.map((id) => this.cue(id));
        for (const v of [beforeMs, afterMs]) {
            if (!integer(v) || v < 0 || v > 3000) { throw new TypeError('片段前后留白限 0–3 秒'); }
        }
        const startMs = Math.min(...selected.map((c) => c.startMs)) + this.#offset - beforeMs;
        const endMs = Math.max(...selected.map((c) => c.endMs)) + this.#offset + afterMs;
        if (startMs < 0 || endMs - startMs > 30000) { throw new RangeError('现有附件协议每段最多 30 秒；请缩小范围，不自动截断'); }
        return freeze({
            sessionKey: this.key,
            mediaKey: this.source.mediaKey,
            trackKey: this.source.trackKey,
            cueIds: [...ids],
            startMs,
            endMs,
            originalCues: selected,
            captureRequired: /** @type {const} */ (true),
            note: '这只是采集计划，不证明已有音频，也不授予保存权限。',
        });
    }

    /**
     * Untrusted hint shaped like the old ASB cue; it is never a write authorization.
     * @param {SubtitleSelection|null} [selection]
     * @returns {Record<string, string|number>}
     * @throws {Error}
     */
    asbHint(selection = this.#selection) {
        if (!selection || selection.sessionKey !== this.key) { throw new TypeError('没有属于此轨道的选词'); }
        if (!integer(this.source.trackIndex) || !this.source.url) { throw new TypeError('缺少原轨道编号或网址，不能伪造 ASB 核验'); }
        const cue = this.cue(selection.cueId);
        return freeze({
            version: 1,
            sourceRevision: this.source.revision,
            text: cue.text,
            cueIndex: cue.sourceIndex,
            trackIndex: this.source.trackIndex,
            trackName: this.source.trackName ?? this.source.trackKey,
            language: this.source.language,
            originalStartMs: cue.startMs,
            originalEndMs: cue.endMs,
            subtitleOffsetMs: this.#offset,
            url: this.source.url,
            selectionStart: selection.selectionStart,
            selectionEnd: selection.selectionEnd,
            word: selection.word,
        });
    }

    /**
     * @param {boolean} [bilingual]
     * @returns {string}
     */
    exportVtt(bilingual = false) {
        const body = this.cues.map((c, i) => {
            const translation = bilingual ? this.translation(c.id) : '';
            return `${i + 1}\n${timeLabel(c.startMs, true)} --> ${timeLabel(c.endMs, true)}\n${c.text}${translation ? '\n' + translation : ''}`;
        });
        return 'WEBVTT\n\n' + body.join('\n\n') + '\n';
    }
}

/**
 * Rendering groups are deliberately separate from the immutable raw track.
 * @param {SubtitleCue[]} cues
 * @param {{maxGapMs?: number, maxDurationMs?: number, maxChars?: number}} [options]
 * @returns {SubtitleGroup[]}
 */
export function groupForReading(cues, {maxGapMs = 350, maxDurationMs = 12000, maxChars = 300} = {}) {
    /** @type {SubtitleGroup[]} */
    const groups = [];
    for (const c of cues) {
        const last = groups.at(-1);
        const join = last && !/[.!?。！？]["'”’)]?$/.test(last.text.trim()) && c.startMs >= last.endMs &&
        c.startMs - last.endMs <= maxGapMs && c.endMs - last.startMs <= maxDurationMs &&
        last.text.length + c.text.length + 1 <= maxChars;
        if (last && join) {
            last.cueIds.push(c.id);
            last.text += ' ' + c.text;
            last.endMs = c.endMs;
        } else {
            groups.push({cueIds: [c.id], text: c.text, startMs: c.startMs, endMs: c.endMs});
        }
    }
    return freeze(groups);
}

/**
 * Turns model-proposed groups of cue IDs into reading groups, or returns null when the
 * proposal skips, repeats or reorders a cue. Text and times always come from the cues.
 * @param {SubtitleCue[]} cues
 * @param {unknown} idGroups
 * @returns {SubtitleGroup[]|null}
 */
export function groupsFromIds(cues, idGroups) {
    if (!Array.isArray(idGroups) || idGroups.some((group) => !Array.isArray(group) || group.length === 0 || group.some((id) => typeof id !== 'string'))) { return null; }
    const flat = /** @type {string[][]} */ (idGroups).flat();
    if (flat.length !== cues.length || flat.some((id, index) => id !== cues[index].id)) { return null; }
    const byId = new Map(cues.map((cue) => [cue.id, cue]));
    return freeze(/** @type {string[][]} */ (idGroups).map((ids) => {
        const members = ids.map((id) => /** @type {SubtitleCue} */ (byId.get(id)));
        return {cueIds: [...ids], text: members.map((cue) => cue.text).join(' '), startMs: members[0].startMs, endMs: Math.max(...members.map((cue) => cue.endMs))};
    }));
}
