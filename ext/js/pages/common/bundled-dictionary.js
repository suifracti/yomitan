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
import {initializeBundledDictionary, bundledDictionaryTitle} from './bundled-dictionary-core.js';

/** @param {import('../settings/settings-controller.js').SettingsController} controller */
export async function prepareBundledDictionary(controller) {
    const options = await controller.getOptionsFull();
    // Do not auto-import into migrated/custom profiles or reimport after an intentional deletion.
    if (options.profiles.length !== 1 || options.profiles[0].name !== '英语学习') { return; }
    const marker = 'personalStudyDictionaryReady';
    if ((await chrome.storage.local.get(marker))[marker]) { return; }
    await navigator.locks.request('personal-study-dictionary-import', {ifAvailable: true}, async (lock) => {
        if (!lock || (await chrome.storage.local.get(marker))[marker]) { return; }
        const status = document.createElement('div');
        status.setAttribute('role', 'status');
        status.style.cssText = 'padding:14px 20px;background:#ede8ff;color:#36265c;border-radius:10px;margin:16px;font-size:14px;';
        status.textContent = '正在初始化内置英汉词典（约 77 万词条），首次导入可能需要几分钟。请保持此页面打开；现有词典不会被删除。';
        document.body.prepend(status);
        try {
            await initializeBundledDictionary({
                getInfo: () => controller.application.api.getDictionaryInfo(),
                importArchive: async () => {
                    const response = await fetch(chrome.runtime.getURL('/data/study/ecdict.zip'));
                    if (!response.ok) { throw new Error('内置词典文件读取失败'); }
                    const archive = await response.arrayBuffer();
                    return await new DictionaryWorker().importDictionary(archive, {
                        prefixWildcardsSupported: false, yomitanVersion: chrome.runtime.getManifest().version,
                    }, null);
                },
                enable: async (summary) => {
                    const full = await controller.getOptionsFull();
                    const profile = full.profiles[0];
                    if (profile.name !== '英语学习') { throw new Error('配置已变更，停止自动设置'); }
                    if (!profile.options.dictionaries.some(({name}) => name === bundledDictionaryTitle)) {
                        profile.options.dictionaries.push({
                            name: summary.title,
                            alias: summary.title,
                            enabled: true,
                            allowSecondarySearches: false,
                            definitionsCollapsible: 'not-collapsible',
                            partsOfSpeechFilter: true,
                            useDeinflections: true,
                            styles: summary.styles ?? '',
                        });
                        await controller.setAllSettings(full);
                    }
                    await controller.application.api.triggerDatabaseUpdated('dictionary', 'import');
                },
            });
            await chrome.storage.local.set({[marker]: true});
            status.textContent = '英汉词典已就绪。学习预设：英语查词 · 按住 Shift 扫描 · Anki 端口 8766 · 外语::英语语境。';
        } catch (error) {
            status.textContent = `初始化未完成：${error instanceof Error ? error.message : String(error)}。可重新打开入门页重试。`;
        }
    });
}
