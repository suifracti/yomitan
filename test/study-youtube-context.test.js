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
import {afterAll, expect, test, vi} from 'vitest';
import {builtinEnvironments} from 'vitest/environments';

const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<p id="cue">We improve daily.\n</p><p id="fake">We improve daily.</p><video></video>', url: 'https://www.youtube.com/watch?v=abcdefghijk'}});
afterAll(() => env.teardown(global));
const {YoutubeStudyContext} = await import('../ext/js/study/youtube-study-context.js');
/** @returns {{capture: ReturnType<typeof vi.fn>, context: InstanceType<typeof YoutubeStudyContext>, range: Range}} */
function setup() {
    const capture = vi.fn(async () => ({assets: [{kind: 'audio', mime: 'audio/webm', data: 'actual'}], warnings: []}));
    const context = new YoutubeStudyContext(capture);
    const p = document.querySelector('#cue');
    context.register(p, {text: 'We improve daily.', context: 'Neighbor.', start: 1.25, end: 3.5, url: location.href, translation: () => '我们每天进步。', video: () => document.querySelector('video'), isCurrent: () => true});
    const range = document.createRange();
    range.setStart(p.firstChild, 3);
    range.setEnd(p.firstChild, 10);
    return {context, capture, range};
}
test('real private row supplies exact original sentence, time and translation without ASB authority', () => {
    const {context, range} = setup();
    const result = context.read(range);
    expect(result.sentence).toEqual({text: 'We improve daily.', offset: 3, adjacent: 'Neighbor.'});
    expect(result.videoTime).toBe(1.25);
    expect(result.mediaRange).toEqual({start: 1.25, end: 3.5});
    expect(result.translation).toBe('我们每天进步。');
    expect(result).not.toHaveProperty('studySubtitle');
    range.selectNodeContents(document.querySelector('#fake'));
    expect(context.read(range)).toBe(null);
});
test('capture only uses the selected row range and reset invalidates old word-card tokens', async () => {
    const {context, capture, range} = setup();
    const result = context.read(range);
    await context.capture(result.token, 1.25, 2.25);
    expect(capture).toHaveBeenCalledTimes(1);
    await expect(context.capture(result.token, 2, 2)).rejects.toThrow();
    context.reset();
    await expect(context.capture(result.token, 1.25, 2.25)).rejects.toThrow();
    expect(capture).toHaveBeenCalledTimes(1);
});

test('existing Frontend popup path receives cue time and translation, not the ASB deny-only snapshot', async () => {
    const {Frontend} = await import('../ext/js/app/frontend.js');
    const {TextSourceRange} = await import('../ext/js/dom/text-source-range.js');
    const {youtubeStudyContext} = await import('../ext/js/study/youtube-study-context.js');
    const {range} = setup();
    const p = document.querySelector('#cue');
    youtubeStudyContext.register(p, {text: 'We improve daily.', context: 'Neighbor.', start: 1.25, end: 3.5, url: location.href, translation: () => '我们每天进步。', video: () => document.querySelector('video'), isCurrent: () => true});
    const show = vi.fn();
    const view = {_pageType: 'web', _application: {tabId: 1, frameId: 0}, _textScanner: {}, _showPopupContent: show};
    // eslint-disable-next-line no-underscore-dangle
    Frontend.prototype._showContent.call(view, TextSourceRange.create(range), false, [], 'terms', {text: 'old scanner text', offset: 0}, 'Fixture', {url: location.href}, 'light');
    const state = /** @type {{state: import('display').HistoryState}} */ (show.mock.calls[0][2]).state;
    expect(state.sentence.text).toBe('We improve daily.');
    expect(state.sentence.offset).toBe(3);
    expect(state.sentence).not.toHaveProperty('studySubtitle');
    expect(state.videoTime).toBe(1.25);
    expect(state.studyMediaRange).toEqual({start: 1.25, end: 3.5});
    expect(state.studySentenceTranslation).toBe('我们每天进步。');
});
