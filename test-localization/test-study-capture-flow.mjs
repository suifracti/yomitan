import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountStudyLibrary} from '../ext/js/display/study-library.js';
const tick=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
function setup({capture=async()=>({assets:[{kind:'audio',mime:'audio/webm',data:'real'}],warnings:[]}),isSourceCurrent=()=>true}={}){
 const dom=new JSDOM('<section id="host"></section>'),d=dom.window.document,calls=[];let cancelled=0;
 const entry={word:'improve',sentence:'We improve daily.',context:'',language:'en',translation:'我们每天进步。',meaning:'',notes:'',url:'https://www.youtube.com/watch?v=abcdefghijk&t=1s',title:'Fixture',videoTime:1};
 const row={id:'a'.repeat(32),entry,version:'b'.repeat(64),ankiEnabled:true,cards:[],ankiState:'saved'};
 globalThis.chrome={permissions:{request:async()=>true},runtime:{sendMessage:async({studyAction,data})=>{calls.push([studyAction,data]);let value={};
 if(studyAction==='pendingPeek')value={count:0};if(studyAction==='rememberEntry')value=row;
 if(studyAction==='libraryRead')value={items:[{record:row}]};
 if(studyAction==='libraryMedia')value={...row,media:{audio:{name:'study-media-real.webm'}}};return {ok:true,value};}}};
 const dispose=mountStudyLibrary(d.querySelector('#host'),()=>entry,()=>true,{capture,cancelCapture:async()=>{cancelled++;},range:{start:1,end:3},isSourceCurrent});
 return {d,calls,dispose,get cancelled(){return cancelled;}};
}
test('explicit real capture saves a note then attaches audio, but never creates a card',async()=>{
 const h=setup();h.d.querySelector('[data-study-add-card]').click();h.d.querySelector('[data-study-capture]').click();await tick();
 assert.equal(h.calls.filter(([a])=>a==='rememberEntry').length,1);
 const media=h.calls.find(([a])=>a==='libraryMedia');assert.equal(media[1].start,1);assert.equal(media[1].end,3);assert.equal(media[1].origin,'capture');
 assert.equal(h.calls.some(([a])=>['libraryCardsAdd','draftCards','generate'].includes(a)),false);
 assert.equal(h.d.querySelector('[data-study-card-choice=listening]').disabled,false);h.dispose();
});
test('cancel or disposal never attaches a late recording',async()=>{
 let finish;const h=setup({capture:()=>new Promise(r=>finish=r)});
 h.d.querySelector('[data-study-add-card]').click();h.d.querySelector('[data-study-capture]').click();await tick();
 h.d.querySelector('[data-study-capture-cancel]').click();finish({assets:[{kind:'audio',mime:'audio/webm',data:'late'}],warnings:[]});await tick();
 assert.equal(h.calls.some(([a])=>a==='libraryMedia'),false);assert.equal(h.cancelled,1);h.dispose();
});
test('edited source is not silently recorded as its former cue',async()=>{
 const h=setup({isSourceCurrent:()=>false});h.d.querySelector('[data-study-add-card]').click();h.d.querySelector('[data-study-capture]').click();await tick();
 assert.equal(h.calls.some(([a])=>['libraryMedia','rememberEntry'].includes(a)),false);h.dispose();
});
