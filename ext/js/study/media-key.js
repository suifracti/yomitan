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


import {YOUTUBE_HOSTS, VIDEO_QUERY_KEYS, BILIBILI_HOST, FILE_DURATION_KEY} from './media-rules.js';

/**
 * @param {string} url
 * @returns {URL|null}
 */
function parse(url) {
    try {
        const parsed = new URL(url);
        return ['http:', 'https:', 'file:'].includes(parsed.protocol) ? parsed : null;
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
    if (parsed.protocol === 'file:') {
        const duration = new URLSearchParams(parsed.hash.slice(1)).get(FILE_DURATION_KEY);
        return duration && /^\d+$/.test(duration) ? `file:${decodeURIComponent(parsed.pathname.split('/').pop())}|${duration}` : '';
    }
    const host = parsed.hostname.toLowerCase();
    if (YOUTUBE_HOSTS.has(host)) {
        const id = host === 'youtu.be' ? parsed.pathname.slice(1, 12) : (/^\/(shorts|embed)\//.test(parsed.pathname) ? parsed.pathname.split('/')[2] : parsed.searchParams.get('v'));
        return id && /^[\w-]{11}$/.test(id) ? `youtube:${id}` : '';
    }
    const query = VIDEO_QUERY_KEYS.filter((key) => parsed.searchParams.has(key)).map((key) => `${key}=${parsed.searchParams.get(key)}`).join('&');
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `web:${host}${path}${query ? `?${query}` : ''}`.slice(0, 400);
}

/**
 * Keep route fragments, not ordinary anchors or browser text directives.
 * @param {string} url
 * @returns {string}
 */
export function pageSourceAddress(url) {
    const hash = url.indexOf('#');
    if (hash < 0 || !/^https?:\/\//.test(url)) { return url; }
    const anchor = url.slice(hash + 1).split(':~:', 1)[0];
    return anchor.startsWith('/') || anchor.startsWith('!') || anchor.includes('=') ? `${url.slice(0, hash)}#${anchor}` : url.slice(0, hash);
}

/**
 * Match the saved-note grouping in study_sources.page_source_key, not playback progress.
 * @param {string} url
 * @returns {string}
 */
export function pageSourceKey(url) {
    const parsed = parse(url);
    if (!parsed) { return ''; }
    const host = parsed.hostname;
    if (YOUTUBE_HOSTS.has(host)) {
        const key = mediaKeyOf(url);
        if (key) { return key; }
    }
    if ((host === BILIBILI_HOST || host.endsWith(`.${BILIBILI_HOST}`)) && /^\/video\/(?:BV[0-9A-Za-z]+|av[0-9]+)\/?$/.test(parsed.pathname)) {
        const part = (parsed.searchParams.get('p') || '1').replace(/^0+/, '');
        if (/^\d*$/.test(part)) { return mediaKeyOf(`https://${BILIBILI_HOST}${parsed.pathname}?p=${part || '1'}`); }
    }
    return pageSourceAddress(url);
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
    } else if (host === BILIBILI_HOST || host.endsWith(`.${BILIBILI_HOST}`)) {
        parsed.searchParams.set('t', String(whole));
    } else {
        return {url: parsed.href, timed: false};
    }
    if (parsed.hash.startsWith('#t=')) { parsed.hash = ''; }
    return {url: parsed.href, timed: true};
}

/**
 * The original web video, without the jump we add to ordinary source links.
 * @param {import('study').LibraryEntry|undefined} entry
 * @returns {URL|null}
 */
export function videoListenUrl(entry) {
    if (!entry?.sentence || typeof entry.videoTime !== 'number' || !Number.isFinite(entry.videoTime) || entry.videoTime < 0 ||
    (entry.language && !/^en(?:-|$)/i.test(entry.language))) { return null; }
    const url = parse(entry.url);
    if (!url || url.protocol === 'file:' || !mediaKeyOf(url.href)) { return null; }
    if (timedUrl(url.href, entry.videoTime).timed) {
        url.searchParams.delete('t');
        if (url.hash.startsWith('#t=')) { url.hash = ''; }
    }
    return url;
}
