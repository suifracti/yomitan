import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {JSDOM} from 'jsdom';
import {StudyService} from '../ext/js/study/study-service.js';
const flush=()=>new Promise(r=>setTimeout(r,15));
test('settings uses actual model capabilities, persists preferences, and clears cache when disabled',async()=>{
 const dom=new JSDOM(readFileSync(new URL('../ext/study-settings.html',import.meta.url),'utf8'),{url:'https://extension.test/study-settings.html'});
 globalThis.document=dom.window.document;let data={};let nativeCalls=0;
 const storage={get:async key=>({[key]:data[key]}),set:async values=>Object.assign(data,values)};
 const service=new StudyService(storage,()=>{nativeCalls++;return {promise:Promise.resolve({ok:true,models:[{model:'gpt-6.1-sol',displayName:'GPT-6.1 Sol',efforts:['low','high'],defaultEffort:'low'},{model:'gpt-6-astra',displayName:'GPT-6 Astra',efforts:['medium','high'],defaultEffort:'medium'}]}),cancel:()=>{}};});
 globalThis.chrome={permissions:{request:async()=>true},runtime:{sendMessage:async({studyAction,data})=>{try{return {ok:true,value:await service.handle(studyAction,data)};}catch(e){return {ok:false,error:e.message};}}}};
 await import('../ext/js/pages/study-settings-main.js');await flush();
 assert.equal(document.querySelector('#model').value,'gpt-6.1-sol');assert.equal(nativeCalls,0);
 document.querySelector('#load-models').click();await flush();
 const model=document.querySelector('#model');model.value='gpt-6-astra';model.dispatchEvent(new dom.window.Event('change'));
 assert.deepEqual([...document.querySelector('#effort').options].map(o=>o.value),['medium','high']);
 document.querySelector('#goal').value='listening';document.querySelector('#cacheEnabled').checked=false;
 document.querySelector('#settings-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();
 const config=await service.handle('settings',{});assert.equal(config.model,'gpt-6-astra');assert.equal(config.effort,'medium');assert.equal(config.goal,'listening');assert.equal(config.cacheEnabled,false);
 document.querySelector('#reset-memory').click();await flush();assert.equal((await service.handle('settings',{})).memoryEnabled,false);assert.equal(nativeCalls,1,'only model metadata, no translation calls');
});
