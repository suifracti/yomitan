import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {StudyService,prepareStudyService} from '../ext/js/study/study-service.js';
const entry={word:'bank on',sentence:'Can you bank on him?',language:'en',context:'',meaning:'',translation:'',notes:'',url:'https://example.test/video',title:'Synthetic',subtitleSource:{version:1,url:'https://example.test/video',language:'en',trackIndex:0,trackName:'English',text:'Can you bank on him?',originalStartMs:12000,originalEndMs:14500,subtitleOffsetMs:750,selectionStart:8,selectionEnd:15,word:'bank on',provenance:{queryId:'submitted',sourceRevision:'private',cueIndex:1,tabId:3,frameId:0,documentId:'old-doc'}}};
import {sourceKey} from '../ext/js/study/study-journal.js';
const intent=()=>({key:sourceKey(entry),entry:structuredClone(entry),turns:[]});
function fixture(t,db={}){
 const vault=mkdtempSync(path.join(os.tmpdir(),'startup-cue-'));t.after(()=>rmSync(vault,{recursive:true,force:true}));
 const storage={get:async k=>({[k]:structuredClone(db[k])}),set:async v=>Object.assign(db,structuredClone(v))};const calls=[];
 const native=p=>{calls.push(structuredClone(p));const r=spawnSync('python3',['-B','-c',`import sys,json,pathlib
sys.path.insert(0,sys.argv[1]);from study_library import StudyLibrary
def fake_anki(*a,**k): raise AssertionError('No Anki permitted')
try: print(json.dumps({'ok':True,'library':StudyLibrary(pathlib.Path(sys.argv[2]),anki=fake_anki).handle(json.loads(sys.stdin.read()))},ensure_ascii=False))
except Exception as e: print(json.dumps({'ok':False,'error':str(e)}))`,new URL('../local-bridge',import.meta.url).pathname,vault],{input:JSON.stringify(p),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 let listeners=[];const boot=()=>{listeners=[];globalThis.chrome={storage:{local:storage},runtime:{id:'self',getURL:p=>'chrome-extension://self/'+p,onMessage:{addListener:f=>listeners.push(f)},connectNative(){let receive;return {onMessage:{addListener:f=>receive=f},onDisconnect:{addListener(){}},disconnect(){},postMessage(p){queueMicrotask(()=>receive(native(p)));}};}}};prepareStudyService();};
 return {db,storage,native,calls,vault,boot,listeners:()=>listeners,files(){const all=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?all(path.join(d,e.name)):e.name.endsWith('.md')?[path.join(d,e.name)]:[]);return all(vault).map(p=>readFileSync(p,'utf8')).filter(s=>s.includes('"subtitleSource"'));}};
}
async function wait(f){for(let i=0;i<60;i++){if(f())return;await new Promise(r=>setTimeout(r,10));}assert.ok(f(),'normal production prepare must resume queued R2 intent');}
test('normal prepare recovers explicit lost-reply save into same temp Vault once; repeated boot is idempotent',async t=>{
 const h=fixture(t);const first=new StudyService(h.storage,p=>({cancel(){},promise:Promise.resolve().then(()=>{if(p.action==='libraryTargetResolve')return {ok:true,library:{targetId:'d'.repeat(32)}};const r=h.native(p);assert.equal(r.ok,true,r.error);return {ok:false,error:'lost saved response'};})}));
 globalThis.chrome={runtime:{}};const c=entry.subtitleSource;const sender={id:'self',tab:{id:3,url:entry.url},frameId:0,documentId:'old-doc',url:entry.url};const cue={...c,sourceRevision:c.provenance.sourceRevision,cueIndex:1};delete cue.provenance;
 const rt={id:'self',sendMessage(id,m,cb){cb(m.phase==='prepare'?{ok:true,queryId:m.queryId,receipt:'single',expires:Date.now()+5000}:{ok:true,queryId:m.queryId,cue:m.cue,source:{...m.source,title:entry.title},expires:Date.now()+5000,writeAuthorized:false});}};
 assert.equal((await first.attestCue(rt,sender,{queryId:'submitted',cue})).ok,true);await assert.rejects(first.saveVerifiedCue('submitted',sender),/lost/);assert.equal(h.files().length,1);assert.equal(h.db.studyCueSaveIntentsV1.length,1);
 h.boot();prepareStudyService();assert.equal(h.listeners().length,1);await wait(()=>h.db.studyCueSaveIntentsV1.length===0);assert.equal(h.calls.length,2);assert.equal(h.files().length,1);prepareStudyService();await new Promise(r=>setTimeout(r,30));assert.equal(h.listeners().length,1);assert.equal(h.calls.length,2);
 h.boot();await new Promise(r=>setTimeout(r,30));assert.equal(h.calls.length,2);assert.ok(h.calls.every(p=>p.action==='librarySave'&&p.makeCard===false));assert.deepEqual(h.db.studyRememberSaveIntents,undefined);
});
test('damaged, unsupported/expired-shaped and wrong-owner provenance intents stay queued with errors, no R1 fallback',async t=>{
 const bad=[{key:'legacy',entry:{word:'bank on',sentence:entry.sentence,url:entry.url},turns:[]}, {...intent(),expires:1}, {...intent(),entry:{...structuredClone(entry),subtitleSource:{...structuredClone(entry.subtitleSource),provenance:{...entry.subtitleSource.provenance,frameId:1}}}}, null];
 const h=fixture(t,{studyCueSaveIntentsV1:bad,studyRememberSaveIntents:[{marker:'R1 keep'}]});h.boot();await wait(()=>h.db.studyCueSaveRecoveryV1?.errors?.length===4);assert.deepEqual(h.db.studyCueSaveIntentsV1,bad);assert.equal(h.calls.length,0);assert.deepEqual(h.db.studyRememberSaveIntents,[{marker:'R1 keep'}]);
});
test('invalid row does not block valid explicit intent; changed document is frozen history, not new authorization',async t=>{
 const bad={...intent(),key:'mismatch'};const good=intent();const h=fixture(t,{studyCueSaveIntentsV1:[bad,good]});h.boot();await wait(()=>h.calls.length===1&&h.db.studyCueSaveRecoveryV1?.errors?.length===1);assert.deepEqual(h.db.studyCueSaveIntentsV1,[bad]);assert.equal(h.calls[0].entry.subtitleSource.provenance.documentId,'old-doc');assert.equal(h.files().length,1);
 const receiver=h.listeners()[0];const response=await new Promise(resolve=>receiver({studyAction:'saveVerifiedCue',data:{queryId:'submitted'}},{id:'self',url:'chrome-extension://self/popup.html'},resolve));assert.equal(response.ok,false);assert.equal(h.calls.length,1);
});
test('non-array queue remains untouched and has explanatory recovery error',async t=>{const h=fixture(t,{studyCueSaveIntentsV1:{broken:true}});h.boot();await wait(()=>h.db.studyCueSaveRecoveryV1?.errors?.length===1);assert.deepEqual(h.db.studyCueSaveIntentsV1,{broken:true});assert.equal(h.calls.length,0);});
test('before explicit submission, changed tab owner or later track query cannot queue old cue',async t=>{
 const h=fixture(t);globalThis.chrome={runtime:{}};const service=new StudyService(h.storage,p=>({cancel(){},promise:Promise.resolve(h.native(p))}));
 const sender={id:'self',url:entry.url,tab:{id:3,url:entry.url},frameId:0,documentId:'old-doc'};const cue={...entry.subtitleSource,sourceRevision:'private',cueIndex:1};delete cue.provenance;
 const rt={id:'self',sendMessage(id,m,cb){cb(m.phase==='prepare'?{ok:true,queryId:m.queryId,receipt:'single',expires:Date.now()+5000}:{ok:true,queryId:m.queryId,cue:m.cue,source:m.source,expires:Date.now()+5000,writeAuthorized:false});}};
 assert.equal((await service.attestCue(rt,sender,{queryId:'old',cue})).ok,true);await assert.rejects(service.saveVerifiedCue('old',{...sender,tab:{id:4,url:entry.url}}),/失效/);
 assert.equal((await service.attestCue(rt,sender,{queryId:'new-track',cue:{...cue,trackIndex:1,trackName:'Other'}})).ok,true);await assert.rejects(service.saveVerifiedCue('old',sender),/失效/);assert.equal(h.calls.length,0);assert.equal(h.db.studyCueSaveIntentsV1,undefined);
});
