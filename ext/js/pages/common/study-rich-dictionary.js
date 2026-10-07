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
    const revision = '2026.10.04';
    const marker = 'studyWiktionaryReadyV1';
    const errorKey = 'studyWiktionaryImportErrorV1';
    const full = await controller.getOptionsFull();
    const index = full.profileCurrent;
    const name = full.profiles[index]?.name;
    const panel = document.querySelector('.study-dictionary-status');
    if (!panel || !name) { return; }
    const status = document.createElement('p');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const button = document.createElement('button');
    button.type = 'button';
    panel.append(status, button);
    const refresh = async () => {
        const info = await controller.application.api.getDictionaryInfo();
        const installed = info.find((d) => d.title === title);
        const options = await controller.getOptionsFull();
        const enabled = options.profiles[options.profileCurrent]?.options.dictionaries.some((d) => d.name === title && d.enabled);
        const savedError = (await chrome.storage.local.get(errorKey))[errorKey];
        const incomplete = installed?.importSuccess === false;
        button.textContent = incomplete ? '修复并重新导入 Wiktionary' : '启用 Wiktionary 英英详解与例句';
        status.textContent = installed ? (incomplete ? 'Wiktionary 上次导入未完成。点击修复，确认后只重建这份不完整的词典。' : `Wiktionary 英英详解已安装，${enabled ? '已启用' : '未启用'}。速览保留中文；完整释义与例句在“词典”页。`) : '随包 Wiktionary 压缩包 103 MiB，内容约 1 GiB，索引还需额外空间。首次导入可能数分钟，请勿关闭或刷新本页。';
        if (incomplete && typeof savedError === 'string' && savedError) { status.textContent += ` 上次错误：${savedError}`; }
        button.hidden = Boolean(installed && !incomplete && enabled);
        return installed;
    };
    /** @returns {Promise<Uint8Array<ArrayBuffer>>} */
    const readArchive = async () => {
        status.textContent = '读取并校验随包词典（103 MiB）；尚未删除任何词典。';
        const chunks = await Promise.all(['part1', 'part2'].map(async (part) => {
            const response = await fetch(chrome.runtime.getURL(`/data/study/wty-en-en.${part}`));
            if (!response.ok) { throw new Error('无法读取随包词典。'); }
            return new Uint8Array(await response.arrayBuffer());
        }));
        const archive = new Uint8Array(chunks.reduce((n, part) => n + part.length, 0));
        let offset = 0;
        for (const part of chunks) {
            archive.set(part, offset); offset += part.length;
        }
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', archive))].map((n) => n.toString(16).padStart(2, '0')).join('');
        if (digest !== 'bcccdce0047917db42c55e8221eff22c1477794cbcd571ddc49551cf26254fbf') { throw new Error('随包词典校验失败；未删除任何词典。'); }
        return archive;
    };
    /** @param {boolean} explicit */
    const run = async (explicit = false) => {
        button.disabled = true;
        const prevention = controller.preventPageExit();
        try {
            await navigator.locks.request('study-wiktionary-import', {ifAvailable: true}, async (lock) => {
                if (!lock) { throw new Error('另一个页面正在导入，请等待。'); }
                let summary = await refresh();
                const repair = summary?.importSuccess === false;
                if (summary && repair) {
                    if (!explicit) { return; }
                    if (summary.revision !== revision || summary.author !== 'wty contributors' || summary.url !== 'https://github.com/yomidevs/wiktionary-to-yomitan') { throw new Error('这份不完整词典不是已识别的随包版本；请在词典管理中检查，未删除。'); }
                    // The user must explicitly authorize removal of this identified incomplete import.
                    // eslint-disable-next-line no-alert
                    if (!window.confirm('只删除 wty-en-en（2026.10.04）未完成的导入数据并重新导入。保留 ECDICT、自定义词典和所有学习记录。继续吗？')) {
                        status.textContent = '已取消修复；没有删除词典。'; return;
                    }
                }
                if (!summary || repair) {
                    const archive = await readArchive();
                    const current = await controller.getOptionsFull();
                    if (current.profileCurrent !== index || current.profiles[index]?.name !== name) { throw new Error('配置已切换；未删除词典，请在目标配置重试。'); }
                    if (summary && repair) {
                        // Recheck immediately before destruction, not only before user consent/archive I/O.
                        const latestInfo = (await controller.application.api.getDictionaryInfo()).find((d) => d.title === title);
                        if (!latestInfo || latestInfo.importSuccess !== false || latestInfo.revision !== revision || latestInfo.author !== summary.author || latestInfo.url !== summary.url) { throw new Error('词典状态已变化，停止修复；请刷新状态。'); }
                        status.textContent = '正在清理这份不完整的 Wiktionary；其他词典与学习记录保留。';
                        await new DictionaryWorker().deleteDictionary(title, null);
                        await controller.application.api.triggerDatabaseUpdated('dictionary', 'delete');
                    }
                    let phase = 0;
                    const imported = await new DictionaryWorker().importDictionary(archive.buffer, {prefixWildcardsSupported: false, yomitanVersion: chrome.runtime.getManifest().version}, ({index: done, count, nextStep}) => {
                        if (nextStep) { ++phase; }
                        const label = ['准备', '准备', '准备', '校验词条', '写入数据库'][phase] ?? '完成校验';
                        const percent = count > 0 ? Math.min(100, Math.round(done / count * 100)) : 0;
                        status.textContent = `Wiktionary：${label} ${percent}%（阶段进度）；请勿关闭或刷新本页，普通查词仍可用。`;
                    });
                    if (!imported.result || imported.errors.length > 0 || imported.result.importSuccess === false) {
                        const reason = imported.errors.slice(0, 3).map((e) => e.message).join('；') || '导入未完成，尚未就绪';
                        throw new Error(`Wiktionary 导入失败：${reason.slice(0, 800)}`);
                    }
                    summary = imported.result;
                }
                const latest = await controller.getOptionsFull();
                const profile = latest.profiles[index];
                if (latest.profileCurrent !== index || profile?.name !== name) { throw new Error('配置已切换，数据保留，请在目标配置启用。'); }
                profile.options.dictionaries = planStudyDictionary(profile.options.dictionaries, summary, []).map((d) => (d.name === title ? {...d, alias: 'Wiktionary 英英详解', enabled: true} : d));
                await controller.setAllSettings(latest);
                await controller.application.api.triggerDatabaseUpdated('dictionary', 'import');
                await chrome.storage.local.set({[marker]: true, [errorKey]: ''});
                await refresh();
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : '导入未完成，可以重试。';
            await chrome.storage.local.set({[errorKey]: message.slice(0, 800)});
            await refresh();
            status.textContent += ` 本次错误：${message}。修复仅处理已识别的不完整包；不会删除其他词典。`;
        } finally { button.disabled = false; prevention.end(); }
    };
    button.addEventListener('click', () => { void run(true); });
    const installed = await refresh();
    const marked = (await chrome.storage.local.get(marker))[marker];
    // Single owned profile only, one time. Existing disabled/deleted user choices are not re-enabled.
    const ownsProfile = full.profiles.length === 1 && name === '英语学习' && full.profiles[index].options.dictionaries.some((d) => d.name === 'ECDICT 英语学习词典' && d.enabled);
    if (!marked && !installed && ownsProfile) { await run(); }
}
