/*
 * Copyright (C) 2023-2026  Yomitan Authors
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

// Generated from local-bridge/study_protocol.py by dev/sync-local.py --manifest-only.
export const NATIVE_ROUTES = /** @type {const} */ ({
    librarySettingsGet: 'target',
    librarySettingsSave: 'target',
    librarySettingsCheck: 'target',
    librarySettingsPrepare: 'target',
    librarySettingsOpen: 'target',
    libraryPrepareJapanese: 'library',
    libraryMedia: 'library',
    libraryAudioRead: 'library',
    libraryList: 'library',
    librarySync: 'library',
    libraryEnrich: 'library',
    libraryRead: 'library',
    libraryMemory: 'library',
    libraryCards: 'library',
    libraryDraftSave: 'library',
    libraryDraftDiscard: 'library',
    libraryDraftCommit: 'library',
    libraryReconcile: 'library',
    libraryRepair: 'library',
    libraryOrphan: 'library',
    libraryCardsAdd: 'library',
    libraryFavorite: 'library',
    libraryUpdate: 'library',
    libraryVideoWords: 'library',
    libraryVideoSummary: 'library',
    libraryWordSenses: 'library',
    libraryContextMiss: 'library',
    libraryMarkKnown: 'library',
    knownWords: 'library',
    senseMatch: 'library',
    ankiToday: 'library',
    ankiOpen: 'library',
    bridgeHealth: 'library',
    practiceCheck: 'library',
});
