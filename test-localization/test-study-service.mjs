import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
async function fixture(){
 const {StudyService}=await import('../ext/js/study/study-service.js');
 const data={};let calls=0;const resolvers=new Map();
 const storage={get:async key=>({[key]:structuredClone(data[key])}),set:async value=>Object.assign(data,structuredClone(value))};
 const service=new StudyService(storage,p=>{if(p.action==='libraryMemory')return {promise:Promise.resolve({ok:true,library:{items:[],total:0}}),cancel(){}};calls++;return {promise:new Promise(r=>resolvers.set(p.word,r)),cancel:()=>resolvers.get(p.word)?.({ok:false,error:'取消'})};});
 return {service,data,calls:()=>calls,finish:(word=lookup.word,result={translation:'你反复做什么，就会成为什么样的人。',meaning:'反复地',notes:'副词修饰 do。'})=>resolvers.get(word)?.({ok:true,result})};
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
test('sentence cancel releases an in-flight dictionary translation holding the native lock', async () => {
 const f = await fixture();
 const dictLookup = {word: 'piece', items: [{id: '0', text: 'a part of something'}]};
 const dict = f.service.handle('dictionaryGenerate', dictLookup);
 await new Promise(r => setImmediate(r));
 assert.equal((await f.service.handle('dictionaryPeek', dictLookup)).busy, true);
 await f.service.handle('cancel', lookup);
 await assert.rejects(dict);
 assert.equal((await f.service.handle('dictionaryPeek', dictLookup)).busy, false);
});
test('cancelling one lookup leaves a concurrent lookup able to save its result',async()=>{
 const f=await fixture();
 const other={...lookup,word:'do',mode:'explain'};
 const cancelled=f.service.handle('generate',{...lookup,mode:'explain'});
 const preserved=f.service.handle('generate',other);
 await new Promise(r=>setImmediate(r));assert.equal(f.calls(),2);
 await f.service.handle('cancel',lookup);
 f.finish('do',{translation:'你反复做什么，就会成为什么样的人。',meaning:'做',notes:'此处是动词。'});
 await assert.rejects(cancelled);
 const result=await preserved;assert.equal(result.result.meaning,'做');
 assert.equal((await f.service.handle('peek',lookup)).result,null);
 assert.equal((await f.service.handle('peek',other)).result.meaning,'做');
});
test('settings and context invalidate cache, clearing it cannot be undone by an in-flight completion',async()=>{
 const f=await fixture();const p=f.service.handle('generate',{...lookup,mode:'translate'});await new Promise(r=>setImmediate(r));
 await f.service.handle('clearCache',{});f.finish();await p;assert.equal((await f.service.handle('peek',lookup)).result,null);
 const current=await f.service.handle('settings',{});assert.equal(current.cacheEnabled,true);
 await f.service.handle('saveSettings',{...current,effort:'high'});
 assert.equal((await f.service.handle('peek',lookup)).result,null);
});
test('local collections are explicit, bounded and removable; URLs never enter the model payload',async()=>{
 const f=await fixture();assert.deepEqual(await f.service.handle('saved',{}),[]);
 await f.service.handle('saveWord',{...lookup,url:'https://example.com/article',title:'阅读材料'});
 const saved=await f.service.handle('saved',{});assert.equal(saved.length,1);assert.equal(saved[0].title,'阅读材料');
 await f.service.handle('removeWord',{id:saved[0].id});assert.deepEqual(await f.service.handle('saved',{}),[]);
});
test('AI results are first-view translation and contextual meaning; analysis stays directly in the same card',async()=>{
 const {renderStudyResult}=await import('../ext/js/display/study-translation.js');
 const d=new JSDOM('<div id="out"></div>').window.document;const out=d.getElementById('out');
 renderStudyResult(out,{translation:'译文',meaning:'简短语境含义',notes:'长分析\n'.repeat(300)},true);
 assert.match(out.querySelector('.study-ai-translation').textContent,/译文/);
 assert.equal(out.querySelector('details'),null);assert.match(out.querySelector('.study-ai-notes').textContent,/长分析/);assert.match(out.textContent,/已缓存/);
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

test('library saving forwards only the fixed library action and never invokes AI generation',async()=>{
 const {StudyService}=await import('../ext/js/study/study-service.js');
 const captured=[];
 const s=new StudyService({get:async()=>({}),set:async()=>{}},p=>{if(p.action==='libraryTargetResolve')return {promise:Promise.resolve({ok:true,library:{targetId:'d'.repeat(32)}}),cancel(){}};captured.push(p);return {promise:Promise.resolve({ok:true,library:{vaultSaved:true,ankiState:'pending'}}),cancel(){}};});
 const entry={...lookup,meaning:'反复地',translation:'',notes:'',url:'https://example.com',title:'阅读'};
 const result=await s.handle('librarySave',{entry,makeCard:true});
 assert.equal(result.vaultSaved,true);assert.equal(result.ankiState,'pending');
 assert.equal(captured[0].action,'librarySave');assert.equal(captured[0].entry.sentence,lookup.sentence);
 await assert.rejects(s.handle('librarySave',{action:'generate',entry,makeCard:true}));
});

test('AI organisation has selected records only, strips source URLs, aligns IDs and does not write notes',async()=>{
 const {StudyService}=await import('../ext/js/study/study-service.js');
 let captured;
 const id='a'.repeat(32);
 const s=new StudyService({get:async()=>({}),set:async()=>{}},p=>{captured=p;return {promise:Promise.resolve(p.action==='libraryRead'?{ok:true,library:{items:[{id,version:'b'.repeat(64),word:'repeatedly',text:'学习正文',truncated:false}]}}:{ok:true,result:{items:[{id,text:'学习解释'}]}}),cancel(){}};});
 const result=await s.handle('organize',{records:[{id,version:'b'.repeat(64),entry:{...lookup,meaning:'反复地',translation:'句子译文',notes:'',url:'https://private.example',title:'private'}}]});
 assert.equal(result.items[0].text,'学习解释');assert.equal(captured.action,'organize');
 assert.doesNotMatch(JSON.stringify(captured),/private|url|title/);
 await assert.rejects(s.handle('organize',{records:[]}));
});
