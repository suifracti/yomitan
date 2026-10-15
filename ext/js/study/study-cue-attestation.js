/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2016-2022  Yomichan Authors
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

/* Private display-only cue confirmation; no storage, Native or save actions. */
export const ASB_CUE_EXTENSION_ID = 'bnbpbghlnjpkcjbabdmjllpcfbibjbap';

/**
 * @param {Pick<typeof chrome.runtime, 'id'|'sendMessage'>} runtime
 * @param {chrome.runtime.MessageSender} sender
 * @param {{queryId?: string, cue?: Record<string, unknown>, phase?: 'revalidate'|'seek'}} data
 * @returns {Promise<Record<string, unknown>>}
 */
export async function attestStudyCue(runtime, sender, data) {
    const denied = {ok: false, writeAuthorized: false};
    const url = sender.tab?.url;
    if (sender.id !== runtime.id || sender.frameId !== 0 || typeof sender.documentId !== 'string' || !sender.documentId ||
    typeof sender.tab?.id !== 'number' || typeof url !== 'string' || !/^https?:\/\//.test(url) || sender.url !== url ||
    typeof data?.queryId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(data.queryId) || data.cue?.url !== url) { return denied; }
    const source = {tabId: sender.tab.id, frameId: 0, documentId: sender.documentId, url};
    const request = {kind: 'study-cue-attest', queryId: data.queryId, source, cue: data.cue};
    /**
     * @param {Record<string, unknown>} message
     * @returns {Promise<unknown>}
     */
    const send = (message) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('cue timeout')), 5000);
        runtime.sendMessage(ASB_CUE_EXTENSION_ID, message, (result) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
                reject(new Error('cue unavailable'));
            } else {
                resolve(/** @type {unknown} */ (result));
            }
        });
    });
    try {
        let receipt;
        if (!data.phase) {
            const prepared = /** @type {Record<string, unknown>} */ (await send({...request, phase: 'prepare'}));
            if (!prepared?.ok || prepared.queryId !== data.queryId || typeof prepared.receipt !== 'string' ||
            typeof prepared.expires !== 'number' || prepared.expires <= Date.now()) { return denied; }
            receipt = prepared.receipt;
        }
        const result = /** @type {Record<string, unknown>} */ (await send({...request, phase: data.phase ?? 'consume', ...(receipt ? {receipt} : {})}));
        if (!result?.ok || result.queryId !== data.queryId || result.writeAuthorized !== false ||
        typeof result.expires !== 'number' || result.expires <= Date.now() ||
        JSON.stringify(result.cue) !== JSON.stringify(data.cue)) { return denied; }
        const returned = /** @type {Record<string, unknown>|undefined} */ (result.source);
        if (!returned || returned.tabId !== source.tabId || returned.frameId !== 0 || returned.documentId !== source.documentId || returned.url !== url) { return denied; }
        return result;
    } catch { return denied; }
}
