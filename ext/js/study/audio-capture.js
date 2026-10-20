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

const MAX_ASSET_BYTES = 2_000_000;
const MAX_MEDIA_SECONDS = 604800;
const MIME_TYPES = ['audio/webm', 'audio/ogg'];
const VIDEO_TYPES = ['video/webm;codecs=vp8,opus', 'video/webm'];
const MAX_VIDEO_BYTES = 8_000_000;
const FRAME_WIDTH = 960;
const CAPTURE_STALL_MS = 3500;
const CAPTURE_POLL_MS = 100;
const TIME_EPSILON = 0.025;

/**
 * @param {string} message
 * @param {string} [name]
 * @returns {Error}
 */
function captureError(message, name = 'Error') {
    const error = new Error(message);
    error.name = name;
    return error;
}

/**
 * @param {typeof MediaRecorder|undefined} Recorder
 * @param {MediaStream} stream
 * @returns {{recorder: MediaRecorder, mime: string}}
 * @throws {Error}
 */
function createRecorder(Recorder, stream) {
    if (!Recorder || typeof Recorder.isTypeSupported !== 'function') {
        throw captureError('当前浏览器不支持原声录制。');
    }
    /** @type {unknown} */
    let lastError = null;
    for (const mime of MIME_TYPES) {
        let supported = false;
        try { supported = Recorder.isTypeSupported(mime); } catch { /* Try the next supported container. */ }
        if (!supported) { continue; }
        try {
            return {recorder: new Recorder(stream, {mimeType: mime}), mime};
        } catch (error) {
            lastError = error;
        }
    }
    throw captureError(lastError ? '无法启动支持的原声录制格式。' : '当前浏览器不支持 WebM 或 Ogg 原声录制。');
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    if (typeof btoa !== 'function') { throw captureError('当前环境无法编码原声音频。'); }
    return btoa(binary);
}

/**
 * Capture an actual, bounded audio segment from a video element. This only records
 * the element's captured audio tracks; it never captures the screen or microphone.
 * Optionally also keeps one frame from the middle of the sentence and a low-bitrate
 * WebM clip of the sentence itself; either may be skipped with a warning.
 * @param {HTMLVideoElement & {captureStream: () => MediaStream}} video
 * @param {number} start Start time in seconds.
 * @param {number} duration Duration in seconds.
 * @param {{signal?: AbortSignal, isCurrent?: () => boolean, withFrame?: boolean, withVideo?: boolean}} [options]
 * @returns {Promise<import('study').MediaCapture>}
 */
export async function captureVideoAudio(video, start, duration, {signal, isCurrent, withFrame = false, withVideo = false} = {}) {
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 ||
    typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 30 ||
    start + duration > MAX_MEDIA_SECONDS) {
        throw captureError('原声片段范围无效；请选择 0–30 秒内的有效视频时间。');
    }
    if (signal?.aborted) { throw captureError('原声采集已取消。', 'AbortError'); }
    if (typeof isCurrent === 'function' && !isCurrent()) { throw captureError('原声来源已改变，未采集。', 'AbortError'); }
    if (!video || typeof video.captureStream !== 'function') { throw captureError('当前视频不支持原声音轨采集。'); }

    const originalTime = video.currentTime;
    const originalRate = video.playbackRate;
    const originalPaused = video.paused;
    const originalSrc = video.src;
    const originalMedia = video.currentSrc || video.src;
    const originalSrcObject = video.srcObject;
    const end = start + duration;
    /** @type {MediaStream|null} */
    let capturedStream = null;
    /** @type {MediaStream|null} */
    let audioStream = null;
    /** @type {MediaRecorder|null} */
    let recorder = null;
    /** @type {(() => void)[]} */
    const removeListeners = [];
    /** @type {ReturnType<typeof setTimeout>|null} */
    let timeout = null;
    /** @type {ReturnType<typeof setInterval>|null} */
    let poll = null;
    let playbackChanged = false;
    let recordingStarted = false;
    let initialSeek = false;
    let reachedEnd = false;
    let settled = false;
    let lastTime = Number.NaN;
    let lastProgressAt = 0;
    /** @type {string[]} */
    const warnings = [];
    /** @type {MediaRecorder|null} */
    let videoRecorder = null;
    /** @type {Blob[]} */
    const videoChunks = [];
    /** @type {Promise<void>} */
    let videoStopped = Promise.resolve();
    /** @type {Promise<import('study').MediaAsset|null>|null} */
    let frame = null;
    const grabFrame = () => {
        frame = Promise.resolve(null);
        try {
            const scale = Math.min(1, FRAME_WIDTH / (video.videoWidth || FRAME_WIDTH));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round((video.videoWidth || FRAME_WIDTH) * scale));
            canvas.height = Math.max(1, Math.round((video.videoHeight || FRAME_WIDTH * 0.5625) * scale));
            canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
            /** @type {Promise<Blob|null>} */
            const blob = new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', 0.82); });
            frame = blob.then(async (image) => (image && image.size > 0 && image.size <= MAX_ASSET_BYTES ? {kind: 'image', mime: 'image/jpeg', data: await blobToBase64(image)} : null));
        } catch {
            warnings.push('画面截图失败（视频不允许读取画面），只保存了原声。');
        }
    };
    /** @type {(value: import('study').MediaCapture) => void} */
    let resolveDone = () => {};
    /** @type {(reason?: unknown) => void} */
    let rejectDone = () => {};
    /** @type {Promise<import('study').MediaCapture>} */
    const done = new Promise((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
    });
    // The lifecycle can fail before the caller awaits `done`; attach a handler now.
    void done.catch(() => {});

    const sameSource = () => (video.currentSrc || video.src) === originalMedia && video.src === originalSrc && video.srcObject === originalSrcObject;
    /** @param {unknown} error */
    const settleFailure = (error) => {
        if (settled) { return; }
        settled = true;
        rejectDone(error instanceof Error ? error : captureError('原声采集失败。'));
        if (recorder?.state === 'recording') {
            try { recorder.stop(); } catch { /* Cleanup still stops the capture tracks. */ }
        }
    };
    /** @param {import('study').MediaCapture} value */
    const settleSuccess = (value) => {
        if (settled) { return; }
        settled = true;
        resolveDone(value);
    };
    const assertCurrent = () => {
        if (signal?.aborted) { throw captureError('原声采集已取消。', 'AbortError'); }
        if (!sameSource()) { throw captureError('视频来源已改变，原声采集已取消。', 'AbortError'); }
        if (typeof isCurrent === 'function' && !isCurrent()) { throw captureError('原声来源已改变，采集已取消。', 'AbortError'); }
    };
    /**
     * @param {EventTarget} target
     * @param {string} type
     * @param {EventListener} listener
     */
    const listen = (target, type, listener) => {
        target.addEventListener(type, listener);
        removeListeners.push(() => target.removeEventListener(type, listener));
    };
    /**
     * @param {() => boolean} condition
     * @param {string[]} events
     */
    const waitFor = async (condition, events) => {
        if (condition()) { return; }
        /** @type {Promise<void>} */
        const waiting = new Promise((resolve, reject) => {
            const check = () => {
                try {
                    assertCurrent();
                    if (condition()) { resolve(); }
                } catch (error) { reject(error); }
            };
            for (const type of events) { listen(video, type, check); }
            check();
        });
        await Promise.race([waiting, done]);
        assertCurrent();
    };

    try {
        assertCurrent();
        capturedStream = video.captureStream();
        if (!capturedStream || typeof capturedStream.getAudioTracks !== 'function' || typeof capturedStream.getTracks !== 'function') {
            throw captureError('无法读取视频原声音轨。');
        }
        const audioTracks = capturedStream.getAudioTracks().filter((track) => track.kind === 'audio' && track.readyState !== 'ended');
        if (audioTracks.length === 0) { throw captureError('当前视频没有可采集的原声音轨。'); }
        if (typeof MediaStream !== 'function') { throw captureError('当前浏览器不支持音频流采集。'); }
        audioStream = new MediaStream(audioTracks);
        const created = createRecorder(/** @type {typeof MediaRecorder|undefined} */ (globalThis.MediaRecorder), audioStream);
        recorder = created.recorder;
        if (withVideo) {
            const Recorder = /** @type {typeof MediaRecorder|undefined} */ (globalThis.MediaRecorder);
            const type = VIDEO_TYPES.find((value) => {
                try {
                    return Boolean(Recorder?.isTypeSupported(value));
                } catch {
                    return false;
                }
            });
            if (Recorder && type && capturedStream.getVideoTracks().length > 0) {
                const clipRecorder = new Recorder(capturedStream, {mimeType: type, videoBitsPerSecond: 700_000, audioBitsPerSecond: 96_000});
                videoRecorder = clipRecorder;
                videoStopped = new Promise((resolve) => { listen(clipRecorder, 'stop', () => resolve()); });
                listen(clipRecorder, 'dataavailable', (event) => {
                    const data = /** @type {Event & {data?: Blob}} */ (event).data;
                    if (data && data.size > 0) { videoChunks.push(data); }
                });
            } else {
                warnings.push('这个视频不能录制画面片段，只保存了原声。');
            }
        }
        /** @type {Blob[]} */
        const chunks = [];
        let totalBytes = 0;
        const mediaType = (() => {
            const type = (recorder?.mimeType || created.mime).split(';', 1)[0].trim().toLowerCase();
            return MIME_TYPES.includes(type) ? type : '';
        })();
        if (!mediaType) { throw captureError('录制器返回了不支持的音频格式。'); }

        /** @param {Event & {data?: Blob}} event */
        const onData = (event) => {
            const data = event.data;
            if (!data || typeof data.size !== 'number') { return; }
            if (data.size > 0) {
                chunks.push(data);
                totalBytes += data.size;
                if (totalBytes > MAX_ASSET_BYTES) {
                    settleFailure(captureError('原声片段超过 2MB，未保存。'));
                }
            }
        };
        const onRecorderError = () => settleFailure(captureError('原声录制中断，未保存。'));
        const onRecorderStop = () => {
            if (settled) { return; }
            if (!reachedEnd) {
                settleFailure(captureError('原声录制在视频到达片段终点前停止。'));
                return;
            }
            void (async () => {
                const blob = new Blob(chunks, {type: recorder?.mimeType || created.mime});
                if (blob.size === 0) { throw captureError('原声录制结果为空，未保存。'); }
                if (blob.size > MAX_ASSET_BYTES) { throw captureError('原声片段超过 2MB，未保存。'); }
                const data = await blobToBase64(blob);
                /** @type {import('study').MediaAsset[]} */
                const assets = [{kind: 'audio', mime: mediaType, data}];
                if (withFrame && frame === null) { grabFrame(); }
                const image = frame ? await frame : null;
                if (image) { assets.push(image); }
                if (videoRecorder) {
                    if (videoRecorder.state === 'recording') {
                        try { videoRecorder.stop(); } catch { /* The clip is optional. */ }
                    }
                    await Promise.race([videoStopped, new Promise((resolve) => { setTimeout(resolve, 3000); })]);
                    const clip = new Blob(videoChunks, {type: 'video/webm'});
                    if (clip.size > MAX_VIDEO_BYTES) {
                        warnings.push('视频片段超过 8MB，只保存了原声和截图。');
                    } else if (clip.size > 0) {
                        assets.push({kind: 'video', mime: 'video/webm', data: await blobToBase64(clip)});
                    }
                }
                settleSuccess({assets, warnings});
            })().catch(settleFailure);
        };
        listen(recorder, 'dataavailable', onData);
        listen(recorder, 'error', onRecorderError);
        listen(recorder, 'stop', onRecorderStop);

        const onAbort = () => settleFailure(captureError('原声采集已取消。', 'AbortError'));
        if (signal) {
            signal.addEventListener('abort', onAbort, {once: true});
            removeListeners.push(() => signal.removeEventListener('abort', onAbort));
        }
        const onSourceChange = () => settleFailure(captureError('视频来源已改变，原声采集已取消。', 'AbortError'));
        listen(video, 'emptied', onSourceChange);
        listen(video, 'loadstart', onSourceChange);
        listen(video, 'seeking', () => {
            if (recordingStarted && !initialSeek) { settleFailure(captureError('视频在采集中被跳转，未保存原声。')); }
        });
        listen(video, 'pause', () => {
            if (recordingStarted && !reachedEnd) { settleFailure(captureError('视频在片段结束前暂停，未保存原声。')); }
        });
        listen(video, 'ended', () => {
            if (recordingStarted && !reachedEnd) { settleFailure(captureError('视频在片段结束前结束，未保存原声。')); }
        });
        listen(video, 'timeupdate', () => {
            try { assertCurrent(); } catch (error) {
                settleFailure(error);
                return;
            }
            const current = video.currentTime;
            if (!Number.isFinite(current)) {
                settleFailure(captureError('视频时间无效，未保存原声。'));
                return;
            }
            if (Number.isFinite(lastTime) && current > lastTime + 0.01) { lastProgressAt = Date.now(); }
            lastTime = current;
            if (withFrame && frame === null && recordingStarted && current >= start + duration / 2) { grabFrame(); }
            if (recordingStarted && current >= end) {
                reachedEnd = true;
                try { video.pause(); } catch { /* Recorder stop still bounds the asset. */ }
                if (recorder?.state === 'recording') {
                    try { recorder.stop(); } catch {
                        settleFailure(captureError('无法停止原声录制。'));
                    }
                }
            }
        });

        const timeoutMs = Math.max(5000, duration * 2000 + 5000);
        timeout = setTimeout(() => settleFailure(captureError('原声采集超时或视频未继续播放。')), timeoutMs);
        poll = setInterval(() => {
            try { assertCurrent(); } catch (error) {
                settleFailure(error);
                return;
            }
            if (recordingStarted && video.playbackRate !== 1) {
                settleFailure(captureError('采集中播放速度已改变，未保存原声。'));
                return;
            }
            if (recordingStarted && Date.now() - lastProgressAt > CAPTURE_STALL_MS) {
                settleFailure(captureError('视频播放卡住，原声未采集完成。'));
            }
        }, CAPTURE_POLL_MS);

        const run = async () => {
            await waitFor(() => video.readyState >= 1, ['loadedmetadata', 'loadeddata', 'canplay']);
            assertCurrent();
            if (Number.isFinite(video.duration) && end > video.duration + TIME_EPSILON) {
                throw captureError('原声片段超出视频长度。');
            }
            if (!video.paused) {
                video.pause();
                playbackChanged = true;
            }
            if (video.playbackRate !== 1) {
                video.playbackRate = 1;
                playbackChanged = true;
            }
            if (Math.abs(video.currentTime - start) > TIME_EPSILON) {
                initialSeek = true;
                playbackChanged = true;
                video.currentTime = start;
                await waitFor(() => !video.seeking && Math.abs(video.currentTime - start) <= TIME_EPSILON, ['seeked', 'timeupdate']);
                initialSeek = false;
            }
            await waitFor(() => video.readyState >= 2, ['loadeddata', 'canplay', 'playing']);
            assertCurrent();
            lastTime = video.currentTime;
            recorder?.start(250);
            videoRecorder?.start(250);
            recordingStarted = true;
            playbackChanged = true;
            lastProgressAt = Date.now();
            const playResult = video.play();
            if (playResult && typeof playResult.then === 'function') { await Promise.race([playResult, done]); }
            assertCurrent();
            return await done;
        };

        return await run();
    } catch (error) {
        settleFailure(error);
        throw error;
    } finally {
        if (timeout !== null) { clearTimeout(timeout); }
        if (poll !== null) { clearInterval(poll); }
        for (const remove of removeListeners.splice(0)) { remove(); }
        if (recorder?.state === 'recording') {
            try { recorder.stop(); } catch { /* Tracks are still stopped below. */ }
        }
        if (videoRecorder?.state === 'recording') {
            try { videoRecorder.stop(); } catch { /* Tracks are still stopped below. */ }
        }
        const captureTracks = new Set([...(capturedStream?.getTracks?.() ?? []), ...(audioStream?.getTracks?.() ?? [])]);
        for (const track of captureTracks) {
            try { track.stop(); } catch { /* Best-effort cleanup for ended browser tracks. */ }
        }
        if (playbackChanged && sameSource() && (typeof isCurrent !== 'function' || isCurrent())) {
            try {
                video.pause();
                video.playbackRate = originalRate;
                if (Number.isFinite(originalTime) && Math.abs(video.currentTime - originalTime) > TIME_EPSILON) { video.currentTime = originalTime; }
                if (!originalPaused) {
                    void video.play().catch(() => {});
                } else {
                    video.pause();
                }
                video.playbackRate = originalRate;
            } catch { /* Do not affect the result if the page stopped allowing restoration. */ }
        }
    }
}
