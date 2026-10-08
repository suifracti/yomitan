/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2019-2022  Yomichan Authors
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

import {Application} from '../application.js';
import {DocumentFocusController} from '../dom/document-focus-controller.js';
import {HotkeyHandler} from '../input/hotkey-handler.js';
import {ModalController} from '../pages/settings/modal-controller.js';
import {SettingsController} from '../pages/settings/settings-controller.js';
import {SettingsDisplayController} from '../pages/settings/settings-display-controller.js';
import {DisplayAnki} from './display-anki.js';
import {DisplayAudio} from './display-audio.js';
import {Display} from './display.js';
import {SearchActionPopupController} from './search-action-popup-controller.js';
import {SearchDisplayController} from './search-display-controller.js';
import {prepareStudyCard} from './study-card.js';
import {studyCall} from '../study/study-client.js';
import {SearchPersistentStateController} from './search-persistent-state-controller.js';

await Application.main(true, async (application) => {
    const detailId = new URL(location.href).searchParams.get('studyDetail');
    if (detailId) { document.documentElement.dataset.studyDetail = 'true'; }
    const documentFocusController = new DocumentFocusController('#search-textbox');
    documentFocusController.prepare();

    const searchPersistentStateController = new SearchPersistentStateController();
    searchPersistentStateController.prepare();

    const searchActionPopupController = new SearchActionPopupController(searchPersistentStateController);
    searchActionPopupController.prepare();

    const hotkeyHandler = new HotkeyHandler();
    hotkeyHandler.prepare(application.crossFrame);

    const display = new Display(application, 'search', documentFocusController, hotkeyHandler);
    await display.prepare();

    const displayAudio = new DisplayAudio(display);
    displayAudio.prepare();

    const displayAnki = new DisplayAnki(display, displayAudio);
    displayAnki.prepare();

    const searchDisplayController = new SearchDisplayController(display, displayAudio, searchPersistentStateController);
    await searchDisplayController.prepare();

    const modalController = new ModalController([]);
    await modalController.prepare();

    const settingsController = new SettingsController(application);
    await settingsController.prepare();

    const settingsDisplayController = new SettingsDisplayController(settingsController, modalController);
    await settingsDisplayController.prepare();

    document.body.hidden = false;

    documentFocusController.focusElement();

    if (detailId) {
        prepareStudyCard(display, true);
        const heading = document.querySelector('#study-detail-heading');
        if (heading instanceof HTMLElement) { heading.hidden = false; }
        const search = document.querySelector('#search-textbox');
        if (search instanceof HTMLTextAreaElement) { search.placeholder = '查另一个词（新查词不沿用上一句语境）'; }
        try {
            const snapshot = /** @type {?import('study').DetailSnapshot} */ (await studyCall('detail', {id: detailId}));
            if (!snapshot) { throw new Error('此详解的本地语境已过期；请从原网页重新打开。'); }
            const s = snapshot.source;
            display.setContent({focus: false,
                historyMode: 'overwrite',
                params: {type: 'terms', query: s.word, studyDetail: detailId},
                state: {sentence: {text: s.sentence, offset: s.offset, adjacent: s.context},
                    url: s.url,
                    documentTitle: s.title,
                    videoTime: s.videoTime,
                    optionsContext: s.profileIndex === void 0 ? {url: s.url, depth: 0} : {index: s.profileIndex}},
                content: {}});
        } catch (error) {
            if (heading instanceof HTMLElement) { heading.textContent = error instanceof Error ? error.message : '无法恢复详解语境。'; }
        }
    } else { display.initializeState(); }

    document.documentElement.dataset.loaded = 'true';
});
