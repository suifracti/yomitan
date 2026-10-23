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

(() => {
    const type = 'yomitan-caption-response';
    /** @type {{type: string, url: string, body: string}|null} */
    let latest = null;
    /**
     * @param {string} url
     * @param {string} body
     */
    const publish = (url, body) => {
        if (!body.trim()) { return; }
        latest = {type, url, body};
        window.postMessage(latest, location.origin);
    };
    window.addEventListener('message', (/** @type {MessageEvent<{type?: string, ready?: boolean}|null>} */ event) => {
        const data = event.data;
        if (event.source === window && event.origin === location.origin && data?.type === type && data.ready && latest) {
            window.postMessage(latest, location.origin);
        }
    });
    const originalFetch = window.fetch;
    window.fetch = function captionFetch(...args) {
        return originalFetch.apply(this, args).then((response) => {
            const url = args[0] instanceof Request ? args[0].url : String(args[0]);
            if (url.includes('/api/timedtext')) {
                response.clone().text().then((body) => publish(url, body))
                    .catch(() => {});
            }
            return response;
        });
    };
    // Preserve the method and call it with the actual XMLHttpRequest receiver.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function captionSend(...args) {
        this.addEventListener('load', () => {
            if (this.responseURL.includes('/api/timedtext') && (!this.responseType || this.responseType === 'text')) {
                publish(this.responseURL, this.responseText);
            }
        }, {once: true});
        return originalSend.apply(this, args);
    };
})();
