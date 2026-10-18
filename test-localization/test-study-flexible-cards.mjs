import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {mountStudyLibrary} from '../ext/js/display/study-library.js';
const root=fileURLToPath(new URL('../ext/js/display/',import.meta.url));
function makeHarness(){
 const dom=new JSDOM('<!doctype html><body><div id="host"></div></body>');
 const calls=[];
 globalThis.chrome={permissions:{request:async()=>true},storage:{local:{get:async()=>({})}}};
 const studyCall=async(action,data)=>{calls.push([action,data]);if(action==='pendingPeek')return {count:0};if(action==='rememberEntry')return {id:'a'.repeat(32),path:'English/hello.md',openUrl:'',entry:{word:'hello',language:'en'},ankiEnabled:true,ankiState:'synced',cards:[],target:{deck:'English'}};if(action==='libraryCardsAdd')return {id:'a'.repeat(32),entry:{word:'hello',language:'en'},cards:data.cards.map((card)=>({...card,syncState:'pending'})),syncState:'pending'};return {};};
 globalThis.chrome.runtime={sendMessage:async({studyAction,data})=>({ok:true,value:await studyCall(studyAction,data)})};
 const mount=mountStudyLibrary;
 const d=dom.window.document;mount(d.querySelector('#host'),()=>({word:'hello',language:'en',sentence:'Hello world.',context:'A prior clause.',meaning:'你好',translation:'你好，世界。'}),()=>true);
 return {dom,d,calls};
}
const tick=async()=>{for(let i=0;i<5;i++)await new Promise((resolve)=>setImmediate(resolve));};
test('saved study can add separately authored cards for multiple learning points without AI',async()=>{
 const {d,calls}=makeHarness();
 d.querySelector('[data-study-save="note"]').click();await tick();
 const open=d.querySelector('[data-study-add-card]');assert.ok(open,'save success offers another/manual card action');open.click();
 let rows=[...d.querySelectorAll('.study-card-editor')];assert.equal(rows.length,1,'manual form starts with one card, not repeated copies per kind');
 rows[0].querySelector('[data-study-card-kind]').value='meaning';
 assert.equal(rows[0].querySelector('[data-study-card-front]').maxLength,1000);assert.equal(rows[0].querySelector('[data-study-card-back]').maxLength,2400);
 rows[0].querySelector('[data-study-card-front]').value='What does hello mean?';rows[0].querySelector('[data-study-card-back]').value='你好';rows[0].querySelector('[data-study-card-deck]').value='My English';
 d.querySelector('[data-study-add-row]').click();
 rows=[...d.querySelectorAll('.study-card-editor')];assert.equal(rows.length,2,'can add an independent second card');
 rows[1].querySelector('[data-study-card-kind]').value='sentence';
 rows[1].querySelector('[data-study-card-front]').value='Complete the sentence';rows[1].querySelector('[data-study-card-back]').value='Hello world.';
 d.querySelector('[data-study-cards-submit]').click();await tick();
 const call=calls.find(([action])=>action==='libraryCardsAdd');assert.ok(call,'uses the existing library card-add endpoint');
 assert.deepEqual(call[1],{id:'a'.repeat(32),language:'en',cards:[{front:'What does hello mean?',back:'你好',kind:'meaning',deck:'My English'},{front:'Complete the sentence',back:'Hello world.',kind:'sentence'}]});
 assert.equal(calls.some(([action])=>action==='generate'||action==='draftCards'),false,'manual cards do not invoke AI');
});
test('existing saved id survives a source edit and review suggestions remain individually selectable',async()=>{
 const {d,calls}=makeHarness();
 const host=d.querySelector('#host');host.dispatchEvent(new d.defaultView.CustomEvent('study-record-current',{detail:{id:'b'.repeat(32),entry:{word:'hello',language:'en'},reviewDraft:{cards:[{front:'Prompt',back:'Answer',kind:'context'}]},cards:[]}}));
 d.querySelector('[data-study-save="note"]').click();await tick();
 const saved=calls.find(([action])=>action==='rememberEntry');assert.equal(saved[1].recordId,'b'.repeat(32));
 host.dispatchEvent(new d.defaultView.CustomEvent('study-record-current',{detail:{id:'b'.repeat(32),entry:{word:'hello',language:'en'},reviewDraft:{cards:[{front:'Prompt',back:'Answer',kind:'context'}]},cards:[]}}));
 d.querySelector('[data-study-add-card]').click();
 const draft=d.querySelector('[data-study-review-card]');assert.ok(draft);draft.checked=true;draft.dispatchEvent(new d.defaultView.Event('change',{bubbles:true}));
 d.querySelector('[data-study-cards-submit]').click();await tick();
 const call=calls.find(([action])=>action==='libraryCardsAdd');assert.deepEqual(call[1],{id:'b'.repeat(32),language:'en',cards:[{front:'Prompt',back:'Answer',kind:'context'}]});
});
test('study focus exposes sources, reconciliation, and the correct settings/library routes',()=>{
 const focus=readFileSync(root+'study-focus.js','utf8');const card=readFileSync(root+'study-card.js','utf8');const library=readFileSync(root+'study-library.js','utf8');const css=readFileSync(new URL('../ext/css/study-focus.css',import.meta.url),'utf8');
 assert.match(card,/settings\.html#learning/);assert.match(focus,/study-library\.html/);assert.match(focus,/documentTitle/);assert.match(focus,/videoTime/);assert.match(focus,/libraryReconcile/);assert.match(focus,/study-record-current/);assert.match(focus,/sf-source-details/);assert.match(focus,/时间点/);assert.match(focus,/sourceMenu\.textContent = '发音来源/);assert.doesNotMatch(focus,/sf-audio-source-label/);assert.match(focus,/保留 Obsidian/);assert.match(focus,/保留 Anki/);assert.match(library,/maxLength = 1000/);assert.match(library,/maxLength = 2400/);assert.match(library,/ankiEnabled === false/);assert.match(css,/sf-learning-scroll>\.study-card-add/);assert.doesNotMatch(css,/sf-save-bar>\.study-card-add/);assert.match(card,/recordId, meaning/);
});

test('Anki-disabled records never expose or call manual card addition',()=>{
 const {d,calls}=makeHarness();
 d.querySelector('#host').dispatchEvent(new d.defaultView.CustomEvent('study-record-current',{detail:{id:'c'.repeat(32),entry:{word:'hello',language:'en'},ankiEnabled:false,cards:[]}}));
 const button=d.querySelector('[data-study-add-card]');assert.equal(button.hidden,true);button.click();
 assert.equal(calls.some(([action])=>action==='libraryCardsAdd'),false);
});
