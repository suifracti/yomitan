import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StudyService} from '../ext/js/study/study-service.js';
const entry={word:'just',sentence:'It is a just decision.',context:'',meaning:'fair',translation:'公正的',notes:'',url:'https://example.test/article',title:'Article'};
const id='a'.repeat(32), targetId='b'.repeat(32);
function setup(){const db={},calls=[];let enabled=false,fail=false,target=targetId;
const storage={get:async k=>({[k]:structuredClone(db[k])}),set:async v=>Object.assign(db,structuredClone(v))};
const native=p=>({cancel(){},promise:(async()=>{calls.push(structuredClone(p));
if(p.action==='librarySettingsGet'||p.action==='librarySettingsSave')return {ok:true,library:{ankiEnabled:enabled,targetId:target,vault:'/tmp/Vault',directory:'Studies',deck:'Target',model:'外语语境卡'}};
if(p.action==='libraryTargetResolve')return {ok:true,library:{targetId:target,ankiEnabled:enabled}};
if(p.action==='librarySave'){if(fail)throw Error('offline');return {ok:true,library:row()};}
if(p.action==='libraryRead')return {ok:true,library:{items:[{id,word:'just',text:'Complete learning',record:row()}]}};
throw Error('Unexpected action: '+p.action);
})()});const row=()=>({id,entry,version:'v1',path:'Studies/just.md',openUrl:'obsidian://open?x',vaultSaved:true,ankiState:'saved',noteId:null,ankiEnabled:enabled,targetId, target:{deck:'Target',model:'外语语境卡'}});
return {db,calls,storage,native,service:new StudyService(storage,native),setEnabled:v=>enabled=v,setFail:v=>fail=v,setTarget:v=>target=v};}
test('settings read caches native targets for the native direct-card button',async()=>{const h=setup();const result=await h.service.handle('librarySettingsGet',{});assert.equal(result.ankiEnabled,false);assert.equal(h.db.studySaveTargetsV1.deck,'Target');});
test('Anki off remembers the complete note without AI card choice or delivery',async()=>{const h=setup();await h.service.journal.append({...entry,question:'Why is just used here?'},{meaning:'fair',translation:'公正的',notes:'Completed answer'});const r=await h.service.handle('rememberEntry',{entry});assert.equal(r.ankiEnabled,false);assert.equal(h.calls.some(p=>p.action==='cards'),false);assert.deepEqual(h.db.studyRememberOutbox,[]);assert.equal(h.calls.find(p=>p.action==='librarySave').targetId,targetId);assert.equal(h.calls.find(p=>p.action==='librarySave').turns[0].notes,'Completed answer');});
test('save intent freezes its old target across failure, change, and service restart',async()=>{const h=setup();h.setFail(true);await assert.rejects(h.service.handle('rememberEntry',{entry}),/offline/);assert.equal(h.db.studyRememberSaveIntents[0].targetId,targetId);h.setTarget('c'.repeat(32));h.setFail(false);await new StudyService(h.storage,h.native).handle('retryPending',{});assert.equal(h.calls.filter(p=>p.action==='librarySave').at(-1).targetId,targetId);});
test('turning Anki off preserves earlier queued work rather than pretending zero cards',async()=>{const h=setup();h.db.studyRememberOutbox=[{id,language:'en'}];const r=await h.service.handle('retryPending',{});assert.equal(r.ankiEnabled,false);assert.equal(h.db.studyRememberOutbox.length,1);assert.equal(h.calls.some(p=>p.action==='cards'),false);});
test('direct card draft endpoint also refuses model choice while Anki disabled',async()=>{const h=setup();const r=await h.service.handle('draftCards',{ids:[id]});assert.equal(r.items[0].ankiEnabled,false);assert.equal(h.calls.some(p=>p.action==='cards'),false);});

import {DisplayAnki} from '../ext/js/display/display-anki.js';
import {JSDOM} from 'jsdom';
test('native direct-card formats share the chosen deck without replacing advanced field mapping',async t=>{
 const oldChrome=globalThis.chrome;t.after(()=>globalThis.chrome=oldChrome);
 globalThis.chrome={storage:{local:{get:async()=>({studySaveTargetsV1:{ankiEnabled:true,deck:'Shared'}})}}};
 const fields={Word:{value:'{expression}'}};const view={_display:{getOptions:()=>({general:{language:'en'}})},_cardFormats:[{type:'term',deck:'Old',model:'Existing',fields}]};
 await DisplayAnki.prototype._refreshStudyAnkiTarget.call(view);
 assert.equal(view._cardFormats[0].deck,'Shared');assert.equal(view._cardFormats[0].model,'Existing');assert.equal(view._cardFormats[0].fields,fields);
});
test('Anki off hides direct-card actions and its submit guard prevents an API write',async t=>{
 const dom=new JSDOM('<button data-action="save-note">Add</button>');const oldChrome=globalThis.chrome,oldDocument=globalThis.document,oldButton=globalThis.HTMLButtonElement;
 Object.assign(globalThis,{document:dom.window.document,HTMLButtonElement:dom.window.HTMLButtonElement,chrome:{runtime:{sendMessage:async()=>({ok:true,value:{ankiEnabled:false,deck:'Shared'}})}}});
 t.after(()=>{Object.assign(globalThis,{chrome:oldChrome,document:oldDocument,HTMLButtonElement:oldButton});dom.window.close();});
 let writes=0;const view={_display:{getOptions:()=>({general:{language:'en'}}),application:{api:{addAnkiNote:async()=>writes++}}},_cardFormats:[],_subtitleSnapshotOnly:()=>false,_refreshStudyAnkiTarget:DisplayAnki.prototype._refreshStudyAnkiTarget};
 await view._refreshStudyAnkiTarget(true);
 assert.equal(document.querySelector('button').hidden,true);assert.equal(view._studyAnkiEnabled,false);
 const errors=[];await DisplayAnki.prototype._addNewAnkiNote.call(view,{deckName:'Old'},errors,document.querySelector('button'),0);
 assert.equal(writes,0);assert.match(errors[0].message,/未启用/);
});

test('switching away from English clears its disable state and target deck',async()=>{
 const view={_display:{getOptions:()=>({general:{language:'ja'}})},_studyAnkiEnabled:false,_studyAnkiDeck:'English'};
 await DisplayAnki.prototype._refreshStudyAnkiTarget.call(view);
 assert.equal(view._studyAnkiEnabled,true);assert.equal(view._studyAnkiDeck,null);
});

import {mountStudyLibrary} from '../ext/js/display/study-library.js';
test('remember UI distinguishes note-only from normal zero-card completion',async t=>{
 const h=setup(),dom=new JSDOM('<section></section>');const original=globalThis.chrome;
 globalThis.chrome={permissions:{request:async()=>true},runtime:{sendMessage:async({studyAction,data})=>({ok:true,value:await h.service.handle(studyAction,data)})}};
 t.after(()=>{globalThis.chrome=original;dom.window.close();});
 const box=dom.window.document.querySelector('section');mountStudyLibrary(box,()=>entry,()=>true);
 box.querySelector('[data-study-save]').click();
 for(let i=0;i<20&&!box.querySelector('.study-library-status').textContent.includes('Anki 未启用');i++)await new Promise(r=>setImmediate(r));
 assert.equal(box.querySelector('.study-library-status').textContent,'笔记已保存 · Anki 未启用');
 assert.equal(h.calls.some(p=>p.action==='cards'),false);
});

test('folder discovery uses the existing settings transport and never selects a new save target',async()=>{
 const settings={ankiEnabled:false,targetId:'a'.repeat(32),vault:'/tmp/fixture-vault',directory:'Study',deck:'Fixture',model:'Fixture'};
 const db={studySaveTargetsV1:structuredClone(settings)},calls=[];
 const service=new StudyService({get:async k=>({[k]:db[k]}),set:async v=>Object.assign(db,v)},p=>({cancel(){},promise:Promise.resolve().then(()=>{calls.push(p);return {ok:true,library:{...settings,items:[{path:'Another folder',label:'Another folder'}]}};})}));
 const result=await service.handle('librarySettingsOpen',{folderAction:'detect',kind:'directory',vault:settings.vault,directory:settings.directory});
 assert.equal(result.items[0].path,'Another folder');assert.deepEqual(db.studySaveTargetsV1,settings);
 assert.deepEqual(calls.map(p=>p.action),['librarySettingsOpen']);
});
