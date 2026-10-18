"""Small headless render check of the real settings HTML with local-only service stubs."""
import functools
import http.server
import os
import pathlib
import tempfile
import threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXT = ROOT / 'ext'
OUTPUT = pathlib.Path(os.environ.get('SETTINGS_UI_OUTPUT', '/tmp/yomitan-unified-settings-preview'))
OUTPUT.mkdir(parents=True, exist_ok=True)

MAIN_MODULE = r"""
import {prepareSettingsNavigation} from '/js/pages/settings/settings-navigation.js';
import {prepareStudySettings} from '/js/pages/study-settings-main.js';
const root = document.querySelector('.content-center');
prepareSettingsNavigation(root);
await prepareStudySettings(root);
document.body.hidden = false;
document.documentElement.dataset.loaded = 'true';
window.unifiedSettingsReady = true;
"""
STUDY_CLIENT = r"""
export async function studyCall(action) {
    window.unifiedSettingsCalls.push(action);
    if (action === 'settings') {
        return {model: 'gpt-local-preview', effort: 'low', autoDictionaryTranslate: false, cacheEnabled: true};
    }
    throw new Error(`Unexpected preview action: ${action}`);
}
"""

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass

with http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(EXT))) as server:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with sync_playwright() as playwright:
        launch = {'headless': True, 'args': ['--no-sandbox']}
        executable = os.environ.get('CHROMIUM_EXECUTABLE', '/usr/bin/chromium')
        if pathlib.Path(executable).exists():
            launch['executable_path'] = executable
        browser = playwright.chromium.launch(**launch)
        page = browser.new_page(viewport={'width': 1280, 'height': 900}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script("""
            window.unifiedSettingsCalls = [];
            window.chrome = {
                permissions: {contains: async () => false, request: async () => false},
                storage: {onChanged: {addListener() {}}},
                runtime: {getURL: (path) => new URL(path, location.origin).href},
            };
        """)
        page.route('**/js/pages/settings/settings-main.js', lambda route: route.fulfill(status=200, content_type='text/javascript', body=MAIN_MODULE))
        page.route('**/js/pages/common/zh-cn-ui.js', lambda route: route.fulfill(status=200, content_type='text/javascript', body=''))
        page.route('**/js/study/study-client.js', lambda route: route.fulfill(status=200, content_type='text/javascript', body=STUDY_CLIENT))

        page.goto(f'http://127.0.0.1:{server.server_port}/settings.html#save', wait_until='networkidle')
        page.wait_for_function('window.unifiedSettingsReady === true')

        def assert_category(expected):
            actual = page.locator('[data-settings-category-panel]:not([hidden])').evaluate_all(
                '(panels) => panels.map((panel) => panel.dataset.settingsCategoryPanel)')
            assert actual == [expected], (expected, actual)

        assert_category('save')
        assert page.locator('[data-settings-category-panel="save"] #library-settings-form').count() == 1
        assert page.locator('[data-settings-category-panel="save"] #anki').count() == 1
        assert page.locator('[data-settings-category-link="save"]').get_attribute('aria-current') == 'page'
        assert page.locator('[data-settings-category-link="save"]').evaluate('(e) => getComputedStyle(e).backgroundColor') != 'rgba(0, 0, 0, 0)'
        assert page.locator('#library-status').inner_text().startswith('点击「只读检查」')
        assert page.locator('#library-save-state').inner_text() == '尚未读取'
        assert not page.locator('#status').is_visible()
        assert page.locator('.deck-routing-details').evaluate('(e) => !e.open')
        assert page.evaluate('window.unifiedSettingsCalls') == ['settings']
        assert page.locator('[data-settings-category-link="save"]').evaluate('(e) => getComputedStyle(e).backgroundColor') != 'rgba(0, 0, 0, 0)'
        page.screenshot(path=str(OUTPUT / 'save.png'))

        page.locator('[data-settings-category-link="ai"]').click()
        assert_category('ai')
        assert page.locator('[data-settings-category-panel="ai"] #settings-form').count() == 1
        assert page.locator('[data-settings-category-panel="ai"] #status').count() == 1
        assert page.evaluate('window.unifiedSettingsCalls') == ['settings']
        page.screenshot(path=str(OUTPUT / 'ai.png'))

        page.evaluate("location.hash = '#anki'")
        page.wait_for_function("document.querySelector('[data-settings-category-panel=save]:not([hidden])') !== null")
        assert_category('save')
        page.wait_for_function("document.querySelector('#legacy-anki-settings').open === true")
        page.wait_for_timeout(50)
        page.mouse.move(1100, 20)
        assert page.locator('[data-settings-category-link="save"]').get_attribute('aria-current') == 'page'
        page.screenshot(path=str(OUTPUT / 'anki-section.png'))

        page.locator('.content').evaluate('(element) => { element.scrollTop = 300; }')
        page.evaluate("location.hash = '#advanced'")
        page.wait_for_function("document.querySelector('[data-settings-category-panel=advanced]:not([hidden])') !== null")
        assert_category('advanced')
        assert page.locator('.content').evaluate('(element) => element.scrollTop') == 0
        assert page.locator('[data-settings-category-panel="advanced"] .advanced-toggle').is_visible()
        assert page.locator('[data-settings-category-panel="advanced"] a[href="/info.html"]').count() == 1
        page.screenshot(path=str(OUTPUT / 'advanced.png'))
        for width in [320, 420, 720]:
            page.set_viewport_size({'width': width, 'height': 700})
            for category in ['lookup', 'ai', 'save', 'audio', 'interface', 'advanced']:
                page.evaluate('(category) => { location.hash = category; }', category)
                page.wait_for_function('(category) => document.querySelector(`[data-settings-category-panel="${category}"]`).hidden === false', arg=category)
                assert_category(category)
                overflow = page.locator('.content').evaluate('(e) => ({width: e.clientWidth, content: e.scrollWidth})')
                assert overflow['content'] <= overflow['width'] + 1, (width, category, overflow)
            page.screenshot(path=str(OUTPUT / f'width-{width}.png'))
        page.set_viewport_size({'width': 1280, 'height': 900})
        page.evaluate("location.hash = '#save'; document.documentElement.dataset.theme = 'dark'")
        page.wait_for_function("document.querySelector('[data-settings-category-panel=save]').hidden === false")
        page.screenshot(path=str(OUTPUT / 'save-dark.png'))
        page.unroute('**/js/study/study-client.js')
        routed_client = STUDY_CLIENT.replace('throw new Error(`Unexpected preview action: ${action}`);', "if(action==='librarySettingsGet')return {vault:'/tmp/preview-vault',directory:'Study',ankiEnabled:true,deck:'外语::英语语境',model:'外语语境卡',deckByKind:{}}; if(action==='saved')return []; throw new Error(action);")
        page.route('**/js/study/study-client.js', lambda route: route.fulfill(status=200,content_type='text/javascript',body=routed_client))
        page.add_init_script('window.chrome.permissions.contains=async()=>true')
        page.reload(wait_until='networkidle')
        page.wait_for_function('window.unifiedSettingsReady === true')
        page.locator('#library-use-subdecks').click()
        assert page.locator('#library-deck-meaning').input_value() == '外语::单词意思'
        assert page.locator('#library-deck-context').input_value() == '外语::原句中的意思'
        assert page.locator('#library-deck-listening').input_value() == '外语::视频声音字幕'
        assert page.evaluate('window.unifiedSettingsCalls') == ['settings','librarySettingsGet']
        page.locator('#library-parent-deck').scroll_into_view_if_needed()
        page.screenshot(path=str(OUTPUT / 'three-child-decks.png'))
        assert not errors, errors
        browser.close()

server.shutdown()
print(f'Headless settings screenshots: {OUTPUT}')
