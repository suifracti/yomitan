import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StudyService} from '../ext/js/study/study-service.js';
import {JSDOM} from 'jsdom';
const source={word:'just',sentence:'You just can.',offset:4,context:'',url:'https://example.com/read',title:'Article',videoTime:42};
const dictionary={word:'just',items:[{id:'0',text:'Only, simply, merely.'},{id:'1',text:'Fair; morally right.'}]};
function fixture(){
 const data={};let calls=0,resolve,payload;
 const service=new StudyService({get:async k=>({[k]:structuredClone(data[k])}),set:async v=>Object.assign(data,structuredClone(v))},p=>{calls++;payload=p;return {promise:new Promise(r=>resolve=r),cancel:()=>resolve({ok:false,error:'Cancelled'})};});
 return {service,data,calls:()=>calls,payload:()=>payload,finish:result=>resolve({ok:true,result})};
}
test('fixed detail keeps only bounded source locally; survives service restart, no model call',async()=>{
 const f=fixture();const saved=await f.service.handle('storeDetail',source);
 const fresh=new StudyService(f.service.storage,()=>{throw new Error('No AI on open');});
 assert.deepEqual((await fresh.handle('detail',{id:saved.id})).source,source);
 assert.equal(f.calls(),0);assert.match(saved.id,/^[a-f0-9-]{36}$/);
 await assert.rejects(f.service.handle('storeDetail',{...source,sentence:'x'.repeat(2401)}));
 await assert.rejects(f.service.handle('detail',{id:'../secrets'}));
 assert.equal((await fresh.handle('detail',{id:'00000000-0000-4000-8000-000000000000'})),null);
});
test('dictionary AI is explicit, cached by exact source and model, shared while inflight',async()=>{
 const f=fixture();assert.equal((await f.service.handle('dictionaryPeek',dictionary)).result,null);assert.equal(f.calls(),0);
 const p=f.service.handle('dictionaryGenerate',dictionary),q=f.service.handle('dictionaryGenerate',dictionary);
 await new Promise(r=>setImmediate(r));assert.equal(f.calls(),1);assert.equal(f.payload().action,'dictionary');
 f.finish({items:[{id:'0',translation:'只是、仅仅。'},{id:'1',translation:'公正、正当。'}]});
 await p;await q;
 assert.equal((await f.service.handle('dictionaryPeek',dictionary)).result.items[0].translation,'只是、仅仅。');
 assert.equal((await f.service.handle('dictionaryGenerate',dictionary)).cached,true);assert.equal(f.calls(),1);
 assert.equal((await f.service.handle('dictionaryPeek',{...dictionary,items:[{id:'0',text:'Changed source.'}]})).result,null);
 await f.service.handle('saveSettings',{model:'another-model'});assert.equal((await f.service.handle('dictionaryPeek',dictionary)).result,null);
});
test('invalid/reordered dictionary IDs, oversize and injection fields fail closed; clearing cannot resurrect cache',async()=>{
 const f=fixture();await assert.rejects(f.service.handle('dictionaryGenerate',{...dictionary,command:'read files'}));
 await assert.rejects(f.service.handle('dictionaryGenerate',{...dictionary,items:Array.from({length:7},(_,i)=>({id:String(i),text:'sense'}))}));
 const p=f.service.handle('dictionaryGenerate',dictionary);await new Promise(r=>setImmediate(r));
 f.finish({items:[{id:'1',translation:'错误顺序'},{id:'0',translation:'错误顺序'}]});await assert.rejects(p);assert.equal((await f.service.handle('dictionaryPeek',dictionary)).result,null);
 const q=f.service.handle('dictionaryGenerate',dictionary);await new Promise(r=>setImmediate(r));await f.service.handle('clearCache',{});
 f.finish({items:[{id:'0',translation:'中文'},{id:'1',translation:'中文'}]});await q;assert.equal((await f.service.handle('dictionaryPeek',dictionary)).result,null);
});
test('safe aligned bilingual rendering retains originals; no HTML from AI',async()=>{
 const {renderDictionaryTranslation}=await import('../ext/js/display/study-dictionary.js');
 const d=new JSDOM('<div id="out"></div>').window.document,out=d.getElementById('out');
 renderDictionaryTranslation(out,dictionary,{items:[{id:'0',translation:'<img onerror=evil()>只是'},{id:'1',translation:'公正'}]},true);
 assert.equal(out.querySelector('img'),null);assert.match(out.textContent,/Only, simply, merely/);assert.match(out.textContent,/AI.*已缓存/);assert.equal(out.querySelectorAll('.study-bilingual-row').length,2);
});
test('fixed-page senses page without AI; examples already readable and stale generation never leaks across pages',async()=>{
 const {prepareStudyDictionary}=await import('../ext/js/display/study-dictionary.js');
 const dom=new JSDOM('<div id="entry"><div class="entry-body"><div class="definition-item"><ol data-sc-content="glosses">'+Array.from({length:8},(_,i)=>`<li><div>Sense ${i}.<details data-sc-content="details-entry-examples"><summary>1 example</summary><div data-sc-content="extra-info">A source example ${i}.</div></details></div></li>`).join('')+'</ol></div></div></div>');
 for(const key of ['HTMLElement','HTMLDetailsElement'])globalThis[key]=dom.window[key];
 let generated=0,finish,grant;
 globalThis.chrome={permissions:{request:()=>new Promise(r=>grant=r)},runtime:{sendMessage:async({studyAction,data})=>{
  if(studyAction==='dictionaryPeek')return {ok:true,value:{result:null,busy:false}};
  if(studyAction==='dictionaryGenerate'){generated++;return new Promise(r=>finish=()=>r({ok:true,value:{result:{items:data.items.map(s=>({id:s.id,translation:'OLD PAGE 中文'}))},cached:false}}));}
  return {ok:true,value:true};
 }}};
 const entry=dom.window.document.querySelector('#entry'),dispose=prepareStudyDictionary(entry,'just');
 await new Promise(r=>setImmediate(r));assert.equal(generated,0);assert.equal(entry.querySelectorAll('[data-study-sense-hidden=false]').length,6);
 assert.equal(entry.querySelector('details').open,true);
 const buttons=[...entry.querySelectorAll('.study-dictionary-controls button')];buttons.find(b=>b.textContent==='AI 中文 · 本组').click();
 grant(true);await new Promise(r=>setImmediate(r));assert.equal(generated,1);
 buttons.find(b=>b.textContent==='下一组').click();await new Promise(r=>setImmediate(r));assert.equal(entry.querySelectorAll('[data-study-sense-hidden=false]').length,2);
 finish();await new Promise(r=>setImmediate(r));assert.doesNotMatch(entry.textContent,/OLD PAGE 中文/);dispose();
});
test('openDetail accepts only own pages and opens constant persistent URL, never navigation to a submitted website',async()=>{
 const {prepareStudyService}=await import('../ext/js/study/study-service.js');
 let receive;const tabs=[],storage={};const base='chrome-extension://test-id/';
 globalThis.chrome={runtime:{id:'test-id',getURL:p=>base+p,onMessage:{addListener:fn=>receive=fn}},tabs:{create:async v=>tabs.push(v)},storage:{local:{get:async k=>({[k]:storage[k]}),set:async v=>Object.assign(storage,v)}}};
 prepareStudyService();
 const invoke=(sender,studyAction='openDetail',data=source)=>new Promise(resolve=>{const async=receive({studyAction,data},sender,resolve);if(!async)resolve({ok:false});});
 assert.equal((await invoke({id:'test-id',url:'https://example.com/'})).ok,false);assert.equal(tabs.length,0);
 assert.equal((await invoke({id:'test-id',url:base+'popup.html'})).ok,true);assert.equal(tabs.length,1);
 assert.match(tabs[0].url,/^chrome-extension:\/\/test-id\/search.html\?studyDetail=[a-f0-9-]{36}$/);
 assert.doesNotMatch(tabs[0].url,/example.com|You|sentence/);
 assert.equal((await invoke({id:'test-id',url:base+'search.html?studyDetail=x'},'clearCache',{})).ok,false);
});

test('real popup has one fixed detail button; search ships study stylesheet and original upstream actions',()=>{
 const root=new URL('../',import.meta.url);
 const popup=new JSDOM(readFileSync(new URL('ext/popup.html',root),'utf8')).window.document;
 const search=new JSDOM(readFileSync(new URL('ext/search.html',root),'utf8')).window.document;
 assert.equal(popup.querySelectorAll('#study-open-detail').length,1);assert.equal(popup.querySelectorAll('[data-study-view]').length,0);
 assert.ok(search.querySelector('link[href="/css/study-card.css"]'));assert.equal(search.querySelectorAll('#study-context').length,1);assert.ok(search.querySelector('#search-textbox'));
});
