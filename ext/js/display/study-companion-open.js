// @ts-nocheck
import {studyCall} from '../study/study-client.js';
export function mountStudyCompanion(display, container, sentence) {
    if (!sentence || ['studySubtitle', 'subtitle', 'subtitleSource'].some(key => key in sentence) ||
        (sentence.sourceKind !== undefined && sentence.sourceKind !== 'web') || !/[A-Za-z]/.test(display.query) || /\p{Cc}/u.test(display.query)) { return; }
    // One explicit selection keeps its identity across a lost reply and retry.
    const captureID = crypto.randomUUID();
    const action = document.createElement('button');
    action.type = 'button'; action.className = 'scan-disable'; action.textContent = '在伴学 App 学习';
    const status = document.createElement('p');status.setAttribute('role', 'status');
    action.addEventListener('click', () => {
        const card = document.querySelector('.entry-current') ?? document.querySelector('.study-entry');
        const text = selector => card?.querySelector(selector)?.textContent?.trim() ?? '';
        const meanings = text('[data-sc-study-role=meaning]');
        const english = text('.study-primary-english') || text('[data-sc-study-role=english]');
        const dictionary = {phonetic: text('.study-quick-phonetic'), meanings: [meanings, english].filter(Boolean).join('\n'),
            details: (card?.textContent ?? '').slice(0, 20000)};
        const entry = {language: 'en', word: display.query, sentence: sentence.text,
            context: typeof sentence.adjacent === 'string' ? sentence.adjacent : '', meaning: meanings, translation: '', notes: '',
            dictionaryNotes: [meanings, english].filter(Boolean).join('\n').slice(0, 4000),
            url: display.history.state?.url ?? '', title: display.history.state?.documentTitle ?? ''};
        action.disabled = true;
        void studyCall('companionOpen', {captureID, entry, dictionary, optionsContext: display.getOptionsContext()})
            .then(() => {status.textContent = '已发送到伴学 App；尚未保存或调用 AI。当前文章和词典保持不变。';})
            .catch(error => {status.textContent = error.message;})
            .finally(() => {action.disabled = false;});
    });
    (container.querySelector('.study-translation-actions') ?? container).append(action);
    container.append(status);
}
