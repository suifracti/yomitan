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


// Where the caption reader lives on a YouTube watch page. Other sites use WebVideoSite;
// the reader and the in-video captions only talk to one of these.
import {youtubeVideoId} from './vendor/kiss/youtube-caption-source.js';

const ACTIVE_CLASS = 'study-captions-on';

export class YoutubeSite {
    constructor() {
        /** @type {'youtube'} */
        this.kind = 'youtube';
    }

    /** @returns {string|null} */
    mediaKey() {
        const id = location.pathname === '/watch' ? youtubeVideoId(location.href) : null;
        return id ? `youtube:${id}` : null;
    }

    /** @returns {HTMLVideoElement|null} */
    video() {
        const video = document.querySelector('#movie_player video');
        return video instanceof HTMLVideoElement ? video : null;
    }

    /** @returns {string} */
    pageUrl() {
        const key = this.mediaKey();
        return key ? `https://www.youtube.com/watch?v=${key.slice(8)}` : location.href;
    }

    /**
     * The right column is hidden in YouTube's narrow layout; fall back to below the video.
     * @returns {Element|null}
     */
    host() {
        const candidates = ['#secondary-inner', '#secondary', '#below'].map((s) => document.querySelector(s)).filter((e) => e !== null);
        return candidates.find((e) => e instanceof HTMLElement && e.offsetWidth > 0) ?? candidates[0] ?? null;
    }

    /** @returns {boolean} YouTube inserts panels above ours later; keep the list first. */
    pinFirst() { return true; }

    /** @param {() => void} onChange */
    watch(onChange) {
        document.addEventListener('yt-navigate-finish', onChange);
        window.addEventListener('popstate', onChange);
    }

    /** @returns {boolean} */
    active() { return location.pathname === '/watch'; }

    /** @returns {HTMLElement|null} */
    player() {
        const player = document.querySelector('#movie_player');
        return player instanceof HTMLElement ? player : null;
    }

    /** @returns {Element|null} */
    controls() { return this.player()?.querySelector('.ytp-right-controls') ?? null; }

    /** @param {boolean} on */
    hideNative(on) { this.player()?.classList.toggle(ACTIVE_CLASS, on); }

    /** @returns {number} */
    height() { return this.player()?.clientHeight ?? 0; }

    /**
     * The sidebar is part of the page here, always open.
     * @param {boolean} [_open]
     * @returns {boolean}
     */
    toggleDock(_open) { return true; }

    /** @returns {boolean} */
    dockOpen() { return true; }
}

export const youtubeSite = new YoutubeSite();
