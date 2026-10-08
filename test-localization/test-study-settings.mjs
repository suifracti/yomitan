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
 const config=await service.handle('settings',{});assert.equal(config.model,'gpt-6-astra');assert.equal(config.effort,'medium');assert.deepEqual(Object.keys(config).sort(),['cacheEnabled','effort','model']);assert.equal(config.cacheEnabled,false);
 assert.equal(data.studySavedWordsV1[0].id,'keep');assert.deepEqual(Object.keys(data.studySettingsV2).sort(),['cacheEnabled','effort','model']);assert.equal(nativeCalls,1,'only model metadata, no translation calls');
});
