import assert from 'node:assert/strict';
import {test} from 'node:test';
import {attestStudyCue, ASB_CUE_EXTENSION_ID} from '../ext/js/study/study-cue-attestation.js';

const url='https://example.test/video';
const sender={id:'self',tab:{id:3,url},url,frameId:0,documentId:'doc-1'};
const cue={url,text:'bank',word:'bank'};
globalThis.chrome={runtime:{}};
function runtime(change=()=>{}) {
    return {id:'self',sendMessage(id,message,callback) {
        assert.equal(id,ASB_CUE_EXTENSION_ID);
        assert.deepEqual(message.source,{tabId:3,frameId:0,documentId:'doc-1',url});
        const result=message.phase==='prepare' ? {ok:true,queryId:message.queryId,receipt:'private-token',expires:Date.now()+5000} :
            {ok:true,queryId:message.queryId,cue:message.cue,source:message.source,expires:Date.now()+5000,writeAuthorized:false};
        change(result,message);callback(result);
    }};
}
test('actual sender anchors private request; confirmed result never grants writes',async()=>{
    const result=await attestStudyCue(runtime(),sender,{queryId:'q-1',cue});
    assert.equal(result.ok,true);assert.equal(result.writeAuthorized,false);
});
for(const [name,changed] of [['cross frame',{frameId:2}],['missing document',{documentId:undefined}],
    ['foreign extension',{id:'foreign'}],['popup sender',{url:'chrome-extension://self/popup.html'}],['missing tab',{tab:undefined}]]) {
    test(name+' denied before transport',async()=>{
        const r=await attestStudyCue({id:'self',sendMessage(){throw Error('must not send');}},{...sender,...changed},{queryId:'q-2',cue});
        assert.equal(r.ok,false);
    });
}
for(const [name,change] of [['wrong query',(r)=>{r.queryId='old-query';}],['expired',(r)=>{r.expires=0;}],
    ['write grant',(r,m)=>{if(m.phase==='consume')r.writeAuthorized=true;}],
    ['wrong source',(r,m)=>{if(m.phase==='consume')r.source={...r.source,documentId:'other-doc'};}],
    ['wrong cue',(r,m)=>{if(m.phase==='consume')r.cue={...r.cue,word:'fake'};}]]) {
    test(name+' rejected',async()=>assert.equal((await attestStudyCue(runtime(change),sender,{queryId:'q-3',cue})).ok,false));
}
