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

- Batch 2 — caption translation services and automation.

  - The background reads the service from `studySubtitlePrefs` (never from the
    page) in `subtitle-translation.js`; cache keys are namespaced per service
    (`subtitle:<engine>:…`, the model keeps its original keys).
  - Services (`ext/js/study/free-translators.js`): Google's public page
    translation endpoint (`translate-pa.googleapis.com/v1/translateHtml`,
    batched; checked live), Microsoft Edge's free token endpoint (returned 404
    from this network; the settings test button reports it), Chrome's
    on-device Translator (runs in the page; default service), Apple's
    on-device Translation framework through the bridge, and the model.
  - Apple: `local-bridge/apple-translate/main.swift` (compiled by
    `install_bridge.py` with swiftc) and `local-bridge/study_apple_translate.py`;
    new native action `appleTranslate`. Checked live through the installed
    bridge ("Keep going." → "继续。").
  - AI segmentation: native action `segment` (model; returns ID groups only,
    validated to cover every cue in order) and `subtitleSegment` in the
    background. The reader sends windows of up to 60 cues, re-sends each
    window's last group with the next one, and keeps rule grouping on any
    invalid answer. Results stay in page memory for that track.
  - Automatic translation keeps `aheadSeconds` of rows translated ahead of
    playback, pauses in background tabs and backs off 20 s after a failure.
  - The native-messaging permission is only required for the model and Apple.
  - Settings page: "视频字幕" section in AI 与翻译 (service with data
    destination and cost, test button, automation and display switches). The
    player panel and sidebar menu also pick the service.
  - The installed bridge received `study_translator.py`,
    `study_apple_translate.py` and the compiled `apple-translate`. The
    installer's `install-metadata.json` was already stale for several files
    before this batch (direct syncs); a full reinstall will need it refreshed.

- Batch 3 — card types by stage and mastery.

  - `ext/js/display/study-card-kinds.js`: 12 kinds in three stages (① 认得:
    meaning, listen-meaning, form-recognize; ② 理解: context, sentence,
    listening; ③ 会用: produce, cloze, form-produce, make-sentence,
    expression, spelling), prerequisites (sentence, audio, forms, translation),
    draft texts, recommendations per mastery and deck routing (new kinds use
    their stage's subdeck; ③ goes to the new `produce` subdeck).
  - Card panel (`study-library.js`): mastery picker (完全不会 / 有印象/模糊 /
    认识但不会用) pre-drafts the recommended cards once; stage-grouped type
    buttons explain missing prerequisites. Nothing is sent before 添加已选卡片.
  - Back end: `libraryCardsAdd` accepts optional `mastery`; records keep it,
    the note gets a 掌握程度 line, cards get `study_stage::N` and
    `study_mastery::…` tags. For 认识但不会用, newly created stage-1 cards are
    moved 3–7 days out with AnkiConnect `setDueDate`; existing cards are never
    rescheduled. Audio is required for every audio kind.
  - Settings: fourth subdeck 会用（产出）; "套用四个子牌组".
  - The upgrade reminder (stage ①/② cards with long intervals) depends on the
    automatic sync reading intervals and lands with batch 5.

- Batch 4 — video word cards and media.
  - Word card: a lookup from our captions shows a "视频语境" strip (clip range,
    "▶ 回听本句", "回到视频" with `t=`) and a "视频" tag by the headword.
    Replay goes through the new cross-frame call `frontendPlayStudyClip` to
    `youtubeStudyContext.play(token)`, which plays only that sentence and
    pauses at its end (a jump elsewhere just ends the replay).
  - Capture (`audio-capture.js`): optional frame from the middle of the
    sentence (JPEG, max 960 px wide) and optional WebM clip of the sentence
    (`video/webm`, ~700 kbps, up to 8 MB). Card panel switches: 同时保存画面截图
    (on), 附带原句视频片段（较大） (off). Checked in real Chrome: audio, frame and
    clip all recorded from a generated video.
  - Bridge (`study_media.py`): `video/webm` accepted (8 MB; audio and images
    keep 2 MB), up to three assets per capture, note embeds 视频片段. In Anki
    the clip goes into the Audio field as `[sound:…webm]` (it carries the
    audio); the frame goes into Image. Native frame limit raised to 16 MB.
  - Cards and notes keep only original times (cue start/end of the reading
    row), so later regrouping never changes an existing clip.
  - 本视频生词: sidebar tab backed by the read-only `libraryVideoWords`
    action (`study_settings.video_words`), allowed for the watch page's own
    video only (the background checks the `v` of the sender URL). Each word
    shows its time, cards and stage; clicking returns to that moment.

## Next

- Batch 5 — note format (clickable time range, mastery, cards) and automatic
  two-way Obsidian↔Anki sync every ~30 s, plus the upgrade reminder.

## Not verified

- Real YouTube with the installed extension: the user reloads the extension.
  Checked here in jsdom tests, a fixture player page and the existing real
  MediaRecorder wiring test.
