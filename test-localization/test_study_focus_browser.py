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
        '()=>document.querySelector(".sf-tab[aria-selected=true]").textContent==="词义与原句" && document.querySelector(".sf-source-pane .sf-gloss-text")?.textContent==="能力，才干" && !document.querySelector(".sf-source-pane").hidden && document.querySelector(".sf-source-pane mark").textContent==="ability"')
    check('one source and readable current answer','()=>document.querySelectorAll(".sf-source-pane .study-source").length===1 && document.querySelector(".sf-answer").textContent.includes("入睡的能力")')
    check('no model/write on lookup','()=>window.models===0 && window.saveClicks===0 && window.calls.every(([x])=>["libraryMemory","libraryRead"].includes(x))')
    check('previous history hidden for first turn','()=>document.querySelector(".study-conversation-history").hidden')
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
    page.locator('.study-more-actions').evaluate('(e)=>e.open=true')
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
    before=page.locator('.sf-source-pane').bounding_box()
    page.locator('#study-context').evaluate('(e)=>e.scrollTop=e.scrollHeight')
    after=page.locator('.sf-source-pane').bounding_box()
    assert before['y']==after['y'];results.append({'test':'original sentence stays put while long AI answer scrolls','passed':True})
    for width in [320,420,720]:
        page.set_viewport_size({'width':width,'height':600});load_fixture()
        check(f'no horizontal overflow at {width}px', '()=>document.documentElement.scrollWidth<=innerWidth+1')
        page.screenshot(path=str(OUTPUT/'previews'/f'learning-{width}.png'))
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
