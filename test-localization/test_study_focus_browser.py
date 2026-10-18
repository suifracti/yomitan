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
    def load_fixture():
        raw=(ROOT/'test-localization/fixtures/study-focus.html').read_text()
        html, script=raw.split('<script type="module">',1)
        script=script.split('</script>',1)[0]
        script=script.replace("import {prepareStudyFocus} from '/source/ext/js/display/study-focus.js';",'')
        module=(ROOT/'ext/js/display/study-focus.js').read_text()
        module=module.replace("import {studyCall} from '../study/study-client.js';", "const studyCall=(a,d)=>globalThis.mockCall(a,d);")
        upstream=(ROOT/'ext/js/display/study-translation.js').read_text()
        begin=upstream.index('export function updateStudySourcePreview(')
        end=upstream.find('\n}\n',begin)+3
        helper='const sourceHighlightSelections=new WeakMap();\n'+upstream[begin:end].replace('export function','function',1)
        module=module.replace("import {updateStudySourcePreview} from './study-translation.js';",helper)
        module=module.replace('export function prepareStudyFocus','function prepareStudyFocus')
        module=module.replace("new URL('../../css/study-focus.css', import.meta.url).href", "'data:text/css,'")
        page.set_content(html+'</body></html>')
        page.add_style_tag(content=(ROOT/'ext/css/study-focus.css').read_text())
        page.add_script_tag(content='(()=>{'+module+'\n'+script+'})();')
        page.wait_for_function('window.ready===true')
        page.wait_for_timeout(100)
    load_fixture()
    def check(name,code):
        result=page.evaluate(code)
        assert result, (name, result)
        results.append({'test':name,'passed':True})
    check('first page puts Chinese meaning beside the authentic source',
        '()=>document.querySelector(".sf-tab[aria-selected=true]").textContent==="词义与原句" && document.querySelector(".sf-heading .sf-gloss-text")?.textContent==="能力，才干" && !document.querySelector(".sf-source-pane").hidden && document.querySelector(".sf-source-pane mark").textContent==="ability"')
    check('one source and readable current answer','()=>document.querySelectorAll(".sf-source-pane .study-source").length===1 && document.querySelector(".sf-answer").textContent.includes("入睡的能力")')
    check('no model/write on lookup','()=>window.models===0 && window.saveClicks===0 && window.calls.every(([x])=>["libraryMemory","libraryRead"].includes(x))')
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
    check('dictionary is separate and hides the first-page source while keeping all meanings','()=>document.querySelector(".sf-source-pane").hidden && !document.querySelector(".sf-dictionary").hidden && document.querySelector(".sf-dictionary").textContent.includes("才干")')
    page.locator('.study-reading-english').evaluate('(e)=>e.open=true')
    page.locator('.preview-retry').click()
    check('dictionary preview retry still reaches original handler','()=>window.dictionaryRetries===1')
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
    check('explicit readback reflects edits without writes','()=>document.querySelector(".sf-records").textContent.includes("修改的解释 v2") && window.calls.every(([x])=>["libraryMemory","libraryRead"].includes(x))')
    page.screenshot(path=str(OUTPUT/'previews'/'records-420.png'))
    page.get_by_role('tab',name='词义与原句',exact=True).click()
    page.evaluate('window.addTurn("很长的解释。".repeat(120), 3)');page.wait_for_timeout(30)
    before=page.locator('.sf-compose').bounding_box()
    page.locator('.sf-learning-scroll').evaluate('(e)=>e.scrollTop=e.scrollHeight')
    after=page.locator('.sf-compose').bounding_box()
    assert before['y']==after['y'];results.append({'test':'composer stays fixed while source and long AI answer scroll together','passed':True})
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
    check('dictionary hint keeps part of speech separate from the first gloss only', '()=>!document.querySelector(".sf-short-gloss").hidden && document.querySelector(".sf-gloss-text").textContent==="能力，才干" && document.querySelector(".sf-gloss-pos").textContent.includes("名词") && !document.querySelector(".sf-short-gloss").textContent.includes("使能够") && document.querySelector(".sf-gloss-kicker").textContent.includes("未按本句判断")')
    page.get_by_role('tab',name='详细词典',exact=True).click()
    check('usage stays in the dictionary and sentence editing stays beside the sentence', '()=>document.querySelector(".sf-dictionary .study-token-summary") && document.querySelector(".sf-source-pane .study-more-actions") && document.querySelectorAll(".sf-heading button").length===1 && document.querySelector(".sf-audio-primary-hidden")')
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
    check('a plain web address is labeled as opening the source', '()=>document.querySelector(".sf-source-footer a").textContent==="打开来源"')
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

    # Restore normal component state for distributable screenshots.
    load_fixture()
    page.get_by_role('tab',name='详细词典',exact=True).click();page.screenshot(path=str(OUTPUT/'previews'/'dictionary-420.png'))
    page.get_by_role('tab',name='词义与原句',exact=True).click()
    page.evaluate('document.documentElement.setAttribute("data-theme","dark")')
    page.screenshot(path=str(OUTPUT/'previews'/'learning-dark-420.png'))
    assert not errors, errors
    results.append({'test':'no browser JS exceptions','passed':True})
    (OUTPUT/'test-results.json').write_text(json.dumps({'checks':results,'count':len(results),'scope':'Chromium component integration with simulated storage/Native; no user Mac or real AI/Anki writes'},ensure_ascii=False,indent=2))
    print(json.dumps({'passed':len(results),'errors':errors},ensure_ascii=False))
    browser.close()
