// @vitest-environment jsdom
import {test, expect, vi} from 'vitest';
import {YoutubeReader} from '../ext/js/study/youtube-reader.js';
import {WebVideoSite} from '../ext/js/study/web-video-site.js';
test('local imported captions remain usable when an old bridge lacks video actions', async () => {
    vi.stubGlobal('location', new URL('file:///tmp/fixture.html'));
    document.body.innerHTML = '<video src="file:///tmp/my%20movie.webm" style="opacity:1"></video>';
    const video = document.querySelector('video');
    video.getBoundingClientRect = () => ({width: 640, height: 360});
    Object.defineProperty(video, 'duration', {value: 62.4});
    const site = new WebVideoSite();
    const reader = new YoutubeReader({site, prefs: {merge: false}, call: async () => {throw new Error('unknown action');}});
    reader._mediaKey = site.mediaKey();
    expect(reader._mediaKey).toBe('file:my movie.webm|62');
    await reader._mount(0);
    reader.importText('1\n00:00:00,000 --> 00:00:02,000\nWe learn from a real video.', 'fixture.srt');
    await reader._loadWords();
    expect(reader.session.cues[0].text).toContain('real video');
    expect(reader.session.source.url).toContain('#study-duration=62');
    expect(reader._view.words.textContent).toContain('unknown action');
    reader._reset();
    vi.unstubAllGlobals();
});
