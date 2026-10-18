import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';

const templates = readFileSync(new URL('../ext/templates-display.html', import.meta.url), 'utf8');

function createHarness({getAudioInfoList = async () => [], audioSourceType = 'custom'} = {}) {
    const dom = new JSDOM(`<!doctype html><html><head></head><body>
        <div id="popup-menus"></div>
        <div class="entry" data-index="2">
            <div class="headword-list">
                <div class="headword" data-index="0"><button class="action-button" data-action="play-audio"></button></div>
                <div class="headword" data-index="1">
                    <button class="action-button" data-action="play-audio"></button>
                    <button class="study-audio-sources" type="button">发音来源 ▾</button>
                </div>
            </div>
        </div>
        ${templates}
    </body></html>`, {pretendToBeVisual: true});
    const {window} = dom;
    for (const key of ['document', 'window', 'CustomEvent', 'Element', 'HTMLElement', 'MouseEvent', 'Node']) {
        globalThis[key] = window[key];
    }

    const entry = document.querySelector('.entry');
    const sourceButton = document.querySelector('.study-audio-sources');
    const callbacks = new Map();
    const options = {
        general: {language: 'en'},
        audio: {
            enabled: false,
            autoPlay: false,
            fallbackSoundType: 'none',
            volume: 100,
            sources: [{type: audioSourceType, url: 'https://audio.example.test/{term}', voice: ''}],
            enableDefaultAudioSources: false,
        },
    };
    const display = {
        application: {api: {getTermAudioInfoList: getAudioInfoList}},
        hotkeyHandler: {registerActions() {}},
        registerDirectMessageHandlers() {},
        on(name, callback) { callbacks.set(name, callback); },
        getOptions() { return options; },
        getLanguageSummary() { return 'English'; },
        getElementDictionaryEntryIndex(element) { return Number(element.closest('.entry')?.dataset.index ?? -1); },
        displayGenerator: {
            instantiateTemplate(name) {
                const template = document.querySelector(`#${name}-template`);
                return template.content.firstElementChild.cloneNode(true);
            },
        },
        dictionaryEntries: [null, null, {type: 'term', headwords: [{term: 'zero'}, {term: 'target', reading: 'target'}]}],
        dictionaryEntryNodes: [null, null, entry],
        progressIndicatorVisible: {setOverride() { return {}; }, clearOverride() {}},
    };
    return {dom, display, callbacks, entry, sourceButton};
}

async function createAudio({getAudioInfoList, audioSourceType} = {}) {
    const {DisplayAudio} = await import('../ext/js/display/display-audio.js');
    const {PopupMenu} = await import('../ext/js/dom/popup-menu.js');
    for (const menu of PopupMenu.openMenus) { menu.close(); }
    const harness = createHarness({getAudioInfoList, audioSourceType});
    const audio = new DisplayAudio(harness.display);
    audio._audioSystem = {prepare() {}, getFallbackAudio: () => makePlayableAudio(), createAudio: async () => makePlayableAudio()};
    audio.prepare();
    harness.callbacks.get('contentUpdateEntry')({element: harness.entry});
    return {...harness, audio};
}

function makePlayableAudio() {
    return {currentTime: 0, volume: 1, play: async () => {}, pause() {}};
}

test('visible source button keeps its original headword when moved into a separate header', async () => {
    const {audio, entry, sourceButton} = await createAudio();
    const header = document.createElement('div');
    header.className = 'study-card-header';
    entry.prepend(header);
    header.appendChild(sourceButton);
    sourceButton.click();
    const menu = [...audio._openMenus][0];
    assert.ok(menu, 'clicking the visible control opens the menu');
    assert.equal(menu.sourceElement, sourceButton, 'the visible control is the PopupMenu anchor');
    assert.equal(menu.containerNode.dataset.term, 'target', 'headword index comes from the control before it was moved');
    assert.equal(menu.containerNode.dataset.reading, 'target');
    assert.equal(document.querySelectorAll('.audio-button-popup-menu').length, 1);

    const playCalls = [];
    audio._playAudio = async (...args) => {
        playCalls.push(args);
        return {valid: true};
    };
    menu.bodyNode.querySelector('.popup-menu-item-audio-button').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(playCalls[0].slice(0, 2), [2, 1], 'preview also uses the captured dictionary/headword indexes');
});

test('clicking the same source control toggles the menu without closing its parent card', async () => {
    const {audio, entry, sourceButton} = await createAudio();
    sourceButton.click();
    const menu = [...audio._openMenus][0];
    sourceButton.click();
    assert.equal(menu.isClosed, true);
    assert.equal(document.querySelectorAll('.audio-button-popup-menu').length, 0);
    assert.equal(entry.hidden, false);
});

test('menu position stays within a small card viewport and long content scrolls inside the menu', async () => {
    const {audio, sourceButton} = await createAudio();
    const rect = (left, top, width, height) => ({left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() { return this; }});
    window.HTMLElement.prototype.getBoundingClientRect = function() {
        if (this.classList?.contains('popup-menu-container')) { return rect(0, 0, 400, 250); }
        if (this.classList?.contains('popup-menu')) { return rect(0, 0, 360, 420); }
        if (this.classList?.contains('popup-menu-body')) { return rect(0, 0, 360, 420); }
        if (this === sourceButton) { return rect(370, 230, 24, 20); }
        return rect(0, 0, 0, 0);
    };
    sourceButton.click();
    const menu = [...audio._openMenus][0];
    assert.equal(menu.node.style.left, '40px');
    assert.equal(menu.node.style.top, '0px');
    const css = readFileSync(new URL('../ext/css/study-audio-menu.css', import.meta.url), 'utf8');
    assert.match(css, /max-height:\s*calc\(100vh\s*-\s*16px\)/);
    assert.match(css, /overflow-y:\s*auto/);
    assert.match(css, /overflow-wrap:\s*anywhere/);
});

test('preview remains open and does not select card audio; explicit card action toggles it', async () => {
    let resolveInfo;
    let resolveAudio;
    const {audio, sourceButton} = await createAudio({getAudioInfoList: () => new Promise(resolve => { resolveInfo = resolve; })});
    audio._audioSystem.createAudio = () => new Promise(resolve => { resolveAudio = resolve; });
    sourceButton.click();
    const menu = [...audio._openMenus][0];
    const group = menu.bodyNode.querySelector('.popup-menu-item-group');
    const preview = group.querySelector('.popup-menu-item-audio-button');
    const card = group.querySelector('.popup-menu-item-set-primary-audio-button');
    assert.match(preview.textContent, /试听/);
    assert.match(card.textContent, /用于卡片/);
    preview.click();
    assert.equal(menu.isClosed, false, 'previewing a source keeps the menu open');
    assert.equal(group.dataset.status, 'loading');
    resolveInfo([{type: 'url', url: 'https://audio.example.test/target.mp3'}]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(group.dataset.status, 'loading', 'in-flight media remains marked loading');
    resolveAudio(makePlayableAudio());
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    const updatedGroup = menu.bodyNode.querySelector('.popup-menu-item-group');
    const updatedCard = updatedGroup.querySelector('.popup-menu-item-set-primary-audio-button');
    assert.equal(updatedGroup.dataset.status, 'available');
    assert.equal(updatedCard.getAttribute('aria-pressed'), 'false');
    assert.match(updatedCard.textContent, /用于卡片/);
    updatedCard.click();
    assert.equal(updatedCard.getAttribute('aria-pressed'), 'true');
    assert.match(updatedCard.textContent, /已用于卡片/);
    assert.equal(menu.isClosed, false);
});

test('missing audio stays visible as failed and cannot be selected for card audio', async () => {
    const {audio, sourceButton} = await createAudio({getAudioInfoList: async () => []});
    sourceButton.click();
    const menu = [...audio._openMenus][0];
    const group = menu.bodyNode.querySelector('.popup-menu-item-group');
    group.querySelector('.popup-menu-item-audio-button').click();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    const failedGroup = menu.bodyNode.querySelector('.popup-menu-item-group');
    assert.equal(failedGroup.dataset.status, 'failed');
    assert.equal(failedGroup.querySelector('.study-audio-item-status').textContent, '不可用');
    const card = failedGroup.querySelector('.popup-menu-item-set-primary-audio-button');
    assert.equal(card.disabled, true, 'known failed media cannot be selected as card audio');
    card.click();
    assert.equal(card.getAttribute('aria-pressed'), 'false');
    assert.equal(audio._getCacheItem('target', 'target', false).primaryCardAudio, null);
});

test('a preview finishing after menu close does not select card audio', async () => {
    const {audio, sourceButton} = await createAudio({getAudioInfoList: async () => [{type: 'url', url: 'https://audio.example.test/target.mp3'}]});
    sourceButton.click();
    const menu = [...audio._openMenus][0];
    menu.bodyNode.querySelector('.popup-menu-item-audio-button').click();
    menu.close();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(audio._getCacheItem('target', 'target', false).primaryCardAudio, null);
});

test('non-downloadable sources cannot be selected for card audio', async () => {
    const {audio, sourceButton} = await createAudio({audioSourceType: 'text-to-speech'});
    sourceButton.click();
    const menu = [...audio._openMenus][0];
    const card = menu.bodyNode.querySelector('.popup-menu-item-set-primary-audio-button');
    assert.equal(card.hidden, true);
    assert.equal(card.disabled, true);
    card.click();
    assert.equal(audio._getCacheItem('target', 'target', false)?.primaryCardAudio ?? null, null);
});

test('Escape and outside clicks close only the audio menu', async () => {
    const {audio, entry, sourceButton} = await createAudio();
    sourceButton.click();
    const menu = [...audio._openMenus][0];
    const {Display} = await import('../ext/js/display/display.js');
    let parentClosed = 0;
    const displayContext = {
        _closeSinglePopupMenu: Display.prototype._closeSinglePopupMenu,
        close() { parentClosed++; },
    };
    Display.prototype._onHotkeyClose.call(displayContext);
    assert.equal(menu.isClosed, true, 'Escape closes the open menu');
    assert.equal(parentClosed, 0, 'Escape does not close the parent card');
    assert.equal(entry.hidden, false);

    sourceButton.click();
    const secondMenu = [...audio._openMenus][0];
    secondMenu.containerNode.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    assert.equal(secondMenu.isClosed, true, 'outside click closes the menu');
    assert.equal(parentClosed, 0, 'outside click does not close the parent card');
});

test('menu stylesheet is loaded by DisplayAudio and template exposes two named actions', async () => {
    const {audio, sourceButton} = await createAudio();
    sourceButton.click();
    assert.ok(document.head.querySelector('link[href*="study-audio-menu.css"]'));
    const menu = [...audio._openMenus][0];
    const group = menu.bodyNode.querySelector('.popup-menu-item-group');
    assert.ok(group.querySelector('.study-audio-item-status[aria-live="polite"]'));
    assert.ok(group.querySelector('.popup-menu-item-audio-button .study-audio-preview-label'));
    assert.ok(group.querySelector('.popup-menu-item-set-primary-audio-button .study-card-audio-label'));
});
