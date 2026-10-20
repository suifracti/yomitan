// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {test, expect, vi} from 'vitest';
vi.mock('../ext/js/display/study-workspace.js', () => ({prepareStudyWorkspace: () => ({dispose() {}})}));
import {prepareStudyFocus} from '../ext/js/display/study-focus.js';

test('all meanings and forms are visible without a meaning toggle; sentence and video stay intact', async () => {
    document.documentElement.removeAttribute('data-study-focus-ready');
    document.body.innerHTML = readFileSync(`${import.meta.dirname}/fixtures/study-focus.html`, 'utf8').split('<script type="module">')[0];
    globalThis.ResizeObserver = class {observe() {} disconnect() {}};
    const handlers = new Map();
    const source = document.querySelector('.study-source');
    const original = source.querySelector('p').textContent;
    source.insertAdjacentHTML('beforeend', '<div class="study-source-translation-row"><span class="study-source-translation">很长的译文</span></div>');
    const translation = source.querySelector('.study-source-translation');
    Object.defineProperties(translation, {scrollHeight: {value: 100}, clientHeight: {value: 60}});
    document.querySelector('[data-study-meta-role=forms]').textContent = '过去式：improved · 进行时：improving · 三单：improves';
    const meanings = document.querySelector('.study-reading-meaning');
    meanings.innerHTML = '<div class="study-reading-sense"><span class="study-pos">n.</span><span class="study-meaning-text">能力，才干</span></div><div class="study-reading-sense"><span class="study-pos">v.</span><span class="study-meaning-text">能够</span></div>';
    const display = {query: 'ability', history: {state: {sentence: {text: original}, url: 'https://www.youtube.com/watch?v=fixture', videoTime: 5}}, on: (name, fn) => handlers.set(name, fn)};
    prepareStudyFocus(display, {call: async () => ({items: [], anki: {items: []}})});
    handlers.get('contentUpdateComplete')();
    const header = document.querySelector('.sf-header-sense');
    expect(header.querySelector('.sf-gloss-toggle')).toBeNull();
    expect(document.querySelectorAll('.sf-form-piece')).toHaveLength(3);
    expect(header.querySelectorAll('.sf-gloss-row')).toHaveLength(2);
    expect(document.querySelector('.sf-all-meanings')).toBeNull();
    expect(source.querySelector('p').textContent).toBe(original);
    expect(document.querySelector('.sf-source-reading').nextElementSibling.classList.contains('sf-video-strip')).toBe(true);
    const expand = document.querySelector('.sf-translation-expand');
    expect(expand.hidden).toBe(false);
    expand.click();
    expect(translation.classList.contains('sf-translation-expanded')).toBe(true);
    handlers.get('contentClear')();
});
