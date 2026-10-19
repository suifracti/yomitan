import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {mountStudyLibrary} from '../ext/js/display/study-library.js';
const root=fileURLToPath(new URL('../ext/js/display/',import.meta.url));
function makeHarness(overrides={},settings){
 const dom=new JSDOM('<!doctype html><body><div class="study-focus-shell"><div class="sf-header-sense"><div class="sf-gloss-preview"><div class="sf-gloss-row">int. 你好；喂</div></div></div><div id="host"></div></div></body>');
 const calls=[];
 globalThis.chrome={permissions:{request:async()=>true},storage:{local:{get:async()=>({studySaveTargetsV1:settings})}}};
 const studyCall=async(action,data)=>{calls.push([action,data]);if(action==='pendingPeek')return {count:0};if(action==='rememberEntry')return {id:data.recordId||'a'.repeat(32),path:'English/hello.md',openUrl:'',entry:{word:'hello',language:'en'},ankiEnabled:true,ankiState:'synced',cards:[],target:{deck:'English'}};if(action==='libraryCardsAdd')return {id:'a'.repeat(32),entry:{word:'hello',language:'en'},cards:data.cards.map((card)=>({...card,syncState:'pending'})),syncState:'pending'};return {};};
 globalThis.chrome.runtime={sendMessage:async({studyAction,data})=>({ok:true,value:await studyCall(studyAction,data)})};
 const mount=mountStudyLibrary;
 const d=dom.window.document;mount(d.querySelector('#host'),()=>({word:'hello',language:'en',sentence:'Hello world.',context:'A prior clause.',meaning:'在这里是问候',explanationSource:'AI 辅助解释（非词典原文）',translation:'你好，世界。',...overrides}),()=>true);
 return {dom,d,calls};
}
const tick=async()=>{for(let i=0;i<5;i++)await new Promise((resolve)=>setImmediate(resolve));};
test('saved study can add separately authored cards for multiple learning points without AI',async()=>{
 const {d,calls}=makeHarness();
 d.querySelector('[data-study-save="note"]').click();await tick();
 const open=d.querySelector('[data-study-add-card]');assert.ok(open,'save success offers another/manual card action');open.click();
 assert.equal(d.querySelectorAll('.study-card-editor').length,0);d.querySelector('[data-study-card-choice=meaning]').click();
 let rows=[...d.querySelectorAll('.study-card-editor')];assert.equal(rows.length,1,'user explicitly chooses the first card');
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
 assert.match(card,/settings\.html#learning/);assert.match(focus,/study-library\.html/);assert.match(focus,/documentTitle/);assert.match(focus,/videoTime/);assert.match(focus,/libraryReconcile/);assert.match(focus,/study-record-current/);assert.match(focus,/sf-source-details/);assert.match(focus,/时间点/);assert.match(focus,/sourceMenu\.textContent = '发音来源/);assert.doesNotMatch(focus,/sf-audio-source-label/);assert.match(focus,/同步未完成/);assert.match(library,/maxLength = 1000/);assert.match(library,/maxLength = 2400/);assert.match(library,/ankiEnabled === false/);assert.match(css,/sf-learning-scroll>\.study-card-add/);assert.doesNotMatch(css,/sf-save-bar>\.study-card-add[ {]/);assert.match(card,/recordId, meaning/);
});

test('Anki-disabled records never expose or call manual card addition',()=>{
 const {d,calls}=makeHarness();
 d.querySelector('#host').dispatchEvent(new d.defaultView.CustomEvent('study-record-current',{detail:{id:'c'.repeat(32),entry:{word:'hello',language:'en'},ankiEnabled:false,cards:[]}}));
 const button=d.querySelector('[data-study-add-card]');assert.equal(button.hidden,false);assert.equal(button.disabled,true);button.click();
 assert.equal(calls.some(([action])=>action==='libraryCardsAdd'),false);
});

test('word meaning and sentence meaning have separate editable previews and explicit submission',async()=>{
 const {d,calls}=makeHarness();
 d.querySelector('[data-study-save="note"]').click();await tick();
 assert.equal(calls.some(([action])=>action==='libraryCardsAdd'),false);
 d.querySelector('[data-study-add-card]').click();
 d.querySelector('[data-study-card-choice=meaning]').click();
 d.querySelector('[data-study-card-choice=context]').click();
 const rows=[...d.querySelectorAll('.study-card-editor')];assert.equal(rows.length,2);
 assert.equal(rows[0].querySelector('[data-study-card-front]').value,'hello');
 assert.equal(rows[0].querySelector('[data-study-card-back]').value,'int. 你好；喂');
 assert.match(rows[1].querySelector('[data-study-card-front]').value,/Hello world\./);
 assert.equal(rows[1].querySelector('[data-study-card-back]').value,'在这里是问候');
 d.querySelector('[data-study-cards-submit]').click();await tick();
 const cards=calls.find(([action])=>action==='libraryCardsAdd')[1].cards;
 assert.deepEqual(cards.map(c=>c.kind),['meaning','context']);
 assert.notEqual(cards[0].front,cards[1].front);
 assert.equal(calls.some(([action])=>['generate','draftCards'].includes(action)),false);
});
test('context without a confirmed explanation stays editable and unavailable audio is not fabricated',async()=>{
 const {d}=makeHarness({meaning:'词典简释（未按当前句消歧）：你好',explanationSource:'词典简释（尚未按语境确认）'});
 d.querySelector('#host').dispatchEvent(new d.defaultView.CustomEvent('study-record-current',{detail:{id:'a'.repeat(32),entry:{word:'hello',sentence:'Hello world.',language:'en'},cards:[],ankiEnabled:true}}));
 d.querySelector('[data-study-add-card]').click();
 d.querySelector('[data-study-card-choice=context]').click();assert.equal(d.querySelector('[data-study-card-back]').value,'');
 const media=d.querySelector('[data-study-card-choice=listening]');assert.equal(media.disabled,true);assert.match(media.title,/原声/);
});

test('audio choice needs stored real audio, and missing source text disables sentence cards',()=>{
 const {d}=makeHarness();
 const host=d.querySelector('#host');
 host.dispatchEvent(new d.defaultView.CustomEvent('study-record-current',{detail:{id:'a'.repeat(32),entry:{word:'hello',language:'en'},media:{audio:{name:'real.webm'}},cards:[],ankiEnabled:true}}));
 d.querySelector('[data-study-add-card]').click();
 assert.equal(d.querySelector('[data-study-card-choice=listening]').disabled,false);
 const {d:empty}=makeHarness({sentence:''});
 empty.querySelector('#host').dispatchEvent(new empty.defaultView.CustomEvent('study-record-current',{detail:{id:'a'.repeat(32),entry:{word:'hello',language:'en'},cards:[],ankiEnabled:true}}));
 empty.querySelector('[data-study-add-card]').click();
 assert.equal(empty.querySelector('[data-study-card-choice=context]').disabled,true);
});

test('card action is visible before saving and only creates after explicit preview confirmation',async()=>{
 const {d,calls}=makeHarness();
 const button=d.querySelector('[data-study-add-card]');
 assert.equal(button.hidden,false);assert.equal(button.textContent,'制卡');
 button.click();
 assert.equal(d.querySelector('.study-card-add').hidden,false);
 assert.equal(calls.some(([action])=>action==='rememberEntry'||action==='libraryCardsAdd'),false);
 d.querySelector('[data-study-card-choice=meaning]').click();
 d.querySelector('[data-study-cards-submit]').click();await tick();
 assert.equal(calls.filter(([action])=>action==='rememberEntry').length,1);
 assert.equal(calls.filter(([action])=>action==='libraryCardsAdd').length,1);
 assert.equal(calls.find(([action])=>action==='libraryCardsAdd')[1].cards[0].kind,'meaning');
});

test('new cards prefill the target child deck for their chosen kind',async()=>{
 const {d,calls}=makeHarness({}, {ankiEnabled:true,deck:'外语',deckByKind:{meaning:'外语::单词意思',context:'外语::原句中的意思'}});
 await tick();d.querySelector('[data-study-add-card]').click();
 d.querySelector('[data-study-card-choice=meaning]').click();d.querySelector('[data-study-card-choice=context]').click();
 assert.deepEqual([...d.querySelectorAll('[data-study-card-deck]')].map(e=>e.value),['外语::单词意思','外语::原句中的意思']);
 d.querySelector('[data-study-cards-submit]').click();await tick();
 assert.deepEqual(calls.find(([a])=>a==='libraryCardsAdd')[1].cards.map(c=>c.deck),['外语::单词意思','外语::原句中的意思']);
});
