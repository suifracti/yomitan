/* SPDX-License-Identifier: GPL-3.0-or-later */
import {studyCall} from '../study/study-client.js';
import {updateStudySourcePreview} from './study-translation.js';

const cleanText = (value) => typeof value === 'string' ? value : '';
const asArray = (value) => Array.isArray(value) ? value : [];
const validId = (value) => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

/** A reading-first view over the existing lookup, journal and save controls.
 * No new model, save pipeline, collection, or learning identity is created here.
 * @param {import('./display.js').Display} display
 * @param {{call?: typeof studyCall}} options
 */
export function prepareStudyFocus(display, {call = studyCall} = {}) {
    const d = document;
    if (d.documentElement.dataset.studyFocusReady === 'true') { return; }
    d.documentElement.dataset.studyFocusReady = 'true';
    const style = d.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('../../css/study-focus.css', import.meta.url).href;
    d.head.append(style);
    let dispose = () => {};
    let revision = 0;
    let searchWasOpen = false;
    const clear = () => {
        // The Search controller may send more than one clear event per query.
        // Do not read the temporary CSS class after dispose() has removed it.
        // Only the learner's explicit "换词" click changes this preference.
        ++revision;
        dispose();
        dispose = () => {};
    };
    display.on('contentUpdateStart', clear);
    display.on('contentClear', clear);
    display.on('contentUpdateComplete', () => {
        dispose();
        dispose = () => {};
        const token = ++revision;
        const inner = d.querySelector('.content-body-inner');
        const anchor = d.querySelector('.study-reading-anchor');
        const context = d.querySelector('#study-context');
        if (!inner || !anchor || !context || context.hidden) { return; }
        const source = anchor.querySelector('.study-source');
        if (!source) { return; }
        const entry = context.closest('.study-entry');
        const word = cleanText(display.query);
        const language = display.getOptions?.()?.general?.language === 'ja' ? 'ja' : 'en';
        const sentenceState = display.history?.state?.sentence;
        const original = cleanText(sentenceState?.text) || word;
        const sourceLabel = source.querySelector('.study-source-label')?.textContent || '';
        // A dictionary gloss or a bare headword is not the page or subtitle the user is reading.
        const dictionarySource = sentenceState?.sourceKind === 'dictionary' || sourceLabel.includes('来自词典解释') || sourceLabel.includes('暂无完整原句');
        const hasSentence = !dictionarySource && original.trim().toLowerCase() !== word.trim().toLowerCase();
        const dictionaryEntry = display.dictionaryEntries?.[0];
        const lemma = dictionaryEntry?.type === 'term' ? cleanText(dictionaryEntry.headwords?.[0]?.term) : '';
        const owner = {word, language, sentence: original, ...(lemma ? {lemma} : {})};
        const current = () => token === revision && shell.isConnected;
        const homes = [];
        const observers = [];
        const owned = [];
        let refreshSourceExpansion = () => {};
        const make = (tag, cls, text = '') => {
            const el = d.createElement(tag); el.className = cls; el.textContent = text; return el;
        };
        const button = (text, label = text) => {
            const el = make('button', 'sf-button scan-disable', text);
            el.type = 'button'; el.setAttribute('aria-label', label); return el;
        };
        const move = (node, parent) => {
            if (!node || !node.parentNode) { return; }
            const mark = d.createComment('study-focus-home');
            node.before(mark); homes.push([node, mark]); parent.append(node);
        };
        const shell = make('section', 'study-focus-shell');
        shell.setAttribute('aria-label', hasSentence ? '当前语境学习' : '单词查询');
        shell.classList.toggle('sf-no-source', !hasSentence);
        // Keep the actual display entry and all upstream event handlers intact.
        (entry || inner).prepend(shell); owned.push(shell);
        d.documentElement.classList.add('study-focus-active');
        const heading = make('header', 'sf-heading');
        const title = make('div', 'sf-word');
        const wordNode = make('strong', '', word);
        const ipa = make('span', 'sf-ipa', anchor.querySelector('.study-reading-phonetic')?.textContent || '');
        title.append(wordNode, ipa);
        const sound = button('发音', '播放当前词的发音');
        const play = entry?.querySelector('[data-action="play-audio"]');
        sound.disabled = !play;
        sound.addEventListener('click', () => { if (current()) { play?.click(); } });
        // One visible play control. The original button stays for hotkeys and the source menu.
        if (play) { play.classList.add('sf-audio-primary-hidden'); }
        const audioTools = make('div', 'sf-audio-tools');
        audioTools.append(sound);
        const sourceMenu = entry?.querySelector('.study-audio-sources');
        if (sourceMenu) { move(sourceMenu, audioTools); }
        // A full word card can be opened in Yomitan's old Search page at
        // ~400x250. Keep the original search controls available on demand,
        // instead of letting its intro and search form obscure the first sense.
        if (d.documentElement.dataset.pageType === 'search') {
            const searchBox = /** @type {?HTMLTextAreaElement} */ (d.querySelector('#search-textbox'));
            const searchHeader = d.querySelector('#sticky-search-header');
            if (searchBox && searchHeader) {
                const searchToggle = button('换词', '展开搜索其他单词');
                searchToggle.classList.add('sf-search-toggle');
                searchToggle.setAttribute('aria-controls', 'sticky-search-header');
                d.documentElement.classList.toggle('sf-search-open', searchWasOpen);
                searchToggle.setAttribute('aria-expanded', String(searchWasOpen));
                searchToggle.textContent = searchWasOpen ? '收起搜索' : '换词';
                searchToggle.addEventListener('click', () => {
                    if (!current()) { return; }
                    const expanded = !d.documentElement.classList.contains('sf-search-open');
                    searchWasOpen = expanded;
                    d.documentElement.classList.toggle('sf-search-open', expanded);
                    searchToggle.setAttribute('aria-expanded', String(expanded));
                    searchToggle.textContent = expanded ? '收起搜索' : '换词';
                    if (expanded) { searchBox.focus(); }
                    else if (d.activeElement === searchBox) { searchToggle.focus(); }
                });
                audioTools.prepend(searchToggle);
                if (!searchWasOpen && d.activeElement === searchBox) { searchToggle.focus({preventScroll: true}); }
            }
        }
        heading.append(title, audioTools);
        const sourcePane = make('section', 'sf-source-pane');
        sourcePane.setAttribute('aria-label', '原句与译文');
        sourcePane.hidden = !hasSentence;
        const sourceReading = make('div', 'sf-source-reading');
        sourcePane.append(sourceReading);
        move(source, sourceReading);
        const tabs = make('nav', 'sf-tabs'); tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', '学习内容');
        const body = make('div', 'sf-body');
        const learn = make('section', 'sf-learn');
        const dictionary = make('section', 'sf-dictionary');
        const records = make('section', 'sf-records');
        const panels = [learn, dictionary, records];
        const labels = ['词义与原句', '详细词典', '我的记录'];
        const tabButtons = labels.map((label, index) => {
            const tab = button(label); tab.className = 'sf-tab scan-disable';
            tab.setAttribute('role', 'tab');
            tab.id = `study-focus-${token}-tab-${index}`;
            panels[index].id = `study-focus-${token}-panel-${index}`;
            panels[index].setAttribute('role', 'tabpanel');
            panels[index].setAttribute('aria-labelledby', tab.id);
            tab.setAttribute('aria-controls', panels[index].id);
            tab.addEventListener('click', () => select(index));
            tab.addEventListener('keydown', (e) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { return; }
                e.preventDefault();
                const next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (index + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
                select(next); tabButtons[next].focus();
            });
            tabs.append(tab); return tab;
        });
        // A standalone lookup still starts with its Chinese meaning, not a blank AI panel.
        let activeTab = 0;
        const select = (index) => {
            activeTab = index;
            panels.forEach((panel, i) => { panel.hidden = i !== index; });
            tabButtons.forEach((tab, i) => {
                tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1;
            });
            shell.dataset.panel = String(index);
            // The original sentence belongs to the first learning page only.
            sourcePane.hidden = !hasSentence || index !== 0;
            body.scrollTop = 0;
        };
        body.append(...panels);
        shell.append(heading, sourcePane, tabs, body);

        // Full senses stay on the dictionary panel. The reading panel only borrows one labeled hint.
        for (const selector of ['.study-reading-meaning', '.study-reading-english', '.study-reading-info']) {
            move(anchor.querySelector(selector), dictionary);
        }
        const entryHeader = entry?.querySelector('.entry-header');
        move(entryHeader, dictionary);
        // The cloned English preview delegates retry/save lookup to the original
        // header. Keep that original first in entry query order.
        const englishReference = dictionary.querySelector('.study-reading-english');
        if (entryHeader && englishReference) { englishReference.before(entryHeader); }
        move(entry?.querySelector('.study-dictionary-details'), dictionary);
        const dictDisclosure = dictionary.querySelector('.study-dictionary-details');
        if (dictDisclosure) { dictDisclosure.open = true; }
        const direct = dictionary.querySelector('.note-actions-container');
        if (direct) { direct.dataset.studyQuickCard = 'true'; }

        // Reuse the existing input, save intent, feedback and request controls.
        move(context, learn);
        const focusAnswer = make('section', 'sf-answer');
        focusAnswer.setAttribute('aria-live', 'polite');
        const answerHeading = make('div', 'sf-section-label', '在这句话里');
        answerHeading.hidden = true;
        const asked = make('p', 'sf-asked'); asked.hidden = true;
        const meaning = make('div', 'sf-meaning');
        meaning.hidden = true;
        const notes = make('div', 'sf-notes'); notes.hidden = true;
        const shortGloss = make('div', 'sf-short-gloss');
        shortGloss.hidden = true;
        const noSource = make('p', 'sf-no-source-note', '暂无原句 · 当前仅查询这个词');
        noSource.hidden = hasSentence;
        const feedback = make('div', 'sf-feedback');
        focusAnswer.append(shortGloss, noSource, answerHeading, asked, meaning, notes, feedback);
        // For a 400x250 standalone Search card, the input/compose area may take
        // all remaining height. Put the existing Chinese sense ABOVE the tabs,
        // alongside the headword; it must be visible without inner scrolling.
        if (hasSentence) {
            // Keep the Chinese meaning fixed while the source/translation scrolls.
            sourcePane.prepend(shortGloss);
        } else {
            const standaloneSense = make('div', 'sf-standalone-sense');
            standaloneSense.append(shortGloss, noSource);
            heading.append(standaloneSense);
        }
        context.prepend(focusAnswer);
        owned.push(focusAnswer);
        const history = context.querySelector('.study-conversation-history');
        const output = context.querySelector('.study-translation-output');
        const input = context.querySelector('.study-followup');
        const actions = context.querySelector('.study-translation-actions');
        if (input) { input.placeholder = '哪一部分还不明白？可以直接用中文问。'; }
        const compose = make('div', 'sf-compose');
        context.append(compose); owned.push(compose);
        // Usage and source editing are real secondary tools, never deleted.
        const usage = context.querySelector('.study-token-summary');
        if (usage) { move(usage, dictionary); usage.classList.add('sf-usage-reference'); }
        const editSource = context.querySelector('.study-more-actions');
        // Correct a captured sentence beside that sentence. A word-only lookup keeps the same editor on the dictionary page.
        if (editSource) { move(editSource, hasSentence ? sourcePane : dictionary); }
        const neighborAction = editSource?.querySelector('[data-study-use-context]');
        const sourceTools = make('div', 'sf-source-tools');
        const editBody = make('div', 'sf-source-editor-body');
        const openContextEditor = () => { if (current() && editSource) { editSource.open = true; } };
        if (hasSentence && editSource) {
            // Keep the original controls/listeners; only separate their scroll area.
            for (const node of [...editSource.children]) {
                if (node.tagName !== 'SUMMARY' && node !== neighborAction) { move(node, editBody); }
            }
            editSource.append(editBody); owned.push(editBody);
            if (neighborAction) {
                editSource.before(sourceTools); owned.push(sourceTools);
                move(neighborAction, sourceTools);
                neighborAction.classList.add('sf-button');
                neighborAction.addEventListener('click', openContextEditor);
            }
        }
        const editor = editSource?.querySelector('.study-source-editor');
        const onSourceEdit = () => {
            const paragraph = source.querySelector('p');
            if (current() && paragraph && editor) {
                updateStudySourcePreview(paragraph, editor.value);
                refreshSourceExpansion();
            }
        };
        editor?.addEventListener('change', onSourceEdit);
        const allContextChildren = [...context.children];
        for (const node of allContextChildren) {
            if (node === focusAnswer || node === history || node === compose || node.matches('.study-more-actions')) { continue; }
            move(node, compose);
        }
        if (input && actions) { compose.prepend(input); input.after(actions); }
        const save = context.querySelector('[data-study-save="note"]');
        const saveBar = make('div', 'sf-save-bar');
        shell.append(saveBar); owned.push(saveBar);
        if (save) {
            save.title = '保存这次查词到 Obsidian，并按设置关联旧卡或择要新增 0–1 张 Anki 卡。不要求先问 AI。';
            move(save, saveBar);
        }
        const summary = make('div', 'sf-saved-summary');
        summary.setAttribute('role', 'status'); summary.hidden = true;
        saveBar.append(summary); owned.push(summary);
        for (const selector of ['.study-library-status', '.study-anki-status', '.study-pending-recovery', '.study-request-status', '.openNote']) {
            const node = context.querySelector(selector);
            if (node) { move(node, saveBar); }
        }
        const syncSave = () => {
            if (!current()) { return; }
            const note = saveBar.querySelector('.study-library-status');
            const anki = saveBar.querySelector('.study-anki-status');
            const failed = /失败|未完成|待|错误|异常|拒绝|重试|未确认/.test(note?.textContent || '');
            summary.dataset.state = failed ? 'pending' : 'normal';
            const text = [note?.textContent, !anki?.hidden ? anki?.querySelector('span')?.textContent : ''].filter(Boolean).join(' · ');
            summary.textContent = text;
            summary.hidden = !text;
            // Keep actionable retries, open-note links and error messages visible.
            if (note) { note.classList.add('sf-visually-covered'); }
        };
        for (const node of [saveBar.querySelector('.study-library-status'), saveBar.querySelector('.study-anki-status')]) {
            if (!node) { continue; }
            const observer = new MutationObserver(syncSave);
            observer.observe(node, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden']});
            observers.push(observer);
        }

        const paintDictionaryHint = (host) => {
            host.replaceChildren();
            // The pinned meaning may be absent in a standalone or nested lookup.
            // The original dictionary row is the fallback, never an AI guess.
            const sense = dictionary.querySelector('.study-reading-sense') ||
                entry?.querySelector('.study-primary-meaning > div:not([data-sc-study-role="label"])');
            let gloss = sense?.querySelector('.study-meaning-text')?.textContent?.trim() || '';
            if (!gloss && sense) {
                const plain = /** @type {HTMLElement} */ (sense.cloneNode(true));
                plain.querySelectorAll('.study-pos, [data-sc-study-role="label"]').forEach((node) => node.remove());
                gloss = plain.textContent?.trim() || '';
            }
            if (!gloss || !/\p{Script=Han}/u.test(gloss)) {
                host.append(make('span', 'sf-gloss-kicker', '简明中文释义'),
                    make('p', 'sf-gloss-unavailable', '当前词典没有提供中文义项，可查看详细词典或继续问 AI。'));
                return;
            }
            const row = make('div', 'sf-gloss-row');
            const pos = sense?.querySelector('.study-pos');
            if (pos) {
                const copy = /** @type {HTMLElement} */ (pos.cloneNode(true));
                copy.classList.add('sf-gloss-pos');
                row.append(copy);
            }
            row.append(make('strong', 'sf-gloss-text', gloss));
            host.append(make('span', 'sf-gloss-kicker',
                hasSentence ? '中文词义 · 词典参考，未按本句判断' : '中文词义 · 词典参考'), row);
        };
        const updateAnswer = () => {
            if (!current()) { return; }
            const turns = [...(output?.querySelectorAll('.study-conversation-turn') || [])];
            const turn = [...turns].reverse().find((node) => node.querySelector('.study-turn-answer')) || turns.at(-1);
            const prior = turns.filter((node) => node !== turn);
            const answer = turn?.querySelector('.study-turn-answer');
            const meaningText = answer?.querySelector('.study-ai-meaning')?.textContent?.trim() || '';
            const noteText = answer?.querySelector('.study-ai-notes')?.textContent?.trim() || '';
            const mine = turn?.querySelector('.study-user-question')?.textContent || '';
            answerHeading.hidden = !turn;
            answerHeading.textContent = '在这句话里';
            paintDictionaryHint(shortGloss);
            // The lexical meaning stays visible whether or not an AI answer exists.
            // It is labeled separately from the contextual interpretation.
            shortGloss.hidden = shortGloss.childElementCount === 0;
            asked.textContent = mine;
            asked.hidden = !mine || mine === '我：请解释这句话和这个词的用法';
            meaning.textContent = meaningText;
            meaning.hidden = !meaningText;
            notes.textContent = noteText;
            notes.hidden = !noteText || noteText === meaningText;
            feedback.replaceChildren();
            for (const originalButton of turn?.querySelectorAll('.study-feedback button') || []) {
                const proxy = button(originalButton.textContent || '反馈');
                proxy.setAttribute('aria-pressed', originalButton.getAttribute('aria-pressed') || 'false');
                proxy.disabled = originalButton.disabled;
                proxy.addEventListener('click', () => { if (current() && originalButton.isConnected) { originalButton.click(); } });
                feedback.append(proxy);
            }
            for (const panel of turns) { panel.classList.toggle('sf-current-history', panel === turn); }
            if (history) {
                history.hidden = prior.length === 0;
                const label = history.querySelector(':scope > summary');
                if (label) { label.textContent = `之前的问答 · ${prior.length} 轮`; }
            }
            // The original full journal DOM remains authoritative, including the
            // latest turn, but the latest answer is displayed only once.
        };
        if (output) {
            const observer = new MutationObserver(() => { updateAnswer(); syncSave(); });
            observer.observe(output, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-pressed', 'disabled']});
            observers.push(observer);
        }
        const sourceObserver = new MutationObserver(() => { updateAnswer(); refreshSourceExpansion(); });
        sourceObserver.observe(source, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden']});
        observers.push(sourceObserver);

        // Explicit two-way readback: Obsidian stays authoritative for edited prose,
        // Anki for cards and scheduling. The view never overwrites either one.
        const recordsHead = make('div', 'sf-records-head');
        recordsHead.append(make('h3', '', '我的笔记与卡片'));
        const refresh = button('刷新笔记与卡片'); recordsHead.append(refresh);
        const readStatus = make('p', 'sf-description', '读取已有学习，不调用 AI，也不改变笔记或复习排程。');
        const memoryBody = make('div', 'sf-memory-body');
        records.append(recordsHead, readStatus, memoryBody);
        let reading = false;
        const readMemory = async (fresh, interactive) => {
            if (reading || !current()) { return; }
            reading = true; refresh.disabled = true;
            try {
                const permitted = interactive ? await chrome.permissions.request({permissions: ['nativeMessaging']}) :
                    await chrome.permissions.contains?.({permissions: ['nativeMessaging']});
                if (!permitted) { readStatus.textContent = '点「刷新笔记与卡片」后读取你自己的学习记录。'; return; }
                readStatus.textContent = '正在读回 Obsidian 和 Anki…';
                const memory = await call('libraryMemory', {word: owner.word, language: owner.language, ...(owner.lemma ? {lemma: owner.lemma} : {}), fresh});
                if (!current()) { return; }
                memoryBody.replaceChildren();
                const items = asArray(memory?.items);
                const ids = items.map((item) => item.id).filter(validId).slice(0,10);
                let exactRecords = [];
                if (ids.length) {
                    try {
                        const result = await call('libraryRead', {ids, language});
                        exactRecords = asArray(result?.items);
                    } catch { /* Memory snippets remain useful when one exact record was moved. */ }
                }
                if (!current()) { return; }
                const coverage = memory?.coverage?.status || 'unavailable';
                const anki = memory?.anki || {status: 'unavailable', items: []};
                const noteCount = Number.isInteger(memory?.total) ? memory.total : null;
                const cardCount = Number.isInteger(anki.total) ? anki.total : null;
                const notesVerified = coverage === 'complete' && noteCount !== null;
                tabButtons[2].textContent = notesVerified ? `我的记录 · ${noteCount}` : '我的记录 · 未核实';
                readStatus.textContent = `${notesVerified ? `Obsidian ${noteCount} 条同词语境` : 'Obsidian 尚未完整核对，不能据此判断没学过'} · ${anki.status === 'unavailable' ? 'Anki 未连接／未读到' : anki.status === 'complete' ? `Anki ${cardCount ?? asArray(anki.items).length} 条相关笔记` : 'Anki 只读到一部分'}。${fresh ? '已重新读回' : '可刷新取得最新修改'}。`;
                const noteTitle = make('h4', '', 'Obsidian · 我的理解'); memoryBody.append(noteTitle);
                if (!items.length) { memoryBody.append(make('p', 'sf-description', coverage === 'complete' ? '在已检查的语境词库中没有找到相关记录。' : '尚未完整读到笔记，不能据此判断没学过。')); }
                for (const item of items) {
                    const read = exactRecords.find((row) => row.id === item.id);
                    const row = read?.record;
                    const block = make('article', 'sf-memory-note');
                    const subject = make('strong', '', row?.entry?.word || item.word || word);
                    const text = make('div', 'sf-note-prose');
                    for (const part of cleanText(read?.text || item.text).split(/\n\s*\n/)) {
                        const value = part.trim();
                        if (!value || /^<!--/.test(value)) { continue; }
                        const line = /^#{1,6}\s/.test(value) ? make('h5', '', value.replace(/^#{1,6}\s+/, '')) :
                            make('p', '', value.split('\n').map((line) => line.replace(/^> ?/, '')).join('\n'));
                        text.append(line);
                    }
                    block.append(subject, text);
                    if (item.truncated || read?.truncated) { block.append(make('p', 'sf-description', '这里只显示片段；完整内容仍在原笔记。')); }
                    const url = cleanText(row?.openUrl);
                    if (/^obsidian:\/\/open\?/.test(url)) {
                        const link = make('a', 'sf-link scan-disable', '打开原笔记 ↗'); link.href = url; block.append(link);
                    }
                    memoryBody.append(block);
                }
                memoryBody.append(make('h4', '', 'Anki · 已有复习卡'));
                for (const item of asArray(anki.items)) {
                    const block = make('article', 'sf-memory-note');
                    const fields = item?.fields || {};
                    block.append(make('strong', '', cleanText(fields.Question || fields.Word || fields.Expression || fields.Front) || '已有卡片'));
                    block.append(make('p', 'sf-memory-sentence', cleanText(fields.Sentence)));
                    block.append(make('p', '', cleanText(fields.Definition || fields.Back || fields.Text)));
                    if (item.truncated) { block.append(make('p', 'sf-description', '内容为读取片段，完整卡面仍在 Anki。')); }
                    const reviews = asArray(item.reviews);
                    const count = reviews.reduce((total, r) => total + (Number.isInteger(r.reps) ? r.reps : 0), 0);
                    block.append(make('p', 'sf-description', item.reviewStatus === 'reported' ? `已读取复习 ${count} 次；不代表已经掌握。` : '复习情况尚未读到。'));
                    if (Number.isSafeInteger(item.noteId) && item.noteId > 0 && display.application?.api?.viewNotes) {
                        const open = button('在 Anki 查看');
                        open.addEventListener('click', () => {
                            if (!current()) { return; }
                            void display.application.api.viewNotes([item.noteId], 'edit', false).catch(() => { readStatus.textContent = '未打开 Anki；原卡片与排程没有更改。'; });
                        });
                        block.append(open);
                    }
                    memoryBody.append(block);
                }
                if (!asArray(anki.items).length) { memoryBody.append(make('p', 'sf-description', anki.status === 'complete' ? '在当前牌组／笔记类型中未找到相关卡片。' : 'Anki 尚未完整读取，不能当作零卡片。')); }
                if (anki.cached) { memoryBody.append(make('p', 'sf-description', `Anki 结果来自 ${anki.ageSeconds ?? '少量'} 秒前的缓存；刷新会重新核对。`)); }
            } catch (error) {
                if (current()) { readStatus.textContent = `本次未读回：${error instanceof Error ? error.message : '本机学习服务不可用'}。已有记录没有被修改。`; }
            } finally { reading = false; if (current()) { refresh.disabled = false; } }
        };
        refresh.addEventListener('click', () => { void readMemory(true, true); });
        const sourceFooter = make('div', 'sf-source-footer');
        const sourceUrl = cleanText(display.history?.state?.url);
        const videoTime = display.history?.state?.videoTime;
        if (/^https?:\/\//.test(sourceUrl)) {
            let href = sourceUrl;
            let label = '打开来源';
            if (typeof videoTime === 'number' && Number.isFinite(videoTime) && videoTime >= 0) {
                try {
                    const parsed = new URL(sourceUrl);
                    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(parsed.hostname)) {
                        parsed.searchParams.set('t', `${Math.floor(videoTime)}s`);
                        href = parsed.href;
                        label = '打开来源 · 含时间';
                    }
                } catch { /* Keep the plain source link. */ }
            }
            const link = make('a', 'sf-link scan-disable', label); link.href = href;
            link.target = '_blank'; link.rel = 'noopener noreferrer'; sourceFooter.append(link);
        }
        const expandSource = button('展开原句');
        expandSource.classList.add('sf-expand-source'); expandSource.setAttribute('aria-expanded','false');
        expandSource.addEventListener('click', () => {
            const full = shell.classList.toggle('sf-source-expanded');
            expandSource.setAttribute('aria-expanded', String(full)); expandSource.textContent = full ? '收起原句' : '展开原句';
        });
        sourceFooter.append(expandSource); sourcePane.append(sourceFooter); owned.push(sourceFooter);
        refreshSourceExpansion = () => {
            if (!current()) { return; }
            expandSource.hidden = !shell.classList.contains('sf-source-expanded') && sourceReading.scrollHeight <= sourceReading.clientHeight + 2;
        };
        if (typeof ResizeObserver !== 'undefined') {
            const resize = new ResizeObserver(refreshSourceExpansion);
            resize.observe(sourceReading); observers.push(resize);
        }
        requestAnimationFrame(refreshSourceExpansion);
        select(activeTab); updateAnswer(); syncSave();
        void readMemory(false, false);
        dispose = () => {
            observers.forEach((observer) => observer.disconnect());
            editor?.removeEventListener('change', onSourceEdit);
            neighborAction?.removeEventListener('click', openContextEditor);
            neighborAction?.classList.remove('sf-button');
            // Original display nodes return to their own entry before the next
            // lookup. Do not resurrect an anchor already cleared by its owner.
            for (const [node, mark] of homes.reverse()) {
                if (node.isConnected && mark.isConnected) { mark.before(node); }
                mark.remove();
            }
            for (const node of owned.reverse()) { node.remove(); }
            context.querySelector('.sf-visually-covered')?.classList.remove('sf-visually-covered');
            for (const panel of output?.querySelectorAll('.sf-current-history') || []) { panel.classList.remove('sf-current-history'); }
            usage?.classList.remove('sf-usage-reference');
            d.documentElement.classList.remove('study-focus-active', 'sf-search-open');
        };
    });
}
