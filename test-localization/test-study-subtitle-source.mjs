import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', {url:'https://example.test/video'});
for (const key of ['window','document','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLButtonElement','NodeFilter','CustomEvent']) globalThis[key] = dom.window[key];
const {readStudySubtitle, SubtitleTextScanner} = await import('../ext/js/app/frontend.js');
const {TextSourceRange} = await import('../ext/js/dom/text-source-range.js');
const {TextScanner} = await import('../ext/js/language/text-scanner.js');
const cue = {version:1,text:'Can you bank on him?',trackIndex:0,cueIndex:1,trackName:'synthetic',language:'en',originalStartMs:12000,originalEndMs:14500,subtitleOffsetMs:750,url:'https://example.test/video',adjacentCues:[{index:0,text:'Before.',originalStartMs:10000,originalEndMs:11000}]};
function source(start=8,end=8,rich=false) {
 const root = document.createElement('span');root.dataset.asbStudyCue=JSON.stringify(cue);
 root.innerHTML=rich?'Can you <span data-asb-token-start="8"><ruby>bank<rt>NOT ORIGINAL</rt></ruby></span> on him?':cue.text;
 document.body.replaceChildren(root);
 const node=rich?root.querySelector('ruby').firstChild:root.firstChild;
 const r=document.createRange();r.setStart(node,rich?0:start);r.setEnd(node,rich?4:end);
 return {root,src:TextSourceRange.createLazy(r)};
}
test('frozen original range maps phrase without player time and without reading annotations',()=>{
 const {src}=source(8,15);const snap=readStudySubtitle(src);
 assert.equal(snap.word,'bank on');assert.equal(snap.selectionStart,8);assert.equal(snap.selectionEnd,15);assert.equal(snap.playbackSeconds,12.75);
 assert.equal(snap.text,cue.text);assert.equal(readStudySubtitle(source(0,0,true).src).word,'bank');
});
test('unknown timing/language stays unknown; mismatched word and annotation fail safely',()=>{
 const {root,src}=source(8,12);root.dataset.asbStudyCue=JSON.stringify({...cue,language:null,originalStartMs:null});
 assert.equal(readStudySubtitle(src).playbackSeconds,null);assert.equal(readStudySubtitle(src).language,null);
 root.firstChild.textContent='Unrelated text';assert.equal(readStudySubtitle(src),null);
});
test('actual scanner adapter freezes before awaited dictionary lookup and discards switched source',async()=>{
 const {root,src}=source(8,12);let resolve;const old=TextScanner.prototype._findDictionaryEntries;
 TextScanner.prototype._findDictionaryEntries=async()=>await new Promise(r=>{resolve=r;});
 try {
  const scanner=Object.create(SubtitleTextScanner.prototype);scanner.studySources=new WeakMap();scanner.studyQuery=0;
  const p=scanner._findDictionaryEntries(src,true,false,{});assert.equal(scanner.studySources.get(src).text,cue.text);
  root.dataset.asbStudyCue=JSON.stringify({...cue,trackIndex:1,language:'ja'});resolve({type:'terms',dictionaryEntries:[],sentence:{text:'WRONG',offset:0}});
  assert.equal(await p,null);
 } finally {TextScanner.prototype._findDictionaryEntries=old;}
});
test('ordinary article lookup result is unchanged',async()=>{
 document.body.innerHTML='<p>Ordinary article.</p>';const r=document.createRange();r.selectNodeContents(document.querySelector('p'));const src=TextSourceRange.createLazy(r);
 const old=TextScanner.prototype._findDictionaryEntries;const result={type:'terms',dictionaryEntries:[],sentence:{text:'Ordinary article.',offset:0}};
 TextScanner.prototype._findDictionaryEntries=async()=>result;
 try {const scanner=Object.create(SubtitleTextScanner.prototype);scanner.studySources=new WeakMap();scanner.studyQuery=0;assert.equal(await scanner._findDictionaryEntries(src,true,false,{}),result);}finally{TextScanner.prototype._findDictionaryEntries=old;}
});
test('real dictionary pipeline receives clean original rich phrase, never annotations',async()=>{
 const {root,src}=source(0,0,true);const r=document.createRange();r.setStart(root.querySelector('ruby').firstChild,0);r.setEnd(root.lastChild,3);const phrase=TextSourceRange.createLazy(r);
 const scanner=Object.create(SubtitleTextScanner.prototype);Object.assign(scanner,{studySources:new WeakMap(),studyQuery:0,_scanLength:50,_layoutAwareScan:false,_includeSelector:null,_excludeSelector:null,_textSourceGenerator:{extractSentence:()=>({text:cue.text,offset:8})}});
 let input;scanner._api={termsFind:async(text)=>{input=text;return {dictionaryEntries:[{}],originalTextLength:7};}};
 const result=await scanner._findDictionaryEntries(phrase,true,false,{});assert.equal(input,'bank on');assert.equal(result.type,'terms');assert.equal(scanner.studySources.get(phrase).word,'bank on');
});
test('connected but inactive/hidden old cues fail safely after an awaited lookup',async()=>{
 const {root,src}=source(8,12);let resolve;const old=TextScanner.prototype._findDictionaryEntries;
 TextScanner.prototype._findDictionaryEntries=async()=>await new Promise(r=>{resolve=r;});
 try {const scanner=Object.create(SubtitleTextScanner.prototype);scanner.studySources=new WeakMap();scanner.studyQuery=0;const p=scanner._findDictionaryEntries(src,true,false,{});root.setAttribute('aria-hidden','true');resolve({type:'terms'});assert.equal(await p,null);}finally{TextScanner.prototype._findDictionaryEntries=old;}
});
test('subtitle phase denies actual generic Anki save and hotkey, not just hidden buttons',async()=>{
 const {DisplayAnki}=await import('../ext/js/display/display-anki.js');const a=Object.create(DisplayAnki.prototype);let touched=0;
 a._display={history:{state:{sentence:{studySubtitle:cue}}},selectedIndex:0,get dictionaryEntries(){++touched;return [];}};a._dictionaryEntryDetails=[];
 document.body.innerHTML='<div class="note-actions-container"><button class="action-button" data-action="save-note" data-card-format-index="0" hidden></button></div>';a._getEntry=()=>document.body;
 await a._saveAnkiNote(0,0);a._hotkeySaveAnkiNoteForSelectedEntry('0');await Promise.resolve();assert.equal(touched,0);
});
test('late generic Anki button refresh cannot undo subtitle gate',async()=>{
 const {DisplayAnki}=await import('../ext/js/display/display-anki.js');const a=Object.create(DisplayAnki.prototype);
 a._display={history:{state:{sentence:{studySubtitle:cue}}}};a._checkForDuplicates=false;a._displayTagsAndFlags=false;
 document.body.innerHTML='<button data-action="save-note" hidden></button>';const button=document.querySelector('button');a._createSaveButtons=()=>button;a._setupTagsIndicator=()=>{};a._setupFlagsIndicator=()=>{};
 a._updateSaveButtons([{noteMap:new Map([[0,{canAdd:true,noteIds:[],noteInfos:[],ankiError:null}]])}]);assert.equal(button.hidden,true);assert.equal(button.disabled,true);
});
test('source revision is frozen at search entry, before delayed search-context resolution',async()=>{
 const {root,src}=source(8,12);const scanner=Object.create(SubtitleTextScanner.prototype);scanner.studySources=new WeakMap();scanner.studyRequests=new WeakMap();scanner.studyQuery=0;
 const oldSearch=TextScanner.prototype._search,oldFind=TextScanner.prototype._findDictionaryEntries;let release,accepted;
 TextScanner.prototype._search=async function(s){await new Promise(r=>release=r);accepted=await this._findDictionaryEntries(s,true,false,{});};
 TextScanner.prototype._findDictionaryEntries=async()=>({type:'terms',dictionaryEntries:[],sentence:{text:cue.text,offset:8}});
 try{const p=scanner._search(src,true,false,{},false,false);root.dataset.asbStudyCue=JSON.stringify({...cue,trackIndex:1,language:'ja'});release();await p;assert.equal(accepted,null);}finally{TextScanner.prototype._search=oldSearch;TextScanner.prototype._findDictionaryEntries=oldFind;}
});
test('explicit close clears only native subtitle selection; incidental clear and article selection survive',async()=>{
 const {Frontend}=await import('../ext/js/app/frontend.js');const f=Object.create(Frontend.prototype);let canceled=0;
 f._stopClearSelectionDelayed=()=>{};f._popup=null;f._textScanner=Object.assign(Object.create(SubtitleTextScanner.prototype),{clearSelection(){},cancelStudySearch(){++canceled;}});
 const {src}=source(8,12);window.getSelection().removeAllRanges();window.getSelection().addRange(src.range);
 f._clearSelection(false,false);assert.equal(window.getSelection().toString(),'bank');assert.equal(canceled,0);
 f._clearSelection(false,true);assert.equal(window.getSelection().rangeCount,0);assert.equal(canceled,1);
 document.body.innerHTML='<p>Article selection</p>';const r=document.createRange();r.selectNodeContents(document.querySelector('p'));window.getSelection().addRange(r);
 f._clearSelection(false,true);assert.equal(window.getSelection().toString(),'Article selection');
});
test('explicit close invalidates subtitle dictionary IO so a late result cannot reopen the card',async()=>{
 const {src}=source(8,12);const scanner=Object.create(SubtitleTextScanner.prototype);Object.assign(scanner,{studySources:new WeakMap(),studyRequests:new WeakMap(),studyQuery:0});
 const oldSearch=TextScanner.prototype._search,oldFind=TextScanner.prototype._findDictionaryEntries;let release,accepted;
 TextScanner.prototype._search=async function(s){accepted=await this._findDictionaryEntries(s,true,false,{});};
 TextScanner.prototype._findDictionaryEntries=async()=>await new Promise(r=>release=r);
 try{const p=scanner._search(src,true,false,{});scanner.cancelStudySearch();release({type:'terms'});await p;assert.equal(accepted,null);}finally{TextScanner.prototype._search=oldSearch;TextScanner.prototype._findDictionaryEntries=oldFind;}
});
test('display history content cleanup is incidental, not an explicit dismissal of its host card',async()=>{
 const {Frontend}=await import('../ext/js/app/frontend.js');const f=Object.create(Frontend.prototype);const calls=[];
 f._clearSelection=(...args)=>calls.push(args);f._clearMousePosition=()=>{};f._onClosePopups();assert.deepEqual(calls,[[true]]);
});
test('recognized subtitle without snapshot never falls back to writable article identity',async()=>{
 const {Frontend}=await import('../ext/js/app/frontend.js');const {DisplayAnki}=await import('../ext/js/display/display-anki.js');const {StudyService}=await import('../ext/js/study/study-service.js');
 const f=Object.create(Frontend.prototype);let captured;Object.assign(f,{_pageType:'web',_application:{tabId:3,frameId:0},_textScanner:{studySources:new WeakMap()},_showPopupContent:(s,o,d)=>{captured=d;}});
 for(const metadata of [null,'{broken']){document.body.innerHTML='<div class="asbplayer-subtitles"><span>Can you bank on him?</span></div>';const n=document.querySelector('span');if(metadata)n.dataset.asbStudyCue=metadata;const r=document.createRange();r.setStart(n.firstChild,8);r.setEnd(n.firstChild,15);const src=TextSourceRange.createLazy(r);f._showContent(src,false,[],'terms',{text:'Can you bank on him?',offset:8},'Synthetic',{url:'https://example.test/video'},'light');assert.equal(captured.state.sentence.studySubtitle?.sourceState,'unknown');
 const a=Object.create(DisplayAnki.prototype);let touched=0;Object.assign(a,{_display:{history:{state:captured.state},selectedIndex:0,get dictionaryEntries(){touched++;return[];}},_dictionaryEntryDetails:[],_getEntry:()=>document.body});await a._saveAnkiNote(0,0);a._hotkeySaveAnkiNoteForSelectedEntry('0');assert.equal(touched,0);
 let native=0;const service=new StudyService({get:async()=>({}),set:async()=>{}},()=>{native++;throw Error('unexpected native');});for(const action of ['librarySave','rememberEntry','generate'])await assert.rejects(service.handle(action,{word:'bank on',sentence:'Can you bank on him?',studySubtitle:captured.state.sentence.studySubtitle}));assert.equal(native,0);
 }
 document.body.innerHTML='<p>Can you bank on him?</p>';const r=document.createRange();r.selectNodeContents(document.querySelector('p'));f._showContent(TextSourceRange.createLazy(r),false,[],'terms',{text:'Can you bank on him?',offset:8},'Article',{url:'https://example.test/article'},'light');assert.equal(captured.state.sentence.studySubtitle,undefined);
});
test('Anki preparation begun on R1 cannot submit or re-enable after unknown subtitle history replaces it',async()=>{
 const {DisplayAnki}=await import('../ext/js/display/display-anki.js');const a=Object.create(DisplayAnki.prototype);let release,added=0;const originalState={sentence:{text:'Article',offset:0}};
 document.body.innerHTML='<button data-action="save-note"></button>';const button=document.querySelector('button');
 a._display={history:{state:originalState},dictionaryEntries:[{}],progressIndicatorVisible:{setOverride:()=>0,clearOverride(){}},application:{api:{addAnkiNote:async()=>{added++;return null;}}}};
 Object.assign(a,{_dictionaryEntryDetails:[{noteMap:new Map([[0,{requirements:[]}]])}],_saveButtonFind:()=>button,_duplicateBehavior:'allow',_hideErrorNotification(){},_showErrorNotification(){},_getAddNoteRequirementsError:()=>null,_createNote:async()=>await new Promise(r=>{release=r;})});
 const pending=a._saveAnkiNote(0,0);a._display.history.state={sentence:{studySubtitle:{sourceState:'unknown'}}};release({note:{},errors:[],requirements:[]});await pending;assert.equal(added,0);await new Promise(r=>setTimeout(r,2600));assert.equal(button.disabled,true);
});
test('subtitle Element itself as Range start remains unknown even with null sentence',async()=>{const {Frontend}=await import('../ext/js/app/frontend.js');const f=Object.create(Frontend.prototype);let d;Object.assign(f,{_pageType:'web',_application:{tabId:3,frameId:0},_textScanner:{studySources:new WeakMap()},_showPopupContent:(s,o,details)=>d=details});document.body.innerHTML='<span class="ytp-caption-window-container">bank</span>';const r=document.createRange();r.selectNodeContents(document.querySelector('span'));f._showContent(TextSourceRange.createLazy(r),false,[],'terms',null,'Caption',{url:'https://example.test/video'},'light');assert.equal(d.state.sentence?.studySubtitle?.sourceState,'unknown');});

test('ASB actual containers and site player captions deny-only while comments remain R1',async()=>{const {Frontend}=await import('../ext/js/app/frontend.js');const f=Object.create(Frontend.prototype);let d;Object.assign(f,{_pageType:'web',_application:{tabId:3,frameId:0},_textScanner:{studySources:new WeakMap()},_showPopupContent:(s,o,x)=>d=x});for(const markup of ['<div class="asbplayer-subtitles-container-bottom"><span>bank</span></div>','<div class="asbplayer-subtitles-container-top"><span>bank</span></div>','<div id="movie_player"><div class="other-overlay"><span>bank</span></div></div>','<div class="bpx-player-container"><span>bank</span></div>','<div class="bilibili-player-video-wrap"><span>bank</span></div>']){document.body.innerHTML=markup+'<section id="comments"><p>bank</p></section>';for(const [selector,deny] of [['span',true],['#comments p',false]]){const r=document.createRange();r.selectNodeContents(document.querySelector(selector));f._showContent(TextSourceRange.createLazy(r),false,[],'terms',{text:'bank',offset:0},'Video',{url:'https://example.test/video'},'light');assert.equal(d.state.sentence?.studySubtitle?.sourceState,deny?'unknown':undefined);}}});
test('site caption portal over video is deny-only even outside player DOM; distant comment remains R1',async()=>{const {Frontend}=await import('../ext/js/app/frontend.js');const f=Object.create(Frontend.prototype);let d;Object.assign(f,{_pageType:'web',_application:{tabId:3,frameId:0},_textScanner:{studySources:new WeakMap()},_showPopupContent:(s,o,x)=>d=x});document.body.innerHTML='<video></video><div id="portal">bank</div><p id="comment">bank</p>';document.querySelector('video').getBoundingClientRect=()=>({left:0,right:800,top:0,bottom:400,width:800,height:400});for(const [selector,y,deny] of [['#portal',200,true],['#comment',600,false]]){const r=document.createRange();r.selectNodeContents(document.querySelector(selector));const src=TextSourceRange.createLazy(r);src.getRects=()=>[{left:100,right:150,top:y,bottom:y+20,width:50,height:20}];f._showContent(src,false,[],'terms',{text:'bank',offset:0},'Video',{url:'https://www.youtube.com/watch?v=abcdefghijk'},'light');assert.equal(d.state.sentence?.studySubtitle?.sourceState,deny?'unknown':undefined);}});


test('automatic cue lookup reads the pointed word through its end, explicit phrase stays exact', async () => {
 const {root}=source(0,0);
 const range=document.createRange();range.setStart(root.firstChild,8);range.setEnd(root.firstChild,10);
 const pointer=TextSourceRange.create(range);
 let lookedUp='';
 const scanner=Object.create(SubtitleTextScanner.prototype);
 Object.assign(scanner,{_language:'en',_scanLength:64,_api:{termsFind:async text=>{lookedUp=text;return {dictionaryEntries:[{type:'term',headwords:[{term:text}]}],originalTextLength:text.length};}},_textSourceGenerator:{extractSentence:()=>({text:cue.text,offset:8})}});
 await scanner._findTermDictionaryEntries(pointer,{});
 assert.equal(lookedUp,'bank','does not stop at caret prefix ba or expand to bank on');
 assert.equal(readStudySubtitle(pointer).word,'bank');
 const phrase=document.createRange();phrase.setStart(root.firstChild,8);phrase.setEnd(root.firstChild,15);
 await scanner._findTermDictionaryEntries(TextSourceRange.createLazy(phrase),{});
 assert.equal(lookedUp,'bank on');
});
