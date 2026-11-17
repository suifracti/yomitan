# SPDX-License-Identifier: GPL-3.0-or-later
"""Vocabulary for the extension's native learning API; names are not caller permissions."""

# The five target routes return a settings snapshot, not a learning record.
TARGET_ROUTES = ('librarySettingsGet', 'librarySettingsSave', 'librarySettingsCheck',
                 'librarySettingsPrepare', 'librarySettingsOpen')
RECORD_ROUTES = (
    'libraryPrepareJapanese', 'libraryMedia', 'libraryList', 'librarySync', 'libraryEnrich',
    'libraryRead', 'libraryMemory', 'libraryCards', 'libraryDraftSave', 'libraryDraftDiscard',
    'libraryDraftCommit', 'libraryReconcile', 'libraryRepair', 'libraryOrphan', 'libraryCardsAdd',
    'libraryFavorite', 'libraryUpdate', 'libraryVideoWords', 'libraryVideoSummary', 'libraryWordSenses',
    'libraryContextMiss', 'libraryMarkKnown', 'knownWords',
)
# These use the same response envelope but have dedicated validators/handlers in the native host.
TOOL_ROUTES = ('senseMatch', 'ankiToday', 'ankiOpen', 'bridgeHealth', 'practiceCheck')
DIRECT_ROUTES = {**dict.fromkeys(TARGET_ROUTES, 'target'), **dict.fromkeys((*RECORD_ROUTES, *TOOL_ROUTES), 'library')}

# Only used inside the bridge or a dedicated worker operation; never forwarded
# via the generic extension route. Save must still pass through the journal.
SETTINGS_ACTIONS = frozenset((*TARGET_ROUTES, 'libraryTargetResolve', 'librarySettingsDetect', 'librarySettingsPick'))
LIBRARY_ACTIONS = SETTINGS_ACTIONS.union(RECORD_ROUTES, ('librarySave', 'libraryAutoSync', 'libraryWordStatus'))
