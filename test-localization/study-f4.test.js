// @vitest-environment jsdom
import {test, expect} from 'vitest';
import {YoutubeReader} from '../ext/js/study/youtube-reader.js';
test('recommendations survive an old backend without video-word actions and reveal their row', async () => {
    document.body.innerHTML = '<div id="secondary-inner"></div>';
    const reader = new YoutubeReader({prefs: {merge: false}, call: async () => {throw new Error('unknown action');}});
    reader._mediaKey = 'youtube:abcdefghijk';
    reader._learningWords = {brick: {s: 'learning'}};
    await reader._mount(0);
    reader.importText('1\n00:00:00,000 --> 00:00:10,000\nWe build a brick wall today.', 'fixture.srt');
    await reader._loadWords();
    expect(document.querySelector('.r-difficulty').textContent).toBe('语速 36 词/分 · 在学词 1');
    const button = document.querySelector('.r-recommend button');
    expect(button.textContent).toContain('brick');
    button.click();
    expect(document.querySelector('.r-cue').classList.contains('is-flash')).toBe(true);
    expect(document.querySelector('.r-words-note').textContent).toContain('unknown action');
    reader._reset();
});
