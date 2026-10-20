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

// Tolerant readers for the subtitle formats sites actually serve or learners import:
// SRT, WebVTT, ASS/SSA, TTML/DFXP, YouTube json3/XML, Bilibili JSON and simple JSON
// arrays. Formatting tags are dropped, text stays text, and malformed blocks are
// skipped instead of failing the whole file. Times always come from the file.
import {parseJson} from '../core/json.js';
import {cuesFromTimedText, normalizeCues} from './subtitle-session.js';

/** @typedef {'srt'|'vtt'|'sbv'|'ass'|'ttml'|'youtube'|'bilibili'|'json'} SubtitleFormat */

const MAX_TEXT = 4_000_000;
/** @type {Record<string, string>} */
const ENTITIES = {'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', '#39': '\'', 'nbsp': ' '};

/** @typedef {{startMs: number, endMs: number, text: string}} TimedRow */

/**
 * @param {string} value e.g. 01:02:03,456 / 02:03.456 / 0:02:03.45
 * @returns {number} milliseconds, or NaN
 */
function clockMs(value) {
    const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(value.trim());
    if (!match) { return Number.NaN; }
    const [, h = '0', m, s, fraction = '0'] = match;
    return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Math.round(Number(`0.${fraction}`) * 1000);
}

/**
 * @param {string} text
 * @returns {string}
 */
function plain(text) {
    return text.replaceAll(/<[^>]*>/g, '')
        .replaceAll(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name) => ENTITIES[name] ?? '')
        .replaceAll(/[ \t]+/g, ' ')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n');
}

/**
 * @param {TimedRow[]} rows
 * @returns {import('./subtitle-session.js').SubtitleCue[]}
 * @throws {TypeError}
 */
function finish(rows) {
    const clean = rows
        .map((row) => ({startMs: Math.round(row.startMs), endMs: Math.round(row.endMs), text: row.text}))
        .filter((row) => row.text && Number.isSafeInteger(row.startMs) && Number.isSafeInteger(row.endMs) && row.startMs >= 0 && row.endMs > row.startMs)
        .sort((a, b) => a.startMs - b.startMs);
    // Identical consecutive lines (common in rolling captions) collapse into one.
    /** @type {TimedRow[]} */
    const merged = [];
    for (const row of clean) {
        const last = merged.at(-1);
        if (last && last.text === row.text && row.startMs <= last.endMs + 50) {
            last.endMs = Math.max(last.endMs, row.endMs);
        } else {
            merged.push({...row});
        }
    }
    if (merged.length === 0) { throw new TypeError('没有读到带时间的字幕行。'); }
    return normalizeCues(merged.slice(0, 5000).map((row, index) => ({id: String(index), sourceIndex: index, ...row})));
}

/**
 * SRT and WebVTT, tolerant of numbering, cue settings, tags and stray blocks.
 * @param {string} text
 * @returns {{startMs: number, endMs: number, text: string}[]}
 */
function readSrtVtt(text) {
    const rows = [];
    for (const block of text.split(/\n\s*\n/)) {
        const lines = block.split('\n');
        const at = lines.findIndex((line) => line.includes('-->'));
        if (at < 0) { continue; }
        const [from, rest = ''] = lines[at].split('-->');
        const to = rest.trim().split(/\s+/)[0] ?? '';
        rows.push({startMs: clockMs(from), endMs: clockMs(to), text: plain(lines.slice(at + 1).join('\n'))});
    }
    return rows;
}

/**
 * YouTube SBV: "0:00:01.000,0:00:03.000" followed by the text.
 * @param {string} text
 * @returns {TimedRow[]}
 */
function readSbv(text) {
    const rows = [];
    for (const block of text.split(/\n\s*\n/)) {
        const [times = '', ...lines] = block.trim().split('\n');
        const [from = '', to = ''] = times.split(',');
        rows.push({startMs: clockMs(from), endMs: clockMs(to), text: plain(lines.join('\n'))});
    }
    return rows;
}

/**
 * ASS/SSA "Dialogue:" lines, using the [Events] Format order when present.
 * @param {string} text
 * @returns {{startMs: number, endMs: number, text: string}[]}
 */
function readAss(text) {
    let fields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const rows = [];
    for (const line of text.split('\n')) {
        const format = /^Format:\s*(.+)$/i.exec(line);
        if (format && /text/i.test(format[1])) { fields = format[1].split(',').map((f) => f.trim().toLowerCase()); }
        const dialogue = /^Dialogue:\s*(.+)$/i.exec(line);
        if (!dialogue) { continue; }
        const parts = dialogue[1].split(',');
        const textAt = fields.indexOf('text');
        const value = parts.slice(textAt).join(',');
        const body = value.replaceAll(/\{[^}]*\}/g, '').replaceAll(/\\[Nn]/g, '\n').replaceAll('\\h', ' ');
        rows.push({startMs: clockMs(parts[fields.indexOf('start')] ?? ''), endMs: clockMs(parts[fields.indexOf('end')] ?? ''), text: plain(body)});
    }
    return rows;
}

/**
 * TTML / DFXP time expressions: clock, offset (s, ms, m, h) and ticks.
 * @param {string|null} value
 * @param {number} tickRate
 * @returns {number}
 */
function ttmlTime(value, tickRate) {
    if (!value) { return Number.NaN; }
    const offset = /^([\d.]+)(h|m|s|ms|t|f)$/.exec(value.trim());
    if (offset) {
        const n = Number(offset[1]);
        return {h: n * 3600000, m: n * 60000, s: n * 1000, ms: n, t: n / tickRate * 1000, f: n / 30 * 1000}[offset[2]] ?? Number.NaN;
    }
    // hh:mm:ss:frames is read as hh:mm:ss.
    return clockMs(value.trim().replace(/^(\d+:\d{2}:\d{2}):\d+$/, '$1'));
}

/**
 * @param {string} text
 * @returns {{startMs: number, endMs: number, text: string}[]}
 */
function readTtml(text) {
    const tickRate = Number(/tickRate="(\d+)"/.exec(text)?.[1] ?? 10_000_000);
    const rows = [];
    for (const match of text.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
        const attributes = match[1];
        const read = (/** @type {string} */ name) => new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1] ?? null;
        const start = ttmlTime(read('begin'), tickRate);
        const end = read('end') ? ttmlTime(read('end'), tickRate) : start + ttmlTime(read('dur'), tickRate);
        rows.push({startMs: start, endMs: end, text: plain(match[2].replaceAll(/<br\s*\/?>/g, '\n'))});
    }
    return rows;
}

/**
 * Bilibili ({body: [{from, to, content}]}) and simple arrays of {start, end, text}.
 * Seconds are assumed unless a value clearly looks like milliseconds.
 * @param {unknown} data
 * @returns {{rows: {startMs: number, endMs: number, text: string}[], format: SubtitleFormat}|null}
 */
function readJsonRows(data) {
    const object = /** @type {Record<string, unknown>} */ (data && typeof data === 'object' ? data : {});
    const list = [data, object.body, object.cues, object.subtitles].find((value) => Array.isArray(value));
    if (!Array.isArray(list)) { return null; }
    /** @type {Record<string, unknown>[]} */
    const items = list.filter((item) => item && typeof item === 'object');
    const pick = (/** @type {Record<string, unknown>} */ item, /** @type {string[]} */ keys) => keys.map((key) => item[key]).find((value) => typeof value === 'number' || typeof value === 'string');
    const numbers = items.map((item) => Number(pick(item, ['from', 'start', 'startTime', 'begin']))).filter(Number.isFinite);
    const inMs = numbers.length > 0 && Math.max(...numbers) > 100000;
    const rows = items.map((item) => {
        const start = pick(item, ['from', 'start', 'startTime', 'begin']);
        const end = pick(item, ['to', 'end', 'endTime']);
        const duration = pick(item, ['duration', 'dur']);
        const toMs = (/** @type {unknown} */ value) => (typeof value === 'string' && value.includes(':') ? clockMs(value) : Number(value) * (inMs ? 1 : 1000));
        const startMs = toMs(start);
        const endMs = end !== void 0 ? toMs(end) : startMs + toMs(duration);
        const text = pick(item, ['content', 'text', 'line', 'caption']);
        return {startMs, endMs, text: typeof text === 'string' ? plain(text) : ''};
    });
    return {rows, format: Array.isArray(object.body) ? 'bilibili' : 'json'};
}

/**
 * Reads any supported subtitle text into cues.
 * @param {string} text
 * @param {string} [name] File name or URL, used only as a hint.
 * @returns {{cues: import('./subtitle-session.js').SubtitleCue[], format: SubtitleFormat}}
 * @throws {Error}
 */
export function parseSubtitles(text, name = '') {
    if (typeof text !== 'string' || text.length > MAX_TEXT) { throw new TypeError('字幕文件过大或不是文本。'); }
    const body = text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const head = body.trimStart().slice(0, 400);
    const hint = name.toLowerCase();
    if (/\[Script Info\]|^Dialogue:/im.test(head) || /\.(ass|ssa)(\?|$)/.test(hint) || /^Dialogue:/m.test(body)) { return {cues: finish(readAss(body)), format: 'ass'}; }
    if (head.startsWith('{') || head.startsWith('[')) {
        /** @type {unknown} */
        let data;
        try {
            data = parseJson(body);
        } catch {
            throw new TypeError('字幕 JSON 无法解析。');
        }
        if (data && typeof data === 'object' && 'events' in data) { return {cues: cuesFromTimedText(body), format: 'youtube'}; }
        const read = readJsonRows(data);
        if (read) { return {cues: finish(read.rows), format: read.format}; }
        throw new TypeError('不认识这种 JSON 字幕。');
    }
    if (/<tt[\s>]/.test(body.slice(0, 2000))) { return {cues: finish(readTtml(body)), format: 'ttml'}; }
    if (/<transcript|<timedtext/.test(body.slice(0, 2000))) { return {cues: cuesFromTimedText(body), format: 'youtube'}; }
    if (/^\d+:\d{2}:\d{2}\.\d{3},\d+:\d{2}:\d{2}\.\d{3}\s*$/m.test(head)) { return {cues: finish(readSbv(body)), format: 'sbv'}; }
    if (body.includes('-->')) { return {cues: finish(readSrtVtt(body)), format: head.startsWith('WEBVTT') ? 'vtt' : 'srt'}; }
    throw new TypeError('不认识这种字幕格式；支持 SRT、VTT、SBV、ASS、TTML、YouTube 与常见 JSON。');
}

/** File name pattern for subtitle files a page loads or a learner imports. */
export const SUBTITLE_URL = /\.(vtt|srt|ass|ssa|ttml|dfxp|sbv)(?:[?#]|$)|\/(?:api\/timedtext|bfs\/subtitle|bfs\/ai_subtitle)\b|[?&](?:fmt|format)=(?:vtt|srv3|json3|ttml)\b|subtitle[^/]*\.json(?:[?#]|$)/i;

/**
 * Cues a player already parsed (TextTrack cues), cleaned like file cues.
 * @param {TimedRow[]} rows
 * @returns {import('./subtitle-session.js').SubtitleCue[]}
 * @throws {TypeError}
 */
export function cuesFromRows(rows) {
    return finish(rows.map((row) => ({...row, text: plain(row.text)})));
}

/**
 * Splits bilingual files (an English line plus a Chinese line in each cue) into the
 * source text and a ready translation. Returns null for ordinary single-language files.
 * @param {import('./subtitle-session.js').SubtitleCue[]} cues
 * @returns {{cues: import('./subtitle-session.js').SubtitleCue[], translations: Map<string, string>}|null}
 */
export function splitBilingual(cues) {
    const cjk = /[\u3400-\u9FFF\uF900-\uFAFF]/;
    let paired = 0;
    const split = cues.map((cue) => {
        const lines = cue.text.split('\n');
        const zh = lines.filter((line) => cjk.test(line) && (line.match(/[A-Za-z]/g)?.length ?? 0) < line.length / 3);
        const source = lines.filter((line) => !zh.includes(line));
        if (zh.length > 0 && source.length > 0) { ++paired; }
        return {cue, source: source.join('\n'), zh: zh.join('\n')};
    });
    if (paired < Math.max(3, cues.length * 0.6)) { return null; }
    /** @type {Map<string, string>} */
    const translations = new Map();
    const kept = split.filter((row) => row.source.trim()).map((row) => {
        if (row.zh) { translations.set(row.cue.id, row.zh); }
        return {...row.cue, text: row.source};
    });
    return {cues: kept, translations};
}

/**
 * Best guess at the language of cues with no label: Chinese, Japanese, Korean or English.
 * @param {{text: string}[]} cues
 * @returns {string}
 */
export function guessLanguage(cues) {
    const sample = cues.slice(0, 80).map((cue) => cue.text).join(' ');
    const count = (/** @type {RegExp} */ pattern) => sample.match(pattern)?.length ?? 0;
    const latin = count(/[A-Za-z]/g);
    const kana = count(/[\u3040-\u30FF]/g);
    const hangul = count(/[\uAC00-\uD7AF]/g);
    const han = count(/[\u4E00-\u9FFF]/g);
    if (kana > latin / 4 && kana > 10) { return 'ja'; }
    if (hangul > latin / 4 && hangul > 10) { return 'ko'; }
    if (han > latin / 4 && han > 10) { return 'zh'; }
    return 'en';
}
