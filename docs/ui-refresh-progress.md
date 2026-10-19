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

## Next

- Batch 2 — YouTube caption panel (UI only).
- Batch 3 — study library list with detail pane; settings left nav.

## Caveats

- The browser tests inject the tokens file explicitly
  (`test_study_focus_browser.py`, `test_study_workspace_browser.py`).
- Pre-existing stylelint and eslint errors in the older study files are
  unchanged in count; new files are lint-clean.
- Real Chrome extension acceptance is still pending (user).
