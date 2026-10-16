#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Existing guarded storage API, with a readable grouped-note presentation.

The original module is retained byte-for-byte as study_library_core.py. This
small public wrapper changes presentation only; identities, locking, validation,
Anki operations and media/source restrictions remain the same implementation.
"""
from study_library_core import *  # Re-export the established API for existing callers.
from study_library_core import StudyLibrary as GuardedStudyLibrary
import study_note_view


class StudyLibrary(GuardedStudyLibrary):
    def context_block(self, record, body):
        return study_note_view.context_block(self, record, body)

    def word_contexts(self, content):
        return study_note_view.word_contexts(self, content)

    def _legacy_draft_block(self, draft, record=None):
        return super().draft_block(draft, record)

    def draft_block(self, draft, record=None):
        return study_note_view.draft_block(self, draft, record)

    def without_draft(self, record, body):
        return study_note_view.without_draft(self, record, body)
