import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountStudyLibrary} from '../ext/js/display/study-library.js';
import {bindStudyWordTabs} from '../ext/js/display/study-word-tabs.js';

test('parked words survive clear-mode lookup and restore their own source, cached dictionary and drafts',()=>{
 const dom=new JSDOM('<body></body>',{url:'https://example.org/search.html?query=first&type=terms'});
 globalThis.document=dom.window.document;globalThis.location=dom.window.location;globalThis.Event=dom.window.Event;globalThis.MouseEvent=dom.window.MouseEvent;globalThis.HTMLTextAreaElement=dom.window.HTMLTextAreaElement;globalThis.HTMLDetailsElement=dom.window.HTMLDetailsElement;
 const listeners=new Map(),calls=[];let closed=0;const entries=[{type:'term',headwords:[{term:'first'}]}];
 const display={query:'first',history:{state:{sentence:{text:'The first real sentence.'},url:'https://source/one',studyOpenCard:true},content:{dictionaryEntries:entries}},on:(n,f)=>listeners.set(n,f),setContent:d=>calls.push(d),close:()=>{closed++;}};
 const actions = [];
 globalThis.chrome = {runtime: {sendMessage: async ({studyAction}) => { actions.push(studyAction); return {ok: true, value: null}; }}};
 let disposeEditor;
 function mount(){disposeEditor?.();document.body.innerHTML='<nav></nav><textarea class="study-followup"></textarea><details class="study-more-actions"><textarea class="study-source-editor"></textarea><textarea class="study-source-editor"></textarea></details><section id="study-context"></section>';
     disposeEditor = mountStudyLibrary(document.querySelector('#study-context'), () => ({
         word: display.query, sentence: display.history.state.sentence.text, meaning: '词义', url: display.history.state.url,
     }), () => true);
     return bindStudyWordTabs(display,document.querySelector('nav'),()=>{});
 }
 function editCard(front, back, selected) {
     document.querySelector('[data-study-add-card]').click();
     document.querySelector('[data-study-add-row]').click();
     document.querySelector('[data-study-card-front]').value = front;
     document.querySelector('[data-study-card-back]').value = back;
     document.querySelector('[data-study-card-kind]').value = 'context';
     document.querySelector('[data-study-card-deck]').value = '外语::语境';
     const box = document.querySelector('[data-study-card-select]');
     box.checked = selected;
     box.dispatchEvent(new Event('change', {bubbles: true}));
 }
 function checkCard(front, back, selected, hidden) {
     assert.equal(document.querySelector('.study-card-add').hidden, hidden);
     assert.equal(document.querySelector('[data-study-card-front]')?.value, front);
     assert.equal(document.querySelector('[data-study-card-back]')?.value, back);
     assert.equal(document.querySelector('[data-study-card-kind]').value, 'context');
     assert.equal(document.querySelector('[data-study-card-deck]').value, '外语::语境');
     assert.equal(document.querySelector('[data-study-cards-submit]').disabled, !selected);
 }
 const a=mount();assert.ok(document.querySelector('[aria-label="关闭单词 first"]'));document.querySelector('.study-followup').value='first question draft';document.querySelectorAll('textarea.study-source-editor')[0].value='Edited first sentence.';a.park();
 editCard('First prompt', ' First draft\n', false);
 listeners.get('contentWillChange')();
 display.query='second';display.history={state:{sentence:{text:'Second source.'},url:'https://source/two',studyAddCard:true},content:{dictionaryEntries:[]}};
 const b=mount();assert.equal(document.querySelectorAll('[data-study-word-tab]').length,2);
 editCard('Second prompt', 'Second draft', true);
 document.querySelector('[data-study-add-card]').click();
 document.querySelector('[aria-label="切回单词 first"]').click();
 assert.equal(calls.length,1);assert.equal(calls[0].params.query,'first');assert.equal(calls[0].state.sentence.text,'The first real sentence.');assert.equal(calls[0].content.dictionaryEntries,entries);
 assert.equal(calls[0].state.studyOpenCard, undefined);
 listeners.get('contentWillChange')();display.query='first';display.history={state:calls[0].state,content:calls[0].content};mount();
 assert.equal(document.querySelector('.study-followup').value,'first question draft');assert.equal(document.querySelector('.study-source-editor').value,'Edited first sentence.');
 checkCard('First prompt', ' First draft\n', false, false);
 assert.notEqual(a.key,b.key);
 document.querySelector('[aria-label="关闭单词 first"]').click();assert.equal(calls.at(-1).params.query,'second');
 assert.equal(calls.at(-1).state.studyAddCard, undefined);
 listeners.get('contentWillChange')();display.query='second';display.history={state:calls.at(-1).state,content:calls.at(-1).content};mount();
 checkCard('Second prompt', 'Second draft', true, true);
 document.querySelector('[aria-label="关闭单词 second"]').click();assert.equal(closed,1);
 assert.ok(actions.every((action) => action === 'settings' || action === 'pendingPeek'), actions.join(', '));
 disposeEditor();
});
