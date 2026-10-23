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
    /**
     * @param {string} value
     * @returns {unknown}
     */
    function parseJson(value) {
        // Standalone MAIN-world script cannot import the product JSON helper.
        // eslint-disable-next-line no-restricted-syntax
        return JSON.parse(value);
    }
    /**
     * @param {string} url
     * @returns {boolean}
     */
    const matches = (url) => String(url).includes('/api/timedtext');
    /**
     * @param {string} url
     * @param {string} body
     * @param {string} transport
     * @param {number} status
     */
    const record = (url, body, transport, status) => {
        let first = '',
            start = null,
            format = 'unknown';
        try {
            const data = /** @type {{events?: Array<{tStartMs: number, segs: Array<{utf8: string}>}>}} */ (parseJson(body));
            const cue = data.events?.find((event) => event.segs?.some((seg) => seg.utf8?.trim()));
            if (cue) {
                first = cue.segs.map((seg) => seg.utf8 || '').join('');
                start = cue.tStartMs / 1000;
                format = 'json3';
            }
        } catch {
            const xml = new DOMParser().parseFromString(body, 'text/xml');
            const cue = [...xml.querySelectorAll('text, p')].find((node) => node.textContent.trim());
            if (cue) {
                first = cue.textContent;
                start = cue.hasAttribute('start') ? Number(cue.getAttribute('start')) : Number(cue.getAttribute('t')) / 1000;
                format = 'xml';
            }
        }
        const summary = {transport, status, length: body.length, first, start, format};
        // Requested console inspection handle; no persistent storage.
        // eslint-disable-next-line no-underscore-dangle
        window.__probe = {...summary, url: String(url), body};
        console.log('[probe]', JSON.stringify(summary));
    };
    const originalFetch = window.fetch;
    window.fetch = function probeFetch(...args) {
        return originalFetch.apply(this, args).then((response) => {
            const url = args[0] instanceof Request ? args[0].url : String(args[0]);
            if (matches(url)) {
                response.clone().text().then((body) => record(url, body, 'fetch', response.status))
                    .catch(() => console.log('[probe] response copy failed'));
            }
            return response;
        });
    };
    // Preserve the method, then invoke it below with the actual XHR receiver.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function probeSend(...args) {
        this.addEventListener('load', () => {
            if (matches(this.responseURL) && (!this.responseType || this.responseType === 'text')) {
                record(this.responseURL, this.responseText, 'xhr', this.status);
            }
        }, {once: true});
        return originalSend.apply(this, args);
    };
})();
