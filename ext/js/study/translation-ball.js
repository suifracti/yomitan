/*
 * Copyright (C) 2023-2026  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {menuSelect} from './study-ui.js';
import {studyCall} from './study-client.js';
import {translateText} from './page-translate.js';

/**
 * The page's small, draggable entry point; uses the same controller and preferences.
 * @param {import('./page-translate.js').PageTranslate} page
 * @param {typeof import('./page-translate.js').writePagePrefs} save
 */
export function mountTranslationBall(page, save) {
    if (window.top !== window || !/^https?:|^file:/.test(location.protocol)) { return; }
    const host = location.hostname;
    const root = document.createElement('aside');
    root.id = 'study-translation-ball';
    root.className = 'scan-disable';
    root.dataset.studyUi = '';
    const style = document.createElement('style');
    style.textContent = '#study-translation-ball{position:fixed;right:0;z-index:2147482999;font:13px/1.5 -apple-system,sans-serif;color:var(--st-ink,#263248)}#study-translation-ball[hidden]{display:none}#study-translation-ball>.ball-button{width:32px;height:32px;padding:0;border:0;border-radius:50%;background:var(--st-accent,#505ead);color:white;opacity:.55;transform:translateX(50%);touch-action:none;cursor:pointer}#study-translation-ball:hover>.ball-button,#study-translation-ball:focus-within>.ball-button{opacity:1;transform:none}#study-translation-ball>.ball-menu{display:none;position:absolute;right:32px;top:0;width:260px;max-height:75vh;overflow:auto;box-sizing:border-box;padding:6px;border:1px solid var(--st-line,#dce2eb);border-radius:10px;background:var(--st-paper,#fbfaf7);box-shadow:0 4px 20px #0003}#study-translation-ball:hover>.ball-menu,#study-translation-ball:focus-within>.ball-menu{display:block}#study-translation-ball .ball-row{display:block;width:100%;min-height:40px;padding:8px 12px;text-align:left;box-sizing:border-box;border:0;border-radius:6px;background:none;color:inherit;font:inherit;cursor:pointer}#study-translation-ball .ball-row:hover{background:var(--st-accent-soft,#e8eaff)}#study-translation-ball [hidden]{display:none!important}#study-translation-ball textarea{box-sizing:border-box;width:100%;min-height:70px;font:inherit}#study-translation-ball output{display:block;white-space:pre-wrap;padding:6px}#study-translation-ball [data-busy=true]{animation:study-ball-spin 1s linear infinite}@keyframes study-ball-spin{to{rotate:360deg}}';
    document.head.append(style);
    const ball = Object.assign(document.createElement('button'), {type: 'button', className: 'ball-button', title: '翻译本页'});
    const menu = Object.assign(document.createElement('div'), {className: 'ball-menu'});
    root.append(ball, menu);
    document.body.append(root);
    const mode = document.createElement('select');
    mode.dataset.label = '翻译形式';
    for (const [value, textContent] of [['bilingual', '双语对照'], ['translation', '只看译文']]) {
        mode.append(Object.assign(document.createElement('option'), {value, textContent}));
    }
    menu.append(mode);
    menuSelect(mode);
    mode.onchange = () => { void save({mode: /** @type {'bilingual'|'translation'} */ (mode.value)}); };
    const words = Object.assign(document.createElement('button'), {type: 'button', className: 'ball-row'});
    const count = (open = false) => {
        const detail = {count: 0, open};
        document.dispatchEvent(new CustomEvent('study-page-words', {detail}));
        words.textContent = `本页生词（${detail.count}）`;
    };
    words.onclick = () => count(true);
    menu.append(words);
    const textButton = Object.assign(document.createElement('button'), {type: 'button', className: 'ball-row', textContent: '文本翻译'});
    const form = document.createElement('form');
    form.hidden = true;
    const input = Object.assign(document.createElement('textarea'), {placeholder: '输入中文或英文', maxLength: 6000});
    const submit = Object.assign(document.createElement('button'), {type: 'submit', className: 'ball-row', textContent: '翻译'});
    const output = document.createElement('output');
    form.append(input, submit, output);
    form.onsubmit = (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) { return; }
        submit.disabled = true;
        output.textContent = '翻译中…';
        const chinese = (text.match(/\p{Script=Han}/gu)?.length || 0) > (text.match(/[A-Za-z]/g)?.length || 0);
        void translateText(text, {language: chinese ? 'zh' : 'en', target: chinese ? 'en' : 'zh'}).then((result) => {
            output.textContent = result;
        }, () => {
            output.textContent = '没翻译成功，请点「翻译」重试，或在设置里换个服务。';
        }).finally(() => {
            submit.disabled = false;
            paint();
        });
    };
    textButton.onclick = () => {
        form.hidden = !form.hidden;
        if (!form.hidden) { input.focus(); }
        paint();
    };
    menu.append(textButton, form);
    for (const label of ['在这个网站隐藏悬浮球', '设置']) {
        const button = Object.assign(document.createElement('button'), {type: 'button', className: 'ball-row', textContent: label});
        button.onclick = () => {
            if (label === '设置') {
                void studyCall('openStudySettings');
            } else {
                void save({ballSites: {...page.prefs.ballSites, [host]: {...page.prefs.ballSites[host], hidden: true}}});
            }
        };
        menu.append(button);
    }
    const paint = () => {
        root.hidden = !page.prefs.ball || Boolean(page.prefs.ballSites[host]?.hidden) || Boolean(document.fullscreenElement);
        root.style.top = `${Math.min(innerHeight - 40, Math.max(8, (page.prefs.ballSites[host]?.y ?? 0.6) * innerHeight))}px`;
        menu.style.top = `${Math.min(0, innerHeight - root.getBoundingClientRect().top - menu.scrollHeight - 8)}px`;
        const busy = page.active && page.busy > 0;
        ball.textContent = busy ? '◌' : (page.active ? '✓' : '译');
        ball.dataset.busy = String(busy);
        ball.title = page.active ? '显示原文' : '翻译本页';
        ball.setAttribute('aria-label', ball.title);
        mode.value = page.prefs.mode;
        mode.dispatchEvent(new Event('study-ui-sync'));
    };
    let start = 0;
    let moved = false;
    ball.onpointerdown = (event) => {
        start = event.clientY;
        moved = false;
        ball.setPointerCapture(event.pointerId);
    };
    ball.onpointermove = (event) => {
        if (!ball.hasPointerCapture(event.pointerId)) { return; }
        if (Math.abs(event.clientY - start) > 4) { moved = true; }
        if (moved) { root.style.top = `${Math.max(8, Math.min(innerHeight - 40, event.clientY - 16))}px`; }
    };
    ball.onpointerup = () => {
        if (moved) {
            void save({ballSites: {...page.prefs.ballSites, [host]: {...page.prefs.ballSites[host], y: Number.parseFloat(root.style.top) / innerHeight}}});
        }
    };
    ball.onclick = () => {
        if (!moved) { void page.toggle().finally(paint); }
    };
    root.onmouseenter = () => {
        count();
        paint();
    };
    document.addEventListener('fullscreenchange', paint);
    document.addEventListener('study-page-change', paint);
    window.addEventListener('resize', paint);
    chrome.storage.onChanged.addListener(paint);
    count();
    paint();
}
