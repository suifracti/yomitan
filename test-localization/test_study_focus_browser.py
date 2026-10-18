"""Chromium component integration. Local fixture only; no AI or user data writes."""
import json, os, pathlib, tempfile
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUTPUT=pathlib.Path(os.environ.get('STUDY_UI_OUTPUT',tempfile.mkdtemp(prefix='study-focus-test-')))
(OUTPUT/'previews').mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    results=[]
    page=browser.new_page(viewport={'width':420,'height':600},device_scale_factor=1)
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    def load_fixture(term=None):
        raw=(ROOT/'test-localization/fixtures/study-focus.html').read_text()
        html, script=raw.split('<script type="module">',1)
        script=script.split('</script>',1)[0]
        script=script.replace("import {prepareStudyFocus} from '/source/ext/js/display/study-focus.js';",'')
        card_fixture = """
const studyContext=document.querySelector('#study-context');
const cardToggle=document.createElement('button');cardToggle.type='button';cardToggle.className='study-card-add-toggle';cardToggle.dataset.studyAddCard='';cardToggle.textContent='手动添加卡片';cardToggle.hidden=true;
const cardPanel=document.createElement('section');cardPanel.className='study-card-add';cardPanel.setAttribute('aria-label','手动添加复习卡');cardPanel.hidden=true;
cardPanel.innerHTML='<fieldset class=\"study-card-editor\"><label>学习点<select><option>词义</option></select></label><label>正面<textarea rows=\"2\" maxlength=\"1000\">A short prompt</textarea></label><label>背面<textarea rows=\"2\" maxlength=\"2400\">A short answer</textarea></label></fieldset><button type=\"button\">再加一张</button><button type=\"button\">添加已选卡片</button>';
cardToggle.onclick=()=>{cardPanel.hidden=!cardPanel.hidden;document.querySelector('.study-focus-shell')?.classList.toggle('sf-card-editor-open',!cardPanel.hidden);if(!cardPanel.hidden)requestAnimationFrame(()=>cardPanel.scrollIntoView({block:'nearest'}));};
const sourceMenu=document.createElement('button');sourceMenu.type='button';sourceMenu.className='study-audio-sources';sourceMenu.title='选择发音来源';sourceMenu.textContent='发音来源 ▾';document.querySelector('.study-entry .actions').append(sourceMenu);
studyContext.append(cardToggle,cardPanel);
document.querySelector('[data-study-save=note]').addEventListener('click',()=>{cardToggle.hidden=false;});
"""
        if term:
            example = {'improve': {'ipa':'/ɪmˈpruːv/', 'forms':'过去式 / 过去分词：improved · 现在分词：improving · 第三人称：improves', 'sentence':'I am trying to improve three major things in my life.', 'senses':[('vt. 及物动词','改善，提高，改进'),('vi. 不及物动词','变得更好，增加')]}, 'absolutely': {'ipa':'/ˈæbsəluːtli/', 'forms':'', 'sentence':'This is absolutely useful.', 'senses':[('adv. 副词','完全地，绝对地，确确实实地')]}}[term]
            case_script = """
const sample=CASE_DATA;
window.display.query=CASE_TERM;document.querySelector('.study-reading-phonetic').textContent=sample.ipa;
window.display.history.state.sentence={text:sample.sentence};
const sourceP=document.querySelector('.study-source p');sourceP.replaceChildren(sample.sentence.slice(0,sample.sentence.indexOf(CASE_TERM)));const mark=document.createElement('mark');mark.textContent=CASE_TERM;sourceP.append(mark,sample.sentence.slice(sample.sentence.indexOf(CASE_TERM)+CASE_TERM.length));
document.querySelector('.study-reading-meaning').innerHTML=sample.senses.map(([pos,meaning])=>'<div class="study-reading-sense"><span class="study-pos">'+pos+'</span><span class="study-meaning-text">'+meaning+'</span></div>').join('');
document.querySelector('[data-study-meta-role=forms]').textContent=sample.forms;
const grammar=[...document.querySelectorAll('[data-sc-content=summary-entry]')].find(e=>e.textContent==='词形与语法').parentElement;
grammar.querySelector('p').textContent=sample.forms||'absolutely (comparative more absolutely, superlative most absolutely)';
document.querySelectorAll('[data-sc-content=glosses] > li').forEach((li,i)=>{li.textContent=CASE_TERM==='improve'?['To make something better.','To become better.','To increase in quality.','To put to good use.'][i]:['In an absolute manner.','Completely, without qualification.','As an intensifier: extremely, very, indeed.','Yes; certainly.'][i];});
""".replace('CASE_DATA',json.dumps(example,ensure_ascii=False)).replace('CASE_TERM',json.dumps(term))
            script=script.replace("prepareStudyDictionary(document.querySelector('.study-entry'),'ability');",case_script+"\nprepareStudyDictionary(document.querySelector('.study-entry'),"+json.dumps(term)+");")
        script=script.replace("prepareStudyFocus(window.display,{call:window.mockCall});",card_fixture+"\nprepareStudyFocus(window.display,{call:window.mockCall});")
        script=script.replace("import {prepareStudyFocus} from '/source/ext/js/display/study-focus.js';",'')
        module=(ROOT/'ext/js/display/study-focus.js').read_text()
        # This suite checks the underlying source/dictionary controllers. The actual
        # two-card layout and host resizing are exercised by test_study_workspace_browser.py.
        module=module.replace("import {prepareStudyWorkspace} from './study-workspace.js';", "const prepareStudyWorkspace=()=>({dispose(){}});")
        module=module.replace("import {studyCall} from '../study/study-client.js';", "const studyCall=(a,d)=>globalThis.mockCall(a,d);")
        upstream=(ROOT/'ext/js/display/study-translation.js').read_text()
        begin=upstream.index('export function updateStudySourcePreview(')
        end=upstream.find('\n}\n',begin)+3
        helper='const sourceHighlightSelections=new WeakMap();\n'+upstream[begin:end].replace('export function','function',1)
        module=module.replace("import {updateStudySourcePreview} from './study-translation.js';",helper)
        module=module.replace('export function prepareStudyFocus','function prepareStudyFocus')
        module=module.replace("new URL('../../css/study-focus.css', import.meta.url).href", "'data:text/css,'")
        page.set_content(html+'</body></html>')
        for css in ['material.css', 'display.css', 'structured-content.css', 'study-card.css', 'study-focus.css']:
            page.add_style_tag(content=(ROOT/'ext/css'/css).read_text())
        dictionary=(ROOT/'ext/js/display/study-dictionary.js').read_text().replace("import {studyCall} from '../study/study-client.js';", "const dictionaryCall=(a,d)=>globalThis.dictionaryCall(a,d);").replace('export function ', 'function ').replace('await studyCall(', 'await dictionaryCall(').replace('void studyCall(', 'void dictionaryCall(')
        page.add_script_tag(content='(()=>{'+dictionary+'\n'+module+'\n'+script+'})();')
        page.wait_for_function('window.ready===true')
        page.wait_for_timeout(100)
    load_fixture()
    def check(name,code):
        result=page.evaluate(code)
        if not result:
            page.screenshot(path=str(OUTPUT/'failure.png'))
            print(page.evaluate('()=>Object.fromEntries([".sf-heading",".sf-tabs",".sf-body",".sf-dictionary",".sf-dictionary-scroll",".sf-save-bar","[data-study-dictionary-next]","[data-study-dictionary-translate]"].map(s=>{const e=document.querySelector(s),r=e?.getBoundingClientRect();return [s,r?{y:r.y,h:r.height,w:r.width,client:e.clientHeight}:null]}))'))
        assert result, (name, result)
        results.append({'test':name,'passed':True})
    page.set_viewport_size({'width':400,'height':650})
    page.evaluate("""()=>{window.fire('contentUpdateStart');
        document.querySelector('.study-source-translation-row')?.remove();document.querySelector('.study-translation-output').replaceChildren();window.mockOverride=async()=>({items:[],total:0,coverage:{status:'complete'},anki:{status:'complete',items:[],total:0}});
        window.display.query='diet';window.display.history.state.sentence={text:'Choose information diet.'};document.querySelector('.study-source p').innerHTML='Choose information <mark>diet</mark>.';document.querySelector('.study-reading-phonetic').textContent='/ˈdaɪət/';document.querySelector('.study-reading-meaning').innerHTML='<div class="study-reading-sense"><span class="study-pos">n. 名词</span><span class="study-meaning-text">日常饮食，议会</span></div><div class="study-reading-sense"><span class="study-pos">vt. 及物动词</span><span class="study-meaning-text">照规定饮食</span></div>';
        document.querySelector('[data-study-meta-role=forms]').innerHTML='<span class="study-form-item"><span class="study-form-label">pl. 复数 / 3sg. 三单：</span><strong>diets</strong></span><span class="study-form-item"><span class="study-form-label">V-ing 进行：</span><strong>dieting</strong></span><span class="study-form-item"><span class="study-form-label">p.p. 过去分词 / past. 过去式：</span><strong>dieted</strong></span>';
        window.fire('contentUpdateComplete');
    }""")
    for width in [320,400,420,720]:
        page.set_viewport_size({'width':width,'height':650});page.wait_for_timeout(30)
        check(f'long form labels keep composer/source inside {width}px card', '()=>{const selectors=[".sf-heading",".sf-source-pane",".sf-compose",".sf-compose .study-translation-actions",".sf-source-footer",".sf-save-bar"];const boxes=selectors.map(s=>document.querySelector(s).getBoundingClientRect());window.widthDiagnostics=boxes.map(r=>({left:r.left,right:r.right,width:r.width}));return boxes.every(r=>r.left>=-1&&r.right<=innerWidth+1)&&document.documentElement.scrollWidth<=innerWidth+1;}')
        if width==400: page.screenshot(path=str(OUTPUT/'previews'/'diet-long-forms-400.png'))
    page.evaluate('delete window.mockOverride')
    page.set_viewport_size({'width':420,'height':600})
    load_fixture()
    check('tags and frequency are in the shared word header, not the bottom reference section', '()=>document.querySelector(".sf-heading .sf-word-facts")?.textContent.includes("TOEFL") && document.querySelector(".sf-heading [data-study-meta-role=frequency]")?.textContent.includes("BNC") && !document.querySelector(".sf-dictionary-info [data-study-meta-role=frequency]")')
    page.get_by_role('tab', name='详细词典', exact=True).click()
    check('learning UI hides the legacy direct dictionary card controls', '()=>{const e=document.querySelector(".sf-dictionary-info .note-actions-container");return e&&e.getBoundingClientRect().height===0&&document.querySelector("[data-study-save=note]").getBoundingClientRect().height>0;}')
    page.get_by_role('tab', name='词义与原句', exact=True).click()
    check('first page puts Chinese meaning beside the authentic source',
        '()=>document.querySelector(".sf-tab[aria-selected=true]").textContent==="词义与原句" && document.querySelector(".sf-heading .sf-gloss-text")?.textContent==="能力，才干" && !document.querySelector(".sf-source-pane").hidden && document.querySelector(".sf-source-pane mark").textContent==="ability"')
    check('quick dictionary action keeps the separate view-card label', '()=>document.querySelector("[data-action=save-note] .study-action-label").textContent==="快速词典卡" && document.querySelector("[data-action=view-note] .study-action-label").textContent==="查看卡片"')
    check('one source and readable current answer','()=>document.querySelectorAll(".sf-source-pane .study-source").length===1 && document.querySelector(".sf-answer").textContent.includes("入睡的能力")')
    check('lookup does not generate or save new learning; existing records may reconcile','()=>window.models===0 && window.saveClicks===0 && window.calls.every(([x])=>["libraryMemory","libraryRead","libraryReconcile"].includes(x)) && window.dictionaryCalls.every(([x])=>x==="dictionaryPeek")')
    check('common forms are directly visible beside the fixed word header', '()=>document.querySelector(".sf-heading .sf-forms-preview")?.textContent.includes("abilities")')
    page.locator('.sf-forms-preview').click()
    check('word-header forms open their full dictionary reference without scrolling the frame', '()=>{const d=document.querySelector(".sf-dictionary-scroll").getBoundingClientRect(),r=document.querySelector(".sf-dictionary-forms").getBoundingClientRect();return document.querySelector(".sf-tab[aria-selected=true]").textContent==="详细词典"&&r.top>=d.top-1&&r.top<d.bottom&&document.querySelector(".sf-heading").getBoundingClientRect().top===36;}')
    page.get_by_role('tab',name='词义与原句',exact=True).click()
    check('previous history hidden for first turn','()=>document.querySelector(".study-conversation-history").hidden')
    check('Chinese meaning and tabs are outside the one learning scroller', '()=>document.querySelector(".sf-heading .sf-gloss-text") && document.querySelector(".sf-learning-scroll .sf-source-pane") && !document.querySelector(".sf-learning-scroll .sf-tabs") && !document.querySelector(".sf-learning-scroll .sf-compose")')
    pinned_before=page.locator('.sf-heading').bounding_box()
    page.locator('.sf-learning-scroll').evaluate('(e)=>e.scrollTop=e.scrollHeight')
    pinned_after=page.locator('.sf-heading').bounding_box()
    assert pinned_before and pinned_after and pinned_before['y']==pinned_after['y']
    check('source has no separate expand or inner scrolling', '()=>!document.querySelector(".sf-expand-source") && [".sf-source-pane",".sf-source-reading"].every(s=>!/(auto|scroll)/.test(getComputedStyle(document.querySelector(s)).overflowY))')
    page.locator('.sf-learning-scroll').evaluate('(e)=>e.scrollTop=0')
    page.screenshot(path=str(OUTPUT/'previews'/'learning-420.png'))
    page.locator('.sf-feedback button').first.click()
    check('feedback delegates to original journal control','()=>document.querySelector(".study-conversation-turn .study-feedback button").getAttribute("aria-pressed")==="true"')
    page.locator('.study-followup').fill('这里为什么用 to？')
    page.get_by_role('tab',name='详细词典',exact=True).click()
    check('dictionary keeps the same shared Chinese header while hiding the sentence','()=>document.querySelector(".sf-source-pane").hidden && !document.querySelector(".sf-dictionary").hidden && !document.querySelector(".sf-header-sense").hidden && document.querySelector(".sf-header-sense").textContent.includes("才干")')
    check('dictionary starts with English and no duplicate Chinese or preview block', '()=>!!document.querySelector(".sf-dictionary .study-original-dictionary[open]") && !document.querySelector(".sf-dictionary > .study-reading-meaning") && !document.querySelector(".sf-dictionary > .study-reading-english") && document.querySelector(".sf-dictionary-info").tagName==="SECTION"')
    check('grammar and etymology are directly open with no nested reference fold', '()=>[...document.querySelectorAll(".sf-dictionary-scroll [data-sc-content=summary-entry]")].every(n=>n.closest("details").open) && document.querySelectorAll(".sf-dictionary-scroll [data-sc-content=summary-entry]").length===2 && !document.querySelector(".study-original-dictionary [data-sc-content=summary-entry]")')
    check('live dictionary wrappers are never paginated as a parent of their own senses', '()=>{const row=document.querySelector("[data-sc-content=glosses]>li[data-study-sense-hidden=false]");return row && row.getBoundingClientRect().height>0 && !row.closest(".gloss-item[data-study-sense-hidden=true]");}')
    check('dictionary heading and page controls stay outside the only dictionary scroller', '()=>document.querySelector(".sf-dictionary-heading-dock .study-dictionary-heading") && document.querySelector(".sf-dictionary-pager .study-dictionary-pagination") && document.querySelector(".sf-dictionary-scroll .study-original-dictionary") && !/(auto|scroll)/.test(getComputedStyle(document.querySelector(".sf-dictionary")).overflowY)')
    page.locator('.sf-dictionary-scroll').evaluate('(e)=>{e.style.scrollBehavior="auto";e.scrollTop=e.scrollHeight}')
    check('next group stays reachable after long dictionary scrolling', '()=>{const b=document.querySelector("[data-study-dictionary-next]").getBoundingClientRect(),s=document.querySelector(".sf-save-bar").getBoundingClientRect();return b.top>0&&b.bottom<=s.top+1;}')
    page.locator('[data-study-dictionary-next]').click();page.wait_for_timeout(30)
    check('changing group resets only dictionary content scroll', '()=>document.querySelector(".sf-dictionary-scroll").scrollTop===0')
    check('dictionary pages keep original sense nodes and counts', '()=>document.querySelector(".study-sense-count").textContent.includes("2/2") && document.querySelector("[data-study-sense-hidden=false]").textContent.includes("special talent")')
    page.evaluate('window.dictionaryFail=true')
    page.locator('[data-study-dictionary-translate]').click();page.wait_for_timeout(30)
    check('dictionary failure preserves English and exposes original retry', '()=>document.querySelector(".study-dictionary-status").textContent.includes("测试连接失败") && document.querySelector("[data-study-dictionary-translate]").textContent.includes("重试") && document.querySelector("[data-study-sense-hidden=false]").textContent.includes("special talent")')
    page.evaluate('window.dictionaryFail=false')
    page.locator('[data-study-dictionary-translate]').click();page.wait_for_timeout(30)
    check('dictionary retry renders Chinese beside the original English', '()=>document.querySelector("[data-study-sense-hidden=false] .study-sense-translation").textContent.includes("测试释义译文")')
    page.locator('[data-study-dictionary-prev]').click();page.wait_for_timeout(30)
    page.evaluate('window.dictionaryHold=true')
    page.locator('[data-study-dictionary-translate]').click();page.wait_for_timeout(30)
    page.locator('.study-dictionary-heading button').filter(has_text='取消').click()
    page.evaluate('window.releaseDictionary();window.dictionaryHold=false');page.wait_for_timeout(30)
    check('dictionary cancellation keeps its control and ignores late generation', '()=>window.dictionaryCalls.some(([a])=>a==="dictionaryCancel") && document.querySelector(".study-dictionary-status").textContent.includes("已取消") && !document.querySelector("[data-study-sense-hidden=false] .study-sense-translation")')
    page.evaluate('window.dictionaryCached=true')
    page.locator('[data-study-dictionary-next]').click();page.wait_for_timeout(30)
    check('existing dictionary cache is rendered without a new generation', '()=>document.querySelector(".study-dictionary-status").textContent.includes("已缓存") && document.querySelector("[data-study-sense-hidden=false] .study-sense-translation").textContent.includes("缓存中文")')
    page.evaluate('window.dictionaryCached=false')

    page.get_by_role('tab',name='词义与原句',exact=True).click()
    check('neighbor action is visible without opening the source editor', '()=>{const b=document.querySelector(".sf-source-tools [data-study-use-context]");if(!b)return false;const r=b.getBoundingClientRect();return r.height>0 && r.top>=0 && r.bottom<innerHeight && !document.querySelector(".study-more-actions").open;}')
    page.locator('[data-study-use-context]').click()
    check('neighbor action opens the existing context editor', '()=>document.querySelector(".study-more-actions").open')
    check('source editing shares the learning scroller', '()=>!document.querySelector(".sf-source-editor-body") && document.querySelector(".sf-learning-scroll .study-more-actions") && !/(auto|scroll)/.test(getComputedStyle(document.querySelector(".study-more-actions")).overflowY)')
    page.screenshot(path=str(OUTPUT/'previews'/'neighbor-editor-420.png'))
    page.locator('.study-more-actions .study-source-editor').fill('Her ability to learn is remarkable.')
    page.locator('.study-more-actions .study-source-editor').dispatch_event('change')
    check('editing source updates visible context and keeps marked term', '()=>document.querySelector(".sf-source-pane .study-source p").textContent==="Her ability to learn is remarkable." && document.querySelector(".sf-source-pane mark").textContent==="ability"')
    page.get_by_role('tab',name='词义与原句',exact=True).click()
    check('draft survives tab switching','()=>document.querySelector(".study-followup").value==="这里为什么用 to？"')
    page.locator('[data-study-translate=explain]').click();page.wait_for_timeout(50)
    check('new answer is displayed next to unchanged source','()=>document.querySelector(".sf-meaning").textContent.includes("为什么用 to") && document.querySelector(".sf-source-pane").textContent.includes("ability")')
    check('older questions accessible but not repeated','()=>!document.querySelector(".study-conversation-history").hidden && document.querySelector(".study-conversation-history>summary").textContent.includes("1 轮")')
    page.locator('[data-study-save=note]').click();page.wait_for_timeout(50)
    check('save remains exactly one action','()=>window.saveClicks===1 && document.querySelector(".sf-saved-summary").textContent.includes("已关联")')
    page.get_by_role('tab',name='我的记录',exact=False).click()
    check('Obsidian AND Anki latest data visible','()=>document.querySelector(".sf-records").textContent.includes("Obsidian 修改的解释 v1") && document.querySelector(".sf-records").textContent.includes("入睡的能力。v1")')
    page.evaluate('window.memoryVersion=2');page.get_by_role('button',name='刷新笔记与卡片',exact=True).click();page.wait_for_timeout(50)
    check('explicit readback reflects edits without writes','()=>document.querySelector(".sf-records").textContent.includes("修改的解释 v2") && window.calls.every(([x])=>["libraryMemory","libraryRead","libraryReconcile"].includes(x))')
    page.screenshot(path=str(OUTPUT/'previews'/'records-420.png'))
    page.get_by_role('tab',name='词义与原句',exact=True).click()
    page.evaluate('window.addTurn("很长的解释。".repeat(120), 3)');page.wait_for_timeout(30)
    before=page.locator('.sf-compose').bounding_box()
    page.locator('.sf-learning-scroll').evaluate('(e)=>e.scrollTop=e.scrollHeight')
    after=page.locator('.sf-compose').bounding_box()
    assert before['y']==after['y'];results.append({'test':'composer stays fixed while source and long AI answer scroll together','passed':True})
    load_fixture()
    page.evaluate("""()=>{
        window.fire('contentUpdateStart');
        const original=[...document.querySelectorAll('[data-sc-content=summary-entry]')].find(n=>n.textContent==='词源').closest('details');
        original.parentElement.dataset.dictionary='Wiktionary';
        original.after(original.cloneNode(true));
        const other=document.createElement('section');other.dataset.dictionary='Other dictionary';other.append(original.cloneNode(true));
        document.querySelector('.study-dictionary-details').append(other);
        window.fire('contentUpdateComplete');
    }""")
    check('identical metadata deduplicates only within its known dictionary source', '()=>{const rows=[...document.querySelectorAll(".sf-dictionary-scroll [data-sc-content=summary-entry]")];return rows.length===4&&rows.filter(e=>!e.closest("details").hidden).length===3&&rows.some(e=>e.textContent.includes("Other dictionary"));}')
    for width,height in [(400,550),(400,250),(320,550),(420,600),(720,600)]:
        page.set_viewport_size({'width':width,'height':height});load_fixture()
        page.locator('.study-more-actions').evaluate('(e)=>e.open=true')
        page.evaluate('window.addTurn("很长的解释。".repeat(100), 4)')
        page.wait_for_timeout(30)
        check(f'one content scroll and fixed usable controls at {width}x{height}', """()=>{
            const visible=(e)=>{const r=e.getBoundingClientRect();return r.width>0 && r.height>0 && r.top>=0 && r.bottom<=innerHeight+1 && r.left>=0 && r.right<=innerWidth+1;};
            const targets=['.sf-heading .sf-gloss-text','.sf-tabs','.study-followup','[data-study-translate=explain]','[data-study-save=note]'];
            const all=targets.every(s=>visible(document.querySelector(s)));
            const nested=[...document.querySelectorAll('.sf-learn *')].filter(e=>e.tagName!=='TEXTAREA' && e.clientHeight>0 && e.scrollHeight>e.clientHeight+1 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
            return all && nested.length===1 && nested[0].classList.contains('sf-learning-scroll') && document.documentElement.scrollWidth<=innerWidth+1;
        }""")
        page.locator('.sf-learning-scroll').evaluate('(e)=>e.scrollTop=e.scrollHeight')
        check(f'buttons remain clickable after scrolling at {width}x{height}', """()=>['[data-study-translate=explain]','[data-study-save=note]'].every(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})""")
        page.screenshot(path=str(OUTPUT/'previews'/f'learning-{width}x{height}.png'))
    page.set_viewport_size({'width':400,'height':550});load_fixture()
    page.locator('.study-followup').fill('第一行\n第二行\n第三行\n第四行\n第五行')
    check('followup grows to at most three lines without hiding actions', """()=>{const e=document.querySelector('.study-followup'),s=getComputedStyle(e);return e.rows===1 && e.clientHeight<=3*parseFloat(s.lineHeight)+parseFloat(s.paddingTop)+parseFloat(s.paddingBottom)+1 && document.querySelector('[data-study-translate=explain]').getBoundingClientRect().bottom<=innerHeight && document.querySelector('[data-study-save=note]').getBoundingClientRect().bottom<=innerHeight;}""")
    page.set_viewport_size({'width':400,'height':250});load_fixture()
    page.locator('.study-followup').fill('第一行\n第二行\n第三行\n第四行')
    check('compact multiline input leaves both actions fully on screen', """()=>['.study-followup','[data-study-translate=explain]','[data-study-save=note]'].every(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();const clip=e.closest('.sf-body')?.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && (!clip || (r.top>=clip.top && r.bottom<=clip.bottom+1));})""")
    page.set_viewport_size({'width':720,'height':600});load_fixture()
    page.get_by_role('tab',name='详细词典',exact=True).click()
    check('wide detail page expands without an empty source column',
        '()=>document.querySelector(".sf-source-pane").hidden && document.querySelector(".sf-dictionary").getBoundingClientRect().width > 620')
    page.set_viewport_size({'width':420,'height':600});load_fixture()
    page.evaluate('window.fire("contentUpdateStart"); window.fire("contentUpdateComplete")');page.wait_for_timeout(50)
    check('lookup lifecycle does not duplicate controls or lose source', '()=>document.querySelectorAll(".study-focus-shell").length===1 && document.querySelectorAll(".sf-source-pane .study-source").length===1 && document.querySelectorAll("[data-study-save=note]").length===1')
    page.evaluate('document.querySelector(".study-translation-output").replaceChildren()');page.wait_for_timeout(40)
    check('shared hint keeps every Chinese POS row instead of just the first', '()=>!document.querySelector(".sf-short-gloss").hidden && document.querySelector(".sf-gloss-text").textContent==="能力，才干" && document.querySelector(".sf-gloss-pos").textContent.includes("名词") && document.querySelector(".sf-short-gloss").textContent.includes("使能够") && !document.querySelector(".sf-gloss-kicker")')
    page.get_by_role('tab',name='详细词典',exact=True).click()
    check('usage stays in the dictionary and sentence editing stays beside the sentence', '()=>document.querySelector(".sf-dictionary-info .study-token-summary") && document.querySelector(".sf-source-pane .study-more-actions") && document.querySelectorAll(".sf-audio-tools button:not(.study-audio-sources)").length===1 && document.querySelector(".sf-audio-primary-hidden")')
    page.evaluate('window.fire("contentUpdateStart"); window.chrome.permissions.contains=async()=>false;window.calls=[];window.fire("contentUpdateComplete")');page.wait_for_timeout(50)
    check('ungranted permission never starts a read or prompts on opening', '()=>window.calls.length===0 && document.querySelector(".sf-records").textContent.includes("点「刷新笔记与卡片」")')
    load_fixture()
    page.evaluate('window.fire("contentUpdateStart");window.display.history.state.sentence.text="ability";window.fire("contentUpdateComplete")');page.wait_for_timeout(40)
    check('standalone word opens Chinese first page, without inventing a source',
        '()=>document.querySelector(".sf-source-pane").hidden && document.querySelector(".sf-tab[aria-selected=true]").textContent==="词义与原句" && document.querySelector(".sf-gloss-text")?.textContent==="能力，才干" && !document.querySelector(".sf-no-source-note").hidden && !document.querySelector(".sf-save-bar [data-study-save=note]").closest("[hidden]")')
    page.evaluate('window.fire("contentUpdateStart");window.display.history.state.sentence={text:"The quality of being able.",offset:0,sourceKind:"dictionary"};window.display.history.state.url="https://example.org/dict";window.fire("contentUpdateComplete")');page.wait_for_timeout(40)
    check('dictionary text is not treated as the sentence being read', '()=>document.querySelector(".sf-source-pane").hidden && document.querySelector(".study-focus-shell").classList.contains("sf-no-source") && document.querySelector(".sf-tab[aria-selected=true]").textContent==="词义与原句"')
    load_fixture()
    page.evaluate("""() => {
        window.fire('contentUpdateStart');
        document.querySelector('.study-reading-meaning').replaceChildren();
        const raw=document.createElement('div');
        raw.className='study-primary-meaning';
        raw.innerHTML='<div><span class="study-pos">n. 名词</span><span class="study-meaning-text">备用中文释义</span></div>';
        document.querySelector('.study-entry .entry-header').append(raw);
        window.fire('contentUpdateComplete');
    }""")
    page.wait_for_timeout(40)
    check('standalone Chinese sense also reads original dictionary row when pinned preview is absent',
        '()=>document.querySelector(".sf-gloss-text")?.textContent==="备用中文释义" && document.querySelector(".sf-gloss-pos")?.textContent.includes("名词")')
    load_fixture()
    page.evaluate("""()=>{
        window.fire('contentUpdateStart');window.display.query='improve';
        document.querySelector('.study-reading-meaning').innerHTML='<div class="study-reading-sense"><span class="study-pos">vt. 及物动词</span><span class="study-meaning-text">改善，提高价值，改进，利用。改善，提高价值，改进，利用。</span></div><div class="study-reading-sense"><span class="study-pos">vi. 不及物动词</span><span class="study-meaning-text">变得更好，增加。</span></div>';
        window.fire('contentUpdateComplete');
    }""");page.wait_for_timeout(30)
    shared=page.locator('.sf-gloss-preview').text_content()
    page.get_by_role('tab',name='详细词典',exact=True).click()
    assert page.locator('.sf-gloss-preview').text_content()==shared and '变得更好' in shared
    check('improve shares all Chinese POS rows and offers full meanings explicitly', '()=>document.querySelector(".sf-gloss-toggle").textContent.includes("共 2 项") && !document.querySelector(".sf-gloss-toggle").hidden')
    page.locator('.sf-gloss-toggle').click()
    check('full Chinese opens in current main scroll without expanding fixed header', '()=>!document.querySelector(".sf-all-meanings").hidden && document.querySelector(".sf-dictionary-scroll > .sf-all-meanings .sf-gloss-text").textContent.includes("改善")')
    page.get_by_role('tab',name='词义与原句',exact=True).click()
    check('full Chinese stays open across the first two pages with one shared panel', '()=>document.querySelectorAll(".sf-all-meanings").length===1 && !document.querySelector(".sf-all-meanings").hidden && document.querySelector(".sf-learning-scroll > .sf-all-meanings").textContent.includes("变得更好")')
    page.screenshot(path=str(OUTPUT/'previews'/'shared-meanings-420.png'))
    page.evaluate("""()=>{window.fire('contentUpdateStart');document.querySelector('.study-reading-meaning').replaceChildren();window.fire('contentUpdateComplete');}""");page.wait_for_timeout(30)
    check('absent Chinese is explicit and never generated', '()=>document.querySelector(".sf-gloss-unavailable").textContent.includes("暂无中文释义") && window.models===0')
    load_fixture()
    check('a plain web address is labeled as opening the source', '()=>document.querySelector(".sf-source-footer > a").textContent==="打开来源"')
    page.evaluate('''() => { window.mockOverride = async (action) => { window.calls.push([action, null]); if (action==="libraryMemory") return {total:0, coverage:{status:"partial"}, items:[], anki:{status:"unavailable", items:[]}}; if (action==="libraryRead") return {items:[]}; throw new Error(action); }; }''')
    page.get_by_role('tab', name='我的记录', exact=False).click(); page.get_by_role('button', name='刷新笔记与卡片', exact=True).click(); page.wait_for_timeout(50)
    check('partial coverage is not shown as zero records', '()=>document.querySelector(".sf-tab[aria-selected=true]").textContent.includes("未核实") && !document.querySelector(".sf-tab[aria-selected=true]").textContent.includes("· 0")')
    # Real Yomitan search windows have their own legacy title/options/search box
    # above the card. A 400x250 full-word lookup must expose the first Chinese
    # sense immediately while keeping the original search controls reachable.
    page.set_viewport_size({'width':400,'height':250});load_fixture()
    page.evaluate("""() => {
        document.documentElement.dataset.pageType = 'search';
        const legacy = document.createElement('div');
        legacy.id = 'above-sticky-header';
        legacy.innerHTML = '<div class="search-header-wrapper"><div class="search-header"><div id="intro"><h1>Yomitan Search</h1></div><details class="study-search-options"><summary>搜索选项</summary></details></div></div>';
        const search = document.createElement('div');
        search.id = 'sticky-search-header';
        search.className = 'search-header-wrapper';
        search.innerHTML = '<div class="search-header"><textarea id="search-textbox" placeholder="输入单词或短语"></textarea></div>';
        document.querySelector('#content-scroll').prepend(legacy, search);
        window.fire('contentUpdateStart');
        window.display.history.state.sentence = {text:'ability',offset:0};
        search.querySelector('#search-textbox').focus();
        window.fire('contentUpdateComplete');
    }""")
    page.wait_for_timeout(60)
    check('legacy Search title and textbox hidden until requested',
        '()=>getComputedStyle(document.querySelector("#above-sticky-header")).display==="none" && getComputedStyle(document.querySelector("#sticky-search-header")).display==="none" && !document.querySelector(".sf-search-open")')
    check('400x250 standalone Chinese sense is in the fixed heading above the tabs',
        '()=>{const gloss=document.querySelector(".sf-heading .sf-standalone-sense .sf-gloss-text");const note=document.querySelector(".sf-heading .sf-no-source-note");const tabs=document.querySelector(".sf-tabs");if(!gloss||!note||!tabs)return false;const r=gloss.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && r.bottom<tabs.getBoundingClientRect().top && note.textContent.includes("暂无原句") && document.querySelector(".sf-tab[aria-selected=true]").textContent==="词义与原句";}')
    check('400x250 saved learning control remains reachable at viewport bottom',
        '()=>{const r=document.querySelector(".sf-save-bar [data-study-save=note]")?.getBoundingClientRect();return !!r && r.top<innerHeight && r.bottom<=innerHeight+1;}')
    check('standalone compact input and ask button are not clipped by the save bar', '()=>[".study-followup","[data-study-translate=explain]"].every(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),c=e.closest(".sf-body").getBoundingClientRect();return r.top>=c.top && r.bottom<=c.bottom+1 && r.bottom<=innerHeight;})')
    page.screenshot(path=str(OUTPUT/'previews'/'standalone-search-400x250.png'))
    page.locator('.sf-search-toggle').click()
    check('switch-word button exposes the original text input and options',
        '()=>document.querySelector(".sf-search-toggle").getAttribute("aria-expanded")==="true" && getComputedStyle(document.querySelector("#sticky-search-header")).display!=="none" && getComputedStyle(document.querySelector("#above-sticky-header")).display!=="none" && document.activeElement?.id==="search-textbox"')
    page.evaluate('window.fire("contentUpdateStart"); window.fire("contentClear"); window.fire("contentUpdateComplete")')
    page.wait_for_timeout(40)
    check('switch-word search remains open through multiple clear events',
        '()=>document.querySelector(".sf-search-toggle")?.getAttribute("aria-expanded")==="true" && getComputedStyle(document.querySelector("#sticky-search-header")).display!=="none"')
    page.locator('.sf-search-toggle').click()
    check('collapsed search keeps original card intact',
        '()=>document.querySelector(".sf-search-toggle").getAttribute("aria-expanded")==="false" && getComputedStyle(document.querySelector("#sticky-search-header")).display==="none" && document.querySelector(".sf-gloss-text")?.textContent==="能力，才干"')

    for width,height in [(400,550),(400,250),(320,550),(420,600),(720,600)]:
        page.set_viewport_size({'width':width,'height':height});load_fixture()
        page.get_by_role('tab',name='详细词典',exact=True).click()
        page.locator('[data-study-sense-hidden=false]').first.evaluate('(e)=>e.append(document.createTextNode(" Long dictionary definition.".repeat(90)))')
        page.locator('.sf-dictionary-scroll').evaluate('(e)=>e.scrollTop=e.scrollHeight')
        check(f'dictionary paging and translation remain visible at {width}x{height}', '''()=>{
            const p=document.querySelector('[data-study-dictionary-next]').getBoundingClientRect();
            const t=document.querySelector('[data-study-dictionary-translate]').getBoundingClientRect();
            const s=document.querySelector('.sf-save-bar').getBoundingClientRect();
            const scroll=document.querySelector('.sf-dictionary-scroll');
            return p.height>0&&p.top>=0&&p.bottom<=s.top+1&&s.bottom<=innerHeight+1&&t.top>=0&&t.bottom< p.top&&scroll.clientHeight>15&&document.documentElement.scrollWidth<=innerWidth+1;
        }''')
        page.locator('[data-study-dictionary-next]').click();page.wait_for_timeout(20)
        check(f'dictionary group starts at top and keeps forms at {width}x{height}', '()=>document.querySelector(".sf-dictionary-scroll").scrollTop===0 && document.querySelector(".sf-forms-preview").getBoundingClientRect().height>0')
        page.screenshot(path=str(OUTPUT/'previews'/f'dictionary-fixed-{width}x{height}.png'))
    for term in ['improve','absolutely']:
        page.set_viewport_size({'width':400,'height':550});load_fixture(term)
        page.get_by_role('tab',name='详细词典',exact=True).click()
        check(f'{term} directly exposes full forms and keeps dictionary controls fixed', '()=>{const info=document.querySelector(".sf-dictionary-info");return info.tagName==="SECTION" && [...info.querySelectorAll("details:not(.study-token-summary)")].every(e=>e.open) && document.querySelector(".sf-dictionary-pager [data-study-dictionary-next]").getBoundingClientRect().bottom<=document.querySelector(".sf-save-bar").getBoundingClientRect().top+1;}')
        if term=='improve':
            check('compact header does not repeat the exact same forms paragraph below', '()=>!document.querySelector(".sf-gloss-kicker") && getComputedStyle(document.querySelector(".sf-forms-original")).display==="none" && document.querySelector(".sf-dictionary-forms").hidden')
            check('improve retains both transitive and intransitive Chinese with the supplied form strings', '()=>document.querySelector(".sf-short-gloss").textContent.includes("改善") && document.querySelector(".sf-short-gloss").textContent.includes("变得更好") && document.querySelector(".sf-forms-preview").textContent.includes("improved")')
        else:
            check('absolutely keeps dictionary grammar without creating an empty headword forms row', '()=>!document.querySelector(".sf-forms-preview") && document.querySelector(".sf-dictionary-forms").textContent.includes("comparative more absolutely")')
        page.screenshot(path=str(OUTPUT/'previews'/f'{term}-dictionary-400.png'))
    # Restore normal component state for distributable screenshots.
    page.set_viewport_size({'width':420,'height':600});load_fixture()
    page.get_by_role('tab',name='详细词典',exact=True).click();page.screenshot(path=str(OUTPUT/'previews'/'dictionary-420.png'))
    page.get_by_role('tab',name='词义与原句',exact=True).click()
    page.evaluate('document.documentElement.setAttribute("data-theme","dark")')
    page.screenshot(path=str(OUTPUT/'previews'/'learning-dark-420.png'))
    assert not errors, errors
    results.append({'test':'no browser JS exceptions','passed':True})
    # Exercise the actual focus relocation with a real expanded manual-card panel.
    for height in (250,550):
        page.set_viewport_size({'width':400,'height':height});load_fixture()
        page.locator('[data-study-save=note]').click();page.locator('[data-study-add-card]').click();page.wait_for_timeout(60)
        check(f'manual card editor shares the content scroll and fixed bottom stays visible at 400x{height}', '''()=>{
            const panel=document.querySelector('.study-card-add'),scroller=document.querySelector('.sf-learning-scroll'),field=panel?.querySelector('textarea');
            const visible=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight+1;};
            const toggle=document.querySelector('[data-study-add-card]'),compose=document.querySelector('.sf-compose'),savebar=document.querySelector('.sf-save-bar');
            return !panel.hidden&&panel.parentElement===scroller&&!panel.closest('.sf-save-bar')&&visible(toggle)&&visible(compose)&&visible(savebar)&&visible(field)&&field.maxLength===1000&&field.getAttribute('maxlength')==='1000'&&getComputedStyle(field).resize==='none'&&getComputedStyle(field).overflowY==='hidden';
        }''')
        page.screenshot(path=str(OUTPUT/'previews'/f'card-editor-400x{height}.png'))
        page.locator('.study-card-add button').filter(has_text='添加已选卡片').evaluate('(e)=>e.scrollIntoView({block:"nearest"})');page.wait_for_timeout(20)
        check(f'manual-card controls remain reachable inside the one content scroll at 400x{height}', '''()=>{
            const panel=document.querySelector('.study-card-add'),scroller=document.querySelector('.sf-learning-scroll');
            const button=[...panel.querySelectorAll('button')].find(e=>e.textContent.includes('添加已选卡片'));
            const r=button.getBoundingClientRect(),sr=scroller.getBoundingClientRect(),save=document.querySelector('[data-study-save=note]').getBoundingClientRect();
            return panel.parentElement===scroller&&r.height>0&&r.top>=sr.top&&r.bottom<=sr.bottom+1&&save.top>=0&&save.bottom<=innerHeight+1&&document.querySelectorAll('.study-card-add').length===1;
        }''')
    # Restore normal component state for distributable screenshots.
    page.set_viewport_size({'width':420,'height':600});load_fixture()
    page.get_by_role('tab',name='详细词典',exact=True).click();page.screenshot(path=str(OUTPUT/'previews'/'dictionary-420.png'))
    page.get_by_role('tab',name='词义与原句',exact=True).click()
    page.evaluate('document.documentElement.setAttribute("data-theme","dark")')
    page.screenshot(path=str(OUTPUT/'previews'/'learning-dark-420.png'))
    # The visual fixture alone cannot catch a real controller hiding the wrong details node.
    def serve_interaction(route):
        path=route.request.url.split('https://study-interaction.test/',1)[-1].split('?',1)[0]
        file=ROOT/'ext'/path
        if file.is_file():
            route.fulfill(path=str(file))
        else:
            route.fulfill(content_type='text/html',body='<html><head><meta charset="UTF-8"></head><body><div class="content-body-inner"><div class="study-entry"><div class="entry-header"></div><div class="study-reading-anchor"><div class="study-source"><span class="study-source-label">当前原句</span><p>Her <mark>ability</mark> matters.</p></div><div class="study-reading-ai-context"><div class="study-reading-ai-text"></div><details class="study-reading-ai-more"><summary>更多</summary><div class="study-reading-ai-full"></div></details></div><div class="study-reading-meaning"><div class="study-reading-sense">n. 能力</div></div></div><section id="study-context"></section></div></div></body></html>')
    page.route('https://study-interaction.test/**',serve_interaction)
    page.goto('https://study-interaction.test/')
    page.set_viewport_size({'width':400,'height':550})
    page.evaluate("""async()=>{
        window.chrome={runtime:{sendMessage:async({studyAction})=>({ok:true,value:['journalConversation','conversationUsage','saved'].includes(studyAction)?[]:studyAction==='pendingPeek'?{count:0}:{result:null,busy:false}})}};
        const {prepareStudyTranslation}=await import('/js/display/study-translation.js');
        const {prepareStudyFocus}=await import('/js/display/study-focus.js');
        const callbacks={};
        const display={on:(event,fn)=>callbacks[event]=fn,query:'ability',history:{state:{sentence:{text:'Her ability matters.'},url:'https://example.test/article'}},getOptions:()=>({general:{language:'en'}})};
        prepareStudyTranslation().render(document.querySelector('#study-context'),'Her ability matters.','ability',{context:'She works hard. She keeps learning.'});
        prepareStudyFocus(display,{call:async()=>({items:[],total:0,anki:{status:'complete',items:[]}})});
        callbacks.contentUpdateComplete();
    }""")
    page.wait_for_timeout(100)
    check('real empty-answer controller leaves original sentence adjustment visible', '()=>!document.querySelector(".study-more-actions").hidden && document.querySelector("[data-study-translate-sentence]") && document.querySelector(".sf-short-gloss").textContent.includes("能力")')
    page.locator('[data-study-use-context]').click()
    page.get_by_label('原句',exact=True).fill('Her ability to learn matters.')
    page.get_by_label('补充语境',exact=True).click()
    check('real neighbor action fills context and original remains editable', '()=>document.querySelector(".study-more-actions").open && !document.querySelector(".study-more-actions").hidden && document.querySelector("[aria-label=补充语境]").value==="She works hard. She keeps learning." && document.querySelector(".study-source p").textContent==="Her ability to learn matters."')
    page.screenshot(path=str(OUTPUT/'previews'/'real-source-editor-400.png'))
    assert not errors, errors
    results.append({'test':'no browser JS exceptions','passed':True})
    (OUTPUT/'test-results.json').write_text(json.dumps({'checks':results,'count':len(results),'scope':'Chromium component integration with simulated storage/Native; no user Mac or real AI/Anki writes'},ensure_ascii=False,indent=2))
    print(json.dumps({'passed':len(results),'errors':errors},ensure_ascii=False), flush=True)
    page.unroute_all(behavior='ignoreErrors')
    page.close()
    browser.close()
