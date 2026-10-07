import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
test('settings labels have Chinese translations',()=>{
 const map=JSON.parse(readFileSync(new URL('ext/data/zh-cn-ui.json',root),'utf8'));
 for(const key of ['Yomitan Settings','Dictionaries','Enable Anki integration','Import Settings']) assert.match(map[key],/[\u4e00-\u9fff]/);
});
test('fresh-install preset matches local Anki fields',async()=>{
 const {applyStudyPreset}=await import('../ext/js/pages/common/study-preset.js');
 const o={profiles:[{name:'Default',options:{general:{},scanning:{inputs:[]},translation:{},anki:{}}}]};
 applyStudyPreset(o);const p=o.profiles[0].options;
 assert.equal(p.general.language,'en');assert.equal(p.anki.server,'http://127.0.0.1:8766');
 assert.equal(p.anki.cardFormats[0].fields.Word.value,'{expression}');
});

test('only exact UI labels are translated', async()=>{
 const {translateLabel}=await import('../ext/js/pages/common/zh-cn-ui.js');
 assert.equal(translateLabel('  Dictionaries  ',{Dictionaries:'词典'}),'  词典  ');
 assert.equal(translateLabel('My Dictionaries sentence',{Dictionaries:'词典'}),'My Dictionaries sentence');
 assert.equal(translateLabel('{expression}',{}),'{expression}');
});
test('bundled dictionary initializes once and never deletes existing data', async()=>{
 const {initializeBundledDictionary}=await import('../ext/js/pages/common/bundled-dictionary-core.js');
 let imports=0;let enabled=0;
 const services={getInfo:async()=>[],importArchive:async()=>{imports++;return {result:{title:'ECDICT 英语学习词典',importSuccess:true},errors:[]};},enable:async()=>{enabled++;}};
 assert.equal(await initializeBundledDictionary(services),'imported');
 assert.equal(imports,1);assert.equal(enabled,1);
 services.getInfo=async()=>[{title:'ECDICT 英语学习词典',importSuccess:true}];
 assert.equal(await initializeBundledDictionary(services),'exists');assert.equal(imports,1);
 services.getInfo=async()=>[{title:'ECDICT 英语学习词典',importSuccess:false}];
 await assert.rejects(()=>initializeBundledDictionary(services),/未完成/);
});
test('lookup action titles are Chinese without rewriting dictionary contents',()=>{
 const html=readFileSync(new URL('ext/templates-display.html',root),'utf8');
 assert.ok(html.includes('title="播放发音"'));
 assert.ok(!html.includes('title="View added note"'));
});
