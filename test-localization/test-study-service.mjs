import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
async function fixture(){
 const {StudyService}=await import('../ext/js/study/study-service.js');
 const data={};let calls=0,resolve;
 const storage={get:async key=>({[key]:structuredClone(data[key])}),set:async value=>Object.assign(data,structuredClone(value))};
 const service=new StudyService(storage,()=>{calls++;return {promise:new Promise(r=>resolve=r),cancel:()=>resolve({ok:false,error:'取消'})};});
 return {service,data,calls:()=>calls,finish:()=>resolve({ok:true,result:{translation:'你反复做什么，就会成为什么样的人。',meaning:'反复地',notes:'副词修饰 do。'}})};
}
const lookup={sentence:'You are what you repeatedly do.',word:'repeatedly',context:''};
test('completed translation survives popup replacement without a new model call, sentence reuse is distinct from word meaning',async()=>{
 const f=await fixture();const p=f.service.handle('generate',{...lookup,mode:'explain'});
 await new Promise(r=>setImmediate(r));f.finish();await p;
 const result=await f.service.handle('peek',lookup);assert.equal(result.result.meaning,'反复地');
 const another=await f.service.handle('peek',{...lookup,word:'do'});assert.equal(another.result,null);assert.match(another.translation,/成为什么样/);assert.equal(f.calls(),1);
});
test('inflight is shared across popup instances; explicit cancel stops it and never stores error',async()=>{
 const f=await fixture();const p=f.service.handle('generate',{...lookup,mode:'explain'});const q=f.service.handle('generate',{...lookup,mode:'explain'});
 await new Promise(r=>setImmediate(r));assert.equal(f.calls(),1);
 assert.equal((await f.service.handle('peek',lookup)).busy,true);
 await f.service.handle('cancel',lookup);await assert.rejects(p);await assert.rejects(q);
 assert.equal((await f.service.handle('peek',lookup)).result,null);
});
test('settings and context invalidate cache, clearing it cannot be undone by an in-flight completion',async()=>{
 const f=await fixture();const p=f.service.handle('generate',{...lookup,mode:'translate'});await new Promise(r=>setImmediate(r));
 await f.service.handle('clearCache',{});f.finish();await p;assert.equal((await f.service.handle('peek',lookup)).result,null);
 const current=await f.service.handle('settings',{});assert.equal(current.cacheEnabled,true);
 await f.service.handle('saveSettings',{...current,goal:'reading'});
 assert.equal((await f.service.handle('peek',lookup)).result,null);
});
test('local collections are explicit, bounded and removable; URLs never enter the model payload',async()=>{
 const f=await fixture();assert.deepEqual(await f.service.handle('saved',{}),[]);
 await f.service.handle('saveWord',{...lookup,url:'https://example.com/article',title:'阅读材料'});
 const saved=await f.service.handle('saved',{});assert.equal(saved.length,1);assert.equal(saved[0].title,'阅读材料');
 await f.service.handle('removeWord',{id:saved[0].id});assert.deepEqual(await f.service.handle('saved',{}),[]);
});
test('AI results are first-view translation and contextual meaning; long analysis is closed by default',async()=>{
 const {renderStudyResult}=await import('../ext/js/display/study-translation.js');
 const d=new JSDOM('<div id="out"></div>').window.document;const out=d.getElementById('out');
 renderStudyResult(out,{translation:'译文',meaning:'简短语境含义',notes:'长分析\n'.repeat(300)},true);
 assert.match(out.querySelector('.study-ai-translation').textContent,/译文/);
 assert.equal(out.querySelector('details').open,false);assert.match(out.textContent,/已缓存/);
});
test('bounded neighbouring sentences are separate from the selected sentence',async()=>{
 const {adjacentSentences}=await import('../ext/js/study/study-data.js');
 assert.equal(adjacentSentences('Earlier thought. Previous sentence. ',' Next sentence! More unrelated material.'),'前句：Previous sentence.\n后句：Next sentence!');
 assert.equal(adjacentSentences('',''),'');
});
test('video bookmarks retain an explicit playback position locally, never as a model URL',async()=>{
 const f=await fixture();await f.service.handle('saveWord',{...lookup,url:'https://www.youtube.com/watch?v=demo',title:'视频',videoTime:92});
 assert.equal((await f.service.handle('saved',{}))[0].videoTime,92);
});
test('translate another word in the same cached sentence returns immediately, without inventing its meaning',async()=>{
 const f=await fixture();const p=f.service.handle('generate',{...lookup,mode:'explain'});await new Promise(r=>setImmediate(r));f.finish();await p;
 const reuse=await Promise.race([f.service.handle('generate',{...lookup,word:'do',mode:'translate'}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Cached sentence triggered another generation')),60))]);
 assert.match(reuse.result.translation,/成为什么样/);assert.equal(reuse.result.meaning,'');assert.equal(f.calls(),1);
});
test('saving at collection capacity never silently deletes an older favourite',async()=>{
 const f=await fixture();f.data.studySavedWordsV1=Array.from({length:200},(_,i)=>({id:String(i),word:`word${i}`,sentence:'Saved sentence.',url:'https://example.com',title:'',context:'',created:1}));
 await assert.rejects(f.service.handle('saveWord',{...lookup,url:'https://other.example'}),/收藏.*满/);
 assert.equal((await f.service.handle('saved',{}))[0].id,'0');
});
