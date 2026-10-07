import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const root=new URL('../',import.meta.url);
test('lookup actions use visible labels while preserving upstream selectors',()=>{
 const html=readFileSync(new URL('ext/templates-display.html',root),'utf8');
 const d=new JSDOM(html).window.document;
 const save=d.querySelector('#action-button-container-template').content.querySelector('[data-action="save-note"]');
 assert.match(save.textContent,/添加到 Anki/);
 const audio=d.querySelector('#audio-button-popup-menu-template').content;
 assert.match(audio.textContent,/选择发音来源/);
 assert.match(audio.textContent,/卡片音频/);
});
test('source context is safe text, highlighted and omitted when absent',async()=>{
 const {appendStudyContext}=await import('../ext/js/display/study-card.js');
 const d=new JSDOM('<div id="entry"></div>').window.document;
 const entry=d.getElementById('entry');
 appendStudyContext(entry,{text:'We help <img onerror=evil()> ourselves.',offset:29},'ourselves');
 assert.equal(entry.querySelector('img'),null);
 assert.match(entry.textContent,/来自当前页面/);
 assert.equal(entry.querySelector('mark').textContent,'ourselves');
 const empty=d.createElement('div');appendStudyContext(empty,null,'word');assert.equal(empty.children.length,0);
});
test('auto-size constraints preserve above anchor and fit tiny viewports',async()=>{
 const {fitStudyPopup}=await import('../ext/js/app/study-popup-size.js');
 assert.deepEqual(fitStudyPopup({left:500,top:600,width:400,height:250},450,330,{left:0,top:0,right:800,bottom:900},true),{left:350,top:570,width:450,height:330});
 assert.deepEqual(fitStudyPopup({left:100,top:350,width:400,height:250},400,180,{left:0,top:0,right:800,bottom:900},false),{left:100,top:420,width:400,height:180});
 assert.deepEqual(fitStudyPopup({left:0,top:0,width:400,height:250},450,330,{left:0,top:0,right:240,bottom:160},true),{left:0,top:0,width:240,height:160});
});
test('upgrade disables only identified bundled predecessor and preserves user choices',async()=>{
 const {planStudyDictionary}=await import('../ext/js/pages/common/bundled-dictionary-core.js');
 const old={name:'ECDICT 英汉词典',enabled:true,custom:'keep'};
 const custom={name:'My dictionary',enabled:false};
 const previous=[old,custom];
 const summaries=[{title:old.name,revision:'ECDICT-2026-10-07',importSuccess:true}];
 const planned=planStudyDictionary(previous,{title:'ECDICT 英语学习词典'},summaries);
 assert.equal(old.enabled,true);assert.equal(planned[0].enabled,false);assert.equal(planned[0].custom,'keep');assert.deepEqual(planned[1],custom);
 assert.equal(planned.at(-1).enabled,true);
 const disabled=planStudyDictionary([{...old,enabled:false}],{title:'ECDICT 英语学习词典'},summaries);
 assert.equal(disabled.at(-1).enabled,false);
 const unknown=planStudyDictionary(previous,{title:'ECDICT 英语学习词典'},[{title:old.name,revision:'custom'}]);
 assert.equal(unknown[0].enabled,true);
});
