import test from 'node:test';
import assert from 'node:assert/strict';
import {StudyService} from '../ext/js/study/study-service.js';
import {SETTINGS_KEY,CACHE_KEY} from '../ext/js/study/study-data.js';
function harness(){const db={[SETTINGS_KEY]:{model:'fixture',effort:'low',cacheEnabled:true}},calls=[];let held;
 const service=new StudyService({get:async k=>({[k]:db[k]}),set:async v=>Object.assign(db,v)},p=>{calls.push(p);return {cancel(){},promise:new Promise(resolve=>{held=()=>resolve({ok:true,result:{items:p.items.map(r=>({id:r.id,translation:'译：'+r.text}))}});queueMicrotask(()=>held());})};});
 return {service,db,calls};}
const request={requestId:'test-run',language:'en',title:'Fixture',config:{model:'fixture',effort:'low'},items:[{id:'line-0',text:'Keep going.',context:'Prior sentence.'},{id:'line-1',text:'Stay curious.',context:''}]};
test('subtitle batches use configured native translator without learning writes and share sentence cache',async()=>{
 const {service,db,calls}=harness();const result=await service.handle('subtitleTranslate',request);
 assert.deepEqual(result.items.map(r=>r.id),['line-0','line-1']);
 assert.equal(calls.length,1);assert.equal(calls[0].action,'subtitles');
 assert.deepEqual(calls[0].config,{model:'fixture',effort:'low'});
 assert.equal(calls.some(p=>p.action.startsWith('library')||p.action.startsWith('video')),false);
 assert.equal(db[CACHE_KEY].length,2);
 const reused=await service.handle('generate',{word:'going',sentence:'Keep going.',context:'Prior sentence.',mode:'translate',language:'en'});
 assert.equal(reused.result.translation,'译：Keep going.');assert.equal(calls.length,1);
});
test('subtitle batches reject wrong settings, duplicates, and oversized requests without calling native',async()=>{
 const {service,calls}=harness();
 await assert.rejects(service.handle('subtitleTranslate',{...request,config:{model:'other',effort:'low'}}));
 await assert.rejects(service.handle('subtitleTranslate',{...request,items:[request.items[0],request.items[0]]}));
 await assert.rejects(service.handle('subtitleTranslate',{...request,items:Array.from({length:9},(_,i)=>({id:String(i),text:'line'}))}));
 assert.equal(calls.length,0);
});
test('cancellation discards a late subtitle reply and never caches it',async()=>{
 const db={},calls=[];let resolve,cancelled=false;
 const service=new StudyService({get:async k=>({[k]:db[k]}),set:async v=>Object.assign(db,v)},p=>{calls.push(p);return {cancel(){cancelled=true;},promise:new Promise(r=>resolve=r)};});
 const config=await service.handle('settings',{});
 const pending=service.handle('subtitleTranslate',{...request,config:{model:config.model,effort:config.effort}});
 while(!resolve)await new Promise(r=>setImmediate(r));
 await service.handle('subtitleCancel',{requestId:request.requestId});
 resolve({ok:true,result:{items:request.items.map(r=>({id:r.id,translation:'late'}))}});
 await assert.rejects(pending,/取消/);assert.equal(cancelled,true);assert.equal(db[CACHE_KEY],undefined);
});
