import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {bindStudyWordTabs} from '../ext/js/display/study-word-tabs.js';

test('parked words survive clear-mode lookup and restore their own source, cached dictionary and drafts',()=>{
 const dom=new JSDOM('<body></body>',{url:'https://example.org/search.html?query=first&type=terms'});
 globalThis.document=dom.window.document;globalThis.location=dom.window.location;globalThis.Event=dom.window.Event;globalThis.MouseEvent=dom.window.MouseEvent;globalThis.HTMLTextAreaElement=dom.window.HTMLTextAreaElement;globalThis.HTMLDetailsElement=dom.window.HTMLDetailsElement;
 const listeners=new Map(),calls=[];let closed=0;const entries=[{type:'term',headwords:[{term:'first'}]}];
 const display={query:'first',history:{state:{sentence:{text:'The first real sentence.'},url:'https://source/one'},content:{dictionaryEntries:entries}},on:(n,f)=>listeners.set(n,f),setContent:d=>calls.push(d),close:()=>{closed++;}};
 function mount(){document.body.innerHTML='<nav></nav><textarea class="study-followup"></textarea><details class="study-more-actions"><textarea class="study-source-editor"></textarea><textarea class="study-source-editor"></textarea></details><section id="study-context"></section>';return bindStudyWordTabs(display,document.querySelector('nav'),()=>{});}
 const a=mount();assert.ok(document.querySelector('[aria-label="关闭单词 first"]'));document.querySelector('.study-followup').value='first question draft';document.querySelectorAll('textarea.study-source-editor')[0].value='Edited first sentence.';a.park();
 listeners.get('contentWillChange')();
 display.query='second';display.history={state:{sentence:{text:'Second source.'},url:'https://source/two'},content:{dictionaryEntries:[]}};
 const b=mount();assert.equal(document.querySelectorAll('[data-study-word-tab]').length,2);
 document.querySelector('[aria-label="切回单词 first"]').click();
 assert.equal(calls.length,1);assert.equal(calls[0].params.query,'first');assert.equal(calls[0].state.sentence.text,'The first real sentence.');assert.equal(calls[0].content.dictionaryEntries,entries);
 listeners.get('contentWillChange')();display.query='first';display.history={state:calls[0].state,content:calls[0].content};mount();
 assert.equal(document.querySelector('.study-followup').value,'first question draft');assert.equal(document.querySelector('.study-source-editor').value,'Edited first sentence.');
 assert.notEqual(a.key,b.key);
 document.querySelector('[aria-label="关闭单词 first"]').click();assert.equal(calls.at(-1).params.query,'second');
 listeners.get('contentWillChange')();display.query='second';display.history={state:calls.at(-1).state,content:calls.at(-1).content};mount();document.querySelector('[aria-label="关闭单词 second"]').click();assert.equal(closed,1);
});
