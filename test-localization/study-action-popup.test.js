// @vitest-environment jsdom
import {test, expect, vi} from 'vitest';
import {readFileSync} from 'node:fs';
vi.mock('../ext/js/application.js', () => ({Application: {main() {}}}));
import {DisplayController} from '../ext/js/pages/action-popup-main.js';
test('popup shows the actual scan keys, enabled state and today count with the library as primary entrance', async () => {
    document.body.innerHTML = readFileSync(`${import.meta.dirname}/../ext/action-popup.html`, 'utf8');
    globalThis.chrome = {runtime: {sendMessage: async () => ({ok: true, value: {due: 23}})}};
    const commandExec = vi.fn();
    const controller = new DisplayController({commandExec});
    controller._optionsFull = {profiles: [{options: {scanning: {inputs: [{include: 'ctrl, shift'}]}}}], profileCurrent: 0};
    controller._updateDisplayModifierKey();
    await controller._updateToday();
    expect(document.querySelector('.tooltip').textContent).toContain('Ctrl + Shift');
    expect(document.querySelector('#action-today').textContent).toBe('今天 23 张');
    expect(document.querySelector('.action-open-search')).toBeNull();
    expect(document.querySelector('#action-popup').firstElementChild.tagName).toBe('HEADER');
    controller._updateDictionariesEnabledWarnings = async () => {};
    controller._updatePermissionsWarnings = async () => {};
    controller._themeController = {updateTheme() {}};
    controller._setupOptions({options: {general: {enable: true}}});
    expect(document.querySelector('.scan-state').textContent).toBe('划词查询已开启');
    const toggle = document.querySelector('.enable-search'); toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    expect(document.querySelector('.scan-state').textContent).toBe('已暂停');
    expect(commandExec).toHaveBeenCalledOnce();
});
