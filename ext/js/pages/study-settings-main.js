/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2016-2022  Yomichan Authors
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

import {studyCall} from '../study/study-client.js';
import {DEFAULTS} from '../study/study-data.js';

const status = /** @type {HTMLElement} */ (document.querySelector('#status'));
const model = /** @type {HTMLSelectElement} */ (document.querySelector('#model'));
const effort = /** @type {HTMLSelectElement} */ (document.querySelector('#effort'));
/** @type {import('study').Model[]} */
let catalog = [];
/**
 * @param {string} id
 * @returns {HTMLSelectElement}
 */
const select = (id) => /** @type {HTMLSelectElement} */ (document.getElementById(id));
/**
 * @param {string} id
 * @returns {HTMLInputElement}
 */
const check = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
const effortNames = new Map([['none', '关闭'], ['minimal', '最小'], ['low', '低 · 更快'], ['medium', '中'], ['high', '高'], ['xhigh', '很高'], ['max', '最高'], ['ultra', '极高']]);
/**
 *
 * @param {HTMLSelectElement} target
 * @param {string} value
 * @param {string} label
 */
function option(target, value, label) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    target.append(o);
}
/**
 * @param {string} [preferred]
 */
function refreshEffort(preferred) {
    const found = catalog.find((m) => m.model === model.value);
    effort.replaceChildren();
    for (const value of found?.efforts ?? [preferred ?? DEFAULTS.effort]) {
        option(effort, value, effortNames.get(value) ?? value);
    }
    effort.value = preferred && [...effort.options].some((o) => o.value === preferred) ? preferred : found?.defaultEffort ?? DEFAULTS.effort;
}
/**
 * @param {import('study').StudyConfig} config
 */
function fill(config) {
    model.replaceChildren();
    option(model, config.model, `${config.model}（已保存；刷新可选列表）`);
    refreshEffort(config.effort);
    for (const id of ['level', 'goal', 'style']) {
        select(id).value = config[/** @type {'level'|'goal'|'style'} */ (id)];
    }
    check('memoryEnabled').checked = config.memoryEnabled;
    check('cacheEnabled').checked = config.cacheEnabled;
}
/** @returns {import('study').StudyConfig} */
function current() {
    return {model: model.value, effort: effort.value, level: select('level').value, goal: select('goal').value, style: select('style').value, memoryEnabled: check('memoryEnabled').checked, cacheEnabled: check('cacheEnabled').checked};
}
/**
 * @param {() => Promise<void>} operation
 * @returns {Promise<void>}
 */
async function run(operation) {
    try {
        await operation();
    } catch (error) {
        status.textContent = error instanceof Error ? error.message : '操作未完成。';
    }
}
/** @returns {Promise<void>} */
async function showSaved() {
    const rows = /** @type {import('study').SavedWord[]} */ (await studyCall('saved'));
    const list = /** @type {HTMLElement} */ (document.querySelector('#saved'));
    list.replaceChildren();
    if (rows.length === 0) {
        list.textContent = '还没有收藏。查词卡点击 ☆ 收藏语境即可。';
    }
    for (const row of [...rows].reverse()) {
        const item = document.createElement('div');
        item.className = 'saved-word';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '移除';
        remove.addEventListener('click', () => {
            void run(async () => {
                await studyCall('removeWord', {id: row.id});
                await showSaved();
            });
        });
        const title = document.createElement('strong');
        title.textContent = row.word;
        const sentence = document.createElement('p');
        sentence.textContent = row.sentence;
        item.append(remove, title, sentence);
        if (row.url) {
            const a = document.createElement('a');
            a.href = row.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = `${row.title || '打开来源'}${typeof row.videoTime === 'number' ? ` · 查词时 ${Math.floor(row.videoTime / 60)}:${String(row.videoTime % 60).padStart(2, '0')}` : ''} ↗`;
            item.append(a);
        }
        list.append(item);
    }
}
model.addEventListener('change', () => {
    refreshEffort();
});
document.querySelector('#load-models')?.addEventListener('click', () => {
    const button = /** @type {HTMLButtonElement} */ (document.querySelector('#load-models'));
    button.disabled = true;
    status.textContent = '正在读取本机模型目录，不会生成译文…';
    void chrome.permissions.request({permissions: ['nativeMessaging']}).then((allowed) => run(async () => {
        if (!allowed) {
            throw new Error('未授予本机通信权限。');
        }
        const previous = model.value;
        const previousEffort = effort.value;
        catalog = /** @type {import('study').Model[]} */ (await studyCall('models'));
        if (catalog.length === 0) {
            throw new Error('本机未返回可用的文本模型。');
        }
        model.replaceChildren();
        for (const m of catalog) {
            option(model, m.model, m.displayName);
        }
        if (catalog.some((m) => m.model === previous)) {
            model.value = previous;
        }
        refreshEffort(previousEffort);
        status.textContent = '模型目录已读取；选择后点击保存。目录支持不等于账号实际调用已验收。';
    })).catch(() => {
        status.textContent = '无法请求本机通信权限。';
    })
        .finally(() => {
            button.disabled = false;
        });
});
document.querySelector('#settings-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void run(async () => {
        const value = current();
        const found = catalog.find((m) => m.model === value.model);
        if (catalog.length > 0 && (!found || !found.efforts.includes(value.effort))) {
            throw new Error('请选择模型支持的推理强度。');
        }
        await studyCall('saveSettings', value);
        status.textContent = '已保存；下一次查词 AI 使用新设置。没有调用模型。';
    });
});
document.querySelector('#reset-memory')?.addEventListener('click', () => {
    void run(async () => {
        const config = /** @type {import('study').StudyConfig} */ (await studyCall('settings'));
        const next = {...config, level: 'unspecified', goal: 'general', style: 'brief', memoryEnabled: false};
        await studyCall('saveSettings', next);
        for (const id of ['level', 'goal', 'style']) {
            select(id).value = next[/** @type {'level'|'goal'|'style'} */ (id)];
        }
        check('memoryEnabled').checked = false;
        status.textContent = '学习偏好已清空并关闭，不影响模型设置或收藏。';
    });
});
document.querySelector('#clear-cache')?.addEventListener('click', () => {
    void run(async () => {
        await studyCall('clearCache');
        status.textContent = '翻译缓存已清空；在途结果也不会写回此缓存。';
    });
});
// Explicit destructive action is confirmed before changing personal data.

document.querySelector('#clear-saved')?.addEventListener('click', () => {
    // eslint-disable-next-line no-alert
    if (confirm('清空所有主动收藏？此操作不能撤销。')) {
        void run(async () => {
            await studyCall('clearSaved');
            await showSaved();
            status.textContent = '收藏已清空。';
        });
    }
});
document.querySelector('#export-saved')?.addEventListener('click', () => {
    void run(async () => {
        const saved = await studyCall('saved');
        const url = URL.createObjectURL(new Blob([JSON.stringify({format: 'study-saved-v1', saved}, null, 2)], {type: 'application/json'}));
        const a = document.createElement('a');
        a.href = url;
        a.download = '英语学习-收藏语境.json';
        a.click();
        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 30000);
        status.textContent = '已请求导出收藏（包含你保存的句子及来源链接）。';
    });
});
void run(async () => {
    fill(/** @type {import('study').StudyConfig} */ (await studyCall('settings')));
    await showSaved();
    status.textContent = '本地设置已读取。首次选择其他模型，请先读取可用模型。';
});
