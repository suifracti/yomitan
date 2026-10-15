import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareStudyCompanion} from '../ext/js/study/study-companion.js';
import {mountStudyCompanion} from '../ext/js/display/study-companion-open.js';

const url = 'https://en.wikipedia.org/wiki/Running';
const sender = {id: 'extension', url: 'chrome-extension://extension/popup.html', tab: {id: 9}};
const entry = () => ({language: 'en', word: 'Running', sentence: '  Running is fun.  ', context: '',
    url, title: 'Running', dictionaryNotes: 'run: move quickly', meaning: 'not a saved result'});
const captureID = '052924d0-1508-47b6-87aa-73a4a5955e6f';
const chromeFor = (tabUrl = url) => ({runtime: {id: 'extension', getURL: path => 'chrome-extension://extension/' + path},
    tabs: {get: async id => ({id, url: tabUrl})}});

test('explicit handoff sends exact raw surface through native host only; App owns AI and saving', async () => {
    const calls = [];
    globalThis.chrome = chromeFor();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => {assert.fail('No HTTP relay may be contacted');};
    const nativeCall = payload => {calls.push(payload);return {promise: Promise.resolve({ok: true, capture: {id: captureID, opened: true}})};};
    const open = prepareStudyCompanion({handle: () => assert.fail('No learning operation in Chrome handoff')},
        () => assert.fail('No dictionary operation in Chrome handoff'), nativeCall);
    try {
        const result = await open({captureID, entry: entry(), dictionary: {}, optionsContext: {}}, sender);
        assert.deepEqual(result, {id: captureID, opened: true});
        assert.deepEqual(calls, [{action: 'niratanCapture', captureID, language: 'en', sourceKind: 'web',
            rawSurface: 'Running', sentence: '  Running is fun.  ', context: '', url, title: 'Running',
            quote: '  Running is fun.  ', dictionaryNotes: 'run: move quickly', senderUrl: url}]);
    } finally {open.close();globalThis.fetch = previousFetch;delete globalThis.chrome;}
});

test('current tab and extension document identity must match before native call', async () => {
    for (const [tabUrl, source] of [[url, {...sender, id: 'other'}], [url, {...sender, url}],
        ['https://example.org/changed', sender], [url, {...sender, tab: undefined}],
        [url, {...sender, url: 'chrome-extension://extension/arbitrary.html'}]]) {
        globalThis.chrome = chromeFor(tabUrl);
        const open = prepareStudyCompanion(null, null, () => assert.fail('Rejected source reached native host'));
        await assert.rejects(open({captureID, entry: entry()}, source));
        open.close();
    }
    delete globalThis.chrome;
});

test('unknown subtitle fields, foreign language, arbitrary paths and unsafe URLs fail closed', async () => {
    globalThis.chrome = chromeFor();
    const open = prepareStudyCompanion(null, null, () => assert.fail('Rejected payload reached native host'));
    for (const change of [{studySubtitle: null}, {subtitleSource: {}}, {subtitle: false},
        {sourceKind: 'subtitle'}, {sourceKind: 'unknown'}, {language: 'ja'}, {word: '語'},
        {outputPath: '/tmp/write'}, {senderUrl: url}, {url: 'http://example.org'},
        {url: 'https://user:secret@example.org/'}, {url: 'https://127.0.0.1/'}, {title: 'x'.repeat(1001)}]) {
        await assert.rejects(open({captureID, entry: {...entry(), ...change}}, sender));
    }
    await assert.rejects(open({captureID, entry: entry(), subtitleSource: {}}, sender));
    await assert.rejects(open({captureID: '../injected', entry: entry()}, sender));
    await assert.rejects(open({entry: entry()}, sender));
    open.close();delete globalThis.chrome;
});

test('ordinary article and comments stay R1; native error is not reported as saved', async () => {
    globalThis.chrome = chromeFor();
    let calls = 0;
    const open = prepareStudyCompanion(null, null, () => {calls++;return {promise: Promise.resolve({ok: false, error: 'Candidate not connected'})};});
    await assert.rejects(open({captureID, entry: {...entry(), sentence: 'A normal comment.'}}, sender), /Candidate not connected/);
    assert.equal(calls, 1);
    open.close();delete globalThis.chrome;
});

test('caller never strips unknown subtitle provenance into a plain article handoff', () => {
    const before = globalThis.document;
    globalThis.document = {createElement: () => assert.fail('Subtitle or dictionary must not get an article button')};
    try {
        for (const marker of [{studySubtitle: null}, {studySubtitle: {sourceType: 'unknown'}},
            {subtitleSource: {}}, {subtitle: false}, {sourceKind: 'subtitle'}, {sourceKind: 'unknown'}, {sourceKind: 'dictionary'}]) {
            mountStudyCompanion({query: 'running'}, {}, {text: 'I am running.', ...marker});
        }
    } finally {globalThis.document = before;}
});

test('punctuated expression and empty dictionary still hand off the original selected surface', async () => {
    globalThis.chrome = chromeFor();
    const calls = [];
    const open = prepareStudyCompanion(null, null, payload => {calls.push(payload);return {promise: Promise.resolve({ok: true, capture: {id: captureID, opened: true}})};});
    await open({captureID, entry: {...entry(), word: 'Would / could ...?', dictionaryNotes: '', lemma: 'would'}, dictionary: {}}, sender);
    assert.equal(calls[0].rawSurface, 'Would / could ...?');
    assert.equal(calls[0].dictionaryNotes, '');
    open.close();delete globalThis.chrome;
});

test('plain article caller permits a punctuated expression without dictionary results', () => {
    const previous = globalThis.document;
    let buttons = 0;
    globalThis.document = {createElement: () => ({setAttribute() {}, addEventListener() {}})};
    try {
        mountStudyCompanion({query: 'Would / could ...?'}, {querySelector: () => ({append() {buttons++;}}), append() {}}, {text: 'Would / could ...? In this sentence.'});
        assert.equal(buttons, 1);
    } finally {globalThis.document = previous;}
});
