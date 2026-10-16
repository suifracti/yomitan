import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {JSDOM} from 'jsdom';
import {StudyService} from '../ext/js/study/study-service.js';
const flush=()=>new Promise(r=>setTimeout(r,15));
test('settings uses actual model capabilities, drops retired preferences, and clears cache when disabled',async()=>{
 const dom=new JSDOM(readFileSync(new URL('../ext/study-settings.html',import.meta.url),'utf8'),{url:'https://extension.test/study-settings.html'});
 globalThis.document=dom.window.document;let data={studySettingsV2:{model:'gpt-6.1-sol',effort:'low',level:'advanced',goal:'exam',style:'detailed',memoryEnabled:true,cacheEnabled:true},studySavedWordsV1:[{id:'keep',word:'word',sentence:'A word.'}]};let nativeCalls=0;
 const storage={get:async key=>({[key]:data[key]}),set:async values=>Object.assign(data,values)};
 const service=new StudyService(storage,()=>{nativeCalls++;return {promise:Promise.resolve({ok:true,models:[{model:'gpt-6.1-sol',displayName:'GPT-6.1 Sol',efforts:['low','high'],defaultEffort:'low'},{model:'gpt-6-astra',displayName:'GPT-6 Astra',efforts:['medium','high'],defaultEffort:'medium'}]}),cancel:()=>{}};});
 globalThis.chrome={permissions:{request:async()=>true},runtime:{sendMessage:async({studyAction,data})=>{try{return {ok:true,value:await service.handle(studyAction,data)};}catch(e){return {ok:false,error:e.message};}}}};
 await import('../ext/js/pages/study-settings-main.js');await flush();
 assert.equal(document.querySelector('#model').value,'gpt-6.1-sol');assert.equal(nativeCalls,0);
 document.querySelector('#load-models').click();await flush();
 const model=document.querySelector('#model');model.value='gpt-6-astra';model.dispatchEvent(new dom.window.Event('change'));
 assert.deepEqual([...document.querySelector('#effort').options].map(o=>o.value),['medium','high']);
 assert.equal(document.querySelector('#goal'),null);assert.equal(document.querySelector('#level'),null);assert.equal(document.querySelector('#style'),null);assert.equal(document.querySelector('#memoryEnabled'),null);assert.equal(document.querySelector('#reset-memory'),null);document.querySelector('#cacheEnabled').checked=false;
 document.querySelector('#settings-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();
 const config=await service.handle('settings',{});assert.equal(config.model,'gpt-6-astra');assert.equal(config.effort,'medium');assert.deepEqual(Object.keys(config).sort(),['autoDictionaryTranslate','cacheEnabled','effort','model']);assert.equal(config.cacheEnabled,false);
 assert.equal(data.studySavedWordsV1[0].id,'keep');assert.deepEqual(Object.keys(data.studySettingsV2).sort(),['autoDictionaryTranslate','cacheEnabled','effort','model']);assert.equal(nativeCalls,1,'only model metadata, no translation calls');
});

test('native dictionary translation receives only model and effort, not UI preferences',async()=>{
 for(const flags of [
  {autoDictionaryTranslate:true,cacheEnabled:true},
  {autoDictionaryTranslate:false,cacheEnabled:false}
 ]){
  const data={studySettingsV2:{model:'gpt-6-luna',effort:'max',...flags}};
  const storage={get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value)};
  const calls=[];
  const native=payload=>{
   calls.push(payload);
   return {promise:Promise.resolve({ok:true,result:{items:[{id:'0',translation:'智力'}]}}),cancel:()=>{}};
  };
  const service=new StudyService(storage,native);
  const lookup={word:'intelligence',items:[{id:'0',text:'The ability to learn and understand.'}]};
  const result=await service.handle('dictionaryGenerate',lookup);
  assert.deepEqual(result.result,{items:[{id:'0',translation:'智力'}]});
  assert.equal(calls.length,1);
  assert.equal(calls[0].action,'dictionary');
  assert.deepEqual(calls[0].config,{model:'gpt-6-luna',effort:'max'});
  assert.deepEqual(Object.keys(calls[0].config).sort(),['effort','model']);
  assert.equal(data.studySettingsV2.autoDictionaryTranslate,flags.autoDictionaryTranslate,'do not rewrite user preferences');
  assert.equal(data.studySettingsV2.cacheEnabled,flags.cacheEnabled,'keep local cache preference');
 }
});

test('sentence AI native requests accept only model/effort even when UI toggles are saved',async()=>{
 const state={studySettingsV2:{model:'gpt-6-luna',effort:'max',autoDictionaryTranslate:true,cacheEnabled:true}};
 const storage={get:async key=>({[key]:state[key]}),set:async values=>Object.assign(state,values)};
 const outbound=[];
 const native=payload=>{
  outbound.push(payload);
  if(payload.action==='libraryMemory'){
   return {promise:Promise.resolve({ok:true,library:{items:[],total:0}}),cancel:()=>{}};
  }
  return {promise:Promise.resolve({ok:true,result:{translation:'我的知识和智力。',meaning:'智力',notes:''}}),cancel:()=>{}};
 };
 const service=new StudyService(storage,native);
 service.journal={checkRoom:async()=>{},get:async()=>[],recordUsage:async()=>{},append:async()=>{}};
 for(const mode of ['translate','explain']){
  const value={word:'intelligence',sentence:'My knowledge and intelligence.',context:'',mode,question:mode==='explain'?'怎么理解？':''};
  const answer=await service.handle('generate',value);
  assert.equal(answer.result.translation,'我的知识和智力。');
  const request=outbound.find(row=>row.action===mode);
  assert.ok(request,mode+' must reach the Native bridge');
  assert.deepEqual(request.config,{model:'gpt-6-luna',effort:'max'});
 }
 assert.equal(state.studySettingsV2.autoDictionaryTranslate,true,'persist UI preference in extension');
 assert.equal(state.studySettingsV2.cacheEnabled,true,'retain cache configuration');
});
