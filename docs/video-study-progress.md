# Video study integration progress

Claude implements this plan end to end, front end and back end, by the user's
explicit exception to the usual split (2026-10-20). GPT continues from GitHub
main as usual. Plan summary: our own in-video captions and sidebar replace
KISS and asbplayer on YouTube, then card types and mastery stages, video card
media, the note format and automatic two-way sync.

## Done

- Batch 1 — one caption controller with two views.
  - `YoutubeReader` (`ext/js/study/youtube-reader.js`) is now the controller.
    It extends `EventTarget` and emits `session`, `reset`, `active`, `lookup`,
    `loop`, `translation` and `prefs`; the sidebar is rendered by it and the
    new in-video view subscribes, so lookup, loop, blur and translations agree.
  - `ext/js/study/youtube-overlay.js`: our bilingual captions inside
    `#movie_player` (kept in fullscreen, sized with the player). YouTube's own
    caption window is hidden while ours is on. The English line is registered
    with `youtubeStudyContext` exactly like a sidebar row, so selecting a word
    opens the word card. Lines stay connected (hidden) after playback moves
    on, so a lookup token stays valid for later audio capture. The caption
    holds still while the pointer rests on it. A player-bar button opens a
    settings panel: in-video captions, bilingual, blurred translation, merge
    into sentences, load, translate next 8, show in sidebar, downloads.
  - Merging: `groupForReading` builds a reading session; each row keeps its
    original cue IDs (`reader.members(id)`) and original times. Downloads keep
    the raw track for VTT, the reading rows for bilingual VTT, and both in
    JSON.
  - The sidebar stays first in `#secondary-inner` (a MutationObserver moves it
    back when YouTube inserts panels). Display options and downloads moved to
    a "⋯" menu.
  - `ext/js/study/subtitle-prefs.js`: shared preferences in
    `chrome.storage.local` under `studySubtitlePrefs` (overlay, bilingual,
    blur, merge, aiSegment, autoTranslate, engine, aheadSeconds). The engine
    and automatic translation are wired in batch 2.

## Next

- Batch 2 — free translation services (Chrome built-in, Apple, Google,
  Microsoft Edge; model optional), automatic translation ahead of playback,
  AI segmentation, settings page section.

## Not verified

- Real YouTube with the installed extension: the user reloads the extension.
  Checked here in jsdom tests, a fixture player page and the existing real
  MediaRecorder wiring test.
