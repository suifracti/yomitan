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


import {expect, test} from 'vitest';
import {parseSubtitles, SUBTITLE_URL} from '../ext/js/study/subtitle-formats.js';

const rows = (/** @type {{cues: {startMs: number, endMs: number, text: string}[]}} */ {cues}) => cues.map(({startMs, endMs, text}) => [startMs, endMs, text]);

test('SRT with numbering, CRLF, tags and a broken block', () => {
    const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> &amp; welcome\r\n\r\n2\r\nnot a time\r\n\r\n3\r\n00:00:03,000 --> 00:00:04,000\r\nSecond line\r\nwraps here\r\n';
    const result = parseSubtitles(srt, 'movie.srt');
    expect(result.format).toBe('srt');
    expect(rows(result)).toEqual([[1000, 2500, 'Hello & welcome'], [3000, 4000, 'Second line\nwraps here']]);
});

test('WebVTT with cue settings, voice tags and rolling duplicates', () => {
    const vtt = 'WEBVTT\n\nNOTE skip\n\nc1\n00:01.000 --> 00:02.000 align:start position:0%\n<v Roger><c.yellow>Keep</c> going</v>\n\n00:02.000 --> 00:03.000\nKeep going\n\n01:00:00.000 --> 01:00:01.000\nLate';
    const result = parseSubtitles(vtt);
    expect(result.format).toBe('vtt');
    expect(rows(result)).toEqual([[1000, 3000, 'Keep going'], [3600000, 3601000, 'Late']]);
});

test('ASS uses the Format order and drops override tags', () => {
    const ass = '[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\i1}Hi,{\\i0} there\\Nfriend\nComment: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,ignored';
    const result = parseSubtitles(ass);
    expect(result.format).toBe('ass');
    expect(rows(result)).toEqual([[1500, 3000, 'Hi, there\nfriend']]);
});

test('TTML clock times, ticks and durations', () => {
    const ttml = '<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" ttp:tickRate="10000000"><body><div>' +
    '<p begin="00:00:01.000" end="00:00:02.000">One<br/>two</p>' +
    '<p begin="30000000t" end="40000000t"><span>Three</span></p>' +
    '<p begin="5s" dur="1.5s">Four</p></div></body></tt>';
    const result = parseSubtitles(ttml, 'x.dfxp');
    expect(result.format).toBe('ttml');
    expect(rows(result)).toEqual([[1000, 2000, 'One\ntwo'], [3000, 4000, 'Three'], [5000, 6500, 'Four']]);
});

test('Bilibili JSON in seconds and generic JSON in milliseconds', () => {
    const bili = JSON.stringify({font_size: 0.4, body: [{from: 1.2, to: 2.4, content: '你好 hello'}, {from: 3, to: 4, content: 'bye'}]});
    expect(parseSubtitles(bili)).toMatchObject({format: 'bilibili'});
    expect(rows(parseSubtitles(bili))).toEqual([[1200, 2400, '你好 hello'], [3000, 4000, 'bye']]);
    const generic = JSON.stringify([{start: 120000, end: 121500, text: 'one'}, {start: 125000, duration: 1000, text: 'two'}]);
    expect(rows(parseSubtitles(generic))).toEqual([[120000, 121500, 'one'], [125000, 126000, 'two']]);
    const clock = JSON.stringify({cues: [{start: '00:00:01.000', end: '00:00:02.000', text: 'clock'}]});
    expect(rows(parseSubtitles(clock))).toEqual([[1000, 2000, 'clock']]);
});

test('YouTube json3 goes through the timed-text reader', () => {
    const json3 = JSON.stringify({events: [{tStartMs: 0, dDurationMs: 1000, segs: [{utf8: 'Hi'}]}]});
    expect(parseSubtitles(json3)).toMatchObject({format: 'youtube', cues: [{startMs: 0, endMs: 1000, text: 'Hi'}]});
});

test('unknown text, broken JSON and files without timed lines are refused', () => {
    expect(() => parseSubtitles('just some prose')).toThrow('不认识');
    expect(() => parseSubtitles('{broken')).toThrow('JSON');
    expect(() => parseSubtitles(JSON.stringify({hello: 1}))).toThrow('不认识');
    expect(() => parseSubtitles('WEBVTT\n\n00:05.000 --> 00:01.000\nbackwards')).toThrow('没有读到');
});

test('subtitle URLs are recognised without matching ordinary pages', () => {
    for (const url of ['https://cdn.example.com/a/en.vtt?sig=1', 'https://x.com/sub.srt', 'https://aisubtitle.hdslb.com/bfs/subtitle/abc.json', 'https://www.youtube.com/api/timedtext?v=x&fmt=json3', 'https://media.example/sub.ttml#t', 'https://x.org/video_subtitle_en.json']) {
        expect(SUBTITLE_URL.test(url), url).toBe(true);
    }
    for (const url of ['https://example.com/page.html', 'https://example.com/video.mp4', 'https://example.com/api/data.json', 'https://example.com/vtt-guide']) {
        expect(SUBTITLE_URL.test(url), url).toBe(false);
    }
});
