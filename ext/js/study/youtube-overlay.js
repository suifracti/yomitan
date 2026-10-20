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

/*
 * Our captions inside the YouTube player, plus a player-bar button and settings panel.
 * This is only a view: the caption controller (YoutubeReader) owns the session,
 * playback position, lookup, loop and translations, so the sidebar and the video
 * always agree. The English line is ordinary page text registered with the same
 * study context as the sidebar row, so selecting a word opens the existing card.
 */
import {ENGINE_LABELS} from './free-translators.js';
import {youtubeStudyContext} from './youtube-study-context.js';
import {youtubeSite} from './youtube-site.js';

const OVERLAY_ID = 'study-yt-overlay';
const BUTTON_ID = 'study-yt-button';
const PANEL_ID = 'study-yt-panel';
const STYLE_ID = 'study-yt-overlay-style';
const ACTIVE_CLASS = 'study-captions-on';

const STYLE = `
#movie_player.${ACTIVE_CLASS} .ytp-caption-window-container{display:none!important}
#${OVERLAY_ID}{position:absolute;left:50%;bottom:8%;z-index:60;transform:translateX(-50%);width:min(88%,1100px);display:flex;justify-content:center;pointer-events:none;transition:bottom 160ms}
#movie_player:not(.ytp-autohide) #${OVERLAY_ID}{bottom:calc(8% + 44px)}
#${OVERLAY_ID}[hidden]{display:none}
#${OVERLAY_ID} .o-line{position:relative;display:flex;flex-direction:column;align-items:center;max-width:100%;padding:.25em .7em .3em;border-radius:6px;background:rgb(8 8 10 / 72%);color:#fff;text-align:center;pointer-events:auto;user-select:text;-webkit-user-select:text;cursor:text}
#${OVERLAY_ID} .o-line[hidden]{display:none}
#${OVERLAY_ID} .o-text{margin:0;font-family:'Iowan Old Style',Georgia,serif;font-size:1em;line-height:1.35;white-space:pre-line;overflow-wrap:anywhere}
#${OVERLAY_ID} .o-zh{margin:.1em 0 0;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;font-size:.86em;line-height:1.4;color:#f3e7c4;white-space:pre-wrap}
#${OVERLAY_ID} .o-zh:empty{display:none}
#${OVERLAY_ID}.o-mono .o-zh{display:none}
#${OVERLAY_ID}.o-blur .o-zh:not(.is-revealed){filter:blur(6px);cursor:pointer}
#${OVERLAY_ID}.o-blur .o-line:hover .o-zh{filter:none}
#${OVERLAY_ID} .o-line.is-lookup .o-text{text-decoration:underline 2px rgb(255 214 92 / 80%);text-underline-offset:.2em}
#${OVERLAY_ID} .o-line.is-looping{box-shadow:inset 3px 0 #a9b6ef}
#${OVERLAY_ID} .o-side{position:absolute;top:2px;right:-30px;display:flex;flex-direction:column;gap:2px;opacity:0;transition:opacity 120ms}
#${OVERLAY_ID} .o-line:hover .o-side,#${OVERLAY_ID} .o-side:focus-within{opacity:1}
#${OVERLAY_ID} .o-side button{width:26px;height:22px;padding:0;border:0;border-radius:4px;background:rgb(8 8 10 / 72%);color:#fff;font:13px/22px -apple-system,sans-serif;cursor:pointer}
#${OVERLAY_ID} .o-side button[aria-pressed=true]{color:#a9b6ef}
#${OVERLAY_ID} .o-chip{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:3px 6px 3px 10px;border-radius:999px;background:rgb(8 8 10 / 72%);color:#eee;font:13px/1.4 -apple-system,'PingFang SC',sans-serif;white-space:nowrap;pointer-events:auto}
#${OVERLAY_ID} .o-chip[hidden]{display:none}
#${OVERLAY_ID} .o-chip button{padding:1px 8px;border:1px solid rgb(255 255 255 / 30%);border-radius:999px;background:none;color:#fff;font:inherit;font-size:12px;cursor:pointer}
#${OVERLAY_ID} .o-chip button[hidden]{display:none}
#${PANEL_ID} .p-offset button{padding:1px 7px;border:1px solid rgb(255 255 255 / 22%);border-radius:5px;background:none;color:#eee;font:inherit;font-size:12px;cursor:pointer}
#${PANEL_ID} .p-offset button:disabled{opacity:.45;cursor:default}
#${PANEL_ID} .p-offset output{min-width:4.5em;text-align:center;font-variant-numeric:tabular-nums}
#${BUTTON_ID}{display:inline-flex;align-items:center;justify-content:center;width:48px;opacity:.9}
#${BUTTON_ID} svg{width:24px;height:24px}
#${BUTTON_ID}[aria-expanded=true]{opacity:1}
#${PANEL_ID}{position:absolute;right:12px;bottom:60px;z-index:70;width:250px;max-height:calc(100% - 80px);overflow:auto;padding:6px 0;border-radius:10px;background:rgb(28 28 30 / 94%);color:#eee;font:13px/1.4 -apple-system,'PingFang SC',sans-serif;box-shadow:0 6px 20px rgb(0 0 0 / 40%)}
#${PANEL_ID}[hidden]{display:none}
#${PANEL_ID} .p-row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:34px;padding:0 14px;cursor:pointer}
#${PANEL_ID} .p-row:hover{background:rgb(255 255 255 / 8%)}
#${PANEL_ID} .p-row select{max-width:130px;padding:2px 4px;border:1px solid rgb(255 255 255 / 25%);border-radius:5px;background:#2a2a2e;color:#eee;font:inherit;font-size:12px}
#${PANEL_ID} .p-row input{width:34px;height:18px;margin:0;accent-color:#a9b6ef;cursor:pointer}
#${PANEL_ID} .p-note{padding:2px 14px 6px;color:#aaa;font-size:12px}
#${PANEL_ID} .p-actions{display:flex;flex-wrap:wrap;gap:6px;padding:6px 14px 4px;border-top:1px solid rgb(255 255 255 / 12%)}
#${PANEL_ID} .p-actions button{padding:4px 9px;border:1px solid rgb(255 255 255 / 22%);border-radius:6px;background:none;color:#eee;font:inherit;font-size:12px;cursor:pointer}
#${PANEL_ID} .p-actions button:hover:not(:disabled){border-color:#a9b6ef;color:#fff}
#${PANEL_ID} .p-actions button:disabled{opacity:.45;cursor:default}
`;

/** Events that must not reach the player (it would toggle playback or hide controls). */
const ISOLATED_EVENTS = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'contextmenu', 'wheel'];

export class YoutubeOverlay {
    /**
     * @param {import('./youtube-reader.js').YoutubeReader} reader
     * @param {import('./youtube-reader.js').ReaderSite} [site]
     */
    constructor(reader, site = youtubeSite) {
        /** @type {import('./youtube-reader.js').YoutubeReader} */
        this._reader = reader;
        /** @type {import('./youtube-reader.js').ReaderSite} */
        this._site = site;
        /** @type {Map<string, HTMLElement>} Lines stay connected (only hidden) so a lookup token stays valid. */
        this._lines = new Map();
        /** @type {string} */
        this._shown = '';
        /** @type {string} */
        this._pending = '';
        /** @type {boolean} */
        this._hold = false;
        /** @type {HTMLElement|null} */
        this._overlay = null;
        /** @type {HTMLElement|null} */
        this._panel = null;
        /** @type {HTMLButtonElement|null} */
        this._button = null;
        /** @type {ResizeObserver|null} */
        this._resize = null;
        /** @type {number} */
        this._timer = 0;
        /** @type {HTMLElement|null} One short hint above the captions (resume, shadowing pause). */
        this._chip = null;
        /** @type {number} */
        this._chipTimer = 0;
    }

    /** */
    start() {
        const reader = this._reader;
        reader.addEventListener('session', () => this._onSession());
        reader.addEventListener('reset', () => this._clear());
        reader.addEventListener('active', (event) => this._onActive(/** @type {CustomEvent<{ids: string[]}>} */ (event).detail.ids));
        reader.addEventListener('translation', (event) => this._onTranslation(/** @type {CustomEvent<{id: string}>} */ (event).detail.id));
        reader.addEventListener('lookup', () => this._paintStates());
        reader.addEventListener('loop', () => this._paintStates());
        reader.addEventListener('prefs', () => this._applyPrefs());
        reader.addEventListener('offset', () => this._applyPrefs());
        reader.addEventListener('resume', (event) => {
            const {ms} = /** @type {CustomEvent<{ms: number}>} */ (event).detail;
            if (ms < 0) {
                this._hint('');
            } else {
                this._hint(`上次学到 ${clock(ms)}`, '继续', () => reader.resume(), 12000);
            }
        });
        reader.addEventListener('shadow', () => this._hint('跟读：说完这句，再按播放继续', '', null, 4000));
        document.addEventListener('pointerdown', (event) => {
            const target = /** @type {Node} */ (event.target);
            if (this._panel && !this._panel.hidden && !this._panel.contains(target) && !this._button?.contains(target)) { this._togglePanel(false); }
        }, true);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this._panel && !this._panel.hidden) { this._togglePanel(false); }
        }, true);
        // The player is rebuilt on some navigations; re-attach our nodes when that happens.
        this._timer = window.setInterval(() => this._ensureMounted(), 1500);
        this._ensureMounted();
    }

    /** @returns {HTMLElement|null} */
    _player() { return this._site.player(); }

    /** */
    _ensureMounted() {
        if (!this._site.active()) { return; }
        const player = this._player();
        if (!player) { return; }
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = STYLE;
            document.head.append(style);
        }
        const controls = this._site.controls();
        if (controls && !this._button?.isConnected) {
            this._button = this._makeButton();
            controls.prepend(this._button);
        }
        if (!this._panel?.isConnected) {
            this._panel = this._makePanel();
            player.append(this._panel);
        }
        if (!this._overlay?.isConnected) {
            this._overlay = document.createElement('div');
            this._overlay.id = OVERLAY_ID;
            this._overlay.lang = 'en';
            this._overlay.hidden = true;
            isolate(this._overlay);
            this._overlay.addEventListener('pointerenter', () => { this._hold = true; });
            this._overlay.addEventListener('pointerleave', () => {
                this._hold = false;
                this._release();
            });
            this._chip = document.createElement('div');
            this._chip.className = 'o-chip scan-disable';
            this._chip.hidden = true;
            this._chip.setAttribute('role', 'status');
            this._overlay.append(this._chip);
            player.append(this._overlay);
            this._lines.clear();
            this._shown = '';
            this._resize?.disconnect();
            this._resize = new ResizeObserver(() => this._fit());
            this._resize.observe(player);
            this._onSession();
        }
        this._applyPrefs();
    }

    /** Scales the caption font with the player, like YouTube's own captions. */
    _fit() {
        if (!this._overlay) { return; }
        this._overlay.style.fontSize = `${Math.max(14, Math.min(40, this._site.height() * 0.042))}px`;
    }

    /** @returns {HTMLButtonElement} */
    _makeButton() {
        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        // On YouTube this joins the player bar; elsewhere it is a small launcher shown on hover.
        button.className = this._site.kind === 'youtube' ? 'ytp-button' : 'w-launch scan-disable';
        button.setAttribute('aria-label', '字幕学习设置');
        button.setAttribute('aria-expanded', 'false');
        button.title = '字幕学习';
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="12" y="16" text-anchor="middle" font-size="9.5" font-family="PingFang SC,sans-serif" fill="currentColor">学</text></svg>';
        if (this._site.kind !== 'youtube') { isolate(button); }
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            this._togglePanel(Boolean(this._panel?.hidden));
        });
        return button;
    }

    /** @returns {HTMLElement} */
    _makePanel() {
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.className = 'scan-disable';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', '字幕学习设置');
        panel.hidden = true;
        isolate(panel);
        /** @type {[keyof import('./subtitle-prefs.js').SubtitlePrefs, string][]} */
        const toggles = [['overlay', '视频内字幕'], ['bilingual', '双语显示'], ['blur', '模糊译文'], ['merge', '合并成整句'], ['aiSegment', 'AI 断句（用模型）'], ['shadow', '跟读（每句后暂停）']];
        const engine = translationSettingsLink();
        engine.classList.add('p-row');
        panel.append(engine);
        for (const [key, label] of toggles) {
            const row = document.createElement('label');
            row.className = 'p-row';
            const text = document.createElement('span');
            text.textContent = label;
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.setAttribute('role', 'switch');
            box.dataset.pref = key;
            box.addEventListener('change', () => this._reader.updatePrefs({[key]: box.checked}));
            row.append(text, box);
            panel.append(row);
        }
        const repeats = repeatSelect((shadowRepeats) => this._reader.updatePrefs({shadowRepeats}));
        repeats.classList.add('p-row');
        const offset = offsetControl(this._reader);
        offset.classList.add('p-row', 'p-offset');
        panel.append(repeats, offset);
        const note = document.createElement('div');
        note.className = 'p-note';
        note.dataset.note = '';
        panel.append(note);
        const actions = document.createElement('div');
        actions.className = 'p-actions';
        /** @type {[string, string, () => void][]} */
        const buttons = [
            ['load', '重新载入', () => this._reader.loadCaptions()],
            ['import', '导入字幕文件…', () => this._reader.pickFile()],
            ['translate', '翻译全文', () => this._reader.translateNext()],
            ['reveal', '在侧栏查看', () => { if (this._shown) { this._reader.revealRow(this._shown); } }],
            ['vtt', '下载原文 VTT', () => this._reader.download('vtt')],
            ['bilingual', '下载双语 VTT', () => this._reader.download('bilingual')],
            ['json', '下载 JSON', () => this._reader.download('json')],
        ];
        if (this._site.kind !== 'youtube') {
            buttons.splice(3, 1, ['dock', '字幕栏', () => {
                const open = this._site.toggleDock();
                if (open && this._shown) { this._reader.revealRow(this._shown); }
                this._applyPrefs();
            }]);
        }
        for (const [name, label, action] of buttons) {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.action = name;
            button.textContent = label;
            button.addEventListener('click', action);
            actions.append(button);
        }
        panel.append(actions);
        return panel;
    }

    /** @param {boolean} open */
    _togglePanel(open) {
        if (!this._panel) { return; }
        this._panel.hidden = !open;
        this._button?.setAttribute('aria-expanded', String(open));
        if (open) { this._applyPrefs(); }
    }

    /** Mirrors preferences and session state into the overlay and the panel. */
    _applyPrefs() {
        const prefs = this._reader.prefs;
        const loaded = this._reader.session !== null;
        this._site.hideNative(prefs.overlay && loaded);
        if (this._overlay) {
            this._overlay.hidden = (!prefs.overlay || !loaded || !this._shown) && (this._chip?.hidden ?? true);
            this._overlay.classList.toggle('o-mono', !prefs.bilingual);
            this._overlay.classList.toggle('o-blur', prefs.blur);
        }
        if (this._panel) {
            for (const box of this._panel.querySelectorAll('input[data-pref]')) {
                const key = /** @type {keyof import('./subtitle-prefs.js').SubtitlePrefs} */ (/** @type {HTMLInputElement} */ (box).dataset.pref);
                /** @type {HTMLInputElement} */ (box).checked = Boolean(prefs[key]);
            }
            for (const select of this._panel.querySelectorAll('select[data-engine]')) { /** @type {HTMLSelectElement} */ (select).value = prefs.engine; }
            syncControls(this._panel, this._reader);
            for (const button of this._panel.querySelectorAll('button[data-action]')) {
                const action = /** @type {HTMLButtonElement} */ (button).dataset.action;
                /** @type {HTMLButtonElement} */ (button).disabled = !['load', 'import', 'dock'].includes(action ?? '') && !loaded;
                if (action === 'load') { button.textContent = '重新载入'; }
                if (action === 'dock') {
                    button.hidden = window.self !== window.top && innerWidth < 600;
                    button.textContent = this._site.dockOpen() ? '收起字幕栏' : '打开字幕栏';
                }
            }
            const note = this._panel.querySelector('[data-note]');
            if (note) { note.textContent = loaded ? '' : '还没有字幕，可导入字幕文件。'; }
        }
    }

    /**
     * @param {string} text Empty hides the hint.
     * @param {string} [label]
     * @param {(() => void)|null} [action]
     * @param {number} [ms] Hides itself after this long.
     */
    _hint(text, label = '', action = null, ms = 0) {
        const chip = this._chip;
        if (!chip) { return; }
        clearTimeout(this._chipTimer);
        chip.hidden = !text;
        if (!text) { return; }
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.hidden = !action;
        if (action) {
            button.addEventListener('click', () => {
                action();
                chip.hidden = true;
            });
        }
        chip.replaceChildren(text, button);
        // The overlay box is hidden between sentences; the hint must still show.
        if (this._overlay) { this._overlay.hidden = false; }
        if (ms > 0) {
            this._chipTimer = window.setTimeout(() => {
                chip.hidden = true;
                this._applyPrefs();
            }, ms);
        }
    }

    /** */
    _onSession() {
        for (const line of this._lines.values()) { line.remove(); }
        this._lines.clear();
        this._shown = '';
        this._pending = '';
        this._fit();
        this._hint(!this._reader.session && location.protocol === 'file:' ? '没有字幕' : '', '导入字幕', () => this._reader.pickFile());
        this._applyPrefs();
    }

    /** */
    _clear() {
        this._onSession();
        this._togglePanel(false);
    }

    /** @param {string[]} ids */
    _onActive(ids) {
        const id = ids[0] ?? '';
        if (this._hold || this._selectionInside()) {
            this._pending = id;
            return;
        }
        this._show(id);
    }

    /** Applies the latest playback line once the pointer or selection leaves. */
    _release() {
        if (this._selectionInside()) { return; }
        if (this._pending !== this._shown) { this._show(this._pending); }
    }

    /** @returns {boolean} */
    _selectionInside() {
        const selection = window.getSelection();
        return Boolean(this._overlay && selection && !selection.isCollapsed && selection.anchorNode && this._overlay.contains(selection.anchorNode));
    }

    /** @param {string} id */
    _show(id) {
        this._pending = id;
        if (!this._overlay) { return; }
        const current = this._lines.get(this._shown);
        if (current) { current.hidden = true; }
        this._shown = '';
        const line = id ? this._line(id) : null;
        if (line) {
            line.hidden = false;
            this._shown = id;
        }
        this._paintStates();
        this._applyPrefs();
    }

    /**
     * @param {string} id
     * @returns {HTMLElement|null}
     */
    _line(id) {
        const existing = this._lines.get(id);
        if (existing) { return existing; }
        const info = this._reader.rowInfo(id);
        if (!info || !this._overlay) { return null; }
        const line = document.createElement('div');
        line.className = 'o-line';
        line.dataset.id = id;
        line.hidden = true;
        const text = document.createElement('p');
        text.className = 'o-text';
        // Same sentence boundary as the sidebar: the trailing newline ends the scan here.
        text.textContent = `${info.text}\n`;
        youtubeStudyContext.register(text, info);
        const zh = document.createElement('p');
        zh.className = 'o-zh scan-disable';
        zh.lang = 'zh-CN';
        zh.textContent = info.translation();
        zh.addEventListener('click', () => zh.classList.toggle('is-revealed'));
        const side = document.createElement('div');
        side.className = 'o-side scan-disable';
        const reveal = sideButton('≡', '在侧栏查看这句', () => this._reader.revealRow(id));
        reveal.hidden = window.self !== window.top && innerWidth < 600;
        const loop = sideButton('↻', '循环本句', () => this._reader.toggleLoop(id));
        loop.dataset.loop = '';
        side.append(reveal, loop);
        line.append(text, zh, side);
        this._overlay.append(line);
        this._lines.set(id, line);
        return line;
    }

    /** @param {string} id */
    _onTranslation(id) {
        const zh = this._lines.get(id)?.querySelector('.o-zh');
        const info = this._reader.rowInfo(id);
        if (zh && info) { zh.textContent = info.translation(); }
    }

    /** Lookup and loop state come from the controller, so both views always agree. */
    _paintStates() {
        const lookup = this._reader.lookupId;
        const loop = this._reader.loopId;
        for (const [id, line] of this._lines) {
            line.classList.toggle('is-lookup', id === lookup);
            line.classList.toggle('is-looping', id === loop);
            line.querySelector('[data-loop]')?.setAttribute('aria-pressed', String(id === loop));
        }
    }
}

/**
 * @param {string} label
 * @param {string} title
 * @param {() => void} action
 * @returns {HTMLButtonElement}
 */
function sideButton(label, title, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', action);
    return button;
}

/**
 * Keeps clicks and selections on our nodes from reaching the player. Yomitan's scanner
 * listens in the capture phase, so lookups still work.
 * @param {HTMLElement} element
 */
function isolate(element) {
    for (const type of ISOLATED_EVENTS) {
        element.addEventListener(type, (event) => event.stopPropagation());
    }
}

/**
 * @param {number} ms
 * @returns {string}
 */
function clock(ms) {
    const whole = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(whole / 3600);
    const rest = `${Math.floor((whole % 3600) / 60)}:${String(whole % 60).padStart(2, '0')}`;
    return hours ? `${hours}:${rest.padStart(5, '0')}` : rest;
}

/**
 * How many times shadowing plays each sentence before it pauses.
 * @param {(repeats: number) => void} onChange
 * @returns {HTMLLabelElement}
 */
export function repeatSelect(onChange) {
    const label = document.createElement('label');
    label.className = 'r-engine';
    label.append('跟读遍数');
    const select = document.createElement('select');
    select.dataset.repeats = '';
    for (const count of [1, 2, 3, 5]) {
        select.append(Object.assign(document.createElement('option'), {value: String(count), textContent: `每句 ${count} 遍`}));
    }
    select.addEventListener('change', () => onChange(Number(select.value)));
    label.append(select);
    return label;
}

/**
 * Nudges captions earlier or later against the video; remembered per video.
 * @param {import('./youtube-reader.js').YoutubeReader} reader
 * @returns {HTMLElement}
 */
export function offsetControl(reader) {
    const row = document.createElement('div');
    row.className = 'r-offset';
    row.append('字幕偏移');
    /** @type {[string, string, () => number][]} */
    const steps = [['−0.5', '字幕提前 0.5 秒', () => reader.offsetMs - 500], ['', '', () => 0], ['+0.5', '字幕延后 0.5 秒', () => reader.offsetMs + 500], ['归零', '取消偏移', () => 0]];
    for (const [text, title, next] of steps) {
        if (!text) {
            const output = document.createElement('output');
            output.dataset.offset = '';
            output.textContent = '0 秒';
            row.append(output);
            continue;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.dataset.offsetStep = '';
        button.addEventListener('click', () => reader.setOffset(next()));
        row.append(button);
    }
    return row;
}

/**
 * Mirrors the repeat count and caption offset into a menu (sidebar or in-video panel).
 * @param {ParentNode} menu
 * @param {import('./youtube-reader.js').YoutubeReader} reader
 */
export function syncControls(menu, reader) {
    for (const link of menu.querySelectorAll('.r-translation-setting')) {
        link.textContent = reader.prefs.engine === 'model' ? '翻译：你的模型 ↗' : '翻译：免费引擎 ↗';
        link.setAttribute('title', ENGINE_LABELS[reader.prefs.engine]);
    }
    for (const select of menu.querySelectorAll('select[data-repeats]')) { /** @type {HTMLSelectElement} */ (select).value = String(reader.prefs.shadowRepeats); }
    for (const output of menu.querySelectorAll('output[data-offset]')) {
        const seconds = reader.offsetMs / 1000;
        output.textContent = `${seconds > 0 ? '+' : ''}${Number(seconds.toFixed(2))} 秒`;
    }
    for (const button of menu.querySelectorAll('[data-offset-step]')) { /** @type {HTMLButtonElement} */ (button).disabled = !reader.session; }
}

/**
 * A link to the one shared sentence/caption translation setting.
 * @returns {HTMLAnchorElement}
 */
export function translationSettingsLink() {
    const link = document.createElement('a');
    link.className = 'r-translation-setting';
    link.style.cssText = 'font-size:12px;color:inherit;text-decoration:none';
    link.href = chrome.runtime.getURL('settings.html#ai'); link.target = '_blank';
    link.textContent = '翻译：免费引擎 ↗';
    return link;
}
