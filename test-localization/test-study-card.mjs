import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const root=new URL('../',import.meta.url);
test('lookup actions use visible labels while preserving upstream selectors',()=>{
 const html=readFileSync(new URL('ext/templates-display.html',root),'utf8');
 const d=new JSDOM(html).window.document;
 const save=d.querySelector('#action-button-container-template').content.querySelector('[data-action="save-note"]');
 assert.match(save.textContent,/添加到 Anki/);
 const audio=d.querySelector('#audio-button-popup-menu-template').content;
 assert.match(audio.textContent,/选择发音来源/);
 assert.match(audio.textContent,/卡片音频/);
});
test('source context is safe text, highlighted and omitted when absent',async()=>{
 const {appendStudyContext}=await import('../ext/js/display/study-card.js');
 const d=new JSDOM('<div id="entry"></div>').window.document;
 const entry=d.getElementById('entry');
 appendStudyContext(entry,{text:'We help <img onerror=evil()> ourselves.',offset:29},'ourselves');
 assert.equal(entry.querySelector('img'),null);
 assert.match(entry.textContent,/来自当前页面/);
 assert.equal(entry.querySelector('mark').textContent,'ourselves');
 const empty=d.createElement('div');appendStudyContext(empty,null,'word');assert.equal(empty.children.length,0);
});
test('auto-size constraints preserve above anchor and fit tiny viewports',async()=>{
 const {fitStudyPopup}=await import('../ext/js/app/study-popup-size.js');
 assert.deepEqual(fitStudyPopup({left:500,top:600,width:400,height:250},450,330,{left:0,top:0,right:800,bottom:900},true),{left:350,top:570,width:450,height:330});
 assert.deepEqual(fitStudyPopup({left:100,top:350,width:400,height:250},400,180,{left:0,top:0,right:800,bottom:900},false),{left:100,top:420,width:400,height:180});
 assert.deepEqual(fitStudyPopup({left:0,top:0,width:400,height:250},450,330,{left:0,top:0,right:240,bottom:160},true),{left:0,top:0,width:240,height:160});
});
test('upgrade disables only identified bundled predecessor and preserves user choices',async()=>{
 const {planStudyDictionary}=await import('../ext/js/pages/common/bundled-dictionary-core.js');
 const old={name:'ECDICT 英汉词典',enabled:true,custom:'keep'};
 const custom={name:'My dictionary',enabled:false};
 const previous=[old,custom];
 const summaries=[{title:old.name,revision:'ECDICT-2026-10-07',importSuccess:true}];
 const planned=planStudyDictionary(previous,{title:'ECDICT 英语学习词典'},summaries);
 assert.equal(old.enabled,true);assert.equal(planned[0].enabled,false);assert.equal(planned[0].custom,'keep');assert.deepEqual(planned[1],custom);
 assert.equal(planned.at(-1).enabled,true);
 const disabled=planStudyDictionary([{...old,enabled:false}],{title:'ECDICT 英语学习词典'},summaries);
 assert.equal(disabled.at(-1).enabled,false);
 const unknown=planStudyDictionary(previous,{title:'ECDICT 英语学习词典'},[{title:old.name,revision:'custom'}]);
 assert.equal(unknown[0].enabled,true);
});
function setupDisplay() {
 const dom=new JSDOM('<div class="content-body-inner"><input id="study-auto-size" type="checkbox" checked><section id="study-context"></section><div id="dictionary-entries"></div></div>');
 for(const key of ['document','HTMLElement','HTMLDetailsElement','MouseEvent','MutationObserver'])globalThis[key]=dom.window[key];
 globalThis.ResizeObserver=class {observe(){}};
 globalThis.requestAnimationFrame=()=>{};
 const callbacks=new Map();
 const display={on:(n,c)=>callbacks.set(n,c),parentPopupId:null,history:{state:{sentence:{text:'We are tired of this.',offset:7}}},query:'tired of',getOptions:()=>({dictionaries:[]})};
 return {dom,callbacks,display};
}
test('one shared source, secondary matches collapsed, keyboard focus reveals them',async()=>{
 const {prepareStudyCard}=await import('../ext/js/display/study-card.js');
 const {callbacks,display}=setupDisplay();prepareStudyCard(display);
 callbacks.get('contentUpdateStart')();
 for(let index=0;index<2;index++){
  const element=document.createElement('div');element.className='entry';element.innerHTML='<div class="entry-header"><div class="headword-list">tired</div></div><button>audio</button><div class="entry-body">definition</div>';
  callbacks.get('contentUpdateEntry')({element,dictionaryEntry:{type:'term',headwords:[{term:index?'tired':'tired of'}]},index});
  document.querySelector('#dictionary-entries').append(element);
 }
 callbacks.get('contentUpdateComplete')();
 assert.equal(document.querySelectorAll('.study-source').length,1);
 const secondary=document.querySelector('.study-secondary');assert.ok(secondary,'short secondary row exists');
 assert.equal(secondary.dataset.studyExpanded,'false');
 secondary.querySelector('.study-match-toggle').click();assert.equal(secondary.dataset.studyExpanded,'true');
 secondary.querySelector('.study-match-toggle').click();
 secondary.querySelector('.entry-body').dispatchEvent(new document.defaultView.FocusEvent('focusin',{bubbles:true}));
 assert.equal(secondary.dataset.studyExpanded,'true');
});
test('translation is click-only, bounded editable source and stale responses do not replace next query',async()=>{
 const {prepareStudyCard}=await import('../ext/js/display/study-card.js');
 const {callbacks,display}=setupDisplay();let calls=0,finish;
 globalThis.chrome={permissions:{request:async()=>true},runtime:{sendMessage:async ({studyAction,data})=>{if(studyAction==='peek')return {ok:true,value:{result:null}};calls++;assert.equal(data.sentence,'A complete edited sentence.');return new Promise(resolve=>finish=resolve);}}};
 prepareStudyCard(display);callbacks.get('contentUpdateStart')();callbacks.get('contentUpdateComplete')();
 assert.equal(calls,0);
 const button=document.querySelector('[data-study-translate="translate"]');assert.ok(button,'explicit translate button');
 document.querySelector('.study-source-editor').value='A complete edited sentence.';
 button.click();await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 callbacks.get('contentUpdateStart')();display.query='new';display.history.state.sentence={text:'Another sentence.',offset:0};callbacks.get('contentUpdateComplete')();
 finish({ok:true,value:{result:{translation:'STALE',meaning:'old',notes:''},cached:false}});await new Promise(r=>setImmediate(r));
 assert.doesNotMatch(document.querySelector('#study-context').textContent,/STALE/);
});
test('low-value metadata is collapsed together, original meanings and POS retained',async()=>{
 const {prepareStudyCard}=await import('../ext/js/display/study-card.js');
 const {callbacks,display}=setupDisplay();prepareStudyCard(display);
 const element=document.createElement('div');element.innerHTML='<div data-sc-study-role="card"><div data-sc-study-role="meaning"><div>a. 疲累的, 疲乏的, 厌倦的</div></div><details data-sc-study-role="english"><summary>英文解释</summary><div>depleted of strength</div></details><details data-sc-study-role="forms"><summary>词形变化</summary><div>tire</div></details><div data-sc-study-role="tags">高考</div><details data-sc-study-role="frequency"><summary>词频资料</summary><div>101</div></details></div>';
 callbacks.get('contentUpdateEntry')({element,dictionaryEntry:{type:'term',headwords:[{term:'tired'}]},index:0});
 assert.ok(element.querySelector('.study-word-details'),'compact metadata disclosure');
 assert.equal(element.querySelector('.study-word-details').open,false);
 assert.equal(element.querySelector('[data-sc-study-role=english]').closest('.study-word-details'),null);
 assert.match(element.querySelector('[data-sc-study-role=meaning]').textContent,/疲累的, 疲乏的, 厌倦的/);
 assert.equal(element.querySelector('.study-pos').textContent,'a.');
});

test('mouse-selected secondary can still collapse; keyboard navigation explicitly expands',async()=>{
 const {prepareStudyCard}=await import('../ext/js/display/study-card.js');
 const {callbacks,display}=setupDisplay();prepareStudyCard(display);
 const element=document.createElement('div');element.className='entry entry-current';
 callbacks.get('contentUpdateEntry')({element,dictionaryEntry:{type:'term',headwords:[{term:'tired'}]},index:1});
 const button=element.querySelector('.study-match-toggle');button.click();button.click();
 assert.equal(element.dataset.studyExpanded,'false');
 element.dispatchEvent(new document.defaultView.Event('study-entry-focus'));
 assert.equal(element.dataset.studyExpanded,'true');
 assert.equal(document.documentElement.dataset.studyView,'dictionary','keyboard navigation reveals the destination view');
});
test('cancelling before permission resolves never starts a model connection',async()=>{
 const {prepareStudyCard}=await import('../ext/js/display/study-card.js');
 const {callbacks,display}=setupDisplay();let grant,calls=0;
 globalThis.chrome={permissions:{request:()=>new Promise(resolve=>grant=resolve)},runtime:{connectNative:()=>{calls++;throw new Error('Must not connect');}}};
 prepareStudyCard(display);callbacks.get('contentUpdateStart')();callbacks.get('contentUpdateComplete')();
 document.querySelector('[data-study-translate="translate"]').click();
 [...document.querySelectorAll('.study-translation-actions button')].find(b=>b.textContent==='取消').click();
 grant(true);await new Promise(r=>setImmediate(r));assert.equal(calls,0);
});
