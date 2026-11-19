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

// Private content-script row identity. DOM attributes never grant a capture or save permission.
/** @typedef {{text: string, context: string, start: number, end: number, url: string, translation: () => string, waitTranslation?: () => Promise<string|null>, video: () => HTMLVideoElement|null, isCurrent: () => boolean}} Row */
/** @typedef {{element: Element, row: Row, video: HTMLVideoElement|null, src: string, media: string, srcObject: HTMLVideoElement['srcObject']}} Bound */
/** @typedef {(video: HTMLVideoElement, start: number, duration: number, options: {signal: AbortSignal, isCurrent: () => boolean, withFrame?: boolean, withVideo?: boolean}) => Promise<import('study').MediaCapture>} Capture */
export class YoutubeStudyContext {
    /** @param {Capture} [capture] */
    constructor(capture = async (video, start, duration, options) => (await import('./audio-capture.js')).captureVideoAudio(/** @type {HTMLVideoElement & {captureStream: () => MediaStream}} */ (video), start, duration, options)) {
        /** @type {Capture} */
        this.captureAudio = capture;
        /** @type {WeakMap<Element, Row>} */
        this.rows = new WeakMap();
        /** @type {Map<string, Bound>} */
        this.tokens = new Map();
        /** @type {Map<string, {video: HTMLVideoElement, controller: AbortController}>} */
        this.active = new Map();
        /** @type {{video: HTMLVideoElement, stop: (reason: 'ended'|'cancelled'|'failed') => void}|null} */
        this.replay = null;
        /** @type {((range: Range, openPanel?: boolean|'audio', recordId?: string) => Promise<void>)|null} Opens the existing scanner and card panel. */
        this.openCard = null;
    }

    /**
     * @param {Element} element
     * @param {Row} row
     */
    register(element, row) { this.rows.set(element, row); }
    /** Clear source tokens and stop any active capture or replay. */
    reset() {
        this.replay?.stop('cancelled');
        for (const {controller} of this.active.values()) { controller.abort(); }
        this.active.clear();
        this.tokens.clear();
        this.rows = new WeakMap();
    }

    /**
     * @param {HTMLVideoElement} video
     * @returns {boolean}
     */
    isTemporaryPlayback(video) {
        return this.replay?.video === video || [...this.active.values()].some((capture) => capture.video === video);
    }

    /**
     * @param {Range|null} range
     * @returns {{token: string, sentence: {text: string, offset: number, adjacent: string}, url: string, videoTime: number, mediaRange: import('study').MediaRange, translation: string}|null}
     */
    read(range) {
        let element = range?.startContainer instanceof Element ? range.startContainer : range?.startContainer.parentElement;
        while (element && !this.rows.has(element)) { element = element.parentElement; }
        const row = element ? this.rows.get(element) : null;
        if (!range || !element || !row || !element.contains(range.endContainer) || !element.isConnected || !row.isCurrent()) { return null; }
        const prefix = range.cloneRange();
        prefix.selectNodeContents(element);
        prefix.setEnd(range.startContainer, range.startOffset);
        const offset = prefix.toString().length;
        if (row.text.slice(offset, offset + range.toString().length) !== range.toString()) { return null; }
        const token = crypto.randomUUID();
        const video = row.video();
        this.tokens.set(token, {element,
            row,
            video,
            src: video?.src || '',
            media: video?.currentSrc || video?.src || '',
            srcObject: video?.srcObject ?? null});
        while (this.tokens.size > 100) { this.tokens.delete(/** @type {string} */ (this.tokens.keys().next().value)); }
        return {token,
            sentence: {text: row.text, offset, adjacent: row.context},
            url: row.url,
            videoTime: row.start,
            mediaRange: {start: row.start, end: row.end},
            translation: row.translation()};
    }

    /** @param {string} token */
    cancel(token) { this.active.get(token)?.controller.abort(); }

    /**
     * @param {string} token
     * @param {string} sentence
     * @returns {Promise<string|null>}
     */
    async waitTranslation(token, sentence) {
        const bound = this.tokens.get(token);
        if (!bound || !bound.element.isConnected || !bound.row.isCurrent()) { return ''; }
        if (bound.row.text.trim() !== sentence) { return null; }
        return await bound.row.waitTranslation?.() ?? null;
    }

    /**
     * Replays exactly the looked-up sentence in the page's video and pauses at its end.
     * Moving the playhead elsewhere ends the replay without pausing.
     * @param {string} token
     * @param {(reason: 'ended'|'cancelled'|'failed') => void} [finished]
     * @returns {() => void} Cancels this replay and pauses only its still-current video.
     * @throws {Error}
     */
    play(token, finished) {
        const bound = this.tokens.get(token);
        const video = bound?.video;
        if (!bound || !video) { throw new Error('没找到这句的播放器，请回到视频里重试。'); }
        const isCurrent = () => bound.element.isConnected && bound.row.isCurrent() && video === bound.row.video();
        if (video.src !== bound.src || (video.currentSrc || video.src) !== bound.media || (video.srcObject ?? null) !== bound.srcObject) {
            throw new Error('视频或字幕已改变，请回到视频里重试。');
        }
        const {start, end} = bound.row;
        return this.playRange(video, {start, end, isCurrent}, finished);
    }

    /**
     * Plays a reader-owned range. This does not issue a selection or capture token.
     * @param {HTMLVideoElement} video
     * @param {{start: number, end: number, isCurrent: () => boolean, rate?: number, repeat?: boolean}} range
     * @param {(reason: 'ended'|'cancelled'|'failed') => void} [finished]
     * @returns {(pause?: boolean) => void}
     * @throws {Error}
     */
    playRange(video, {start, end, isCurrent, rate, repeat = false}, finished) {
        const {src, srcObject} = video;
        const media = video.currentSrc || src;
        const live = () => video.isConnected && video.src === src && (video.currentSrc || video.src) === media &&
        video.srcObject === srcObject && isCurrent();
        if (!live()) { throw new Error('视频或字幕已改变，请回到视频里重试。'); }
        if (this.active.size > 0) { throw new Error('正在采集原声，请稍后再回听。'); }
        this.replay?.stop('cancelled');
        const previousRate = video.playbackRate;
        const clockEvents = ['timeupdate', 'playing', 'seeked', 'ratechange'];
        /** @type {ReturnType<typeof setTimeout>|undefined} */
        let timer;
        /** @param {'ended'|'cancelled'|'failed'} reason */
        const stop = (reason) => {
            if (this.replay?.stop !== stop) { return; }
            clearTimeout(timer);
            for (const event of clockEvents) { video.removeEventListener(event, onTime); }
            video.removeEventListener('seeking', onSeek);
            video.removeEventListener('ended', onEnded);
            video.removeEventListener('emptied', onEmptied);
            this.replay = null;
            if (rate !== void 0 && video.playbackRate === rate) { video.playbackRate = previousRate; }
            finished?.(reason);
        };
        const onTime = () => {
            clearTimeout(timer);
            const remaining = end - video.currentTime;
            if (!live()) {
                stop('cancelled');
            } else if (remaining <= 0) {
                if (repeat) {
                    if (!video.paused && !video.seeking) { video.currentTime = start; }
                } else {
                    video.pause();
                    stop('ended');
                }
            } else if (!video.paused && !video.seeking && video.playbackRate > 0) {
                // timeupdate can arrive a fraction of a second after the cue has ended.
                timer = setTimeout(onTime, Math.max(12, remaining * 1000 / video.playbackRate));
            }
        };
        const onSeek = () => {
            clearTimeout(timer);
            const now = video.currentTime;
            const outside = repeat ? now < start - 0.05 || now >= end : now < start - 0.5 || now > end + 0.5;
            if (!live() || outside) { stop('cancelled'); }
        };
        const startPlayback = () => { void video.play()?.catch?.(() => stop('failed')); };
        const onEnded = () => {
            if (!live()) {
                stop('cancelled');
            } else if (repeat && video.ended && video.currentTime > start) {
                video.currentTime = start;
                startPlayback();
            } else {
                if (repeat && !video.ended) { return; }
                stop(video.currentTime >= end - 0.1 ? 'ended' : 'cancelled');
            }
        };
        const onEmptied = () => { stop('cancelled'); };
        this.replay = {video, stop};
        if (rate !== void 0) { video.playbackRate = rate; }
        video.currentTime = start;
        for (const event of clockEvents) { video.addEventListener(event, onTime); }
        video.addEventListener('seeking', onSeek);
        video.addEventListener('ended', onEnded);
        video.addEventListener('emptied', onEmptied);
        startPlayback();
        if (repeat) { onTime(); }
        return (pause = true) => {
            if (this.replay?.stop !== stop) { return; }
            if (pause && live()) { video.pause(); }
            stop('cancelled');
        };
    }

    /**
     * @param {string} token
     * @param {number} start
     * @param {number} duration
     * @param {{withFrame?: boolean, withVideo?: boolean}} [options] Also keep a frame or the sentence clip.
     * @returns {Promise<import('study').MediaCapture>}
     */
    async capture(token, start, duration, {withFrame = false, withVideo = false} = {}) {
        const bound = this.tokens.get(token);
        if (!bound || !bound.element.isConnected || !bound.row.isCurrent() || this.active.size > 0) { throw new Error('字幕或视频已改变，或已有采集；请重新选词。'); }
        const {row} = bound;
        if (start !== row.start || Math.abs(duration - (row.end - row.start)) > 0.001 || duration <= 0 || duration > 30) { throw new Error('只能采集当前字幕的真实时间，最多30秒。'); }
        const video = bound.video;
        const mediaCurrent = () => video !== null && video.isConnected && row.video() === video &&
        video.src === bound.src && (video.currentSrc || video.src) === bound.media && (video.srcObject ?? null) === bound.srcObject;
        if (!video || !mediaCurrent()) { throw new Error('视频来源已改变，请重新选词后采集。'); }
        const controller = new AbortController(); this.active.set(token, {video, controller});
        try {
            return await this.captureAudio(video, start, duration, {signal: controller.signal, isCurrent: () => bound.element.isConnected && row.isCurrent() && mediaCurrent(), withFrame, withVideo});
        } finally { this.active.delete(token); }
    }
}

export const youtubeStudyContext = new YoutubeStudyContext();
