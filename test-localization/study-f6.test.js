// @vitest-environment jsdom
import {test, expect, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {prepareSystemStatus} from '../ext/js/pages/study-settings-main.js';
function setup(response) {
    document.body.innerHTML = readFileSync('ext/settings.html', 'utf8');
    const root = document.querySelector('.content-center');
    root.dataset.activeSettingsCategory = 'advanced';
    const send = vi.fn(async () => response);
    globalThis.chrome = {runtime: {getURL: path => path, sendMessage: send}, extension: {isAllowedFileSchemeAccess: fn => fn(false)}};
    vi.stubGlobal('fetch', vi.fn(async () => ({json: async () => ({'bridge.py': 'expected'})})));
    prepareSystemStatus(root);
    return send;
}
test('system status renders five rows, version copy and manual refresh without polling', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});
    const send = setup({ok: true, value: {files: {'bridge.py': 'old'}, anki: {ok: true}, vault: {ok: true}, appleTranslate: true, errors: Array.from({length: 20}, () => ({action: 'ankiToday', message: 'offline'}))}});
    await vi.waitFor(() => expect(document.querySelector('[data-health=bridge]').textContent).toContain('✗ 版本不一致'));
    expect(document.querySelector('[data-health=anki]').textContent).toContain('✓ 正常');
    expect(document.querySelector('[data-health=file]').textContent).toContain('✗ 未授权');
    expect(document.querySelector('[data-health-errors]').textContent).toBe('ankiToday：offline ×20');
    expect(document.querySelector('#study-system-status ul')).toBeNull();
    expect(document.querySelector('#practiceEnabled').closest('label').classList.contains('toggle')).toBe(true);
    expect(document.querySelector('#practiceEnabled').closest('section').querySelector('h2').textContent).toBe('词典 AI 辅助');
    document.querySelector('[data-health-copy]').click();
    expect(writeText).toHaveBeenCalledWith('python3 dev/sync-local.py');
    document.querySelector('[data-health-refresh]').click();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
});
test('old bridge without health leaves settings usable and explains how to sync', async () => {
    setup({ok: false, error: 'unknown action'});
    await vi.waitFor(() => expect(document.querySelector('[data-health-summary]').textContent).toContain('尚不支持'));
    expect(document.querySelector('[data-health-command]').hidden).toBe(false);
    expect(document.querySelector('[data-health-refresh]').disabled).toBe(false);
});
