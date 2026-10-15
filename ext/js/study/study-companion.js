// Explicit native handoff only. Niratan owns the learning session, AI and saves.
// @ts-nocheck
import {studyLookup} from './study-data.js';
import {nativeStudyCall} from './study-client.js';

const ENTRY_FIELDS = new Set(['language', 'word', 'sentence', 'context', 'meaning', 'translation', 'notes', 'dictionaryNotes', 'url', 'title', 'lemma', 'reading', 'dictionaryTranslation', 'explanationSource']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function webURL(value) {
    if (typeof value !== 'string' || value.length > 4000 || /[\s\p{Cc}]/u.test(value)) { return false; }
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
            /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/i.test(url.hostname) &&
            !/\.(?:local|localhost|internal|invalid|test)$/i.test(url.hostname);
    } catch { return false; }
}

// Keep the existing prepareStudyService call signature; do not use its service
// or dictionary callback. Tests inject the same narrow native transport boundary.
export function prepareStudyCompanion(_service, _lookupDictionary, nativeCall = nativeStudyCall) {
    const open = async (data, sender) => {
        if (!data || typeof data !== 'object' || Object.keys(data).some(key => !['captureID', 'entry', 'dictionary', 'optionsContext'].includes(key))) {
            throw new Error('只允许明确的网页学习材料。');
        }
        const {entry, captureID} = data;
        if (typeof captureID !== 'string' || !UUID.test(captureID)) { throw new Error('网页交接标识无效，请重新选词。'); }
        studyLookup(entry);
        if (Object.keys(entry).some(key => !ENTRY_FIELDS.has(key)) || entry.language !== 'en' ||
            !/[A-Za-z]/.test(entry.word) || /\p{Cc}/u.test(entry.word)) {
            throw new Error('本项只接英文文章或评论，不接字幕及未知来源。');
        }
        if (!webURL(entry.url) || (entry.title !== undefined && (typeof entry.title !== 'string' || entry.title.length > 1000))) {
            throw new Error('网页地址或标题无效；只接公开 HTTPS 文章。');
        }
        const prefix = chrome.runtime.getURL('');
        const pathname = sender?.url?.slice(prefix.length).split(/[?#]/)[0];
        if (sender?.id !== chrome.runtime.id || !sender.url?.startsWith(prefix) ||
            !['popup.html', 'search.html'].includes(pathname) || !Number.isInteger(sender.tab?.id)) {
            throw new Error('只允许当前 Chrome 词卡发起伴学交接。');
        }
        // Never trust a caller-provided senderUrl. The tab comes from the runtime
        // sender and Chrome supplies its current URL independently of the entry.
        const tab = await chrome.tabs.get(sender.tab.id);
        if (tab.url !== entry.url) { throw new Error('原文章已改变，请从当前文章重新选词。'); }
        const request = {action: 'niratanCapture', captureID, language: 'en', sourceKind: 'web',
            rawSurface: entry.word, sentence: entry.sentence, context: entry.context ?? '',
            url: entry.url, title: entry.title ?? '', quote: entry.sentence,
            dictionaryNotes: entry.dictionaryNotes ?? '', senderUrl: tab.url};
        const response = await nativeCall(request).promise;
        if (response?.ok !== true) { throw new Error(response?.error ?? '未连接 Niratan 隔离候选；未调用 AI 或保存。'); }
        if (!UUID.test(response.capture?.id ?? '') || response.capture?.opened !== true) {
            throw new Error('候选交接回执无效；不能确认 App 已接收。');
        }
        return response.capture;
    };
    // Compatibility with the old relay lifecycle; there is no polling to stop.
    open.close = () => {};
    return open;
}
