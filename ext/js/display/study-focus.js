/* SPDX-License-Identifier: GPL-3.0-or-later */
import {studyCall} from '../study/study-client.js';
import {prepareStudyWorkspace} from './study-workspace.js';
import {updateStudySourcePreview} from './study-translation.js';
import {explainWordForm, findFormExample} from './study-word-forms.js';
import {chromeTranslate} from '../study/free-translators.js';
import {readSubtitlePrefs} from '../study/subtitle-prefs.js';

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
        const subtitleSource = Boolean(sentenceState?.studySubtitle);
        const sameSavedWord = !display.history?.state?.savedRecordWord || cleanText(display.history.state.savedRecordWord).toLocaleLowerCase() === word.toLocaleLowerCase();
        const savedRecordId = subtitleSource || !sameSavedWord ? void 0 : (display.history?.state?.savedRecordId ?? sentenceState?.recordId);
        const sourceUrlCurrent = cleanText(display.history?.state?.url);
        const sourceTitleCurrent = cleanText(display.history?.state?.documentTitle) || cleanText(display.history?.state?.title);
        const sourceTimeCurrent = display.history?.state?.videoTime;
        const sourceLabel = source.querySelector('.study-source-label')?.textContent || '';
        // A dictionary gloss or a bare headword is not the page or subtitle the user is reading.
        const dictionarySource = sentenceState?.sourceKind === 'dictionary' || sourceLabel.includes('来自词典解释') || sourceLabel.includes('暂无完整原句');
        const hasSentence = !dictionarySource && original.trim().toLowerCase() !== word.trim().toLowerCase();
        const dictionaryEntry = display.dictionaryEntries?.[0];
        const lemma = dictionaryEntry?.type === 'term' ? cleanText(dictionaryEntry.headwords?.[0]?.term) : '';
        const owner = {word, language, sentence: original, ...(lemma ? {lemma} : {})};
        if (validId(savedRecordId)) { context.dataset.studyRecordId = savedRecordId; }
        const current = () => token === revision && shell.isConnected;
        const homes = [];
        const observers = [];
        const owned = [];
        let resizeFollowup = () => {};
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
        if (sourceMenu) {
            sourceMenu.textContent = '发音来源 ▾';
            move(sourceMenu, audioTools);
        }
        const navigation = make('nav', 'sf-navigation');
        navigation.setAttribute('aria-label', '学习导航');
        const libraryLink = make('a', 'sf-link scan-disable', '学习库');
        libraryLink.href = '/study-library.html';
        libraryLink.target = '_blank';
        libraryLink.rel = 'noopener noreferrer';
        navigation.append(libraryLink);
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
        const headerSense = make('div', hasSentence ? 'sf-header-sense' : 'sf-header-sense sf-standalone-sense');
        heading.append(title, audioTools, navigation, headerSense);
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
        const dictionaryHeading = make('div', 'sf-dictionary-heading-dock');
        const dictionaryScroll = make('div', 'sf-dictionary-scroll');
        dictionaryScroll.setAttribute('aria-label', '英文释义、例句与词形资料');
        const dictionaryPager = make('div', 'sf-dictionary-pager');
        dictionary.append(dictionaryHeading, dictionaryScroll, dictionaryPager);
        const records = make('section', 'sf-records');
        const fullMeanings = make('section', 'sf-all-meanings');
        fullMeanings.hidden = true;
        owned.push(fullMeanings);
        let allMeaningsOpen = false;
        let learningScroll;
        let syncGlossOverflow = () => {};
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
            headerSense.hidden = index === 2;
            fullMeanings.hidden = !allMeaningsOpen || index === 2;
            if (index < 2) { (index === 0 ? learningScroll : dictionaryScroll)?.prepend(fullMeanings); }
            requestAnimationFrame(syncGlossOverflow);
            requestAnimationFrame(resizeFollowup);
        };
        body.append(...panels);
        shell.append(heading, tabs, body);

        // Keep the original meaning/preview data for the shared header and saving,
        // but show only the full English dictionary as the main second-page content.
        const dictionaryReference = make('div', 'sf-dictionary-reference');
        dictionaryReference.hidden = true;
        const dictionaryInfo = make('section', 'sf-dictionary-info');
        dictionaryInfo.append(make('h3', 'sf-section-label', '词典资料'));
        const dictionaryForms = make('section', 'sf-dictionary-forms');
        const entryHeader = entry?.querySelector('.entry-header');
        move(entryHeader, dictionaryInfo);
        move(anchor.querySelector('.study-reading-meaning'), dictionaryReference);
        move(anchor.querySelector('.study-reading-english'), dictionaryReference);
        const wordFacts = make('div', 'sf-word-facts');
        const factNodes = entryHeader?.querySelectorAll('[data-study-meta-role="tags"], [data-sc-study-role="tags"], [data-study-meta-role="frequency"], [data-sc-study-role="frequency"]') || [];
        for (const node of factNodes) { move(node, wordFacts); }
        const readingInfo = anchor.querySelector('.study-reading-info');
        move(readingInfo, factNodes.length ? dictionaryReference : wordFacts);
        if (wordFacts.textContent.trim()) {
            wordFacts.title = wordFacts.textContent.trim();
            headerSense.before(wordFacts); owned.push(wordFacts);
        }
        move(entry?.querySelector('.study-dictionary-details'), dictionaryScroll);
        const dictDisclosure = dictionary.querySelector('.study-dictionary-details');
        if (dictDisclosure) { dictDisclosure.open = true; }
        const originalDictionary = dictionary.querySelector('.study-original-dictionary');
        if (originalDictionary) { originalDictionary.open = true; }
        // Keep one dictionary content scroller; its two toolbars never scroll away.
        move(dictionary.querySelector('.study-dictionary-heading'), dictionaryHeading);
        move(dictionary.querySelector('.study-dictionary-status'), dictionaryHeading);
        move(dictionary.querySelector('.study-dictionary-pagination'), dictionaryPager);
        dictionaryHeading.hidden = !dictionaryHeading.childElementCount;
        dictionaryPager.hidden = !dictionaryPager.childElementCount;
        const referenceStates = new Map();
        const seenReferences = new Set();
        const lockReferenceOpen = (event) => {
            const node = event.currentTarget;
            if (current() && node instanceof HTMLDetailsElement && !node.open) { node.open = true; }
        };
        for (const label of [...dictionaryScroll.querySelectorAll('[data-sc-content=summary-entry]')]) {
            if (!['词形与语法', '词源', 'Grammar', 'Etymology'].includes(label.textContent?.trim() || '')) { continue; }
            const details = label.closest('details');
            if (!details || referenceStates.has(details)) { continue; }
            const dict = details.closest('[data-dictionary]')?.getAttribute('data-dictionary') || '';
            const signature = dict ? `${dict}:${details.textContent?.replace(/\s+/g, ' ').trim()}` : '';
            const duplicate = Boolean(signature && seenReferences.has(signature));
            if (signature) { seenReferences.add(signature); }
            move(details, ['词形与语法', 'Grammar'].includes(label.textContent?.trim() || '') ? dictionaryForms : dictionaryInfo);
            for (const node of [details, ...details.querySelectorAll('details')]) {
                const summary = node.querySelector(':scope > summary');
                referenceStates.set(node, {open: node.open, hidden: node.hidden, summary, tabIndex: summary?.getAttribute('tabindex')});
                node.open = true;
                node.classList.add('sf-reference-open');
                summary?.setAttribute('tabindex', '-1');
                node.addEventListener('toggle', lockReferenceOpen);
            }
            details.hidden = duplicate;
            if (dict) {
                const origin = make('span', 'sf-reference-source', ` · ${dict}`);
                label.append(origin); owned.push(origin);
            }
        }
        if (dictionaryForms.childElementCount) { dictionaryScroll.prepend(dictionaryForms); }
        dictionaryScroll.append(dictionaryInfo, dictionaryReference);
        const formNodes = entryHeader?.querySelectorAll('[data-study-meta-role="forms"], [data-sc-study-role="forms"]') || [];
        const formText = [...formNodes].map((node) => {
            const items = [...node.querySelectorAll('.study-form-item')];
            return (items.length ? items.map((item) => item.textContent?.trim()).join(' · ') : node.textContent?.trim()) || '';
        }).filter(Boolean).join(' · ');
        let syncFormsPreview = () => {};
        let disposeForms = () => {};
        if (formText) {
            const repeatedForms = [];
            const formOrigins = [];
            // The header already displays these exact words; keep the original node/data,
            // but do not print an identical forms paragraph again below it.
            const normalizeForms = (text) => (text || '').replace(/\s+/g, '');
            for (const details of dictionaryForms.children) {
                const bodyText = [...details.children].filter((node) => node.tagName !== 'SUMMARY').map((node) => node.textContent).join('');
                if (!details.hidden && normalizeForms(bodyText) === normalizeForms(formText)) {
                    repeatedForms.push(details);
                    const origin = details.querySelector('.sf-reference-source')?.textContent?.trim();
                    if (origin) { formOrigins.push(origin); }
                }
            }
            // Each form is its own control: hover or focus explains it, a click pins the note.
            const formsPreview = make('div', 'sf-forms-preview scan-disable');
            formsPreview.setAttribute('role', 'group');
            formsPreview.setAttribute('aria-label', '常见词形');
            const explain = make('div', 'sf-form-explain scan-disable');
            explain.id = `sf-form-explain-${revision}`;
            explain.setAttribute('role', 'tooltip');
            explain.hidden = true;
            /** @type {?HTMLButtonElement} */
            let shownPiece = null;
            let pinned = false;
            let quietFocus = false;
            let hideTimer = 0;
            const senses = () => {
                const seen = new Set();
                const list = [];
                for (const row of shell.querySelectorAll('.sf-gloss-row')) {
                    const pos = row.querySelector('.sf-gloss-pos')?.textContent?.trim() || '';
                    const text = row.querySelector('.sf-gloss-text')?.textContent?.trim() || '';
                    if (text && !seen.has(pos + text)) {
                        seen.add(pos + text);
                        list.push({pos, text});
                    }
                }
                return list;
            };
            const exampleTexts = function *exampleTexts() {
                for (const node of dictionaryScroll.querySelectorAll('li, p, div, span')) {
                    if (node.closest('.sf-dictionary-forms, .sf-dictionary-info') || node.querySelector('li, p, div')) { continue; }
                    yield node.textContent || '';
                }
            };
            // Example translation runs only on an explicit click, through the same
            // sentence translation service the caption reader uses; results stay in memory.
            /** @type {Map<string, string>} */
            const exampleTranslations = new Map();
            let translateRun = '';
            const cancelExampleTranslation = () => {
                if (!translateRun) { return; }
                void call('subtitleCancel', {requestId: translateRun}).catch(() => {});
                translateRun = '';
            };
            /**
             * @param {string} example
             * @param {string} form
             * @returns {HTMLElement}
             */
            const exampleTranslation = (example, form) => {
                const holder = make('div', 'sf-form-explain-translation');
                const known = exampleTranslations.get(example);
                if (known) {
                    holder.append(make('p', '', known));
                    return holder;
                }
                const action = button('翻译例句', `翻译 ${form} 的例句`);
                const status = make('span', 'sf-form-explain-status');
                status.setAttribute('role', 'status');
                action.addEventListener('click', () => {
                    if (!current() || translateRun) { return; }
                    const run = `form-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
                    translateRun = run;
                    pinned = true;
                    shownPiece?.setAttribute('aria-expanded', 'true');
                    action.disabled = true;
                    status.textContent = '正在翻译…';
                    void (async () => {
                        try {
                            // Chrome's on-device translator runs in this page; other services go through the background.
                            const local = (await readSubtitlePrefs()).engine === 'chrome' ? (await chromeTranslate([example]))[0] : '';
                            /** @type {{items?: {id: string, translation?: string, error?: string}[]}} */
                            let result = {items: [{id: 'example', translation: local}]};
                            if (!local) {
                                const config = /** @type {{model?: string, effort?: string}} */ (await call('subtitleSettings'));
                                if (translateRun !== run) { return; }
                                result = /** @type {{items?: {id: string, translation?: string, error?: string}[]}} */ (await call('subtitleTranslate', {requestId: run,
                                    items: [{id: 'example', text: example, context: `${word}：${form}`}],
                                    config: {model: config?.model, effort: config?.effort},
                                    language: 'en',
                                    title: `${word} 词形例句`}));
                            }
                            if (translateRun !== run || !current()) { return; }
                            const translation = result?.items?.[0]?.translation?.trim();
                            if (!translation) { throw new Error(result?.items?.[0]?.error || '没有取得译文'); }
                            exampleTranslations.set(example, translation);
                            holder.replaceChildren(make('p', '', translation));
                        } catch (error) {
                            if (translateRun !== run || !current()) { return; }
                            action.disabled = false;
                            action.textContent = '重试';
                            status.textContent = `翻译未完成：${error instanceof Error ? error.message : String(error)}`;
                        } finally {
                            if (translateRun === run) { translateRun = ''; }
                        }
                    })();
                });
                holder.append(action, status);
                return holder;
            };
            const hideExplain = () => {
                cancelExampleTranslation();
                clearTimeout(hideTimer);
                explain.hidden = true;
                pinned = false;
                shownPiece?.setAttribute('aria-expanded', 'false');
                shownPiece?.removeAttribute('aria-describedby');
                shownPiece = null;
            };
            /**
             * @param {HTMLButtonElement} piece
             * @param {boolean} pin
             */
            const showExplain = (piece, pin) => {
                if (!current()) { return; }
                clearTimeout(hideTimer);
                if (explain.dataset.form !== piece.dataset.form) { cancelExampleTranslation(); }
                if (shownPiece && shownPiece !== piece) {
                    shownPiece.setAttribute('aria-expanded', 'false');
                    shownPiece.removeAttribute('aria-describedby');
                }
                shownPiece = piece;
                pinned = pin || (pinned && explain.dataset.form === piece.dataset.form);
                piece.setAttribute('aria-expanded', String(pinned));
                piece.setAttribute('aria-describedby', explain.id);
                const form = piece.dataset.form || '';
                const info = explainWordForm(piece.dataset.label || '', word, senses());
                const head = make('div', 'sf-form-explain-title');
                head.append(make('strong', '', form), make('span', '', ` · ${word} 的${info.kind}`));
                const parts = [head];
                for (const line of info.usage) { parts.push(make('p', 'sf-form-explain-usage', line)); }
                if (info.sense) {
                    const sense = make('p', 'sf-form-explain-sense');
                    sense.append(make('span', 'sf-gloss-pos', info.sense.pos), ` ${info.sense.text}`);
                    parts.push(sense);
                } else if (info.missing) {
                    parts.push(make('p', 'sf-form-explain-note', info.missing));
                }
                const example = findFormExample(exampleTexts(), form);
                if (example) {
                    const line = make('p', 'sf-form-explain-example');
                    const at = example.toLocaleLowerCase().indexOf(form.toLocaleLowerCase());
                    if (at >= 0) {
                        line.append(example.slice(0, at), make('mark', '', example.slice(at, at + form.length)), example.slice(at + form.length));
                    } else { line.textContent = example; }
                    parts.push(line, exampleTranslation(example, form));
                }
                explain.replaceChildren(...parts);
                explain.dataset.form = form;
                explain.hidden = false;
                const box = formsPreview.getBoundingClientRect();
                const at = piece.getBoundingClientRect();
                explain.style.left = `${Math.max(0, Math.min(at.left - box.left, box.width - explain.offsetWidth))}px`;
            };
            const scheduleHide = () => {
                if (pinned) { return; }
                clearTimeout(hideTimer);
                hideTimer = window.setTimeout(hideExplain, 160);
            };
            for (const part of formText.split(' · ')) {
                const split = part.indexOf('：');
                const piece = /** @type {HTMLButtonElement} */ (make('button', 'sf-form-piece scan-disable'));
                piece.type = 'button';
                piece.setAttribute('aria-expanded', 'false');
                if (split > 0) {
                    const rawLabel = part.slice(0, split);
                    let label = rawLabel;
                    if (/\p{Script=Han}/u.test(label)) {
                        label = label.replace(/\b(?:pl\.|3sg\.|past\.|p\.p\.|V-ing|comp\.|superl\.)\s*/gi, '').replace(/过去式/g, '过去').replace(/过去分词/g, '分词').replace(/现在分词/g, '进行').replace(/第三人称/g, '三单').replace(/\s*\/\s*/g, '/').trim();
                    }
                    const form = part.slice(split + 1).trim();
                    piece.dataset.label = rawLabel;
                    piece.dataset.form = form;
                    piece.setAttribute('aria-label', `${label} ${form}，查看这个词形的用法`);
                    piece.append(make('span', 'sf-form-name', label), make('strong', '', form));
                } else {
                    piece.textContent = part;
                    piece.dataset.label = '';
                    piece.dataset.form = part.trim();
                }
                piece.addEventListener('mouseenter', () => showExplain(piece, false));
                piece.addEventListener('mouseleave', scheduleHide);
                piece.addEventListener('focus', () => {
                    if (!quietFocus) { showExplain(piece, false); }
                });
                piece.addEventListener('blur', () => {
                    if (!explain.contains(d.activeElement)) { scheduleHide(); }
                });
                piece.addEventListener('click', () => {
                    if (pinned && shownPiece === piece) {
                        hideExplain();
                        return;
                    }
                    showExplain(piece, true);
                });
                formsPreview.append(piece);
            }
            explain.addEventListener('mouseenter', () => clearTimeout(hideTimer));
            explain.addEventListener('mouseleave', scheduleHide);
            formsPreview.append(explain);
            /** @param {KeyboardEvent} e */
            const onFormsKey = (e) => {
                if (e.key !== 'Escape' || explain.hidden) { return; }
                const piece = shownPiece;
                hideExplain();
                quietFocus = true;
                piece?.focus();
                quietFocus = false;
            };
            /** @param {PointerEvent} e */
            const onFormsPointer = (e) => {
                if (!explain.hidden && !formsPreview.contains(/** @type {Node} */ (e.target))) { hideExplain(); }
            };
            d.addEventListener('keydown', onFormsKey);
            d.addEventListener('pointerdown', onFormsPointer);
            disposeForms = () => {
                cancelExampleTranslation();
                clearTimeout(hideTimer);
                d.removeEventListener('keydown', onFormsKey);
                d.removeEventListener('pointerdown', onFormsPointer);
            };
            for (const node of formNodes) { node.classList.add('sf-forms-original'); }
            if (formOrigins.length > 0) { formsPreview.title = formOrigins.join('\n'); }
            syncFormsPreview = () => {
                const fits = formsPreview.scrollWidth <= formsPreview.clientWidth + 1;
                for (const details of repeatedForms) { details.hidden = fits; }
                dictionaryForms.hidden = ![...dictionaryForms.children].some((node) => !node.hidden);
            };
            requestAnimationFrame(syncFormsPreview);
            window.addEventListener('resize', syncFormsPreview);
            headerSense.before(formsPreview); owned.push(formsPreview);
        }
        const resetDictionaryScroll = () => { if (current()) { dictionaryScroll.scrollTop = 0; } };
        entry?.addEventListener('study-dictionary-pagechange', resetDictionaryScroll);
        owned.push(dictionaryForms, dictionaryInfo, dictionaryReference);
        const quickLabels = new Map();
        const syncQuickLabels = () => {
            for (const label of dictionaryInfo.querySelectorAll('.note-actions-container [data-action="save-note"] .study-action-label')) {
                if (!quickLabels.has(label)) { quickLabels.set(label, label.textContent); }
                if (label.textContent !== '快速词典卡') { label.textContent = '快速词典卡'; }
            }
        };
        const quickObserver = new MutationObserver(syncQuickLabels);
        quickObserver.observe(dictionaryInfo, {childList: true, subtree: true});
        observers.push(quickObserver);
        syncQuickLabels();
        const direct = dictionaryInfo.querySelector('.note-actions-container');
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
        const noSource = make('p', 'sf-no-source-note', '暂无原句');
        noSource.hidden = hasSentence;
        const feedback = make('div', 'sf-feedback');
        focusAnswer.append(shortGloss, noSource, answerHeading, asked, meaning, notes, feedback);
        // The lexical hint is outside the content scroller for both source and word-only lookups.
        headerSense.append(shortGloss, noSource);
        context.prepend(focusAnswer);
        owned.push(focusAnswer);
        const history = context.querySelector('.study-conversation-history');
        const output = context.querySelector('.study-translation-output');
        const input = context.querySelector('.study-followup');
        const actions = context.querySelector('.study-translation-actions');
        const inputOriginal = input ? {rows: input.getAttribute('rows'), height: input.style.height} : null;
        if (input) {
            input.placeholder = '哪一部分还不明白？可以直接用中文问。';
            input.rows = 1;
        }
        const compose = make('div', 'sf-compose');
        context.append(compose); owned.push(compose);
        // Usage and source editing are real secondary tools, never deleted.
        const usage = context.querySelector('.study-token-summary');
        if (usage) { move(usage, dictionaryInfo); usage.classList.add('sf-usage-reference'); }
        const editSource = context.querySelector('.study-more-actions');
        // Correct a captured sentence beside that sentence. A word-only lookup keeps the same editor on the dictionary page.
        if (editSource) { move(editSource, hasSentence ? sourcePane : dictionaryInfo); }
        const neighborAction = editSource?.querySelector('[data-study-use-context]');
        const sourceTools = make('div', 'sf-source-tools');
        const openContextEditor = () => { if (current() && editSource) { editSource.open = true; resizeEditors(); } };
        const translateSentence = source.querySelector('[data-study-translate-sentence]');
        if (hasSentence && (translateSentence || neighborAction)) {
            (source.querySelector('.study-source-heading') || source).append(sourceTools); owned.push(sourceTools);
            if (translateSentence) { move(translateSentence, sourceTools); }
            if (neighborAction) {
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
            }
        };
        const editorHeights = new Map([...editSource?.querySelectorAll('textarea') || []].map((field) => [field, field.style.height]));
        const resizeEditors = () => {
            if (!current() || !hasSentence || !editSource?.open) { return; }
            for (const field of editorHeights.keys()) {
                field.style.height = '0px';
                field.style.height = `${field.scrollHeight + 2}px`;
            }
        };
        sourcePane.addEventListener('input', resizeEditors);
        editSource?.addEventListener('toggle', resizeEditors);
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
            save.title = '保存这次学习到 Obsidian，不自动制卡；可另选单词意思或原句中的意思制卡。';
            move(save, saveBar);
        }
        const summary = make('div', 'sf-saved-summary');
        summary.setAttribute('role', 'status'); summary.hidden = true;
        saveBar.append(summary); owned.push(summary);
        for (const selector of ['.study-library-status', '.study-anki-status', '.study-pending-recovery', '.study-request-status', '.openNote', '.study-card-add-toggle']) {
            const node = context.querySelector(selector);
            if (node) { move(node, saveBar); }
        }
        const cardControl = saveBar.querySelector('.study-card-add-toggle');
        if (save && cardControl) { save.after(cardControl); }
        learningScroll = make('div', 'sf-learning-scroll');
        learningScroll.setAttribute('aria-label', '原句与问答内容');
        context.prepend(learningScroll); owned.push(learningScroll);
        learningScroll.append(sourcePane, focusAnswer);
        move(history, learningScroll);
        const cardPanel = context.querySelector('.study-card-add');
        if (cardPanel) { move(cardPanel, learningScroll); }
        resizeFollowup = () => {
            if (!current() || !input || !input.getClientRects().length) { return; }
            const style = getComputedStyle(input);
            const line = parseFloat(style.lineHeight) || 18;
            const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
            const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
            input.style.height = '0px';
            const dock = getComputedStyle(compose);
            const available = Math.max(line + padding + border, context.clientHeight - parseFloat(dock.paddingTop) - parseFloat(dock.paddingBottom) - 16);
            input.style.height = `${Math.min(input.scrollHeight + border, line * 3 + padding + border, available)}px`;
        };
        const inputSizeObserver = new ResizeObserver(() => { resizeFollowup(); });
        inputSizeObserver.observe(context); observers.push(inputSizeObserver);
        input?.addEventListener('input', resizeFollowup);
        window.addEventListener('resize', resizeFollowup);
        window.addEventListener('resize', resizeEditors);
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

        let glossSignature = '';
        const paintDictionaryHint = (host) => {
            const collect = (rows) => [...rows].map((sense) => {
                const plain = sense.cloneNode(true);
                plain.querySelectorAll('.study-pos, [data-sc-study-role="label"]').forEach((node) => node.remove());
                const text = sense.querySelector('.study-meaning-text')?.textContent?.trim() || plain.textContent?.trim() || '';
                return {pos: sense.querySelector('.study-pos'), text};
            }).filter(({text}) => /\p{Script=Han}/u.test(text));
            let senses = collect(dictionaryReference.querySelectorAll('.study-reading-sense'));
            if (!senses.length) { senses = collect(entry?.querySelectorAll('.study-primary-meaning > div:not([data-sc-study-role="label"])') || []); }
            const signature = JSON.stringify(senses.map(({pos, text}) => [pos?.textContent || '', text]));
            if (signature === glossSignature) { return; }
            glossSignature = signature;
            host.replaceChildren(); fullMeanings.replaceChildren();
            if (!senses.length) {
                host.append(make('p', 'sf-gloss-unavailable', '暂无中文释义'));
                allMeaningsOpen = false; fullMeanings.hidden = true;
                return;
            }
            const appendRow = (parent, {pos, text}) => {
                const row = make('div', 'sf-gloss-row');
                if (pos) {
                    const copy = pos.cloneNode(true); copy.classList.add('sf-gloss-pos'); row.append(copy);
                }
                row.append(make('strong', 'sf-gloss-text', text)); parent.append(row);
            };
            const preview = make('div', 'sf-gloss-preview');
            const caption = make('div', 'sf-gloss-caption');
            const toggle = button(`全部词义 · 共 ${senses.length} 项`);
            toggle.classList.add('sf-gloss-toggle');
            toggle.setAttribute('aria-expanded', String(allMeaningsOpen));
            toggle.hidden = true; caption.hidden = true;
            caption.append(toggle);
            for (const sense of senses) { appendRow(preview, sense); }
            host.append(caption, preview);
            const fullHeader = make('div', 'sf-meanings-heading');
            fullHeader.append(make('h3', '', '全部中文词义'));
            const collapse = button('收起全部'); fullHeader.append(collapse);
            fullMeanings.append(fullHeader);
            for (const sense of senses) { appendRow(fullMeanings, sense); }
            const setExpanded = (expanded) => {
                allMeaningsOpen = expanded;
                fullMeanings.hidden = !expanded || activeTab === 2;
                toggle.setAttribute('aria-expanded', String(expanded));
                if (expanded) { (activeTab === 0 ? learningScroll : dictionaryScroll).scrollTop = 0; }
                syncGlossOverflow();
            };
            toggle.addEventListener('click', () => { setExpanded(!allMeaningsOpen); });
            collapse.addEventListener('click', () => { setExpanded(false); });
            syncGlossOverflow = () => {
                if (!current() || !preview.getClientRects().length) { return; }
                toggle.hidden = !allMeaningsOpen && preview.scrollHeight <= preview.clientHeight + 1;
                caption.hidden = toggle.hidden;
            };
            requestAnimationFrame(syncGlossOverflow);
        };
        const glossObserver = new ResizeObserver(() => { syncGlossOverflow(); });
        glossObserver.observe(headerSense); observers.push(glossObserver);
        const updateAnswer = () => {
            if (!current()) { return; }
            const turns = [...(output?.querySelectorAll('.study-conversation-turn') || [])];
            /** @param {Element} node */
            const isTranslationTurn = (node) => node.getAttribute('data-study-mode') === 'translate';
            const questionTurns = turns.filter((node) => !isTranslationTurn(node));
            const turn = [...questionTurns].reverse().find((node) => node.querySelector('.study-turn-answer')) || questionTurns.at(-1);
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
            resizeFollowup();
            // The question reads as a heading over the full-width answer.
            asked.textContent = mine.replace(/^\s*我[:：]\s*/, '你问：');
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
                const priorQuestionCount = prior.filter((node) => !isTranslationTurn(node)).length;
                const priorTranslationCount = prior.filter(isTranslationTurn).length;
                if (label) { label.textContent = `之前的历史 · 问答 ${priorQuestionCount} 轮 · 原句翻译 ${priorTranslationCount} 次`; }
            }
            // The original full journal DOM remains authoritative, including the
            // latest turn, but the latest answer is displayed only once.
        };
        if (output) {
            const observer = new MutationObserver(() => { updateAnswer(); syncSave(); });
            observer.observe(output, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-pressed', 'disabled']});
            observers.push(observer);
        }
        const sourceObserver = new MutationObserver(() => { updateAnswer(); });
        sourceObserver.observe(source, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden']});
        observers.push(sourceObserver);

        // Explicit two-way readback: Obsidian stays authoritative for edited prose,
        // Anki for cards and scheduling. The view never overwrites either one.
        const recordsHead = make('div', 'sf-records-head');
        recordsHead.append(make('h3', '', '我的记录'));
        const refresh = button('刷新', '刷新笔记与卡片'); recordsHead.append(refresh);
        const readStatus = make('p', 'sf-description', '正在读取记录…');
        const memoryBody = make('div', 'sf-memory-body');
        records.append(recordsHead, readStatus, memoryBody);
        memoryBody.append(make('p', 'sf-record-destination', 'Obsidian · 未核实'), make('p', 'sf-record-destination', 'Anki · 未核实'));
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
                const normalizeWord = (value) => cleanText(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
                const words = [owner.word, owner.lemma].filter(Boolean).map(normalizeWord);
                const sameWord = (value) => words.includes(normalizeWord(value));
                // Memory also returns semantic/body matches for AI context. They
                // are not this word's records and must not be displayed/reconciled here.
                const items = asArray(memory?.items).filter((item) => sameWord(item.word || item.record?.entry?.word));
                const ids = [...new Set([...(validId(savedRecordId) ? [savedRecordId] : []), ...items.map((item) => item.id).filter(validId)])].slice(0,10);
                let exactRecords = [];
                const reconciliation = new Map();
                let reconcileFailed = false;
                if (ids.length) {
                    try {
                        const result = await call('libraryRead', {ids, language});
                        exactRecords = asArray(result?.items).filter((item) => sameWord(item.record?.entry?.word || item.word));
                        for (const item of (subtitleSource ? [] : exactRecords)) {
                            const id = item?.record?.id;
                            if (!validId(id)) { continue; }
                            try {
                                reconciliation.set(id, await call('libraryReconcile', {id, language}));
                            } catch { reconcileFailed = true; }
                        }
                        const reread = await call('libraryRead', {ids, language});
                        exactRecords = asArray(reread?.items).filter((item) => sameWord(item.record?.entry?.word || item.word));
                    } catch { /* Memory snippets remain useful when one exact record was moved. */ }
                }
                if (!current()) { return; }
                // Bind this view only to the same captured context (or an explicit
                // source record id), never the first result for a matching word.
                const requestedId = validId(savedRecordId) ? savedRecordId : context.dataset.studyRecordId;
                const normalize = (value) => cleanText(value).trim().replace(/\s+/g, ' ').toLocaleLowerCase();
                const currentSentence = cleanText(editor?.value).trim() || original.trim();
                const requestedRecord = exactRecords.find((item) => item?.record?.id === requestedId && normalize(item.record.entry?.word) === normalize(word))?.record;
                const candidates = currentSentence && normalize(currentSentence) !== normalize(word) ? exactRecords.filter((item) => {
                        const record = item?.record;
                        const entry = record?.entry;
                        return entry && normalize(entry.word) === normalize(word) &&
                            (entry.language ?? language) === language && normalize(entry.sentence) === normalize(currentSentence);
                    }) : [];
                const sourceMatches = candidates.filter((item) => {
                    const entry = item?.record?.entry;
                    if (!entry) { return false; }
                    if (sourceUrlCurrent && cleanText(entry.url) !== sourceUrlCurrent) { return false; }
                    if (sourceTitleCurrent && cleanText(entry.title) && cleanText(entry.title) !== sourceTitleCurrent) { return false; }
                    if (typeof sourceTimeCurrent === 'number' && typeof entry.videoTime === 'number' && Math.floor(entry.videoTime) !== Math.floor(sourceTimeCurrent)) { return false; }
                    return true;
                });
                const matchingRecord = requestedRecord || (sourceMatches.length === 1 ? sourceMatches[0]?.record : null);
                if (matchingRecord && validId(matchingRecord.id)) {
                    context.dataset.studyRecordId = matchingRecord.id;
                    context.dispatchEvent(new d.defaultView.CustomEvent('study-record-current', {detail: matchingRecord}));
                }
                const coverage = memory?.coverage?.status || 'unavailable';
                const anki = memory?.anki || {status: 'unavailable', items: []};
                const knownNoteIds = new Set(exactRecords.flatMap((item) => asArray(item.record?.cards).map((card) => card.noteId)).filter((id) => Number.isSafeInteger(id) && id > 0));
                const namesCurrentWord = (item) => {
                    if (knownNoteIds.has(item.noteId)) { return true; }
                    const front = normalizeWord(item.fields?.Word || item.fields?.Expression || item.fields?.Question || item.fields?.Front).replace(/<[^>]*>/g, ' ');
                    return words.some((term) => {
                        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, 'u').test(front);
                    });
                };
                const cardItems = asArray(anki.items).filter(namesCurrentWord);
                const verifiedNoteIds = [...reconciliation.values()].filter((row) => row?.syncState === 'synced').flatMap((row) => asArray(row.cards).map((card) => card.noteId));
                const noteIds = [...new Set([...verifiedNoteIds, ...cardItems.map((item) => item.noteId)])].filter((id) => Number.isSafeInteger(id) && id > 0);
                const hasNotes = items.length > 0 || exactRecords.length > 0 || memory?.total > 0;
                const hasCards = noteIds.length > 0;
                const noCardsVerified = anki.status === 'complete' && anki.total === 0;
                tabButtons[2].textContent = '我的记录';
                readStatus.textContent = '';
                const noteRow = make('div', 'sf-record-destination');
                const noteUrl = exactRecords.map((item) => cleanText(item.record?.openUrl)).find((url) => /^obsidian:\/\/open\?/.test(url));
                const noteWords = [...new Set([...exactRecords.map((item) => item.record?.entry?.word), ...items.map((item) => item.word)].filter(Boolean))].join('／') || word;
                const notesLabel = `Obsidian · ${noteWords} · ${hasNotes ? '有笔记' : coverage === 'complete' ? '暂无笔记' : '未核实'}`;
                if (noteUrl) {
                    const link = make('a', 'sf-record-jump sf-link scan-disable', `${notesLabel} ↗`);
                    link.href = noteUrl; link.title = '打开当前词最近的原笔记'; noteRow.append(link);
                } else { noteRow.append(make('span', '', notesLabel)); }
                const cardRow = make('div', 'sf-record-destination');
                if (hasCards && display.application?.api?.viewNotes) {
                    const kinds = {meaning: '单词词义', context: '语境词义', expression: '表达', grammar: '语法', sentence: '句子', listening: '听力'};
                    for (const noteId of noteIds) {
                        const linked = exactRecords.flatMap((item) => asArray(item.record?.cards).filter((card) => card.noteId === noteId).map((card) => ({card, word: item.record.entry.word})))[0];
                        const remote = cardItems.find((item) => item.noteId === noteId);
                        const front = cleanText(linked?.card?.front || remote?.fields?.Question || remote?.fields?.Word || remote?.fields?.Front).replace(/<[^>]*>/g, ' ').trim();
                        const kind = kinds[linked?.card?.kind] || '既有卡片';
                        const cardWord = linked?.word || word;
                        const summary = front.length > 56 ? `${front.slice(0, 56)}…` : front;
                        const open = button(`Anki · ${cardWord} · ${kind}\n${summary || '查看卡片'} ↗`, noteIds.length === 1 ? '在 Anki 查看' : `在 Anki 查看卡片 ${noteId}`);
                        open.classList.add('sf-record-jump'); open.title = front || '打开这张卡片';
                        open.addEventListener('click', () => {
                            if (!current()) { return; }
                            void display.application.api.viewNotes([noteId], 'browse', false).catch(() => {
                                if (current()) { readStatus.textContent = '未能打开 Anki，请连接后重试。'; }
                            });
                        });
                        cardRow.append(open);
                    }
                } else {
                    cardRow.append(make('span', '', `Anki · ${word} · ${hasCards ? '有卡片' : noCardsVerified ? '暂无卡片' : '未核实'}`));
                }
                memoryBody.append(noteRow, cardRow);
                const states = [...reconciliation.values(), ...exactRecords.map((item) => item.record)];
                const conflict = states.some((item) => asArray(item?.conflicts).length > 0 || item?.syncState === 'conflict');
                const pending = states.some((item) => item?.syncState === 'pending' || item?.ankiState === 'pending');
                if (conflict || pending || reconcileFailed) {
                    const link = make('a', 'sf-link sf-record-sync scan-disable', conflict ? '同步有冲突 · 去学习库处理 ↗' : pending ? '同步待处理 · 去学习库查看 ↗' : '同步未完成 · 去学习库重试 ↗');
                    link.href = libraryLink.href;
                    link.target = '_blank'; memoryBody.append(link);
                }

            } catch (error) {
                if (current()) { readStatus.textContent = `暂未读回：${error instanceof Error ? error.message : '请稍后重试'}`; }
            } finally { reading = false; if (current()) { refresh.disabled = false; } }
        };
        refresh.addEventListener('click', () => { void readMemory(true, true); });
        const sourceFooter = make('div', 'sf-source-footer');
        const sourceUrl = cleanText(display.history?.state?.url);
        const sourceTitle = cleanText(display.history?.state?.documentTitle) || cleanText(display.history?.state?.title);
        const videoTime = display.history?.state?.videoTime;
        const sourceMeta = make('dl', 'sf-source-meta');
        const addSourceMeta = (label, value, href = '') => {
            if (!value) { return; }
            const row = make('div', 'sf-source-meta-row');
            row.append(make('dt', '', label));
            const description = make('dd', '');
            if (href) {
                const link = make('a', 'sf-link scan-disable', value);
                link.href = href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                description.append(link);
            } else {
                description.textContent = value;
            }
            row.append(description);
            sourceMeta.append(row);
        };
        addSourceMeta('标题', sourceTitle);
        if (/^https?:\/\//.test(sourceUrl)) { addSourceMeta('链接', sourceUrl, sourceUrl); }
        if (sourceMeta.childElementCount) {
            const details = make('details', 'sf-source-details');
            details.append(make('summary', '', '学习来源详情'), sourceMeta);
            sourceFooter.append(details);
        }
        if (typeof videoTime === 'number' && Number.isFinite(videoTime) && videoTime >= 0) {
            const wholeSeconds = Math.floor(videoTime);
            const hours = Math.floor(wholeSeconds / 3600);
            const minutes = Math.floor((wholeSeconds % 3600) / 60);
            const seconds = wholeSeconds % 60;
            sourceFooter.append(make('span', 'sf-source-time', `时间点 · ${hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`}`));
        }
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
        sourcePane.append(sourceFooter); owned.push(sourceFooter);
        // A lookup from our video captions is a different learning object: say so, and
        // offer the clip itself. Ordinary web lookups show none of this.
        const mediaRange = /** @type {{start?: unknown, end?: unknown}|undefined} */ (display.history?.state?.studyMediaRange);
        const mediaToken = cleanText(display.history?.state?.studyMediaToken);
        const fromVideo = typeof videoTime === 'number' && Number.isFinite(videoTime) && videoTime >= 0 && /youtu\.?be/.test(sourceUrl);
        if (fromVideo) {
            /**
             * @param {number} value
             * @returns {string}
             */
            const clock = (value) => {
                const whole = Math.max(0, Math.floor(value));
                const hours = Math.floor(whole / 3600);
                const rest = `${Math.floor((whole % 3600) / 60)}:${String(whole % 60).padStart(2, '0')}`;
                return hours ? `${hours}:${rest.padStart(5, '0')}` : rest;
            };
            const start = typeof mediaRange?.start === 'number' ? mediaRange.start : /** @type {number} */ (videoTime);
            const end = typeof mediaRange?.end === 'number' ? mediaRange.end : null;
            const strip = make('div', 'sf-video-strip scan-disable');
            strip.append(make('span', 'sf-video-badge', '视频语境'), make('span', 'sf-video-range', end === null ? clock(start) : `${clock(start)}–${clock(end)}`));
            const stripStatus = make('span', 'sf-video-status');
            stripStatus.setAttribute('role', 'status');
            if (mediaToken && end !== null) {
                const replay = button('▶ 回听本句', '在视频里回放这一句');
                replay.addEventListener('click', () => {
                    if (!current()) { return; }
                    stripStatus.textContent = '';
                    void Promise.resolve(display.invokeContentOrigin('frontendPlayStudyClip', {token: mediaToken})).catch((error) => {
                        if (current()) { stripStatus.textContent = error instanceof Error ? error.message : '视频已改变，请回到视频里重新选词。'; }
                    });
                });
                strip.append(replay);
            }
            try {
                const back = new URL(sourceUrl);
                back.searchParams.set('t', `${Math.floor(start)}s`);
                const link = make('a', 'sf-link', '回到视频 ↗');
                link.href = back.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                strip.append(link);
            } catch { /* Without a valid URL the strip still states the clip. */ }
            strip.append(stripStatus);
            sourcePane.prepend(strip); owned.push(strip);
            const tag = make('span', 'sf-video-tag scan-disable', '视频');
            tag.title = '这张词卡来自视频字幕，可回听原句、采集原声和画面';
            title.append(tag); owned.push(tag);
        }
        select(activeTab); updateAnswer(); syncSave();
        const workspace = prepareStudyWorkspace(display, {shell, dictionary, tabs, word});
        void readMemory(false, false);
        dispose = () => {
            workspace.dispose();
            observers.forEach((observer) => observer.disconnect());
            for (const node of formNodes) { node.classList.remove('sf-forms-original'); }
            entry?.removeEventListener('study-dictionary-pagechange', resetDictionaryScroll);
            window.removeEventListener('resize', syncFormsPreview);
            disposeForms();
            for (const [node, state] of referenceStates) {
                node.removeEventListener('toggle', lockReferenceOpen);
                node.open = state.open; node.hidden = state.hidden;
                node.classList.remove('sf-reference-open');
                if (state.summary) {
                    if (state.tabIndex === null) { state.summary.removeAttribute('tabindex'); }
                    else if (typeof state.tabIndex === 'string') { state.summary.setAttribute('tabindex', state.tabIndex); }
                }
            }
            editor?.removeEventListener('change', onSourceEdit);
            sourcePane.removeEventListener('input', resizeEditors);
            editSource?.removeEventListener('toggle', resizeEditors);
            for (const [field, height] of editorHeights) { field.style.height = height; }
            input?.removeEventListener('input', resizeFollowup);
            window.removeEventListener('resize', resizeFollowup);
            window.removeEventListener('resize', resizeEditors);
            if (input && inputOriginal) {
                if (inputOriginal.rows === null) { input.removeAttribute('rows'); } else { input.setAttribute('rows', inputOriginal.rows); }
                input.style.height = inputOriginal.height;
            }
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
            for (const [label, text] of quickLabels) { label.textContent = text; }
            d.documentElement.classList.remove('study-focus-active', 'sf-search-open');
        };
    });
}
