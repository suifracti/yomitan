import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {prepareBundledDictionary} from '../ext/js/pages/common/bundled-dictionary.js';
test('renamed profiles get a visible upgrade entry instead of silent skip, without automatic mutation',async()=>{
 const dom=new JSDOM('<body></body>');globalThis.document=dom.window.document;
 let writes=0;
 globalThis.chrome={storage:{local:{get:async()=>({}),set:async()=>{writes++;}}}};
 const controller={getOptionsFull:async()=>({profileCurrent:0,profiles:[{name:'My English',options:{dictionaries:[]}}]}),application:{api:{getDictionaryInfo:async()=>[]}}};
 await prepareBundledDictionary(controller);
 const panel=document.querySelector('.study-dictionary-status');assert.ok(panel,'upgrade status is not silently skipped');
 assert.match(panel.textContent,/未安装/);assert.match(panel.textContent,/升级/);assert.equal(writes,0);
});
test('success marker does not conceal a disabled or deleted dictionary, preserves choices',async()=>{
 const dom=new JSDOM('<body></body>');globalThis.document=dom.window.document;
 let writes=0;
 globalThis.chrome={storage:{local:{get:async()=>({personalStudyDictionaryRichReadyV1:true}),set:async()=>{writes++;}}}};
 const controller={getOptionsFull:async()=>({profileCurrent:0,profiles:[{name:'英语学习',options:{dictionaries:[{name:'ECDICT 英语学习词典',enabled:false}]}}]}),application:{api:{getDictionaryInfo:async()=>[{title:'ECDICT 英语学习词典',importSuccess:true}]}}};
 await prepareBundledDictionary(controller);
 assert.match(document.body.textContent,/已安装.*未启用/);assert.equal(writes,0);
});
