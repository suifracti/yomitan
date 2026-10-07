import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {DictionaryWorker} from '../ext/js/dictionary/dictionary-worker.js';
import {prepareStudyRichDictionary} from '../ext/js/pages/common/study-rich-dictionary.js';
const revision='2026.10.04';
const known={title:'wty-en-en',revision,author:'wty contributors',url:'https://github.com/yomidevs/wiktionary-to-yomitan',importSuccess:false};
const flush=()=>new Promise(r=>setTimeout(r,20));
async function fixture({confirm=true,summary=known,badDigest=false,errors=[],switchProfile=false,dictionaryChanged=false}={}){
 const dom=new JSDOM('<section class="study-dictionary-status"></section>');globalThis.document=dom.window.document;globalThis.window=dom.window;let consent=0;dom.window.confirm=()=>{consent++;return confirm;};
 let info=summary?[{...summary}]:[];const events=[];const storage={};
 const full={profileCurrent:0,profiles:[{name:'英语学习',options:{dictionaries:[{name:'ECDICT 英语学习词典',enabled:true},{name:'wty-en-en',enabled:false},{name:'Custom',enabled:true}]}}]};
 Object.defineProperty(globalThis,'navigator',{value:{locks:{request:async(_n,_o,fn)=>fn({})}},configurable:true});
 Object.defineProperty(globalThis,'crypto',{value:{subtle:{digest:async()=>Uint8Array.from((badDigest?'0'.repeat(64):'bcccdce0047917db42c55e8221eff22c1477794cbcd571ddc49551cf26254fbf').match(/../g).map(x=>parseInt(x,16))).buffer}},configurable:true});
 globalThis.chrome={runtime:{getURL:x=>x,getManifest:()=>({version:'26.10.8.1'})},storage:{local:{get:async()=>storage,set:async x=>Object.assign(storage,x)}}};
 globalThis.fetch=async()=>{if(switchProfile)full.profileCurrent=1;if(dictionaryChanged&&info[0])info[0].importSuccess=true;return {ok:true,arrayBuffer:async()=>new Uint8Array([1]).buffer};};
 DictionaryWorker.prototype.deleteDictionary=async title=>{events.push(['delete',title]);info=[];};
 DictionaryWorker.prototype.importDictionary=async(_a,_d,progress)=>{events.push(['import']);progress?.({index:1,count:2,nextStep:true});const result={...known,importSuccess:errors.length===0};info=[result];return {result,errors};};
 const controller={getOptionsFull:async()=>full,setAllSettings:async()=>events.push(['settings']),preventPageExit:()=>{events.push(['protect']);return {end:()=>events.push(['unprotect'])};},application:{api:{getDictionaryInfo:async()=>info,triggerDatabaseUpdated:async(_k,action)=>events.push(['notify',action])}}};
 await prepareStudyRichDictionary(controller);
 return {button:document.querySelector('button'),events,full,storage,consent:()=>consent,panel:document.querySelector('section')};
}
test('incomplete known dictionary offers a repair button and only deletes it after explicit confirmation',async()=>{
 const f=await fixture();assert.match(f.button.textContent,/修复/);assert.deepEqual(f.events,[],'no automatic deletion');
 f.button.click();await flush();assert.equal(f.consent(),1);assert.deepEqual(f.events.filter(x=>x[0]==='delete'),[['delete','wty-en-en']]);
 assert.equal(f.full.profiles[0].options.dictionaries[1].enabled,true);assert.equal(f.full.profiles[0].options.dictionaries[2].enabled,true);assert.equal(f.button.hidden,true);
 assert.equal(f.events.at(-1)[0],'unprotect');assert.match(f.panel.textContent,/已启用/);
});
test('cancelling repair or invalid package checksum never deletes a partial dictionary',async()=>{
 for(const options of [{confirm:false},{badDigest:true}]){
  const f=await fixture(options);f.button.click();await flush();assert.equal(f.events.some(x=>x[0]==='delete'),false);assert.equal(f.events.some(x=>x[0]==='import'),false);
 }
});
test('unknown same-title revision cannot be overwritten and completed disabled dictionary is simply enabled',async()=>{
 const unknown=await fixture({summary:{...known,revision:'custom'}});unknown.button.click();await flush();assert.equal(unknown.events.some(x=>x[0]==='delete'),false);
 const complete=await fixture({summary:{...known,importSuccess:true}});complete.button.click();await flush();assert.equal(complete.events.some(x=>x[0]==='delete'||x[0]==='import'),false);assert.equal(complete.consent(),0);assert.equal(complete.button.hidden,true);
});
test('import failure exposes the actual error, never marks ready, and offers retry',async()=>{
 const f=await fixture({errors:[new Error('QuotaExceededError: storage full')]});f.button.click();await flush();assert.match(f.panel.textContent,/QuotaExceededError/);assert.equal(f.storage.studyWiktionaryReadyV1,undefined);assert.equal(f.button.hidden,false);assert.equal(f.button.disabled,false);
});

test('configuration or dictionary state changing during package I/O stops destructive repair',async()=>{
 for(const options of [{switchProfile:true},{dictionaryChanged:true}]){
  const f=await fixture(options);f.button.click();await flush();assert.equal(f.events.some(x=>x[0]==='delete'||x[0]==='import'),false);
 }
});
