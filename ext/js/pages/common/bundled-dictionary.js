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
import {bundledDictionaryTitle, initializeBundledDictionary, planStudyDictionary} from './bundled-dictionary-core.js';

/** @param {import('../settings/settings-controller.js').SettingsController} controller */
export async function prepareBundledDictionary(controller) {
    const marker = 'personalStudyDictionaryRichReadyV1';
    const initial = await controller.getOptionsFull();
    const currentIndex = initial.profileCurrent;
    const initialProfile = initial.profiles[currentIndex];
    if (!initialProfile) { return; }
    const status = document.createElement('section');
    status.className = 'study-dictionary-status';
    status.style.cssText = 'padding:14px 20px;border:1px solid #95b8ad;border-radius:10px;margin:16px;font-size:14px;';
    const label = document.createElement('p');
    label.setAttribute('role', 'status');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '升级／启用增强英语词典';
    const link = document.createElement('a');
    link.href = '/settings.html#dictionaries';
    link.textContent = '  查看词典管理';
    status.append(label, button, link);
    document.body.prepend(status);
    const refresh = async () => {
        const full = await controller.getOptionsFull();
        const info = await controller.application.api.getDictionaryInfo();
        const installed = info.find(({title}) => title === bundledDictionaryTitle);
        const enabled = full.profiles[full.profileCurrent]?.options.dictionaries.some(({name, enabled: value}) => name === bundledDictionaryTitle && value);
        label.textContent = installed ?
(installed.importSuccess === false ?
            '增强英语词典上次导入未完成；请在词典管理中检查，不会自动删除数据。' :
            `增强英语词典已安装，当前配置${enabled ? '已启用' : '未启用'}。`) :
            '增强英语词典未安装。查词结果中的“ECDICT 英汉词典”是旧版，不包含已恢复的英文解释、词形等字段。';
        button.hidden = Boolean(installed && installed.importSuccess !== false && enabled);
        return installed;
    };
    /** @param {boolean} explicit */
    const run = async (explicit) => {
        button.disabled = true;
        try {
            await navigator.locks.request('personal-study-dictionary-import', {ifAvailable: true}, async (lock) => {
                if (!lock) { throw new Error('另一个页面正在初始化；请等待完成后刷新。'); }
                label.textContent = '正在初始化增强英语词典（约 77 万词条），首次导入可能需要几分钟。请保持此页面打开；现有词典不会被删除。';
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
                        const profile = full.profiles[currentIndex];
                        if (full.profileCurrent !== currentIndex || profile?.name !== initialProfile.name) {
                            throw new Error('当前配置已切换，停止设置；词典数据保留，请在新配置中启用。');
                        }
                        const info = await controller.application.api.getDictionaryInfo();
                        let planned = planStudyDictionary(profile.options.dictionaries, summary, info);
                        if (explicit) {
                            const ownedOld = info.some(({title, revision}) => title === 'ECDICT 英汉词典' && revision === 'ECDICT-2026-10-07');
                            planned = planned.map((dictionary) => {
                                if (dictionary.name === summary.title) { return {...dictionary, enabled: true}; }
                                if (ownedOld && dictionary.name === 'ECDICT 英汉词典') { return {...dictionary, enabled: false}; }
                                return dictionary;
                            });
                        }
                        if (planned !== profile.options.dictionaries) {
                            profile.options.dictionaries = planned;
                            await controller.setAllSettings(full);
                        }
                        await controller.application.api.triggerDatabaseUpdated('dictionary', 'import');
                    },
                });
                await chrome.storage.local.set({[marker]: true});
                await refresh();
            });
        } catch (error) {
            label.textContent = `初始化未完成：${error instanceof Error ? error.message : String(error)}。可以重试；未删除任何现有词典。`;
        } finally {
            button.disabled = false;
        }
    };
    button.addEventListener('click', () => { void run(true); });
    const installed = await refresh();
    const marked = (await chrome.storage.local.get(marker))[marker];
    // Automatic first-install path only; other profiles or intentional deletion need an explicit click.
    if (!marked && !installed && initial.profiles.length === 1 && initialProfile.name === '英语学习') { await run(false); }
}
