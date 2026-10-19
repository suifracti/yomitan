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
/** @typedef {{text: string, context: string, start: number, end: number, url: string, translation: () => string, video: () => HTMLVideoElement|null, isCurrent: () => boolean}} Row */
/** @typedef {{element: Element, row: Row, video: HTMLVideoElement|null, src: string, media: string, srcObject: HTMLVideoElement['srcObject']}} Bound */
/** @typedef {(video: HTMLVideoElement, start: number, duration: number, options: {signal: AbortSignal, isCurrent: () => boolean}) => Promise<import('study').MediaCapture>} Capture */
export class YoutubeStudyContext {
    /** @param {Capture} [capture] */
    constructor(capture = async (video, start, duration, options) => (await import('./audio-capture.js')).captureVideoAudio(/** @type {HTMLVideoElement & {captureStream: () => MediaStream}} */ (video), start, duration, options)) {
        /** @type {Capture} */
        this.captureAudio = capture;
        /** @type {WeakMap<Element, Row>} */
        this.rows = new WeakMap();
        /** @type {Map<string, Bound>} */
        this.tokens = new Map();
        /** @type {Map<string, AbortController>} */
        this.active = new Map();
    }

    /**
     * @param {Element} element
     * @param {Row} row
     */
    register(element, row) { this.rows.set(element, row); }
    /** Clear source tokens and stop any active capture. */
    reset() {
        for (const controller of this.active.values()) { controller.abort(); }
        this.active.clear();
        this.tokens.clear();
        this.rows = new WeakMap();
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
    cancel(token) { this.active.get(token)?.abort(); }
    /**
     * @param {string} token
     * @param {number} start
     * @param {number} duration
     * @returns {Promise<import('study').MediaCapture>}
     */
    async capture(token, start, duration) {
        const bound = this.tokens.get(token);
        if (!bound || !bound.element.isConnected || !bound.row.isCurrent() || this.active.size > 0) { throw new Error('字幕或视频已改变，或已有采集；请重新选词。'); }
        const {row} = bound;
        if (start !== row.start || Math.abs(duration - (row.end - row.start)) > 0.001 || duration <= 0 || duration > 30) { throw new Error('只能采集当前字幕的真实时间，最多30秒。'); }
        const video = bound.video;
        const mediaCurrent = () => video !== null && video.isConnected && row.video() === video &&
        video.src === bound.src && (video.currentSrc || video.src) === bound.media && (video.srcObject ?? null) === bound.srcObject;
        if (!video || !mediaCurrent()) { throw new Error('视频来源已改变，请重新选词后采集。'); }
        const controller = new AbortController(); this.active.set(token, controller);
        try {
            return await this.captureAudio(video, start, duration, {signal: controller.signal, isCurrent: () => bound.element.isConnected && row.isCurrent() && mediaCurrent()});
        } finally { this.active.delete(token); }
    }
}

export const youtubeStudyContext = new YoutubeStudyContext();
