import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', {url: 'https://en.wikipedia.org/wiki/Language'});
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLDetailsElement', 'NodeFilter', 'CustomEvent']) globalThis[key] = dom.window[key];
globalThis.ResizeObserver = class {observe() {}};
globalThis.requestAnimationFrame = () => {};
const {Frontend} = await import('../ext/js/app/frontend.js');
const {prepareStudyCard} = await import('../ext/js/display/study-card.js');

function selection(text) {
    document.body.innerHTML = '<p></p>';
    document.querySelector('p').textContent = text;
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('p'));
    return range;
}

test('explicit English article selection permits empty dictionary popup; other scan modes unchanged', async () => {
    for (const [text, pageType, allowEmpty, disallowExpand, expected] of [
        ['Would / could ...?', 'web', false, true, true],
        ['語句', 'web', false, true, false],
        ['word', 'popup', false, true, false],
        ['word', 'web', true, false, false],
        ['x'.repeat(129), 'web', false, true, false]]) {
        const range = selection(text), calls = [];
        const frontend = Object.create(Frontend.prototype);
        Object.assign(frontend, {_pageType: pageType, _getFirstSelectionRange: () => range,
            _textScanner: {search: async (source, detail, showEmpty) => calls.push({raw: source.text(), showEmpty})}});
        await frontend._scanSelectedText(allowEmpty, disallowExpand);
        assert.equal(calls[0].showEmpty, expected, text);
        assert.equal(calls[0].raw, text);
    }
});

test('no-result popup keeps actual selected source instead of fabricating surrounding sentence', () => {
    const frontend = Object.create(Frontend.prototype);
    let shown;
    Object.assign(frontend, {_pageType: 'web', _stopClearSelectionDelayed() {},
        _showContent: (...args) => {shown = args;}});
    frontend._onSearchSuccess({type: 'terms', dictionaryEntries: [], sentence: {text: '', offset: 0},
        inputInfo: {eventType: 'script', detail: null}, textSource: {text: () => 'Would / could ...?'},
        optionsContext: {url: 'https://en.wikipedia.org/wiki/Language'}, detail: {documentTitle: 'Language'}, pageTheme: 'light'});
    assert.deepEqual(shown[4], {text: 'Would / could ...?', offset: 0});
});

test('empty dictionary context shows only explicit companion action and sends no AI/save action', async () => {
    document.body.innerHTML = '<main class="content-body-inner"><div id="dictionary-entries"></div><section id="study-context" hidden></section></main>';
    const events = new Map(), calls = [];
    const display = {query: 'Would / could ...?', history: {state: {sentence: {text: 'Would / could ...?', offset: 0},
        url: 'https://en.wikipedia.org/wiki/Language', documentTitle: 'Language'}},
        on: (name, handler) => events.set(name, handler), getOptionsContext: () => ({})};
    globalThis.chrome = {runtime: {sendMessage: async payload => {calls.push(payload);return {ok: true, value: {}};}}};
    prepareStudyCard(display, true);
    events.get('contentUpdateComplete')();
    const context = document.querySelector('#study-context');
    assert.equal(context.hidden, false);
    assert.match(context.textContent, /Would \/ could/);
    assert.ok(context.querySelectorAll('button').length >= 1);
    const ask = context.querySelector('[data-study-translate="explain"]');
    assert.ok(ask);
    assert.deepEqual(calls.map(c => c.studyAction), ['pendingPeek', 'journalConversation']);
    assert.ok(!calls.some(c => c.studyAction === 'studyTranslate' || c.studyAction === 'save'));
    delete globalThis.chrome;
});


test('whole selected text with a dictionary hit still keeps explicit companion entry', () => {
    document.body.innerHTML = '<main class="content-body-inner"><div id="dictionary-entries"><div class="study-entry"><header class="entry-header"></header></div></div><section id="study-context" hidden></section></main>';
    const events = new Map();
    const display = {query: 'running', history: {state: {sentence: {text: 'running', offset: 0}}},
        on: (name, handler) => events.set(name, handler)};
    prepareStudyCard(display, true);
    events.get('contentUpdateComplete')();
    assert.equal(document.querySelector('#study-context').hidden, false);
    assert.ok(document.querySelectorAll('#study-context button').length >= 1);
});

test('real DOM sentence expands a lazy selected surface for both dictionary hit and no hit', async () => {
    const {SubtitleTextScanner} = await import('../ext/js/app/frontend.js');
    const {TextSourceGenerator} = await import('../ext/js/dom/text-source-generator.js');
    const {TextSourceRange} = await import('../ext/js/dom/text-source-range.js');
    const full = 'A previous thought. The efficient person does not rush. A following thought.';
    const expected = 'The efficient person does not rush.';
    const scanner = new SubtitleTextScanner({api: {}, node: window, getSearchContext: () => ({}), textSourceGenerator: new TextSourceGenerator()});
    scanner.setOptions({sentenceParsingOptions: {scanExtent: 200, terminationCharacterMode: 'custom', terminationCharacters: [
        {enabled: true, character1: '.', character2: null, includeCharacterAtStart: false, includeCharacterAtEnd: true}]}});
    for (const hasEntry of [true, false]) {
        const range = selection(full), text = document.querySelector('p').firstChild;
        const offset = full.indexOf('efficient');
        range.setStart(text, offset);range.setEnd(text, offset + 'efficient'.length);
        const source = TextSourceRange.createLazy(range);
        const frontend = Object.create(Frontend.prototype);
        let shown;
        Object.assign(frontend, {_pageType: 'web', _textScanner: scanner, _stopClearSelectionDelayed() {},
            _showContent: (...args) => {shown = args;}});
        frontend._onSearchSuccess({type: 'terms', dictionaryEntries: hasEntry ? [{}] : [],
            sentence: {text: hasEntry ? 'efficient' : '', offset: 0}, inputInfo: {eventType: 'script', detail: null},
            textSource: source, optionsContext: {url: 'https://en.wikipedia.org/wiki/Language'}, detail: null, pageTheme: 'light'});
        assert.equal(shown[4].text, expected, hasEntry ? 'dictionary hit' : 'no hit');
        assert.equal(shown[4].offset, 4);
        assert.match(shown[4].adjacent, /A previous thought/);
        assert.match(shown[4].adjacent, /A following thought/);
        assert.equal(shown[0].text(), 'efficient');
        assert.equal(range.toString(), 'efficient');
    }
});

test('capture keeps the source-derived adjacent context without replacing the selected surface', async () => {
    const {mountStudyCompanion} = await import('../ext/js/display/study-companion-open.js');
    document.body.innerHTML = '<section id="context"></section>';
    const calls = [];
    globalThis.chrome = {runtime: {sendMessage: async payload => {calls.push(payload);return {ok: true, value: {}};}}};
    const sentence = {text: 'The efficient person does not rush.', adjacent: '前句：A previous thought.\n后句：A following thought.'};
    mountStudyCompanion({query: 'efficient', history: {state: {url: 'https://en.wikipedia.org/wiki/Language'}}, getOptionsContext: () => ({})},
        document.querySelector('#context'), sentence);
    document.querySelector('button').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls[0].data.entry.word, 'efficient');
    assert.equal(calls[0].data.entry.sentence, sentence.text);
    assert.equal(calls[0].data.entry.context, sentence.adjacent);
    delete globalThis.chrome;
});


test('lost native reply and explicit retry retain one capture UUID per mounted selection', async () => {
    const {mountStudyCompanion} = await import('../ext/js/display/study-companion-open.js');
    document.body.innerHTML = '<section id="context"></section>';
    const calls = [];
    globalThis.chrome = {runtime: {sendMessage: async payload => {calls.push(payload);return calls.length === 1 ?
        {ok: false, error: 'Reply lost'} : {ok: true, value: {}};}}};
    const display = {query: 'efficient', history: {state: {url: 'https://en.wikipedia.org/wiki/Language'}}, getOptionsContext: () => ({})};
    const sentence = {text: 'The efficient person does not rush.'};
    const context = document.querySelector('#context');
    mountStudyCompanion(display, context, sentence);
    const button = context.querySelector('button');
    button.click();await new Promise(resolve => setImmediate(resolve));
    button.click();await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 2);
    assert.match(calls[0].data.captureID ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(calls[0].data.captureID, calls[1].data.captureID);
    context.replaceChildren();
    mountStudyCompanion(display, context, sentence);
    context.querySelector('button').click();await new Promise(resolve => setImmediate(resolve));
    assert.notEqual(calls[0].data.captureID, calls[2].data.captureID);
    delete globalThis.chrome;
});
