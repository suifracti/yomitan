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

/* eslint-disable jsdoc/require-jsdoc */

import {afterEach, expect, test, vi} from 'vitest';

const webmBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);

class FakeTrack {
    /** @param {'audio'|'video'} kind */
    constructor(kind) {
        this.kind = kind;
        this.readyState = 'live';
        this.stopped = false;
    }

    stop() {
        this.stopped = true;
        this.readyState = 'ended';
    }
}

class FakeStream {
    /** @param {FakeTrack[]} tracks */
    constructor(tracks) {
        this._tracks = tracks;
    }

    getTracks() { return this._tracks; }
    getAudioTracks() { return this._tracks.filter((track) => track.kind === 'audio'); }
}

class FakeVideo extends EventTarget {
    /** @param {FakeTrack[]} tracks */
    constructor(tracks) {
        super();
        this._currentTime = 5;
        this.duration = 30;
        this.paused = false;
        this.playbackRate = 1.5;
        this.readyState = 2;
        this.seeking = false;
        this.ended = false;
        this.currentSrc = 'https://example.test/video';
        this.src = this.currentSrc;
        this.srcObject = null;
        this._captureStream = new FakeStream(tracks);
        this.playCalls = 0;
        this.pauseCalls = 0;
    }

    get currentTime() { return this._currentTime; }

    set currentTime(value) {
        this._currentTime = value;
        this.seeking = true;
        this.dispatchEvent(new Event('seeking'));
        queueMicrotask(() => {
            this.seeking = false;
            this.dispatchEvent(new Event('seeked'));
        });
    }

    captureStream() { return this._captureStream; }

    pause() {
        this.pauseCalls++;
        if (!this.paused) {
            this.paused = true;
            this.dispatchEvent(new Event('pause'));
        }
    }

    play() {
        this.playCalls++;
        this.paused = false;
        this.dispatchEvent(new Event('playing'));
        return Promise.resolve();
    }

    /** @param {number} time */
    tick(time) {
        this._currentTime = time;
        this.dispatchEvent(new Event('timeupdate'));
    }
}

class FakeRecorder extends EventTarget {
    static supportedTypes = ['audio/webm'];
    static bytes = webmBytes;
    /** @type {FakeRecorder[]} */
    static instances = [];

    /**
     * @param {FakeStream} stream
     * @param {{mimeType?: string}} options
     */
    constructor(stream, options) {
        super();
        this.stream = stream;
        this.mimeType = options.mimeType ?? '';
        this.state = 'inactive';
        this.stopCalls = 0;
        FakeRecorder.instances.push(this);
    }

    /**
     * @param {string} type
     * @returns {boolean}
     */
    static isTypeSupported(type) { return FakeRecorder.supportedTypes.includes(type); }

    start() { this.state = 'recording'; }

    stop() {
        if (this.state === 'inactive') { return; }
        this.stopCalls++;
        this.state = 'inactive';
        queueMicrotask(() => {
            const data = new Blob([FakeRecorder.bytes], {type: this.mimeType});
            const event = new Event('dataavailable');
            Object.defineProperty(event, 'data', {value: data});
            this.dispatchEvent(event);
            this.dispatchEvent(new Event('stop'));
        });
    }
}

/**
 * @param {FakeTrack[]} [tracks]
 * @returns {{video: FakeVideo, tracks: FakeTrack[]}}
 */
function setup(tracks = [new FakeTrack('audio'), new FakeTrack('video')]) {
    FakeRecorder.supportedTypes = ['audio/webm'];
    FakeRecorder.bytes = webmBytes;
    FakeRecorder.instances = [];
    vi.stubGlobal('MediaStream', FakeStream);
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    return {video: new FakeVideo(tracks), tracks};
}

/** @returns {Promise<FakeRecorder>} */
async function recorderStarted() {
    for (let i = 0; i < 10; ++i) {
        await Promise.resolve();
        const recorder = FakeRecorder.instances.at(-1);
        if (recorder?.state === 'recording') { return recorder; }
    }
    throw new Error('fake MediaRecorder did not start');
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

test('captures only the requested video audio range and restores the prior playback state', async () => {
    const {captureVideoAudio} = await import('../ext/js/study/audio-capture.js');
    const {video, tracks} = setup();
    const operation = captureVideoAudio(/** @type {any} */ (video), 2, 1);
    const recorder = await recorderStarted();

    expect(recorder.stream.getTracks().map((track) => track.kind)).toEqual(['audio']);
    expect(video.currentTime).toBe(2);
    expect(video.playbackRate).toBe(1);
    expect(recorder.stopCalls).toBe(0);

    video.tick(2.5);
    expect(recorder.stopCalls).toBe(0);
    video.tick(3);
    const result = await operation;

    expect(result).toEqual({assets: [{kind: 'audio', mime: 'audio/webm', data: 'GkXfowEC'}], warnings: []});
    expect(video.currentTime).toBe(5);
    expect(video.playbackRate).toBe(1.5);
    expect(video.paused).toBe(false);
    expect(tracks.every((track) => track.stopped)).toBe(true);
});

test('rejects an abort during recording and stops capture tracks before restoring a paused video', async () => {
    const {captureVideoAudio} = await import('../ext/js/study/audio-capture.js');
    const audio = new FakeTrack('audio');
    const {video, tracks} = setup([audio, new FakeTrack('video')]);
    video.paused = true;
    const controller = new AbortController();
    const operation = captureVideoAudio(/** @type {any} */ (video), 2, 1, {signal: controller.signal});
    const recorder = await recorderStarted();

    controller.abort();
    await expect(operation).rejects.toMatchObject({name: 'AbortError'});

    expect(recorder.stopCalls).toBe(1);
    expect(tracks.every((track) => track.stopped)).toBe(true);
    expect(video.currentTime).toBe(5);
    expect(video.playbackRate).toBe(1.5);
    expect(video.paused).toBe(true);
});

test('rejects missing audio tracks without leaving the capture stream live', async () => {
    const {captureVideoAudio} = await import('../ext/js/study/audio-capture.js');
    const tracks = [new FakeTrack('video')];
    const {video} = setup(tracks);

    await expect(captureVideoAudio(/** @type {any} */ (video), 2, 1)).rejects.toThrow(/音轨/);
    expect(tracks[0].stopped).toBe(true);
    expect(video.currentTime).toBe(5);
    expect(video.playbackRate).toBe(1.5);
});

test('rejects a recording that produces no audio bytes and cleans up', async () => {
    const {captureVideoAudio} = await import('../ext/js/study/audio-capture.js');
    const {video, tracks} = setup();
    FakeRecorder.bytes = new Uint8Array();
    const operation = captureVideoAudio(/** @type {any} */ (video), 2, 1);
    const recorder = await recorderStarted();
    video.tick(3);

    await expect(operation).rejects.toThrow(/空/);
    expect(recorder.stopCalls).toBe(1);
    expect(tracks.every((track) => track.stopped)).toBe(true);
});

test('rejects unsupported recording formats and over-limit media', async () => {
    const {captureVideoAudio} = await import('../ext/js/study/audio-capture.js');
    const unsupported = setup();
    FakeRecorder.supportedTypes = [];
    await expect(captureVideoAudio(/** @type {any} */ (unsupported.video), 2, 1)).rejects.toThrow(/不支持/);
    expect(unsupported.tracks.every((track) => track.stopped)).toBe(true);

    const oversized = setup();
    FakeRecorder.bytes = new Uint8Array(2_000_001).fill(1);
    const operation = captureVideoAudio(/** @type {any} */ (oversized.video), 2, 1);
    const recorder = await recorderStarted();
    oversized.video.tick(3);
    await expect(operation).rejects.toThrow(/2MB/);
    expect(recorder.stopCalls).toBe(1);
    expect(oversized.tracks.every((track) => track.stopped)).toBe(true);
});

test('cancels if playback stops before the requested end and does not treat wall time as completion', async () => {
    const {captureVideoAudio} = await import('../ext/js/study/audio-capture.js');
    const {video, tracks} = setup();
    const operation = captureVideoAudio(/** @type {any} */ (video), 2, 1);
    const recorder = await recorderStarted();

    expect(recorder.stopCalls).toBe(0);
    video.pause();
    await expect(operation).rejects.toThrow(/暂停/);
    expect(recorder.stopCalls).toBe(1);
    expect(tracks.every((track) => track.stopped)).toBe(true);
    expect(video.currentTime).toBe(5);
    expect(video.paused).toBe(false);
});

test('times out when video time never advances instead of treating elapsed wall time as a captured clip', async () => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
    const {captureVideoAudio} = await import('../ext/js/study/audio-capture.js');
    const {video, tracks} = setup();
    const operation = captureVideoAudio(/** @type {any} */ (video), 2, 1);
    const recorder = await recorderStarted();

    expect(recorder.stopCalls).toBe(0);
    const timedOut = expect(operation).rejects.toThrow(/卡住/);
    await vi.advanceTimersByTimeAsync(4000);
    await timedOut;
    expect(recorder.stopCalls).toBe(1);
    expect(tracks.every((track) => track.stopped)).toBe(true);
    expect(video.currentTime).toBe(5);
    expect(video.paused).toBe(false);
});

test('rejects a manual seek during recording and restores the original playback state', async () => {
    const {captureVideoAudio} = await import('../ext/js/study/audio-capture.js');
    const seeking = setup();
    const seekOperation = captureVideoAudio(/** @type {any} */ (seeking.video), 2, 1);
    const seekRecorder = await recorderStarted();
    seeking.video.dispatchEvent(new Event('seeking'));
    await expect(seekOperation).rejects.toThrow(/跳转/);
    expect(seekRecorder.stopCalls).toBe(1);
    expect(seeking.video.currentTime).toBe(5);
    expect(seeking.video.paused).toBe(false);
});

test('cancels when the source context is no longer current', async () => {
    const {captureVideoAudio} = await import('../ext/js/study/audio-capture.js');
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
    const stale = setup();
    let current = true;
    const staleOperation = captureVideoAudio(/** @type {any} */ (stale.video), 2, 1, {isCurrent: () => current});
    await recorderStarted();
    const cancelled = expect(staleOperation).rejects.toMatchObject({name: 'AbortError'});
    current = false;
    await vi.advanceTimersByTimeAsync(100);
    await cancelled;
    expect(stale.video.currentTime).toBe(2); // Do not seek a newly active context back to an old bookmark.
    expect(stale.video.paused).toBe(false);
});

test('does not restore playback state after the video element switches source', async () => {
    const {captureVideoAudio} = await import('../ext/js/study/audio-capture.js');
    const replaced = setup();
    const replacedOperation = captureVideoAudio(/** @type {any} */ (replaced.video), 2, 1);
    await recorderStarted();
    replaced.video.src = 'https://example.test/other-video';
    replaced.video.currentSrc = replaced.video.src;
    Object.defineProperty(replaced.video, 'currentTime', {value: 0, configurable: true});
    replaced.video.playbackRate = 0.75;
    replaced.video.dispatchEvent(new Event('loadstart'));
    await expect(replacedOperation).rejects.toMatchObject({name: 'AbortError'});
    expect(replaced.video.currentTime).toBe(0);
    expect(replaced.video.playbackRate).toBe(0.75);
});

/* eslint-enable jsdoc/require-jsdoc */
