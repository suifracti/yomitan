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

import {vi} from 'vitest';
import {prepareStudyService} from '../../ext/js/study/study-service.js';

/** @typedef {(message: unknown, sender: {id: string, frameId: number, url: string}, reply: (value: unknown) => void) => boolean} ReaderListener */

/**
 * Connect isolated reader clients to the real background listener using test storage.
 * @param {import('study').Storage} local
 * @param {() => string} [sourceUrl]
 */
export function installReaderStorage(local, sourceUrl = () => location.href) {
    /** @type {ReaderListener} */
    let receive;
    const runtime = {id: 'fixture',
        getURL: (/** @type {string} */ path) => `chrome-extension://fixture/${path}`,
        onMessage: {addListener(/** @type {ReaderListener} */ listener) { receive ??= listener; }},
        sendMessage: (/** @type {unknown} */ message) => new Promise((resolve) => { receive(message, {id: 'fixture', frameId: 0, url: sourceUrl()}, resolve); })};
    vi.stubGlobal('chrome', {runtime,
        storage: {local, onChanged: {addListener() {}, removeListener() {}}},
        permissions: {contains: async () => false}});
    prepareStudyService();
}
