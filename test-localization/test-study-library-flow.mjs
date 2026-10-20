import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {StudyService} from '../ext/js/study/study-service.js';
import {prepareStudyTranslation} from '../ext/js/display/study-translation.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTICLE_URL = 'https://example.test/synthetic-article';
const SENTENCE = 'It is a just decision.';
const QUESTION = 'FLOW-SYNTHETIC-QUESTION: Why is just an adjective here?';
const ANSWER = 'FLOW-SYNTHETIC-ANSWER: It means morally right in this sentence.';
const TRANSLATION = 'FLOW-SYNTHETIC-TRANSLATION: 这是一个公正的决定。';
const MEANING = 'FLOW-SYNTHETIC-MEANING: morally right';
const CARD_FRONT = 'Why is just an adjective in this sentence?';
const CARD_BACK = 'It means morally right here.';

const PYTHON_BRIDGE = String.raw`
import json, pathlib, re, sys
sys.path.insert(0, sys.argv[1])
from study_library import StudyLibrary

class FakeAnki:
    def __init__(self):
        self.notes = {}
        self.calls = []
        self.next_id = 700
        self.lose_next_add_response = False
    def __call__(self, action, params):
        self.calls.append({'action': action, 'params': params})
        if action == 'deckNames':
            return [library.deck]
        if action == 'updateNoteFields':
            self.notes[params['note']['id']]['fields'].update(params['note']['fields'])
            return None
        if action == 'storeMediaFile':
            return params['filename']
        if action == 'findNotes':
            query = params.get('query', '')
            tag = re.search(r'tag:(studycard_[a-f0-9]{32}|studypoint_[a-f0-9]{64})', query)
            if tag:
                value = tag.group(1)
                return [ident for ident, note in self.notes.items() if value in note.get('tags', [])]
            word = re.search(r'Word:\*(.*?)\*', query)
            if word:
                needle = word.group(1).replace(r'\*', '*').replace(r'\_', '_')
                return [ident for ident, note in self.notes.items()
                        if needle.casefold() in note.get('fields', {}).get('Word', '').casefold()]
            return []
        if action == 'addNote':
            self.next_id += 1
            ident = self.next_id
            self.notes[ident] = params['note']
            if self.lose_next_add_response:
                self.lose_next_add_response = False
                raise TimeoutError('fixture: Anki wrote the note but its reply was lost')
            return ident
        if action == 'notesInfo':
            return [{'noteId': ident,
                     'modelName': self.notes[ident].get('modelName'),
                     'tags': self.notes[ident].get('tags', []),
                     'fields': {key: {'value': value} for key, value in self.notes[ident].get('fields', {}).items()}}
                    for ident in params['notes'] if ident in self.notes]
        raise AssertionError('unexpected fake Anki action: ' + action)

vault = pathlib.Path(sys.argv[2])
anki = FakeAnki()
library = StudyLibrary(vault, anki=anki)
print(json.dumps({'ready': True, 'model': library.model, 'deck': library.deck}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    ident = request['id']
    try:
        if 'fixture' in request:
            fixture = request['fixture']
            if fixture['op'] == 'seed':
                note_id = fixture.get('note_id', 501)
                anki.notes[note_id] = fixture['note']
                anki.next_id = max(anki.next_id, note_id)
                result = {'noteId': note_id}
            elif fixture['op'] == 'lose_add_reply':
                anki.lose_next_add_response = True
                result = True
            elif fixture['op'] == 'state':
                result = {'notes': anki.notes,
                          'calls': anki.calls,
                          'markdownFiles': [str(p.relative_to(vault)) for p in vault.rglob('*.md')]}
            elif fixture['op'] == 'meta':
                result = {'model': library.model, 'deck': library.deck}
            else:
                raise AssertionError('unknown fixture operation')
        else:
            result = library.handle(request['payload'])
        print(json.dumps({'id': ident, 'ok': True, 'library': result}, ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({'id': ident, 'ok': False, 'error': str(error)}, ensure_ascii=False), flush=True)
`;

function deferred() {
    /** @type {(value?: unknown) => void} */
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return {promise, resolve: /** @type {(value?: unknown) => void} */ (resolve)};
}

class TemporaryVaultBridge {
    /** @param {string} vault */
    constructor(vault) {
        this.child = spawn('python3', ['-B', '-u', '-c', PYTHON_BRIDGE, path.join(ROOT, 'local-bridge'), vault], {stdio: ['pipe', 'pipe', 'pipe']});
        this.pending = new Map();
        this.nextId = 0;
        this.stderr = '';
        this.ready = deferred();
        this.child.stderr.setEncoding('utf8');
        this.child.stderr.on('data', (value) => { this.stderr += value; });
        const lines = createInterface({input: this.child.stdout});
        lines.on('line', (line) => {
            let value;
            try { value = JSON.parse(line); } catch { return; }
            if (value.ready) {
                this.meta = {model: value.model, deck: value.deck};
                this.ready.resolve();
                return;
            }
            const pending = this.pending.get(value.id);
            if (pending) {
                this.pending.delete(value.id);
                pending.resolve(value);
            }
        });
        this.child.on('exit', (code) => {
            const error = new Error(`temporary bridge exited (${code}): ${this.stderr}`);
            this.ready.resolve(error);
            for (const pending of this.pending.values()) { pending.reject(error); }
            this.pending.clear();
        });
    }

    async request(envelope) {
        await this.ready.promise;
        const id = ++this.nextId;
        return await new Promise((resolve, reject) => {
            this.pending.set(id, {resolve, reject});
            this.child.stdin.write(JSON.stringify({id, ...envelope}) + '\n', (error) => {
                if (error) {
                    this.pending.delete(id);
                    reject(error);
                }
            });
        });
    }

    async call(payload) { return await this.request({payload}); }
    async fixture(op, data = {}) { return await this.request({fixture: {op, ...data}}); }
    close() { this.child.kill(); }
}

async function waitFor(predicate, message, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (await predicate()) { return; }
        await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error(`Timed out waiting for ${message}`);
}

function markdownFiles(root) {
    return readdirSync(root, {withFileTypes: true}).flatMap((entry) => {
        const file = path.join(root, entry.name);
        return entry.isDirectory() ? markdownFiles(file) : (file.endsWith('.md') ? [file] : []);
    });
}

function count(text, needle) { return text.split(needle).length - 1; }

async function createHarness(t, {cards = [], loseSaveReply = false} = {}) {
    const vault = mkdtempSync(path.join(tmpdir(), 'yomitan-study-flow-'));
    t.after(() => rmSync(vault, {recursive: true, force: true}));
    const bridge = new TemporaryVaultBridge(vault);
    t.after(() => bridge.close());
    await bridge.ready.promise;
    const data = {};
    const storage = {get: async (key) => ({[key]: data[key]}), set: async (value) => Object.assign(data, value)};
    const nativeCalls = [];
    const modelCalls = [];
    let dropSaveReply = loseSaveReply;
    let holdSave = null;
    let holdExplain = null;
    let nativeCancels = 0;
    const native = (payload) => ({cancel() { nativeCancels += 1; }, promise: (async () => {
        if (payload.action === 'libraryTargetResolve') { return {ok: true, library: {targetId: 'd'.repeat(32)}}; }
        nativeCalls.push(structuredClone(payload));
        if (payload.action === 'explain') {
            modelCalls.push(structuredClone(payload));
            if (holdExplain) { const gate = holdExplain; holdExplain = null; gate.entered.resolve(); await gate.release.promise; }
            return {ok: true,
                result: {translation: TRANSLATION, meaning: MEANING, notes: ANSWER},
                usage: {status: 'completed', inputTokens: 22, outputTokens: 17, totalTokens: 39}};
        }
        if (payload.action === 'cards') {
            modelCalls.push(structuredClone(payload));
            return {ok: true,
                result: {items: payload.items.map((item) => ({id: item.id, reason: 'fixture: only a useful new review point', cards}))},
                usage: {status: 'completed', inputTokens: 31, outputTokens: 12, totalTokens: 43}};
        }
        const response = await bridge.call(payload);
        if (!response.ok) { return response; }
        if (payload.action === 'librarySave' && holdSave) {
            const gate = holdSave;
            holdSave = null;
            gate.entered.resolve();
            await gate.release.promise;
        }
        if (payload.action === 'librarySave' && dropSaveReply) {
            dropSaveReply = false;
            return {ok: false, error: 'fixture: librarySave response lost after temporary Vault write'};
        }
        return {ok: true, library: response.library};
    })()});
    const service = new StudyService(storage, native);
    const previousChrome = globalThis.chrome;
    globalThis.chrome = {
        permissions: {request: async () => true},
        runtime: {sendMessage: async ({studyAction, data: value}) => {
            try { return {ok: true, value: await service.handle(studyAction, value)}; }
            catch (error) { return {ok: false, error: error instanceof Error ? error.message : String(error)}; }
        }}
    };
    t.after(() => {
        if (previousChrome === undefined) { delete globalThis.chrome; }
        else { globalThis.chrome = previousChrome; }
    });
    return {
        vault, bridge, service, storage, native, nativeCalls, modelCalls,
        nativeCancels: () => nativeCancels,
        holdNextExplain() { const gate = {entered: deferred(), release: deferred()}; holdExplain = gate; return gate; },
        holdNextSave() {
            const gate = {entered: deferred(), release: deferred()};
            holdSave = gate;
            return gate;
        }
    };
}

function mountUi(sentence = SENTENCE) {
    const dom = new JSDOM(`<!doctype html><main><article class="study-entry"><p>${sentence}</p><section id="translation"></section></article></main>`, {url: ARTICLE_URL});
    const container = dom.window.document.querySelector('#translation');
    const view = prepareStudyTranslation();
    view.render(container, sentence, 'just', {url: ARTICLE_URL, title: 'Synthetic article'});
    return {dom, container, view};
}

test('editing the PR1 source updates its own visible sentence without a reading-anchor wrapper', async (t) => {
    const h = await createHarness(t);
    const {dom, container} = mountUi();
    const previous = globalThis.HTMLElement;
    globalThis.HTMLElement = dom.window.HTMLElement;
    t.after(() => {
        if (previous === undefined) { delete globalThis.HTMLElement; }
        else { globalThis.HTMLElement = previous; }
        dom.window.close();
    });
    const d = dom.window.document;
    const source = d.createElement('div');
    source.className = 'study-source';
    source.innerHTML = '<p>It is a <mark>just</mark> decision.</p>';
    container.before(source);
    const other = d.createElement('div');
    other.className = 'study-source';
    other.innerHTML = '<p>Unrelated source must remain unchanged.</p>';
    d.body.prepend(other);
    await waitFor(() => container.querySelector('.study-source-editor'), 'source editor');
    const editor = container.querySelector('.study-source-editor');
    const edited = 'After considering all the evidence, it is a just decision.';
    editor.value = edited;
    editor.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    assert.equal(source.querySelector('p').textContent, edited);
    assert.equal(source.querySelector('mark').textContent, 'just');
    assert.equal(other.textContent, 'Unrelated source must remain unchanged.');
    assert.equal(h.modelCalls.length, 0, 'editing does not itself generate or save');
});

async function askCompletedQuestion(container, service) {
    await waitFor(() => container.querySelector('[data-study-translate="explain"]'), 'AI question control');
    const question = container.querySelector('.study-followup');
    assert.ok(question, 'the translation UI must preserve the completed follow-up question');
    question.value = QUESTION;
    container.querySelector('[data-study-translate="explain"]').click();
    await waitFor(() => container.querySelector('.study-request-status')?.textContent.includes('点“记住它”'), 'completed UI answer');
    const turns = await service.handle('journalConversation', {word: 'just', sentence: SENTENCE, context: '', url: ARTICLE_URL, title: 'Synthetic article'});
    assert.equal(turns.length, 1);
    assert.equal(turns[0].question, QUESTION);
    assert.equal(turns[0].translation, TRANSLATION);
    assert.equal(turns[0].meaning, MEANING);
    assert.equal(turns[0].notes, ANSWER);
}

async function latestState(bridge) {
    const value = await bridge.fixture('state');
    assert.equal(value.ok, true, value.error);
    return value.library;
}

test('translation UI saves the completed original Q&A without card selection or Anki writes', async (t) => {
    const h = await createHarness(t, {cards: []});
    const {dom, container, view} = mountUi();
    t.after(() => { view.cancel(); dom.window.close(); });
    await askCompletedQuestion(container, h.service);
    const save = container.querySelector('[data-study-save="note"]');
    assert.ok(save, 'the real translation view must mount the shared save control');
    save.click();
    await waitFor(() => container.querySelector('.study-library-status')?.textContent.includes('笔记已保存'), 'note-only save receipt');

    const saveCall = h.nativeCalls.find((call) => call.action === 'librarySave');
    assert.equal(saveCall.makeCard, false);
    assert.equal(saveCall.entry.sentence, SENTENCE);
    assert.equal(saveCall.entry.translation, TRANSLATION);
    assert.equal(saveCall.entry.meaning, MEANING);
    assert.equal(saveCall.entry.notes, ANSWER);
    assert.equal(saveCall.turns.length, 1);
    assert.equal(saveCall.turns[0].question, QUESTION);
    assert.equal(h.modelCalls.filter((call) => call.action === 'explain').length, 1);
    assert.equal(h.modelCalls.filter((call) => call.action === 'cards').length, 0);

    const state = await latestState(h.bridge);
    assert.equal(state.markdownFiles.length, 1);
    const body = readFileSync(path.join(h.vault, state.markdownFiles[0]), 'utf8');
    assert.match(body, new RegExp(SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(count(body, QUESTION), 1, body);
    assert.ok(body.includes(ANSWER));
    assert.deepEqual(state.notes, {});
    assert.equal(state.calls.some((call) => call.action === 'addNote'), false);
    assert.equal(h.nativeCalls.some((call) => call.action === 'libraryDraftSave'), false);
    assert.equal(h.nativeCalls.some((call) => call.action === 'libraryDraftCommit'), false);
});

test('lost librarySave response retries the note without touching an existing Anki card', async (t) => {
    const h = await createHarness(t, {cards: [{front: CARD_FRONT, back: CARD_BACK}], loseSaveReply: true});
    const meta = h.bridge.meta;
    await h.bridge.fixture('seed', {note: {deckName: meta.deck, modelName: meta.model,
        fields: {Word: CARD_FRONT, Sentence: SENTENCE, Definition: CARD_BACK}, tags: ['english_study']}});
    const {dom, container, view} = mountUi();
    t.after(() => { view.cancel(); dom.window.close(); });
    await askCompletedQuestion(container, h.service);
    const save = container.querySelector('[data-study-save="note"]');
    save.click();
    await waitFor(() => container.querySelector('.study-library-status')?.textContent.includes('response lost'), 'lost-save error');
    await waitFor(() => save.disabled === false, 'save retry enabled');
    save.click();
    await waitFor(() => container.querySelector('.study-library-status')?.textContent.includes('笔记已保存'), 'retried note-only receipt');

    const state = await latestState(h.bridge);
    assert.equal(state.markdownFiles.length, 1);
    const body = readFileSync(path.join(h.vault, state.markdownFiles[0]), 'utf8');
    assert.equal(count(body, QUESTION), 1, body);
    assert.ok(body.includes(ANSWER));
    assert.equal(Object.keys(state.notes).length, 1, 'the seeded exact card remains the only Anki note');
    assert.equal(state.calls.filter((call) => call.action === 'addNote').length, 0);
    assert.equal(h.nativeCalls.some((call) => ['libraryCards', 'libraryCardsAdd', 'libraryDraftCommit'].includes(call.action)), false);
    assert.equal(h.nativeCalls.filter((call) => call.action === 'librarySave').length, 2);
    assert.equal(h.modelCalls.filter((call) => call.action === 'cards').length, 0);
});

test('closing during note save preserves the write without selecting or creating a card', async (t) => {
    const h = await createHarness(t, {cards: [{front: CARD_FRONT, back: CARD_BACK}]});
    const gate = h.holdNextSave();
    const first = mountUi();
    t.after(() => { first.view.cancel(); first.dom.window.close(); });
    await askCompletedQuestion(first.container, h.service);
    first.container.querySelector('[data-study-save="note"]').click();
    await gate.entered.promise;
    first.view.cancel();
    first.container.remove();
    gate.release.resolve();
    await waitFor(async () => (await h.service.saveIntents()).length === 0, 'completed note intent');
    const state = await latestState(h.bridge);
    assert.equal(state.markdownFiles.length, 1);
    assert.deepEqual(state.notes, {});
    assert.equal(state.calls.some(call => call.action === 'addNote'), false);
    assert.equal(h.modelCalls.filter(call => call.action === 'cards').length, 0);
    assert.equal((await h.service.handle('pendingPeek', {language: 'en'})).count, 0);
    const body = readFileSync(path.join(h.vault, state.markdownFiles[0]), 'utf8');
    assert.equal(count(body, QUESTION), 1, body);
    assert.ok(body.includes(ANSWER));
});


test('lost save acknowledgement retains explicit remember intent across service recreation', async (t) => {
    const h = await createHarness(t, {cards: [{front: CARD_FRONT, back: CARD_BACK}], loseSaveReply: true});
    const {dom, container, view} = mountUi();
    t.after(() => { view.cancel(); dom.window.close(); });
    await askCompletedQuestion(container, h.service);
    container.querySelector('[data-study-save="note"]').click();
    await waitFor(() => container.querySelector('.study-library-status')?.textContent.includes('response lost'), 'lost-save receipt');
    view.cancel(); dom.window.close();
    const restarted = new StudyService(h.storage, h.native);
    assert.equal((await restarted.handle('pendingPeek', {language: 'en'})).count, 1);
    const row = await restarted.handle('retryPending', {language: 'en'});
    assert.equal(row.ankiState, 'saved');
    assert.equal((await restarted.handle('pendingPeek', {language: 'en'})).count, 0);
    const state = await latestState(h.bridge);
    assert.equal(state.markdownFiles.length, 1);
    assert.equal(state.calls.filter((x) => x.action === 'addNote').length, 0);
    assert.equal(count(readFileSync(path.join(h.vault, state.markdownFiles[0]), 'utf8'), QUESTION), 1);
});

test('cancel targets frozen Q1 while retaining the unsubmitted Q2 draft and rejects late Q1', async (t) => {
    const h = await createHarness(t);
    const {dom, container, view} = mountUi();
    t.after(() => { view.cancel(); dom.window.close(); });
    const gate = h.holdNextExplain();
    await waitFor(() => container.querySelector('.study-followup'), 'question input');
    const input = container.querySelector('.study-followup');
    input.value = 'Q1 IN FLIGHT';
    container.querySelector('[data-study-translate="explain"]').click();
    await gate.entered.promise;
    input.value = 'Q2 UNSUBMITTED';
    [...container.querySelectorAll('button')].find((x) => x.textContent === '取消').click();
    await waitFor(() => h.nativeCancels() > 0, 'native Q1 cancellation');
    gate.release.resolve();
    await waitFor(() => h.service.pending.size === 0, 'late request settled');
    assert.equal(input.value, 'Q2 UNSUBMITTED');
    assert.equal((await h.service.handle('journalConversation', {word: 'just', sentence: SENTENCE, url: ARTICLE_URL, title: 'Synthetic article'})).length, 0);
});

test('nested lookup is same-frame read-only mini; layered Esc preserves owner then closes it', async (t) => {
    const {prepareStudyMini} = await import('../ext/js/display/study-mini.js');
    const {Frontend} = await import('../ext/js/app/frontend.js');
    const {Display} = await import('../ext/js/display/display.js');
    const dom = new JSDOM('<body><p id="source">Original sentence</p><input value="UNSENT DRAFT"></body>', {url: ARTICLE_URL});
    const keys = ['document', 'window', 'Node', 'Element', 'CustomEvent'];
    const old = Object.fromEntries(keys.map((k) => [k, globalThis[k]]));
    for (const k of keys) globalThis[k] = dom.window[k];
    t.after(() => { for (const k of keys) { if (old[k] === undefined) delete globalThis[k]; else globalThis[k] = old[k]; } dom.window.close(); });
    const d = dom.window.document;
    const close = prepareStudyMini({displayGenerator: {createTermEntry() { const div = d.createElement('div'); div.innerHTML = '<ol data-sc-content="glosses"><li>Morally right; fair.</li></ol>'; return div; }}});
    t.after(close);
    const entries = [{type: 'term', headwords: [{term: 'fair'}]}];
    Frontend.prototype._showContent.call({_pageType: 'popup'}, {text: () => 'fair', getRects: () => [{left: 5, top: 5, bottom: 10, right: 25}]}, false, entries, 'terms', null, null, {}, 'light');
    assert.equal(d.querySelector('.study-mini strong').textContent, 'fair');
    assert.equal(d.querySelectorAll('iframe').length, 0);
    let closed = 0;
    const owner = {_closeSinglePopupMenu: () => false, close: () => { closed += 1; }};
    Display.prototype._onHotkeyClose.call(owner);
    assert.equal(d.querySelector('.study-mini'), null);
    assert.equal(closed, 0);
    assert.equal(d.querySelector('#source').textContent, 'Original sentence');
    assert.equal(d.querySelector('input').value, 'UNSENT DRAFT');
    Display.prototype._onHotkeyClose.call(owner);
    assert.equal(closed, 1);
});
