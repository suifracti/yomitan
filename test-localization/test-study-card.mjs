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
 assert.match(entry.textContent,/当前原句/);
 assert.equal(entry.querySelector('mark').textContent,'ourselves');
 const empty=d.createElement('div');appendStudyContext(empty,null,'word');assert.equal(empty.children.length,0);
});
test('source marker uses actual boundaries, recovers unique drift and never guesses repeated words',async()=>{
 const {appendStudyContext}=await import('../ext/js/display/study-card.js');
 const d=new JSDOM('<body></body>').window.document;
 const unique=d.createElement('div');
 appendStudyContext(unique,{text:'The brain can change; brainstorming can help.',offset:200},'brain');
 assert.equal(unique.querySelector('mark')?.textContent,'brain','a unique whole word is recovered');
 const repeated=d.createElement('div');
 appendStudyContext(repeated,{text:'My brain needs rest; the brain can recover.',offset:-1},'brain');
 assert.equal(repeated.querySelector('mark'),null,'two candidates without a valid offset must remain unmarked');
 const precise=d.createElement('div');
 const original='My brain needs rest; the brain can recover.';
 appendStudyContext(precise,{text:original,offset:original.lastIndexOf('brain')},'brain');
 assert.equal(precise.querySelector('mark')?.textContent,'brain');
 assert.equal(precise.querySelector('mark')?.previousSibling?.textContent?.includes('My brain needs rest'),true,'offset selects the correct repeated occurrence');
 const phrase=d.createElement('div');
 appendStudyContext(phrase,{text:'I looked it up before.',offset:99},'looked it up');
 assert.equal(phrase.querySelector('mark')?.textContent,'looked it up','selected phrase stays intact');
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
 for(const key of ['document','CustomEvent','Node','Element','HTMLElement','HTMLDetailsElement','HTMLTextAreaElement','MouseEvent','MutationObserver'])globalThis[key]=dom.window[key];
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
 globalThis.chrome={permissions:{request:async()=>true},runtime:{sendMessage:async ({studyAction,data})=>{if(['journalConversation','conversationUsage'].includes(studyAction))return {ok:true,value:[]};if(studyAction==='peek')return {ok:true,value:{result:null}};if(studyAction==='pendingPeek')return {ok:true,value:{count:0}};assert.equal(studyAction,'generate');calls++;assert.equal(data.sentence,'A complete edited sentence.');return new Promise(resolve=>finish=resolve);}}};
 prepareStudyCard(display);callbacks.get('contentUpdateStart')();callbacks.get('contentUpdateComplete')();
 assert.equal(calls,0);
 const button=document.querySelector('[data-study-translate="explain"]');assert.ok(button,'explicit translate button');
 document.querySelector('.study-source-editor').value='A complete edited sentence.';
 button.click();await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 callbacks.get('contentUpdateStart')();display.query='new';display.history.state.sentence={text:'Another sentence.',offset:0};callbacks.get('contentUpdateComplete')();
 finish({ok:true,value:{result:{translation:'STALE',meaning:'old',notes:''},cached:false}});await new Promise(r=>setImmediate(r));
 assert.doesNotMatch(document.querySelector('#study-context').textContent,/STALE/);
});
test('sentence translation stays manual and paints inline from the current saved answer',async()=>{
 const {prepareStudyCard}=await import('../ext/js/display/study-card.js');
 const {callbacks,display}=setupDisplay();
 let modelCalls=0,turns=[];
 globalThis.chrome={permissions:{request:async()=>true},runtime:{sendMessage:async ({studyAction,data})=>{
   if(studyAction==='journalConversation')return {ok:true,value:turns};
   if(studyAction==='conversationUsage')return {ok:true,value:[]};
   if(studyAction==='peek')return {ok:true,value:{result:null,busy:false}};
   if(studyAction==='pendingPeek')return {ok:true,value:{count:0}};
   if(studyAction==='generate'){
     modelCalls++;assert.equal(data.mode,'translate');assert.equal(data.sentence,'We are tired of this.');
     assert.equal(data.question,'','manual translation must not consume a typed follow-up');
     turns=[{id:'translation1',translation:'我们已经厌倦了这件事。',meaning:'tired of 是厌倦',notes:'',question:'',saved:false}];
     return {ok:true,value:{result:turns[0],cached:false}};
   }
   throw new Error('Unexpected backend action '+studyAction);
 }}};
 prepareStudyCard(display);callbacks.get('contentUpdateStart')();callbacks.get('contentUpdateComplete')();
 await new Promise(r=>setImmediate(r));
 assert.equal(modelCalls,0,'opening a real source never spends AI usage');
 const translate=document.querySelector('[data-study-translate-sentence]');
 assert.ok(translate,'manual sentence action exists directly beside its source');
 const draft=document.querySelector('.study-followup');
 draft.value='我的另一个问题';
 translate.click();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 assert.equal(modelCalls,1);
 assert.equal(draft.value,'我的另一个问题','a manual sentence translation does not erase the follow-up draft');
 assert.equal(document.querySelector('.study-source-translation')?.textContent,'我们已经厌倦了这件事。');
 assert.equal(translate.hidden,true,'cached translation replaces the action in the source card');
});

test('metadata is directly visible without nested disclosures, original meanings and POS retained',async()=>{
 const {prepareStudyCard,pinStudyContext,appendStudyContext}=await import('../ext/js/display/study-card.js');
 const {callbacks,display}=setupDisplay();prepareStudyCard(display);
 const element=document.createElement('div');element.innerHTML='<div data-sc-study-role="card"><div data-sc-study-role="meaning"><div>n. 变化，找回的零钱</div><div>vt. 改变，更换，兑换</div><div>vi. 得到零钱</div></div><details data-sc-study-role="english"><summary>英文解释</summary><div>depleted of strength</div></details><details data-sc-study-role="forms"><summary>词形变化</summary><div>过去分词：changed</div><div>过去式：changed</div><div>复数：changes</div><div>第三人称：changes</div></details><div data-sc-study-role="tags">高考</div><details data-sc-study-role="frequency"><summary>词频资料</summary><div>101</div></details></div>';
 callbacks.get('contentUpdateEntry')({element,dictionaryEntry:{type:'term',headwords:[{term:'tired'}]},index:0});
 assert.ok(element.querySelector('.study-metadata'),'visible metadata strip');
 assert.equal(element.querySelector('.study-metadata details'),null);
 assert.match(element.querySelector('.study-metadata').textContent,/高考/);
 assert.match(element.querySelector('.study-metadata').textContent,/101/);
 assert.equal(element.querySelector('[data-sc-study-role=english]').closest('.study-metadata'),null);
 assert.match(element.querySelector('[data-sc-study-role=meaning]').textContent,/变化，找回的零钱/);
 assert.deepEqual([...element.querySelectorAll('.study-pos-en')].map(e=>e.textContent),['n.','vt.','vi.']);
 assert.deepEqual([...element.querySelectorAll('.study-pos-zh')].map(e=>e.textContent),['名词','及物动词','不及物动词']);
 const inner=document.createElement('main');inner.append(element);
 appendStudyContext(element,{text:'Change is difficult.',offset:0},'change');
 pinStudyContext(inner,element,'change');
 const rows=[...inner.querySelectorAll('.study-reading-meaning .study-reading-sense')];
 assert.equal(rows.length,3,'different POS remain separate reading rows, not a flattened string');
 assert.match(rows[0].textContent,/n\..*名词.*变化/);assert.match(rows[1].textContent,/vt\..*及物动词.*改变/);assert.match(rows[2].textContent,/vi\..*不及物动词.*得到零钱/);
 assert.ok(element.querySelector('[data-sc-study-role=meaning]'),'original dictionary is not consumed by pinning');
 assert.match(inner.querySelector('.study-reading-info').textContent,/高考/);
 assert.match(inner.querySelector('.study-reading-info').textContent,/101/);
 const forms=element.querySelector('[data-study-meta-role=forms]');
 assert.equal((forms.textContent.match(/changed/g)||[]).length,1);assert.equal((forms.textContent.match(/changes/g)||[]).length,1);
 assert.match(forms.textContent,/p\.p\. 过去分词.*past\. 过去式/);assert.match(forms.textContent,/pl\. 复数.*3sg\. 第三人称/);
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
 assert.equal(document.documentElement.dataset.studyView,'single','keyboard navigation does not switch modes');
});
test('cancelling before permission resolves never starts a model connection',async()=>{
 const {prepareStudyCard}=await import('../ext/js/display/study-card.js');
 const {callbacks,display}=setupDisplay();let grant,calls=0;
 globalThis.chrome={permissions:{request:()=>new Promise(resolve=>grant=resolve)},runtime:{connectNative:()=>{calls++;throw new Error('Must not connect');}}};
 prepareStudyCard(display);callbacks.get('contentUpdateStart')();callbacks.get('contentUpdateComplete')();
 document.querySelector('[data-study-translate="explain"]').click();
 [...document.querySelectorAll('.study-translation-actions button')].find(b=>b.textContent==='取消').click();
 grant(true);await new Promise(r=>setImmediate(r));assert.equal(calls,0);
});

test('source and dictionary stay in one card across content replacement; no truncated meaning clone',async()=>{
 const {prepareStudyCard}=await import('../ext/js/display/study-card.js');
 const {callbacks,display}=setupDisplay();prepareStudyCard(display);
 for (let i=0;i<2;i++) {
  callbacks.get('contentUpdateStart')();document.querySelector('#dictionary-entries').replaceChildren();
  const element=document.createElement('div');element.innerHTML='<div class="entry-header">word</div><div class="entry-body"><div data-sc-study-role="card"><div data-sc-study-role="meaning"><div>第一义</div><div>第二义</div><div>第三义</div><div>第四义</div></div><details data-sc-study-role="english"><summary>英文解释</summary><div>Original English meaning</div></details></div></div>';
  callbacks.get('contentUpdateEntry')({element,dictionaryEntry:{type:'term',headwords:[{term:'word'}]},index:0});document.querySelector('#dictionary-entries').append(element);
  callbacks.get('contentUpdateComplete')();
  assert.equal(document.querySelectorAll('#study-context').length,1);assert.equal(element.querySelector('#study-context')?.previousElementSibling?.className,'entry-header');
  assert.match(element.querySelector('.entry-header').textContent,/第四义/);assert.equal(element.querySelector('.study-quick-meaning'),null);assert.equal(element.querySelector('[data-sc-study-role=english]').open,true);
 }
});
test('root card survives automatic hide but explicit close works; nested legacy popups still hide normally',async()=>{
 const dom=new JSDOM('<body></body>');globalThis.document=dom.window.document;globalThis.window=dom.window;globalThis.CustomEvent=dom.window.CustomEvent;
 globalThis.chrome={runtime:{getURL:p=>'chrome-extension://test'+p}};
 const {Popup}=await import('../ext/js/app/popup.js');
 const popup=new Popup({},'root',0,1,true);popup._visible.defaultValue=true;
 popup.hide(false);assert.equal(popup.isVisibleSync(),true);
 popup.hideDelayed(0);assert.equal(popup.isVisibleSync(),true);
 popup.hide(false,true);assert.equal(popup.isVisibleSync(),false);
 const child=new Popup({},'nested',1,1,true);child._visible.defaultValue=true;child.hide(false);assert.equal(child.isVisibleSync(),false);
});

test('looking up inside the card reuses the original popup and labels dictionary context honestly',async()=>{
 const {Frontend}=await import('../ext/js/app/frontend.js');
 const card={id:'original'};let created=0;
 const owner={_parentFrameId:1,_depth:1,_parentPopupId:'original',_childrenSupported:true,_pageType:'popup',_popupFactory:{getOrCreatePopup:async p=>{if(p.id==='original')return card;created++;return {};}}};
 assert.equal(await Frontend.prototype._getProxyPopup.call(owner),card);assert.equal(created,0);
 let shown;Object.assign(owner,{_application:{frameId:2},_showPopupContent:(_source,_options,details)=>{shown=details;},_popup:{},_getContentOrigin:()=>({})});
 Frontend.prototype._showContent.call(owner,{text:()=> 'morally'},false,[],'terms',{text:'morally right',offset:0},'Private article',{url:'https://example.com/article'},'light');
 assert.equal(shown.state.url,'');assert.equal(shown.state.sentence.sourceKind,'dictionary');assert.equal(shown.state.documentTitle,'词典解释');
});

test('same-card nested scanner lifecycle cannot close its owner after reopening; explicit close still works',async()=>{
 const {Frontend}=await import('../ext/js/app/frontend.js');
 let visible=true, enabled=true;
 const owner={_pageType:'popup',_parentPopupId:'root',_popup:{id:'root',clearAutoPlayTimer:async()=>{},hide:async()=>{visible=false;}},
  _options:{general:{enable:true}},_disabledOverride:true,_textScannerHasBeenEnabled:true,
  _textScanner:{isEnabled:()=>enabled,setEnabled:v=>{enabled=v;},clearSelection(){},suppressStudyScan(){}},_stopClearSelectionDelayed(){},
  _clearSelection:Frontend.prototype._clearSelection};
 Frontend.prototype._updateTextScannerEnabled.call(owner);
 assert.equal(visible,true,'disabling nested scanner must not close the reused root popup');
 owner._disabledOverride=false;
 Frontend.prototype._updateTextScannerEnabled.call(owner);
 assert.equal(visible,true,'reenabling scanner on reopen must not immediately hide owner');
 Frontend.prototype._onApiClosePopup.call(owner);
 assert.equal(visible,false,'explicit close remains effective');
});

test('editing a question while its answer is pending cannot attach that answer to the new question',async()=>{
 const {prepareStudyCard}=await import('../ext/js/display/study-card.js');
 const {callbacks,display}=setupDisplay();let finish;
 globalThis.chrome={permissions:{request:async()=>true},runtime:{sendMessage:async({studyAction})=>{
  if(studyAction==='peek')return {ok:true,value:{result:null}};
  return new Promise(r=>{finish=r;});
 }}};
 prepareStudyCard(display);callbacks.get('contentUpdateStart')();callbacks.get('contentUpdateComplete')();
 document.querySelector('.study-followup').value='问题一';
 document.querySelector('[data-study-translate="explain"]').click();await new Promise(r=>setImmediate(r));
 document.querySelector('.study-followup').value='问题二';
 finish({ok:true,value:{result:{translation:'OLD_ANSWER',meaning:'旧问题含义',notes:'旧问题解释'},cached:false}});
 await new Promise(r=>setImmediate(r));
 assert.doesNotMatch(document.querySelector('.study-translation-output').textContent,/OLD_ANSWER/);
});

test('reopening survives Display history cleanup and keeps both close routes functional',async()=>{
 const dom=new JSDOM('<body></body>');globalThis.document=dom.window.document;globalThis.window=dom.window;globalThis.CustomEvent=dom.window.CustomEvent;
 globalThis.chrome={runtime:{getURL:p=>'chrome-extension://test'+p}};
 const [{Popup},{Frontend},{Display},{Application}]=await Promise.all([
  import('../ext/js/app/popup.js'),import('../ext/js/app/frontend.js'),
  import('../ext/js/display/display.js'),import('../ext/js/application.js'),
 ]);
 const popup=new Popup({},'root',0,1,true);
 let rootSelection=false,nestedSelection=true;
 const makeFrontend=(pageType,parentPopupId,clear)=>({
  _pageType:pageType,_parentPopupId:parentPopupId,
  _popup:{id:popup.id,hide:(_focus,force)=>popup.hide(false,force),clearAutoPlayTimer:async()=>{}},
  _textScanner:{clearSelection:clear,clearMousePosition(){},suppressStudyScan(){}},_stopClearSelectionDelayed(){},
  _clearSelection:Frontend.prototype._clearSelection,_clearMousePosition:Frontend.prototype._clearMousePosition,
 });
 const root=makeFrontend('web',null,()=>{rootSelection=false;});
 const nested=makeFrontend('popup','root',()=>{nestedSelection=false;});
 const app={trigger:()=>Frontend.prototype._onClosePopups.call(nested),triggerClosePopups:Application.prototype.triggerClosePopups};
 const display={_pageType:'popup',_application:app,invokeContentOrigin:async()=>Frontend.prototype._onApiClosePopup.call(root),close:Display.prototype.close,_closeSinglePopupMenu:()=>false};
 for(const close of [()=>Display.prototype._onCloseButtonClick.call(display,{preventDefault(){}}),()=>Display.prototype._onHotkeyClose.call(display)]){
  for(let iteration=0;iteration<3;iteration++){
   // Popup.showContent makes the root visible before Display._onStateChanged clears descendants.
   rootSelection=true;nestedSelection=true;popup._setVisible(true);
   Display.prototype._closePopups.call(display);
   assert.equal(popup.isVisibleSync(),true,'rendering a new lookup must not force-close the reused owner');
   assert.equal(rootSelection,true,'history cleanup must not disturb the page scanner');
   assert.equal(nestedSelection,false,'stale dictionary selection still clears');
   close();await Promise.resolve();
   assert.equal(popup.isVisibleSync(),false,'the explicit close remains effective');
   assert.equal(rootSelection,false,'explicit close resets same-word suppression for the next scan');
  }
 }
});

test('simple card keeps ask/save primary, full dictionary and immediate cards remain expandable',async()=>{
 const {prepareStudyCard}=await import('../ext/js/display/study-card.js');
 const {callbacks,display}=setupDisplay();let sent=[];
 globalThis.chrome={permissions:{request:async()=>true},runtime:{sendMessage:async({studyAction,data})=>{
  if(studyAction==='peek')return {ok:true,value:{result:null}};
  if(studyAction==='journalConversation')return {ok:true,value:sent.map((x,i)=>({id:String(i),at:'today',question:x.question,translation:'中文解释',meaning:'语境义',notes:'说明',feedback:'unconfirmed'}))};
  if(studyAction==='conversationUsage')return {ok:true,value:[]};
  if(studyAction==='generate'){sent.push(data);return {ok:true,value:{result:{translation:'中文解释',meaning:'语境义',notes:'说明'},cached:false}};}
  return {ok:true,value:{items:[],total:0}};
 }}};
 prepareStudyCard(display);callbacks.get('contentUpdateStart')();
 const element=document.createElement('div');element.innerHTML='<div class="entry-header">word</div><div class="entry-body"><div data-sc-study-role="meaning">第一义、第二义、第三义</div>完整词典与所有例句<button class="evidence">词典内操作</button></div>';
 callbacks.get('contentUpdateEntry')({element,dictionaryEntry:{type:'term',headwords:[{term:'word'}]},index:0});document.querySelector('#dictionary-entries').append(element);callbacks.get('contentUpdateComplete')();
 const hiddenByDetails=node=>{for(let p=node.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open)return true;return false;};
 assert.equal(hiddenByDetails(document.querySelector('[data-study-translate=explain]')),false);
 assert.equal(hiddenByDetails(document.querySelector('[data-study-save=note]')),false);
 const immediate=document.querySelector('[data-study-save=both]');assert.equal(immediate,null,'no direct-card bypass in notes-first workflow');
 const dictionary=document.querySelector('.entry-body').closest('details');assert.ok(dictionary,'dictionary remains an in-card disclosure');assert.equal(dictionary.open,false);assert.equal(hiddenByDetails(document.querySelector('.study-primary-meaning')),false,'basic meanings stay visible without expanding the full dictionary');dictionary.open=true;assert.equal(hiddenByDetails(document.querySelector('.evidence')),false);
 const question=document.querySelector('.study-followup');question.value='为什么这么用？';question.dispatchEvent(new document.defaultView.KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}));await new Promise(r=>setImmediate(r));assert.equal(sent.length,0);
 question.dispatchEvent(new document.defaultView.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await new Promise(r=>setImmediate(r));assert.equal(sent.length,1);assert.equal(sent[0].question,'为什么这么用？');assert.match(document.querySelector('.study-translation-output').textContent,/中文解释/);
});

 test('inside-card lookup is a compact local layer, preserving source, answers and scroll; Escape closes only that layer',async()=>{
 const {prepareStudyCard}=await import('../ext/js/display/study-card.js');
 const {Frontend}=await import('../ext/js/app/frontend.js');
 const {dom,callbacks,display}=setupDisplay();globalThis.window=dom.window;
 const inner=document.querySelector('.content-body-inner');inner.scrollTop=117;
 const source=document.createElement('p');source.textContent='Our original sentence.';inner.append(source);
 const answer=document.createElement('textarea');answer.value='My unfinished question';inner.append(answer);
 display.displayGenerator={createTermEntry:entry=>{const el=document.createElement('section');el.innerHTML='<div data-sc-study-role="meaning"><div></div><div></div></div>';const rows=el.querySelectorAll('[data-sc-study-role=meaning]>div');rows[0].textContent='n. '+entry.headwords[0].term+' 中文词义';rows[1].textContent='vi. 发生变化';return el;}};
 prepareStudyCard(display);
 let rootShows=0,rootCloses=0;const scanner={clearSelection(){}};
 const owner={_application:{tabId:1,frameId:2},_pageType:'popup',_textScanner:scanner,_showPopupContent(){rootShows++;},_clearSelection(){rootCloses++;}};
 const lookup=word=>Frontend.prototype._showContent.call(owner,{text:()=>word,getRects:()=>[{left:25,top:260,right:70,bottom:280}]},false,[{type:'term',headwords:[{term:word}]}],'terms',{text:word,offset:0},'Original',{url:'https://example.org'},'light');
 lookup('brain');const mini=document.querySelector('.study-mini');assert.ok(mini,'nested word should have its own compact panel');
 assert.equal(rootShows,0,'never replaces owner card');assert.match(mini.textContent,/brain.*n\..*名词.*vi\..*不及物动词/s);
 assert.equal(mini.querySelectorAll('input,textarea,details').length,0);assert.equal(mini.querySelectorAll('button').length,2,'close and search buttons; no extra learning workflow');
 lookup('change');assert.equal(document.querySelector('.study-mini'),mini,'further lookup updates the same layer, never stacks');assert.match(mini.textContent,/change/);
 assert.equal(inner.scrollTop,117);assert.equal(source.isConnected,true);assert.equal(answer.value,'My unfinished question');
 const escape=new dom.window.KeyboardEvent('keydown',{key:'Escape',cancelable:true});await Frontend.prototype._onStudyLookupKey.call(owner,escape);
 assert.equal(document.querySelector('.study-mini'),null);assert.equal(rootCloses,0);assert.equal(escape.defaultPrevented,true);
 lookup('brain');source.dispatchEvent(new dom.window.MouseEvent('pointerdown',{bubbles:true}));assert.equal(document.querySelector('.study-mini'),null,'click back in main closes only mini');assert.equal(rootCloses,0);
 lookup('brain');callbacks.get('contentClear')();assert.equal(document.querySelector('.study-mini'),null,'new page source cannot keep a stale mini');
 await Frontend.prototype._onStudyLookupKey.call(owner,new dom.window.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(rootCloses,1,'without mini Escape retains main close');
 dom.window.close();
 });

test('asb timing indicator appears unobtrusively when asb data is detected and omitted otherwise', async () => {
    const {appendStudyContext} = await import('../ext/js/display/study-card.js');
    const d = new JSDOM('<div id="entry"></div>').window.document;
    const entryWithAsb = d.createElement('div');
    appendStudyContext(entryWithAsb, {text: 'The brain can change.', offset: 4}, 'brain', {label: 'ASB 01:14', title: '已读取 asbplayer 字幕时间戳 (01:14 – 01:17)'});
    const badge = entryWithAsb.querySelector('.study-asb-badge');
    assert.ok(badge, 'badge should exist when asb is provided');
    assert.equal(badge.textContent, 'ASB 01:14');
    assert.equal(badge.title, '已读取 asbplayer 字幕时间戳 (01:14 – 01:17)');

    const entryWithoutAsb = d.createElement('div');
    appendStudyContext(entryWithoutAsb, {text: 'The brain can change.', offset: 4}, 'brain');
    assert.equal(entryWithoutAsb.querySelector('.study-asb-badge'), null, 'no badge when asb is omitted');
});

test('article expressions without a dictionary hit stay in the plugin learning flow, not the stopped App', async () => {
    const {prepareStudyCard} = await import('../ext/js/display/study-card.js');
    const {callbacks, display} = setupDisplay();
    display.query = 'turn of phrase';
    display.history.state.sentence = {text: 'This is a turn of phrase.', offset: 10};
    display.history.state.url = 'https://example.test/article';
    globalThis.chrome = {
        permissions: {request: async () => true},
        runtime: {sendMessage: async () => ({ok: true, value: {result: null}})}
    };
    prepareStudyCard(display);
    callbacks.get('contentUpdateStart')();
    callbacks.get('contentUpdateComplete')();
    const context = document.querySelector('#study-context');
    assert.equal(context.hidden, false);
    assert.match(document.querySelector('.content-body-inner').textContent, /This is a turn of phrase/);
    assert.match(context.textContent, /turn of phrase/);
});
