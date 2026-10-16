import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {prepareStudyCard} from '../ext/js/display/study-card.js';
import {prepareStudyMini} from '../ext/js/display/study-mini.js';
import {prepareStudyDictionary} from '../ext/js/display/study-dictionary.js';
import {prepareStudyTranslation} from '../ext/js/display/study-translation.js';
import {Frontend} from '../ext/js/app/frontend.js';
const tick = () => new Promise(r => setImmediate(r));
function setup(html) {
    const dom = new JSDOM(html, {url: 'https://example.test/article'});
    for (const k of ['document', 'window', 'Node', 'Element', 'HTMLElement', 'HTMLDetailsElement', 'HTMLTextAreaElement', 'CustomEvent', 'MouseEvent']) globalThis[k] = dom.window[k];
    globalThis.ResizeObserver = class {observe() {}};
    globalThis.requestAnimationFrame = () => {};
    return dom;
}
test('main meanings explain POS and the real original dictionary folds as one section', () => {
    const dom = setup('<div class="content-body-inner"><input id="study-auto-size"><div id="study-context" class="scan-disable"></div></div>');
    const callbacks = new Map();
    const display = {on: (n, fn) => callbacks.set(n, fn), query: 'repeatedly'};
    prepareStudyCard(display);
    const entry = document.createElement('section');
    entry.innerHTML = '<div class="entry-header"></div><div class="entry-body"><ol class="definition-list"><li class="definition-item"><div data-sc-study-role="card"><div data-sc-study-role="meaning"><div>adv. 重复地，再三地</div></div><details data-sc-study-role="english"><summary>英文解释</summary><div>several time</div></details></div></li><li class="definition-item"><ol data-sc-content="glosses"><li>Done several times or in repetition.</li></ol><ul><li>again and again</li></ul></li></ol></div>';
    callbacks.get('contentUpdateEntry')({element: entry, dictionaryEntry: {type: 'term', headwords: [{term: 'repeatedly'}]}, index: 0});
    assert.equal(entry.querySelector('.study-pos').textContent, 'adv. 副词');
    assert.equal(document.querySelector('#study-context').closest('.scan-disable'), null);
    const fold = entry.querySelector('.study-original-dictionary');
    assert.ok(fold?.contains(entry.querySelector('[data-sc-content=glosses]')));
    assert.ok(fold.contains(entry.querySelector('.study-dictionary-controls')));
    fold.open = false;
    assert.equal(fold.open, false);
    assert.match(fold.textContent, /again and again/);
    dom.window.close();
});
test('dictionary translation includes orphan phrases, names its scope and reveals the result', async () => {
    const dom = setup('<section><div class="entry-body"><ol class="definition-list"><li class="definition-item"><ol data-sc-content="glosses"><li>Done several times.</li></ol><ul><li>again and again</li><li>over and over again</li></ul></li></ol></div></section>');
    const entry = document.querySelector('section');
    let sent;
    globalThis.chrome = {permissions: {request: async () => true}, runtime: {sendMessage: async ({studyAction, data}) => {
        if (studyAction === 'dictionaryGenerate') {sent = data; return {ok: true, value: {cached: false, result: {items: data.items.map(x => ({id: x.id, translation: `中文 ${x.text}`}))}}};}
        return {ok: true, value: {result: null, busy: false}};
    }}};
    const dispose = prepareStudyDictionary(entry, 'repeatedly');
    await tick();
    const button = [...entry.querySelectorAll('button')].find(b => /翻译本组英文/.test(b.textContent));
    assert.ok(button);
    button.click(); await tick();
    assert.match(sent.items.map(x => x.text).join('\n'), /again and again/);
    assert.match(sent.items.map(x => x.text).join('\n'), /over and over again/);
    assert.equal(entry.querySelectorAll('.study-sense-translation').length, 3);
    assert.equal(button.textContent, '本组已译');
    dispose(); dom.window.close();
});
test('dictionary failure exposes an explicit retry button and preserves the current word', async () => {
 const {mountOriginalEnglish}=await import('../ext/js/display/study-card.js');
 const dom=setup('<section class="study-entry"><div class="study-primary-meaning">n. 脑</div><ol data-sc-content="glosses"><li>The organ controlling thought.</li></ol></section>');
 let attempts=0;
 globalThis.chrome={permissions:{request:async()=>true},runtime:{sendMessage:async({studyAction})=>{
  if(studyAction==='dictionaryPeek')return {ok:true,value:{result:null}};
  if(studyAction==='dictionaryGenerate'){attempts++;return attempts===1?{ok:false,error:'Disconnected'}:{ok:true,value:{result:{items:[{id:'0',translation:'大脑器官'}]}}};}
  throw Error('Unexpected action: '+studyAction);
 }}};
 const entry=document.querySelector('.study-entry');
 const stop=mountOriginalEnglish(entry,'brain',false); await tick();
 const retry=entry.querySelector('.study-english-retry');
 assert.ok(retry&&!retry.hidden);assert.equal(attempts,0);
 retry.click();await tick();await tick();assert.match(retry.textContent,/重试翻译/);
 retry.click();await tick();await tick();assert.equal(attempts,2);
 assert.equal(retry.hidden,true);assert.match(entry.querySelector('.study-english-chinese').textContent,/大脑器官/);
 stop();dom.window.close();
});

test('pending Anki card shows a targeted safe resend without re-saving the learning note',async()=>{
 const {mountStudyLibrary}=await import('../ext/js/display/study-library.js');
 const dom=setup('<section id="current"><div class="study-translation-actions"></div></section>');
 const id='a'.repeat(32), entry={word:'improve',language:'en',sentence:'I want to improve.',url:'https://example.com',title:'Example'};
 const card={id:'card1',front:'improve?',back:'改善',state:'pending',noteId:null,error:'Anki not connected'};
 const pending={id,entry,ankiEnabled:true,ankiState:'pending',path:'记录/improve.md',cards:[card]};
 let saves=0,resumes=0;
 globalThis.chrome={permissions:{request:async()=>true},runtime:{sendMessage:async({studyAction,data})=>{
  if(studyAction==='pendingPeek')return {ok:true,value:{count:0}};
  if(studyAction==='rememberEntry'){saves++;return {ok:true,value:pending};}
  if(studyAction==='remember'){resumes++;assert.deepEqual(data,{id,language:'en'});return {ok:true,value:{...pending,ankiState:'synced',cards:[{...card,noteId:321,state:'synced'}]}};}
  throw Error('Unexpected action '+studyAction);
 }}};
 const node=document.getElementById('current');
 mountStudyLibrary(node,()=>entry,()=>true);
 node.querySelector('[data-study-save=note]').click();await tick();await tick();
 const anki=node.querySelector('.study-anki-status'),retry=anki.querySelector('button');
 assert.match(anki.textContent,/1 张卡待核对/);assert.equal(retry.hidden,false);
 retry.click();await tick();await tick();assert.equal(saves,1);assert.equal(resumes,1);
 assert.match(anki.textContent,/已同步 1 张卡/);assert.equal(retry.hidden,true);
 dom.window.close();
});

test('mini opens the existing complete dictionary window without changing the parent or draft', async () => {
    const dom = setup('<p id="parent">Original sentence</p><textarea>UNSENT</textarea>');
    const opened = [];
    const close = prepareStudyMini({application: {api: {getOrCreateSearchPopup: async x => opened.push(x)}}, displayGenerator: {createTermEntry() {const n = document.createElement('div'); n.innerHTML = '<div data-sc-study-role="meaning"><div>n. 重复</div></div>'; return n;}}});
    document.dispatchEvent(new CustomEvent('study-mini-lookup', {cancelable: true, detail: {query: 'repetition', entries: [{type: 'term', headwords: [{term: 'repetition'}]}]}}));
    const button = [...document.querySelectorAll('.study-mini button')].find(b => /完整词卡/.test(b.textContent));
    assert.ok(button);
    button.click(); await tick();
    assert.deepEqual(opened, [{focus: true, text: 'repetition'}]);
    assert.equal(document.querySelector('textarea').value, 'UNSENT');
    assert.equal(document.querySelector('#parent').textContent, 'Original sentence');
    close(); dom.window.close();
});
test('own popup does not swallow modifier lookup over the current original sentence', async () => {
    const popup = {_pageType: 'popup', _popup: {containsPoint: async () => true}, _application: {webExtension: {unloaded: false}}};
    assert.equal(await Frontend.prototype._ignorePoint.call(popup, 40, 40), false);
    popup._pageType = 'web';
    assert.equal(await Frontend.prototype._ignorePoint.call(popup, 40, 40), true);
});
test('follow-up and token details are compact controls, no request generated by opening usage', async () => {
    const dom = setup('<section id="context"></section>');
    let generated = 0;
    globalThis.chrome = {runtime: {sendMessage: async ({studyAction}) => {
        if (studyAction === 'generate') generated++;
        const value = ['journalConversation', 'conversationUsage'].includes(studyAction) ? [] : {result: null};
        return {ok: true, value};
    }}};
    const translation = prepareStudyTranslation();
    translation.render(document.querySelector('section'), 'You are what you repeatedly do.', 'repeatedly');
    await tick();
    assert.equal(document.querySelector('.study-followup').tagName, 'TEXTAREA');
    assert.equal(document.querySelector('.study-token-summary').tagName, 'DETAILS');
    assert.equal(document.querySelector('.study-token-summary').open, false);
    document.querySelector('.study-token-summary').open = true; await tick();
    assert.equal(generated, 0);
    translation.cancel(); dom.window.close();
});

test('ordinary complete-window entry boots the same study card, not the legacy display', async () => {
    const {readFileSync} = await import('node:fs');
    const html = readFileSync(new URL('../ext/search.html', import.meta.url), 'utf8');
    const dom = setup(html);
    globalThis.location = dom.window.location;
    globalThis.chrome = {runtime: {sendMessage: async ({studyAction}) => ({ok: true, value: ['journalConversation', 'conversationUsage'].includes(studyAction) ? [] : {result: null}})}};
    class Controller {prepare() {} focusElement() {}}
    class SearchDisplay {
        constructor() {this.callbacks = new Map(); this.history = {state: {sentence: {text: 'Change; alteration.', offset: 8}, url: ''}}; this.query = 'alteration';}
        async prepare() {}
        on(n, fn) {this.callbacks.set(n, fn);}
        initializeState() {
            const entry = document.createElement('section');
            entry.innerHTML = '<div class="entry-header">alteration</div><div class="entry-body"><div data-sc-study-role="card"><div data-sc-study-role="meaning"><div>n. 变化</div></div></div></div>';
            this.callbacks.get('contentUpdateEntry')?.({element: entry, dictionaryEntry: {type: 'term', headwords: [{term: 'alteration'}]}, index: 0});
            document.querySelector('#dictionary-entries').append(entry);
            this.callbacks.get('contentUpdateComplete')?.();
        }
    }
    const main = readFileSync(new URL('../ext/js/display/search-main.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
    const deps = {Application: {main: async (_enabled, fn) => fn({crossFrame: {}})}, DocumentFocusController: Controller, HotkeyHandler: Controller, SearchPersistentStateController: Controller, SearchActionPopupController: Controller, Display: SearchDisplay, DisplayAudio: Controller, DisplayAnki: Controller, SearchDisplayController: Controller, ModalController: Controller, SettingsController: Controller, SettingsDisplayController: Controller, prepareStudyCard};
    await new (Object.getPrototypeOf(async function () {}).constructor)(...Object.keys(deps), main)(...Object.values(deps));
    assert.equal(document.querySelector('.study-pos')?.textContent, 'n. 名词');
    assert.ok(document.querySelector('.study-followup'));
    assert.equal(document.documentElement.dataset.studyDetail, 'true');
    assert.equal(document.querySelector('.study-search-options')?.open, false);
    dom.window.close();
});

test('selection shortcut closes an empty-selection root and routes outside close to the top card layer', async () => {
    const dom = setup('<p>No selection</p>');
    let closed = 0, layer = 0;
    const owner = Object.create(Frontend.prototype);
    Object.assign(owner, {_pageType: 'web', _textScanner: {isSelectionFromLookup: () => false, getPointerPosition: () => null, getCurrentTextSource: () => null}, _popup: {isVisible: async () => true, toggleStudyLayer: async () => {layer++; return true;}}, _clearSelection: () => {closed++;}});
    owner._onActionScanSelectedText(); await tick();
    assert.equal(layer, 1); assert.equal(closed, 0);
    owner._popup.toggleStudyLayer = async () => false;
    owner._onActionScanSelectedText(); await tick();
    assert.equal(closed, 1);
    dom.window.close();
});
test('mini shortcut restores its last child and releases only that child selection', async () => {
    const dom = setup('<p id="source">alteration</p><textarea>UNSENT</textarea>');
    let closed = 0, remote;
    const close = prepareStudyMini({close: () => closed++, registerDirectMessageHandlers: pairs => remote = pairs[0][1], displayGenerator: {createTermEntry() {const n = document.createElement('div'); n.textContent = 'Change'; return n;}}});
    const select = () => {const r = document.createRange();r.selectNodeContents(document.querySelector('#source'));window.getSelection().removeAllRanges();window.getSelection().addRange(r);};
    const show = () => document.dispatchEvent(new CustomEvent('study-mini-lookup', {cancelable: true, detail: {query: 'alteration', entries: [{type: 'term', headwords: [{term: 'alteration'}]}]}}));
    select(); show();
    document.dispatchEvent(new CustomEvent('study-shortcut-toggle', {cancelable: true}));
    assert.equal(document.querySelector('.study-mini'), null); assert.equal(closed, 0);
    assert.equal(window.getSelection().toString(), '');
    document.dispatchEvent(new CustomEvent('study-shortcut-toggle', {cancelable: true}));
    assert.equal(closed, 0);
    assert.ok(document.querySelector('.study-mini'), 'second press restores the hidden mini');
    select(); show(); assert.ok(document.querySelector('.study-mini'));
    const r = document.createRange(); r.selectNodeContents(document.querySelector('textarea')); window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
    remote(); assert.equal(window.getSelection().toString(), 'UNSENT');
    assert.equal(document.querySelector('textarea').value, 'UNSENT');
    close(); dom.window.close();
});
test('missing nested dictionary results remain a mini layer, never replace the parent session', () => {
    const dom = setup('<p id="parent">Parent question</p><textarea>UNSENT</textarea>');
    const close = prepareStudyMini({displayGenerator: {createTermEntry() {throw Error('No entry to render');}}});
    let replaced = false;
    const owner = {_pageType: 'popup', _application: {}, _textScanner: {studySources: new WeakMap()}, _showPopupContent: () => replaced = true};
    Frontend.prototype._showContent.call(owner, {text: () => 'unlisted expression', getRects: () => []}, false, [], 'terms', null, null, {}, 'light');
    assert.equal(replaced, false);
    assert.match(document.querySelector('.study-mini').textContent, /暂无/);
    assert.equal(document.querySelector('textarea').value, 'UNSENT');
    close(); dom.window.close();
});

test('focused card forwards outside-pointer shortcut, but an actual in-card selection always wins', async () => {
    const dom = setup('<p>selected word</p>');
    const matches = document.documentElement.matches.bind(document.documentElement);
    document.documentElement.matches = selector => selector === ':hover' ? false : matches(selector);
    let forwarded = 0, searched = '';
    const forward = event => {forwarded++; event.preventDefault();};
    document.addEventListener('study-shortcut-forward', forward);
    const owner = Object.create(Frontend.prototype);
    Object.assign(owner, {_pageType: 'popup', _popup: null, _textScanner: {isSelectionFromLookup: () => false, getPointerPosition: () => null, getCurrentTextSource: () => null, setCurrentTextSource() {}}, _scanSelectedText: async () => {searched = window.getSelection().toString();}});
    await owner._studySelectionShortcut(true, true);
    assert.equal(forwarded, 1); assert.equal(searched, '');
    const range = document.createRange();range.selectNodeContents(document.querySelector('p'));window.getSelection().addRange(range);
    await owner._studySelectionShortcut(true, true);
    assert.equal(searched, 'selected word'); assert.equal(forwarded, 1);
    dom.window.close();
});
test('hidden root recovers its existing card before inspecting text now behind it, without requery', async () => {
    const {Popup} = await import('../ext/js/app/popup.js');
    const dom = setup('<textarea>KEEP DRAFT</textarea>');
    let visible = false, focused = 0;
    const popup = Object.create(Popup.prototype);
    Object.assign(popup, {_studyHasContent: true, _frameClient: {isConnected: () => true}, _frame: {isConnected: true, contentWindow: {focus: () => focused++}}, isVisibleSync: () => visible, stopHideDelayed() {}, _setVisible: value => visible = value, _invokeSafe: async () => {throw Error('No content request needed');}});
    const owner = Object.create(Frontend.prototype);
    Object.assign(owner, {_pageType: 'web', _popup: popup, _textScanner: {isSelectionFromLookup: () => false, getPointerPosition: () => {throw Error('Restoration must not query newly revealed background text');}}});
    await owner._studySelectionShortcut(true, true);
    assert.equal(visible, true); assert.equal(focused, 1); assert.equal(document.querySelector('textarea').value, 'KEEP DRAFT');
    dom.window.close();
});


test('empty in-card lookup never replaces the parent with a self-origin no-results card', () => {
    const dom = setup('<p>Parent</p><textarea>KEEP DRAFT</textarea>');
    let replaced = false;
    const owner = {_pageType: 'popup', _application: {}, _textScanner: {studySources: new WeakMap()}, _showPopupContent: () => replaced = true};
    Frontend.prototype._showContent.call(owner, {text: () => '', getRects: () => []}, false, [], 'terms', null, null, {}, 'light');
    assert.equal(replaced, false);
    assert.equal(document.querySelector('textarea').value, 'KEEP DRAFT');
    dom.window.close();
});
test('a no-results card can close even when its content origin points to itself', async () => {
    const {Display} = await import('../ext/js/display/display.js');
    const calls = [];
    const display = {_pageType: 'popup', _parentPopupId: 'host-card', invokeContentOrigin: async () => {throw Error('Content origin is same page');}, invokeParentFrame: async (...args) => calls.push(args)};
    Display.prototype.close.call(display);
    await tick();
    assert.deepEqual(calls, [['popupFactoryHide', {id: 'host-card', changeFocus: true, force: true}]]);
});
test('incidental pointer miss does not request an empty replacement card', async () => {
    const dom = setup('<p>Parent</p>');
    let showEmpty;
    const pointer = {cleanup() {}};
    const owner = Object.create(Frontend.prototype);
    Object.assign(owner, {_pageType: 'web', _popup: {isVisible: async () => true}, _textScanner: {isSelectionFromLookup: () => false, getPointerPosition: () => ({x: 5, y: 5}), getTextSourceAtPointer: () => pointer, getCurrentTextSource: () => null, setCurrentTextSource() {}, search: async (_s, _i, empty = false) => {showEmpty = empty;}}});
    await owner._studySelectionShortcut(true, true);
    assert.equal(showEmpty, false);
    dom.window.close();
});

test('a newer native Chinese or English range is not mistaken for the last automatic highlight', async () => {
    const {TextScanner} = await import('../ext/js/language/text-scanner.js');
    const {TextSourceRange} = await import('../ext/js/dom/text-source-range.js');
    const dom = setup('<p>previous 新选择 English</p>');
    const text = document.querySelector('p').firstChild;
    const range = (a, b) => {const r = document.createRange();r.setStart(text, a);r.setEnd(text, b);return r;};
    const old = range(0, 8);
    const scanner = Object.create(TextScanner.prototype);
    scanner._textSourceCurrentSelected = true;
    scanner._textSourceCurrent = TextSourceRange.create(old);
    const selection = window.getSelection();
    selection.addRange(old.cloneRange());
    assert.equal(scanner.isSelectionFromLookup(), true);
    for (const r of [range(9, 12), range(13, 20)]) {
        selection.removeAllRanges();selection.addRange(r);
        assert.equal(scanner.isSelectionFromLookup(), false, `new selection: ${r.toString()}`);
    }
    scanner._canClearSelection = true;
    scanner._selectionRestoreInfo = {ranges: [old.cloneRange()]};
    scanner.clearSelection();
    assert.equal(selection.toString(), 'English', 'cleanup must not erase the newer manual range or restore an older one');
    assert.equal(scanner._selectionRestoreInfo, null);
    selection.removeAllRanges();
    assert.equal(scanner.isSelectionFromLookup(), false);
    dom.window.close();
});
test('reselecting a word inside the card wins over a moved pointer, even at the previous lookup range', async () => {
    const {TextSourceRange} = await import('../ext/js/dom/text-source-range.js');
    const dom = setup('<p>English 中文释义 another</p>');
    globalThis.Range = dom.window.Range;
    const text = document.querySelector('p').firstChild;
    for (const [start, end] of [[0, 7], [8, 12]]) {
        const r = document.createRange();r.setStart(text, start);r.setEnd(text, end);
        window.getSelection().removeAllRanges();window.getSelection().addRange(r);
        const point = document.createRange();point.setStart(text, 14);point.collapse(true);
        let searched = '', toggles = 0;
        const owner = Object.create(Frontend.prototype);
        Object.assign(owner, {_pageType: 'popup', _popup: null, _studyLastLookupSource: TextSourceRange.create(r.cloneRange()), _textScanner: {isSelectionFromLookup: () => false, getPointerPosition: () => ({x: 20, y: 20}), getTextSourceAtPointer: () => TextSourceRange.create(point), getCurrentTextSource: () => null, setCurrentTextSource() {}, search: async () => {searched = 'WRONG POINTER';}}, _scanSelectedText: async () => {searched = window.getSelection().toString();}, _clearSelection: () => toggles++});
        await owner._studySelectionShortcut(true, true);
        assert.equal(searched, r.toString());
        assert.equal(toggles, 0);
    }
    dom.window.close();
});

test('an already-used manual range does not block pointer switching; a new gesture can select it again', async () => {
    const {TextScanner} = await import('../ext/js/language/text-scanner.js');
    const {TextSourceRange} = await import('../ext/js/dom/text-source-range.js');
    const dom = setup('<p>changing miserable ourselves</p>');
    const node = document.querySelector('p').firstChild;
    const range = document.createRange();range.setStart(node, 0);range.setEnd(node, 8);window.getSelection().addRange(range);
    const scanner = Object.create(TextScanner.prototype);
    Object.assign(scanner, {_textSourceCurrent: TextSourceRange.create(range.cloneRange()), _textSourceCurrentSelected: false, _canClearSelection: true, _selectionRestoreInfo: null, getPointerPosition: () => ({x: 35, y: 45}), getTextSourceAtPointer: () => ({cleanup() {}})});
    let lookup = '';
    scanner.search = async () => {lookup = 'miserable';};
    const owner = Object.create(Frontend.prototype);
    Object.assign(owner, {_pageType: 'popup', _popup: null, _textScanner: scanner, _scanSelectedText: async () => {lookup = window.getSelection().toString();}});
    await owner._studySelectionShortcut(true, true);
    assert.equal(lookup, 'miserable', 'old manual highlight must not lock the previous word');
    assert.equal(window.getSelection().toString(), '', 'retargeting releases the consumed range, not a new selection');
    scanner.clearSelection(); // Existing pointer-down path: a fresh selection is no longer consumed.
    window.getSelection().addRange(range.cloneRange());
    await owner._studySelectionShortcut(true, true);
    assert.equal(lookup, 'changing', 'an actual new selection wins even at the same range');
    dom.window.close();
});
test('English pointer lookup does not swallow intervening words into an interposed phrasal guess', async () => {
    const {TextScanner} = await import('../ext/js/language/text-scanner.js');
    const dom = setup('<p>major things in my life</p>');
    const guessed = {type: 'term', headwords: [{term: 'major in'}], inflectionRuleChainCandidates: [{source: 'algorithm', inflectionRules: [{name: 'interposed object'}]}]};
    const literal = {type: 'term', headwords: [{term: 'major'}], inflectionRuleChainCandidates: []};
    const calls = [];let size;
    const scanner = Object.create(TextScanner.prototype);
    Object.assign(scanner, {_language: 'en', _scanLength: 32, getTextSourceContent: () => 'major things in my life', _api: {termsFind: async text => {calls.push(text);return text === 'major' ? {dictionaryEntries: [literal], originalTextLength: 5} : {dictionaryEntries: [guessed], originalTextLength: 15};}}, _textSourceGenerator: {extractSentence: () => ({text: 'major things in my life', offset: 0})}});
    const source = {text: () => '', setEndOffset: length => size = length};
    const result = await scanner._findTermDictionaryEntries(source, {});
    assert.equal(result.dictionaryEntries[0].headwords[0].term, 'major');
    assert.equal(size, 5);
    assert.deepEqual(calls, ['major']);
    calls.length = 0;
    const {TextSourceRange} = await import('../ext/js/dom/text-source-range.js');
    const r = document.createRange();r.setStart(document.querySelector('p').firstChild, 0);r.setEnd(document.querySelector('p').firstChild, 15);
    const explicit = await scanner._findTermDictionaryEntries(TextSourceRange.createLazy(r), {});
    assert.equal(explicit.dictionaryEntries[0], guessed, 'deliberate multiword selection keeps the existing phrase support');
    assert.equal(calls.length, 1);
    dom.window.close();
});

test('switching back to the displayed word supersedes a different in-flight mini lookup', async () => {
    const {SubtitleTextScanner} = await import('../ext/js/app/frontend.js');
    const {TextSourceRange} = await import('../ext/js/dom/text-source-range.js');
    const dom = setup('<p>improve things</p>');
    const node = document.querySelector('p').firstChild;
    const previous = document.createRange();previous.setStart(node, 0);previous.setEnd(node, 7);
    const pointer = previous.cloneRange();pointer.collapse(true);
    let searched = 0;
    const scanner = Object.create(SubtitleTextScanner.prototype);
    Object.assign(scanner, {studyQuery: 2, isSelectionFromLookup: () => false, getPointerPosition: () => ({x: 3, y: 7}), getTextSourceAtPointer: () => TextSourceRange.create(pointer), getCurrentTextSource: () => null, setCurrentTextSource() {}, search: async () => searched++});
    const owner = Object.create(Frontend.prototype);
    Object.assign(owner, {_pageType: 'popup', _popup: null, _studyLastLookupSource: TextSourceRange.create(previous), _studyLastLookupQuery: 1, _textScanner: scanner, _clearSelection() {}});
    await owner._studySelectionShortcut(true, true);
    assert.equal(searched, 1, 'returning to the old word must supersede the pending different word, not just toggle');
    dom.window.close();
});

test('default English scanning looks up one word; only explicit selection searches a phrase', async () => {
    const {TextScanner} = await import('../ext/js/language/text-scanner.js');
    const {TextSourceRange} = await import('../ext/js/dom/text-source-range.js');
    const dom = setup('<p>rocket fuel of change</p>');
    const p = document.querySelector('p');
    const calls = [];
    const scanner = Object.create(TextScanner.prototype);
    Object.assign(scanner, {_language: 'en', _scanLength: 64, _includeSelector: null, _excludeSelector: null, _api: {termsFind: async text => {calls.push(text);return {dictionaryEntries: [{type: 'term', headwords: [{term: text}]}], originalTextLength: text.length};}}, _textSourceGenerator: {extractSentence: () => ({text: p.textContent, offset: 0})}});
    for (const [sentence, word] of [['rocket fuel of change', 'rocket'], ['not absolutely miserable', 'not'], ["doesn’t perceive change", 'doesn’t'], ['self-disciplined person', 'self-disciplined']]) {
        p.textContent = sentence;
        const r = document.createRange();r.setStart(p.firstChild, 0);r.collapse(true);
        const result = await scanner._findTermDictionaryEntries(TextSourceRange.create(r), {});
        assert.equal(calls.at(-1), word);
        assert.equal(result.dictionaryEntries[0].headwords[0].term, word);
        assert.equal(result.sentence.text, sentence, 'full original sentence remains intact');
    }
    p.textContent = 'rocket fuel of change';
    const phrase = document.createRange();phrase.setStart(p.firstChild, 0);phrase.setEnd(p.firstChild, 11);
    await scanner._findTermDictionaryEntries(TextSourceRange.createLazy(phrase), {});
    assert.equal(calls.at(-1), 'rocket fuel');
    dom.window.close();
});

test('toolbar favorite saves/removes local context, survives reopening and never calls the native/model service', async () => {
    const {StudyService} = await import('../ext/js/study/study-service.js');
    const data = {};let native = 0;
    const service = new StudyService({get: async key => ({[key]: structuredClone(data[key])}), set: async value => Object.assign(data, structuredClone(value))}, () => {native++;throw Error('Favorite must be local only');});
    const actions = [];
    globalThis.chrome = {runtime: {sendMessage: async ({studyAction, data}) => {actions.push(studyAction);try {return {ok: true, value: await service.handle(studyAction, data)};} catch (e) {return {ok:false,error:e.message};}}}};
    const mount = () => {
        const dom = setup('<div class="content-body-inner"><div class="study-toolbar"><span>英语查词</span><a class="study-settings">AI 设置</a><button id="close-button">×</button></div><input id="study-auto-size"><div id="study-context"></div><div id="dictionary-entries"></div></div>');
        const handlers = new Map();
        const display = {on: (n, fn) => handlers.set(n, fn), history: {state: {sentence: {text: 'This is absolutely useful.', offset: 8}, url: 'https://example.test/article', documentTitle: 'Public fixture'}}, query: 'absolutely'};
        prepareStudyCard(display);handlers.get('contentUpdateComplete')();return {dom, handlers, display};
    };
    let f = mount();await tick();await tick();
    let star = document.querySelector('.study-favorite');assert.ok(star, 'card toolbar exposes the promised favorite');
    assert.equal(star.getAttribute('aria-pressed'), 'false');star.click();await tick();await tick();
    assert.equal(star.getAttribute('aria-pressed'), 'true');
    let rows = await service.handle('saved', {});assert.equal(rows.length, 1);assert.equal(rows[0].word, 'absolutely');assert.equal(rows[0].sentence, 'This is absolutely useful.');assert.equal(rows[0].url, 'https://example.test/article');
    f.handlers.get('contentClear')();f.dom.window.close();
    f = mount();await tick();await tick();star = document.querySelector('.study-favorite');assert.equal(star.getAttribute('aria-pressed'), 'true');
    star.click();await tick();await tick();assert.equal((await service.handle('saved', {})).length, 0);assert.equal(star.getAttribute('aria-pressed'), 'false');
    assert.equal(native, 0);assert.ok(!actions.some(a => ['generate', 'rememberEntry', 'draftCards', 'librarySave'].includes(a)));
    f.handlers.get('contentClear')();f.dom.window.close();
});

test('the already-open collection page refreshes when a card favorite changes', async () => {
    const {readFileSync} = await import('node:fs');
    const dom = setup(readFileSync(new URL('../ext/study-settings.html', import.meta.url), 'utf8'));
    let changed, rows = [];
    globalThis.chrome = {permissions: {contains: async () => false}, runtime: {sendMessage: async ({studyAction}) => ({ok: true, value: studyAction === 'settings' ? {model:'gpt-6.1-sol',effort:'low',cacheEnabled:true} : rows})}, storage: {onChanged: {addListener: listener => changed = listener}}};
    await import('../ext/js/pages/study-settings-main.js?favorite-refresh');await tick();
    assert.match(document.querySelector('#saved').textContent, /右上角 ☆/);
    rows = [{id:'fixture',word:'absolutely',sentence:'A public fixture.',url:'https://example.test/article',title:'Fixture'}];
    changed({studySavedWordsV1:{}}, 'local');await tick();
    assert.equal(document.querySelector('.saved-word strong').textContent, 'absolutely');
    rows = [];changed({studySavedWordsV1:{}}, 'local');await tick();
    assert.match(document.querySelector('#saved').textContent, /还没有收藏/);
    dom.window.close();
});
