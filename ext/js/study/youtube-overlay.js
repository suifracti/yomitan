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
     */
    constructor(reader) {
        /** @type {import('./youtube-reader.js').YoutubeReader} */
        this._reader = reader;
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
    _player() {
        const player = document.querySelector('#movie_player');
        return player instanceof HTMLElement ? player : null;
    }

    /** */
    _ensureMounted() {
        const player = this._player();
        if (!player || location.pathname !== '/watch') { return; }
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = STYLE;
            document.head.append(style);
        }
        const controls = player.querySelector('.ytp-right-controls');
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
        const player = this._player();
        if (!player || !this._overlay) { return; }
        this._overlay.style.fontSize = `${Math.max(14, Math.min(40, player.clientHeight * 0.042))}px`;
    }

    /** @returns {HTMLButtonElement} */
    _makeButton() {
        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.className = 'ytp-button';
        button.setAttribute('aria-label', '字幕学习设置');
        button.setAttribute('aria-expanded', 'false');
        button.title = '字幕学习';
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="12" y="16" text-anchor="middle" font-size="9.5" font-family="PingFang SC,sans-serif" fill="currentColor">学</text></svg>';
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
        const toggles = [['autoTranslate', '自动翻译'], ['overlay', '视频内字幕'], ['bilingual', '双语显示'], ['blur', '模糊译文'], ['merge', '合并成整句'], ['aiSegment', 'AI 断句（用模型）']];
        const engine = engineSelect((value) => this._reader.updatePrefs({engine: value}));
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
        const note = document.createElement('div');
        note.className = 'p-note';
        note.dataset.note = '';
        panel.append(note);
        const actions = document.createElement('div');
        actions.className = 'p-actions';
        /** @type {[string, string, () => void][]} */
        const buttons = [
            ['load', '载入字幕', () => this._reader.loadCaptions()],
            ['translate', '翻译接下来8句', () => this._reader.translateNext()],
            ['reveal', '在侧栏查看', () => { if (this._shown) { this._reader.revealRow(this._shown); } }],
            ['vtt', '下载原文 VTT', () => this._reader.download('vtt')],
            ['bilingual', '下载双语 VTT', () => this._reader.download('bilingual')],
            ['json', '下载 JSON', () => this._reader.download('json')],
        ];
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
        const player = this._player();
        player?.classList.toggle(ACTIVE_CLASS, prefs.overlay && loaded);
        if (this._overlay) {
            this._overlay.hidden = !prefs.overlay || !loaded || !this._shown;
            this._overlay.classList.toggle('o-mono', !prefs.bilingual);
            this._overlay.classList.toggle('o-blur', prefs.blur);
        }
        if (this._panel) {
            for (const box of this._panel.querySelectorAll('input[data-pref]')) {
                const key = /** @type {keyof import('./subtitle-prefs.js').SubtitlePrefs} */ (/** @type {HTMLInputElement} */ (box).dataset.pref);
                /** @type {HTMLInputElement} */ (box).checked = Boolean(prefs[key]);
            }
            for (const select of this._panel.querySelectorAll('select[data-engine]')) { /** @type {HTMLSelectElement} */ (select).value = prefs.engine; }
            for (const button of this._panel.querySelectorAll('button[data-action]')) {
                const action = /** @type {HTMLButtonElement} */ (button).dataset.action;
                /** @type {HTMLButtonElement} */ (button).disabled = action !== 'load' && !loaded;
                if (action === 'load') { button.textContent = loaded ? '重新载入字幕' : '载入字幕'; }
            }
            const note = this._panel.querySelector('[data-note]');
            if (note) { note.textContent = loaded ? '' : '还没载入字幕：点「载入字幕」，或用右侧字幕栏。'; }
        }
    }

    /** */
    _onSession() {
        for (const line of this._lines.values()) { line.remove(); }
        this._lines.clear();
        this._shown = '';
        this._pending = '';
        this._fit();
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
 * A labelled service picker shared by the sidebar menu and the in-video panel.
 * @param {(engine: import('./subtitle-prefs.js').SubtitleEngine) => void} onChange
 * @returns {HTMLLabelElement}
 */
export function engineSelect(onChange) {
    const label = document.createElement('label');
    label.className = 'r-engine';
    label.append('翻译服务');
    const select = document.createElement('select');
    select.dataset.engine = '';
    for (const [value, text] of Object.entries(ENGINE_LABELS)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.append(option);
    }
    select.addEventListener('change', () => onChange(/** @type {import('./subtitle-prefs.js').SubtitleEngine} */ (select.value)));
    label.append(select);
    return label;
}
