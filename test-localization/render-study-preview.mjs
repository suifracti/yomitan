// Offline, isolated preview of the real display generator; not Chrome extension acceptance.
import {JSDOM} from 'jsdom';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
const detail=process.argv.includes('--detail');
const dom=new JSDOM(readFileSync(new URL(detail?'ext/search.html':'ext/popup.html',root),'utf8'));
for(const key of ['window','document','Node','NodeFilter','HTMLElement','HTMLDetailsElement','HTMLTextAreaElement','HTMLTemplateElement','DOMParser'])globalThis[key]=key==='window'?dom.window:dom.window[key];
globalThis.location=dom.window.location;
globalThis.chrome={runtime:{getURL:p=>p,sendMessage:async()=>({ok:true,value:{result:null,busy:false}})}};
globalThis.fetch=async url=>new Response(readFileSync(new URL('ext'+url,root)));
const {DisplayGenerator}=await import('../ext/js/display/display-generator.js');
const {renderStudyResult}=await import('../ext/js/display/study-translation.js');
const {prepareStudyCard}=await import('../ext/js/display/study-card.js');
const {DisplayContentManager}=await import('../ext/js/display/display-content-manager.js');
const generator=new DisplayGenerator(new DisplayContentManager(null),null);await generator.prepare();generator.updateLanguage('en');
const word=process.argv[2]||'ourselves';
const data=JSON.parse(execFileSync('python3',['-c',`import zipfile,json\nwith zipfile.ZipFile(${JSON.stringify(new URL('ext/data/study/ecdict.zip',root).pathname)}) as z:\n for n in z.namelist():\n  if n.startswith('term_bank_'):\n   for t in json.loads(z.read(n)):\n    if t[0]==${JSON.stringify(word)}:print(json.dumps(t));raise SystemExit`],{encoding:'utf8'}));
const entryData={type:'term',headwords:[{index:0,headwordIndex:0,term:word,reading:word,tags:[],wordClasses:[],sources:[]}],definitions:[{headwordIndices:[0],dictionary:'ECDICT 英语学习词典',dictionaryAlias:'ECDICT 英语学习词典',tags:[],entries:data[5],sequences:[data[6]],isPrimary:true}],inflectionRuleChainCandidates:[],frequencies:[],pronunciations:[]};
const wty=JSON.parse(execFileSync('python3',['-c',`import zipfile,io,json,pathlib
p=pathlib.Path(${JSON.stringify(new URL('ext/data/study/',root).pathname)});b=(p/'wty-en-en.part1').read_bytes()+(p/'wty-en-en.part2').read_bytes();terms=[]
with zipfile.ZipFile(io.BytesIO(b)) as z:
 for n in z.namelist():
  if n.startswith('term_bank'):
   for t in json.loads(z.read(n)):
    if t[0]==${JSON.stringify(word)}:terms.append(t)
print(json.dumps(terms))`],{encoding:'utf8',maxBuffer:3000000}));
for(const t of wty)entryData.definitions.push({headwordIndices:[0],dictionary:'wty-en-en',dictionaryAlias:'Wiktionary 英英详解',tags:[],entries:t[5],sequences:[t[6]],isPrimary:false});
const entry=generator.createTermEntry(entryData,[]);entry.classList.add('study-entry');
const save=generator.instantiateTemplate('action-button-container');save.querySelector('button').dataset.cardFormatIndex='0';entry.querySelector('.note-actions-container').append(save);
const sentence=word==='just'?'But for some reason, you just can.':word.startsWith('tired')?'I am tired of doing the same thing every day.':word==='ourselves'?'Change can help us understand ourselves better.':'She opened a new bank account.';
globalThis.ResizeObserver=class{observe(){}};
globalThis.MutationObserver=dom.window.MutationObserver;
globalThis.requestAnimationFrame=()=>{};
const callbacks=new Map();
prepareStudyCard({on:(name,callback)=>callbacks.set(name,callback),history:{state:{sentence:{text:sentence,offset:sentence.indexOf(word)}}},query:word},detail);
callbacks.get('contentUpdateStart')();
callbacks.get('contentUpdateEntry')({element:entry,dictionaryEntry:entryData,index:0});
document.querySelector('#dictionary-entries').append(entry);
const second=generator.createTermEntry(entryData,[]);
callbacks.get('contentUpdateEntry')({element:second,dictionaryEntry:entryData,index:1});
document.querySelector('#dictionary-entries').append(second);
callbacks.get('contentUpdateComplete')();
await new Promise(resolve=>setImmediate(resolve));
renderStudyResult(document.querySelector('.study-translation-output'), {translation:word==='just'?'但不知为什么，你就是能做到。':'我厌倦了每天做同样的事。',meaning:word==='just'?'这里的 just 加强语气：就是能做到。':'这里指厌倦，而不是身体疲劳。',notes:'这是离线布局数据，不是实际模型调用。'},true);
if(detail){document.body.hidden=false;document.querySelector('#study-detail-heading').hidden=false;document.querySelector('#search-textbox').value=word;}
for(const script of document.querySelectorAll('script'))script.remove();
for(const link of document.querySelectorAll('link'))if(link.getAttribute('href').startsWith('/'))link.href='/ext'+link.getAttribute('href');
const style=document.createElement('style');style.textContent='.icon{background-image:none}.content-scroll{overflow-y:auto}.entry-current-indicator{display:none}';document.head.append(style);
document.documentElement.dataset.theme=process.argv.includes('dark')?'dark':'light';
document.documentElement.dataset.resultOutputMode='group';
writeFileSync(`/tmp/study-preview-${word}${detail?'-detail':''}.html`,dom.serialize());
console.log(`generated /tmp/study-preview-${word}${detail?'-detail':''}.html`);
