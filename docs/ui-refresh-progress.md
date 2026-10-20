# UI refresh progress (paper reading)

Claude owns this front-end refresh. Back-end logic, data formats and save/sync
behavior are unchanged. Plan summary: one shared token file, then three
batches — word card and card making, YouTube caption panel, study library and
settings.

## Done

- Step 1.1 — `ext/js/study/study-tokens.css` is the single palette, type and
  spacing source. Light paper and dark "night paper" variants. The old
  `--sf-*` (word card), `--study-*` (popup, settings) variables now resolve to
  `--st-*` tokens. The tokens file is linked from popup, search, settings and
  the study library page. Word card: serif headword and source sentence,
  highlighter mark on the looked-up word, translation at near-English size in
  ink color, the question shown as a "你问：…" heading over the full-width
  answer, "记住它" and "制卡" as one equally visible pair, current word tab
  always shows ×.

- Step 1.2 — card-making panel: card types as pill choices; each editor shows
  front and back together (side by side when the panel is at least 420px,
  stacked when narrower). The video card shows an explicit audio state line
  (未采集 / 采集中… / 采集失败 / 已保存，可制卡) with the clip range, next
  to the existing capture button.

- Batch 2 — YouTube caption panel (`ext/js/study/youtube-reader.js`, UI
  only; translation, capture and cancel logic untouched). The panel root
  carries `st-scope` and links the tokens file through
  `chrome.runtime.getURL`, with fallbacks if it has not loaded. Serif English,
  Chinese translation in ink at near-English size, current line marked with a
  tint and left bar (size and line height never change). Separate states:
  playing (`is-current`), the sentence bound to the word card (`is-lookup`,
  highlighter underline) and looping (`is-looping`). "循环" is a row tool
  outside the sentence node; it reuses `session.seekSeconds()` and exits on a
  second click, a jump elsewhere, another row's seek, video switch or
  re-render, a replaced video element, or a word lookup (so audio capture
  never fights the loop). Selecting text pauses follow. Progress reads
  "已译 x/y"; the translate button's tooltip says it starts from the current
  playback position. The status line wraps under the buttons.

- Step 3.1 — study library as a retrieval list. Rows are unboxed with
  hairlines: word (serif) on the left; sentence with the studied word
  highlighted, source and state in the middle; "继续学习" and "详情" on the
  right. "详情" opens the row in place to show context, record details and the
  less frequent actions (note, Anki, favorite, sync). Conflicts always show.
  Filters are pills, the status is a single line, the shared top nav marks
  the current page with an underline. Deviation from the plan: details open
  inline rather than in a right-hand pane, to keep `pages/study-library.js`
  changes small (two helpers, no data flow changes).

- Step 3.2 — settings page: the existing Yomitan left nav and right form are
  kept; study panels lose their card boxes in favor of hairline sections with
  serif headings, inputs sit on the sheet color, the floating save bar keeps a
  shadow so its saved/unsaved state stays readable, and the top nav matches
  the library. Apply-then-save and "创建缺少的牌组" behavior is unchanged.

- Follow-up — word forms on the word card are separate chips. Hovering or
  focusing a chip explains that form (e.g. "bricks · brick 的复数"): what the
  form is used for, the matching Chinese sense from the card (or a plain note
  that the card lists no sense for that part of speech), and a dictionary
  example that uses the exact form when one exists. A click pins the note;
  Escape or a click elsewhere closes it. "翻译例句" translates the example on
  request through the existing sentence translation service
  (`subtitleTranslate`); results stay in memory for the card. Clicking a form
  no longer opens the dictionary card. Rules live in
  `ext/js/display/study-word-forms.js`.

## Status

All three batches are done. Scheduled resume runs should only verify (fetch,
tests, daily directory byte check) and not start new work.

## Verification (final)

- `tsc -p jsconfig.json`: per-file diagnostic counts identical to the
  baseline before the refresh.
- eslint, stylelint and html-validate are clean on new and changed code;
  pre-existing errors in older study CSS/JS are unchanged in count.
- vitest: reader, subtitle session and library page suites (42 tests).
- `test-study-flexible-cards.mjs` (9), `test_study_focus_browser.py` (105),
  `test_study_workspace_browser.py` (33).
- Fixture screenshots checked: word card 320/400×250/420/720 light and dark,
  card editor 320 and 720, caption panel light and dark, library 380 and 900,
  settings 420 and 1100.

## Not verified

- The real extension in Chrome (word card, card making, caption panel on a
  live YouTube page, library and settings with real data) — waits for the
  user.
- The settings page base background still follows Yomitan's own palette;
  only the study panels use the paper tokens.

## Caveats

- The browser tests inject the tokens file explicitly
  (`test_study_focus_browser.py`, `test_study_workspace_browser.py`).
- Pre-existing stylelint and eslint errors in the older study files are
  unchanged in count; new files are lint-clean.
- Real Chrome extension acceptance is still pending (user). The YouTube
  panel was checked in a fixture page with the bundled module; real-YouTube
  injection was blocked by the page's CSP this time, and the host placement
  code is unchanged from the earlier real-page check.
