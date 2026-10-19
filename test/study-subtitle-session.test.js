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

import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe, expect, test} from 'vitest';
import {SubtitleSession, cuesFromTimedText, cuesFromVtt, groupForReading, normalizeCues, timeLabel} from '../ext/js/study/subtitle-session.js';
import {TranslationQueue} from '../ext/js/study/translation-queue.js';
import {captionUrl, selectCaptionTrack} from '../ext/js/study/vendor/kiss/youtube-caption-source.js';

/** @type {import('../ext/js/study/subtitle-session.js').SubtitleSource} */
const source = {mediaKey: 'youtube:abcdefghijk', trackKey: 'en-main', trackIndex: 0, trackName: 'English', revision: 'r1', language: 'en', acquisition: 'fixture', url: 'https://www.youtube.com/watch?v=abcdefghijk'};
const rows = [{id: 'a', startMs: 1000, endMs: 3000, text: 'The brain can change.'}, {id: 'b', startMs: 3000, endMs: 6000, text: 'Keep the original sentence.'}];
const config = {model: 'fixture-not-a-model', effort: 'fixture'};

/**
 * @param {{id: string}[]} items
 * @param {string} text
 * @returns {{id: string, translation: string}[]}
 */
const answer = (items, text) => items.map((i) => ({id: i.id, translation: text}));

describe('KISS caption source', () => {
    test('vendored file is byte-identical to upstream blob', () => {
        const b = readFileSync(new URL('../ext/js/study/vendor/kiss/youtube-caption-source.js', import.meta.url));
        const sha = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest('hex');
        expect(sha).toBe('aaa81cd31f67b470376b6c2f543afdd2a00509f6');
    });
    test('ambiguous selected track does not silently choose English', () => {
        expect(selectCaptionTrack({captionTracks: [{languageCode: 'en', kind: 'asr'}, {languageCode: 'en', kind: 'asr'}], selectedTrack: {languageCode: 'en', kind: 'asr'}})).toBe(null);
    });
    test('caption URL refuses foreign hosts and wrong media IDs', () => {
        expect(captionUrl('https://evil.example/api/timedtext?v=abcdefghijk', 'abcdefghijk', 'https://www.youtube.com')).toBe(null);
        expect(captionUrl('https://www.youtube.com/api/timedtext?v=ZZZZZZZZZZZ', 'abcdefghijk', 'https://www.youtube.com')).toBe(null);
    });
});

describe('subtitle parsing', () => {
    test('raw cue indices survive display sorting', () => {
        const c = normalizeCues([...rows].reverse());
        expect(c[0].id).toBe('a');
        expect(c[0].sourceIndex).toBe(1);
    });
    test('duplicate IDs, negative time and oversized cues are rejected', () => {
        expect(() => normalizeCues([rows[0], rows[0]])).toThrow(/重复/);
        expect(() => normalizeCues([{...rows[0], startMs: -1}])).toThrow(/时间/);
        expect(() => normalizeCues([{...rows[0], text: 'a'.repeat(2401)}])).toThrow(/超限/);
    });
    test('missing duration is not inferred', () => {
        expect(() => cuesFromTimedText(JSON.stringify({events: [{tStartMs: 0, segs: [{utf8: 'text'}]}]}))).toThrow(/起止时间/);
    });
    test('timedtext keeps raw text and timing', () => {
        const out = cuesFromTimedText(JSON.stringify({events: [{tStartMs: 210, dDurationMs: 1500, segs: [{utf8: "I'm "}, {utf8: 'learning.'}]}]}));
        expect(out[0].text).toBe("I'm learning.");
        expect(out[0].endMs).toBe(1710);
    });
    test('append-based rolling captions are refused', () => {
        expect(() => cuesFromTimedText(JSON.stringify({events: [{tStartMs: 0, dDurationMs: 1000, aAppend: 1, segs: [{utf8: 'hello'}]}]}))).toThrow(/追加/);
    });
    test('SRT and VTT keep original milliseconds', () => {
        const srt = cuesFromVtt('1\n00:00:01,120 --> 00:00:02,780\nOriginal sentence.\n');
        expect([srt[0].startMs, srt[0].endMs]).toEqual([1120, 2780]);
        expect(cuesFromVtt('WEBVTT\n\n00:01.001 --> 00:02.100 align:start position:0%\nHello.\n')[0].startMs).toBe(1001);
        expect(() => cuesFromVtt('WEBVTT\n\nThis is not a cue')).toThrow(/字幕块/);
    });
    test('time formatting preserves milliseconds', () => {
        expect(timeLabel(3601002, true)).toBe('01:00:01.002');
        expect(timeLabel(65000)).toBe('1:05');
    });
});

describe('subtitle session', () => {
    test('raw source data is deeply immutable', () => {
        const s = new SubtitleSession(source, rows);
        expect(() => { /** @type {{text: string}} */ (s.cues[0]).text = 'replace'; }).toThrow();
        expect(() => { /** @type {{revision: string}} */ (s.source).revision = 'r2'; }).toThrow();
    });
    test('offset changes playback, not original time or export', () => {
        const s = new SubtitleSession(source, rows);
        s.setOffset(500);
        expect(s.seekSeconds('a')).toBe(1.5);
        expect(s.cues[0].startMs).toBe(1000);
        expect(s.exportVtt()).toContain('00:00:01.000');
        expect(s.active(3500).map((c) => c.id)).toEqual(['b']);
    });
    test('selection stays frozen and exact', () => {
        const s = new SubtitleSession(source, rows);
        const pick = s.select('a', 4, 9);
        s.active(4500);
        expect(s.selection).toBe(pick);
        expect(pick.word).toBe('brain');
        expect(pick.sentence).toBe(rows[0].text);
        const t = new SubtitleSession(source, [{...rows[0], text: 'brain then brain'}]);
        expect(t.select('a', 11, 16).selectionStart).toBe(11);
        expect(() => t.select('a', 99, 102)).toThrow();
    });
    test('translations are session-bound and counted honestly', () => {
        const s = new SubtitleSession(source, rows);
        expect(s.acceptTranslation('a', '译文', 'another-session')).toBe(false);
        expect(s.progress()).toEqual({translated: 0, total: 2});
        s.acceptTranslation('a', '大脑可以改变。');
        expect(s.select('a', 4, 9).word).toBe('brain');
        expect(s.exportVtt(true)).toContain('大脑可以改变。');
        expect(s.exportVtt(true)).not.toContain('undefined');
    });
    test('clip plan keeps cue IDs and the 30-second limit', () => {
        const s = new SubtitleSession(source, rows);
        s.setOffset(200);
        const p = s.clipPlan(['a'], {beforeMs: 100, afterMs: 200});
        expect([p.startMs, p.endMs, p.captureRequired]).toEqual([1100, 3400, true]);
        expect(() => new SubtitleSession(source, [{id: 'x', startMs: 0, endMs: 31000, text: 'too long'}]).clipPlan(['x'])).toThrow(/30 秒/);
        expect(() => new SubtitleSession(source, rows).clipPlan(['a'], {beforeMs: 2000, afterMs: 0})).toThrow();
    });
    test('ASB hint carries no permission', () => {
        const s = new SubtitleSession(source, rows);
        s.select('a', 4, 9);
        const h = s.asbHint();
        expect([h.originalStartMs, h.selectionStart, h.word]).toEqual([1000, 4, 'brain']);
        expect('writeAuthorized' in h || 'receipt' in h).toBe(false);
    });
    test('display grouping leaves raw data unchanged', () => {
        const raw = normalizeCues([{...rows[0], text: 'The brain'}, {...rows[1], text: 'can change.'}]);
        const g = groupForReading(raw);
        expect(g.map((x) => x.cueIds)).toEqual([['a', 'b']]);
        expect(raw[0].text).toBe('The brain');
        expect(groupForReading(normalizeCues(rows)).length).toBe(2);
        expect(groupForReading(normalizeCues([{...rows[0], endMs: 4000}, rows[1]])).length).toBe(2);
    });
});

describe('translation queue', () => {
    test('sends only model/effort and aligns IDs', async () => {
        const q = new TranslationQueue(async ({items, config: c}) => {
            expect(c).toEqual(config);
            return [...items].reverse().map((i) => ({id: i.id, translation: i.id + ' 中文'}));
        });
        const out = await q.translate([{id: 'a', text: 'A'}, {id: 'b', text: 'B'}], config);
        expect(out.nativeCalls).toBe(1);
        expect(out.items[0].translation).toBe('a 中文');
    });
    test('partial batch keeps successes; retry reuses cache', async () => {
        let call = 0;
        const q = new TranslationQueue(async ({items}) => (++call === 1 ? [{id: 'a', translation: '甲'}] : answer(items, '乙')));
        const items = [{id: 'a', text: 'A'}, {id: 'b', text: 'B'}];
        expect((await q.translate(items, config)).items.map((x) => x.state)).toEqual(['translated', 'failed']);
        const out = await q.translate(items, config);
        expect(call).toBe(2);
        expect(out.items.map((x) => x.state)).toEqual(['cached', 'translated']);
    });
    test('unknown response ID fails instead of attaching elsewhere', async () => {
        const q = new TranslationQueue(async () => [{id: 'unknown', translation: '错位'}]);
        expect((await q.translate([{id: 'a', text: 'A'}], config)).items[0].state).toBe('failed');
    });
    test('switching models changes cache key', async () => {
        let calls = 0;
        const q = new TranslationQueue(async ({items}) => {
            calls++;
            return answer(items, '词义');
        });
        await q.translate([{id: 'a', text: 'A'}], config);
        await q.translate([{id: 'a', text: 'A'}], {...config, model: 'different-fixture'});
        expect(calls).toBe(2);
    });
    test('late response after cancellation is discarded', async () => {
        /** @type {(value: unknown) => void} */
        let resolve = () => {};
        let painted = 0;
        const q = new TranslationQueue(() => new Promise((r) => {
            resolve = /** @type {(value: unknown) => void} */ (r);
        }));
        const promise = q.translate([{id: 'a', text: 'A'}], {...config, onItem: () => painted++});
        q.cancel();
        resolve([{id: 'a', translation: '迟到'}]);
        const result = await promise;
        expect(result.cancelled).toBe(true);
        expect(painted).toBe(0);
    });
    test('each request is limited to 8 lines and 6000 characters', async () => {
        /** @type {number[][]} */
        const sizes = [];
        const q = new TranslationQueue(async ({items}) => {
            sizes.push([items.length, items.reduce((n, r) => n + r.text.length, 0)]);
            return answer(items, '好');
        });
        await q.translate(Array.from({length: 20}, (_, i) => ({id: String(i), text: 'A'.repeat(1100)})), config);
        expect(sizes.every(([n, s]) => n <= 8 && s <= 6000)).toBe(true);
    });
});
