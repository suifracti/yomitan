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

import {DictionaryWorker} from '../../dictionary/dictionary-worker.js';
import {planStudyDictionary} from './bundled-dictionary-core.js';

/** @param {import('../settings/settings-controller.js').SettingsController} controller */
export async function prepareStudyRichDictionary(controller) {
    const title = 'wty-en-en';
    const marker = 'studyWiktionaryReadyV1';
    const full = await controller.getOptionsFull();
    const index = full.profileCurrent;
    const name = full.profiles[index]?.name;
    const panel = document.querySelector('.study-dictionary-status');
    if (!panel || !name) { return; }
    const status = document.createElement('p');
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = '启用 Wiktionary 英英详解与例句';
    panel.append(status, button);
    const refresh = async () => {
        const info = await controller.application.api.getDictionaryInfo();
        const installed = info.find((d) => d.title === title);
        const options = await controller.getOptionsFull();
        const enabled = options.profiles[options.profileCurrent]?.options.dictionaries.some((d) => d.name === title && d.enabled);
        status.textContent = installed ? (installed.importSuccess === false ? 'Wiktionary 上次导入未完成；请检查词典管理。' : `Wiktionary 英英详解已安装，${enabled ? '已启用' : '未启用'}。速览保留中文；完整释义与例句在“词典”页。`) : '随包提供 Wiktionary 英英详解（103 MiB），首次导入可能需要几分钟。保留 ECDICT 中文速览，不删除现有词典。';
        button.hidden = Boolean(installed && installed.importSuccess !== false && enabled);
        return installed;
    };
    const run = async () => {
        button.disabled = true;
        try {
            await navigator.locks.request('study-wiktionary-import', {ifAvailable: true}, async (lock) => {
                if (!lock) { throw new Error('另一个页面正在导入，请等待。'); }
                let summary = await refresh();
                if (summary?.importSuccess === false) { throw new Error('上次导入未完成，不自动删除或覆盖。'); }
                if (!summary) {
                    status.textContent = '正在导入 Wiktionary 英英详解与例句，请保持页面打开；普通查词仍可用。';
                    const chunks = await Promise.all(['part1', 'part2'].map(async (part) => {
                        const response = await fetch(chrome.runtime.getURL(`/data/study/wty-en-en.${part}`));
                        if (!response.ok) { throw new Error('无法读取随包词典。'); }
                        return new Uint8Array(await response.arrayBuffer());
                    }));
                    const archive = new Uint8Array(chunks.reduce((n, part) => n + part.length, 0));
                    let offset = 0;
                    for (const part of chunks) {
                        archive.set(part, offset);
                        offset += part.length;
                    }
                    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', archive))].map((n) => n.toString(16).padStart(2, '0')).join('');
                    if (digest !== 'bcccdce0047917db42c55e8221eff22c1477794cbcd571ddc49551cf26254fbf') { throw new Error('随包词典校验失败；停止导入。'); }
                    const imported = await new DictionaryWorker().importDictionary(archive.buffer, {prefixWildcardsSupported: false, yomitanVersion: chrome.runtime.getManifest().version}, null);
                    if (!imported.result || imported.errors.length > 0 || imported.result.importSuccess === false) { throw new Error('词典导入未完成，请检查可用空间。'); }
                    summary = imported.result;
                }
                const latest = await controller.getOptionsFull();
                const profile = latest.profiles[index];
                if (latest.profileCurrent !== index || profile?.name !== name) { throw new Error('配置已切换，数据保留，请在目标配置启用。'); }
                profile.options.dictionaries = planStudyDictionary(profile.options.dictionaries, summary, []).map((d) => (d.name === title ? {...d, alias: 'Wiktionary 英英详解', enabled: true} : d));
                await controller.setAllSettings(latest);
                await controller.application.api.triggerDatabaseUpdated('dictionary', 'import');
                await chrome.storage.local.set({[marker]: true});
                await refresh();
            });
        } catch (error) { status.textContent = error instanceof Error ? error.message : '导入未完成，可以重试。'; } finally { button.disabled = false; }
    };
    button.addEventListener('click', () => { void run(); });
    const installed = await refresh();
    const marked = (await chrome.storage.local.get(marker))[marker];
    // Single owned profile only, one time. Existing disabled/deleted user choices are not re-enabled.
    const ownsProfile = full.profiles.length === 1 && name === '英语学习' && full.profiles[index].options.dictionaries.some((d) => d.name === 'ECDICT 英语学习词典' && d.enabled);
    if (!marked && !installed && ownsProfile) { await run(); }
}
