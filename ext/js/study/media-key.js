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


// One identity per watched video, shared by the reader, the background check and
// the local bridge (study_settings.media_key_of mirrors this): YouTube by video ID,
// other sites by host, path and the few query keys that choose a video.

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const VIDEO_QUERY_KEYS = ['v', 'p', 'id', 'vid', 'ep', 'episode', 'video', 'list', 'index'];

/**
 * @param {string} url
 * @returns {URL|null}
 */
function parse(url) {
    try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * @param {string} url
 * @returns {string} '' for URLs that are not web pages.
 */
export function mediaKeyOf(url) {
    const parsed = parse(url);
    if (!parsed) { return ''; }
    const host = parsed.hostname.toLowerCase();
    if (YOUTUBE_HOSTS.has(host)) {
        const id = host === 'youtu.be' ? parsed.pathname.slice(1, 12) : (parsed.pathname.startsWith('/shorts/') ? parsed.pathname.split('/')[2] : parsed.searchParams.get('v'));
        return id && /^[\w-]{11}$/.test(id) ? `youtube:${id}` : '';
    }
    const query = VIDEO_QUERY_KEYS.filter((key) => parsed.searchParams.has(key)).map((key) => `${key}=${parsed.searchParams.get(key)}`).join('&');
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `web:${host}${path}${query ? `?${query}` : ''}`.slice(0, 400);
}

/**
 * A page link that opens at a moment, for the sites known to accept `t=`.
 * Other sites keep the plain page link; the time is shown next to it instead.
 * @param {string} url
 * @param {number} seconds
 * @returns {{url: string, timed: boolean}}
 */
export function timedUrl(url, seconds) {
    const parsed = parse(url);
    if (!parsed || !Number.isFinite(seconds) || seconds < 0) { return {url, timed: false}; }
    const host = parsed.hostname.toLowerCase();
    const whole = Math.floor(seconds);
    if (YOUTUBE_HOSTS.has(host)) {
        parsed.searchParams.set('t', `${whole}s`);
    } else if (host === 'bilibili.com' || host.endsWith('.bilibili.com')) {
        parsed.searchParams.set('t', String(whole));
    } else {
        return {url: parsed.href, timed: false};
    }
    return {url: parsed.href, timed: true};
}
