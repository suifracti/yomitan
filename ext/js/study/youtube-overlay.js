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
import {menuSelect} from './study-ui.js';
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
#${OVERLAY_ID} .o-chip.o-shadow{bottom:auto;top:calc(100% + 6px);width:max-content;max-width:min(90vw,650px);white-space:normal;flex-wrap:wrap;border-radius:8px}
#${OVERLAY_ID} .o-shadow-translation{flex-basis:100%;margin:0;color:#f3e7c4}
#${OVERLAY_ID} .o-chip[hidden]{display:none}
#${OVERLAY_ID} .o-chip button{padding:1px 8px;border:1px solid rgb(255 255 255 / 30%);border-radius:999px;background:none;color:#fff;font:inherit;font-size:12px;cursor:pointer}
#${OVERLAY_ID} .o-chip button[hidden]{display:none}
#${PANEL_ID} .p-offset button{padding:1px 7px;border:1px solid rgb(255 255 255 / 22%);border-radius:5px;background:none;color:#eee;font:inherit;font-size:12px;cursor:pointer}
#${PANEL_ID} .p-offset button:disabled{opacity:.45;cursor:default}
#${PANEL_ID} .p-offset output{min-width:4.5em;text-align:center;font-variant-numeric:tabular-nums}
#${BUTTON_ID}{display:inline-flex;align-items:center;justify-content:center;width:48px;opacity:.9}
#${BUTTON_ID} svg{width:24px;height:24px}
#${BUTTON_ID}[hidden]{display:none}
#${BUTTON_ID}[aria-expanded=true]{opacity:1}
#${PANEL_ID}{position:absolute;right:12px;bottom:60px;z-index:70;box-sizing:border-box;width:min(380px,calc(100% - 16px));max-height:calc(100% - 80px);overflow:auto;padding:6px 0;border-radius:10px;background:rgb(28 28 30 / 94%);color:#eee;font:13px/1.4 -apple-system,'PingFang SC',sans-serif;box-shadow:0 6px 20px rgb(0 0 0 / 40%)}
#${PANEL_ID}[hidden]{display:none}
#${PANEL_ID} .p-row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:34px;padding:0 14px;cursor:pointer}
#${PANEL_ID} .p-label{flex:0 0 56px;white-space:nowrap}
#${PANEL_ID} .p-modes{display:flex;flex-wrap:wrap;gap:0;min-width:0}
#${PANEL_ID} .p-modes button{font:inherit;font-size:12px;padding:3px 6px;white-space:nowrap;color:inherit;background:none;border:1px solid #777;cursor:pointer}
#${PANEL_ID} .p-modes button[aria-pressed=true]{background:#4d5c9b;color:#fff;border-color:#a9b6ef}
#${PANEL_ID} .p-offset-controls{display:flex;align-items:center;gap:4px;white-space:nowrap}
#${PANEL_ID} .p-offset output{min-width:3em}
#${PANEL_ID} .p-note{display:block}
#${PANEL_ID} .p-note[hidden]{display:none}
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
        /** @type {string} */
        this._shadowId = '';
        /** @type {number} */
        this._shadowCountdown = 0;
        /** @type {HTMLVideoElement|null} */
        this._playVideo = null;
        /**
         *
         */
        this._onPlay = () => { this._clearShadow(); };
    }

    /** */
    start() {
        const reader = this._reader;
        reader.addEventListener('session', () => {
            this._clearShadow();
            this._onSession();
        });
        reader.addEventListener('reset', () => {
            this._clearShadow();
            this._clear();
        });
        reader.addEventListener('active', (event) => this._onActive(/** @type {CustomEvent<{ids: string[]}>} */ (event).detail.ids));
        reader.addEventListener('translation', (event) => this._onTranslation(/** @type {CustomEvent<{id: string}>} */ (event).detail.id));
        reader.addEventListener('lookup', () => this._paintStates());
        reader.addEventListener('loop', () => this._paintStates());
        reader.addEventListener('prefs', () => {
            if (!reader.prefs.shadow) {
                this._clearShadow();
            } this._applyPrefs();
        });
        reader.addEventListener('offset', () => this._applyPrefs());
        reader.addEventListener('resume', (event) => {
            const {ms} = /** @type {CustomEvent<{ms: number}>} */ (event).detail;
            if (ms < 0) {
                this._hint('');
            } else {
                this._hint(`上次学到 ${clock(ms)}`, '继续', () => reader.resume(), 12000);
            }
        });
        reader.addEventListener('shadow', (event) => this._showShadow(/** @type {CustomEvent<{id: string, plays: number}>} */ (event).detail));
        document.addEventListener('pointerdown', (event) => {
            const target = /** @type {Node} */ (event.target);
            if (this._panel && !this._panel.hidden && !this._panel.contains(target) && !this._button?.contains(target)) { this._togglePanel(false); }
        }, true);
        document.addEventListener('click', (event) => {
            if (this._shadowId && event.target instanceof Element && event.target.closest('button')) { this._cancelShadowCountdown(); }
        }, true);
        document.addEventListener('fullscreenchange', () => this._applyPrefs());
        document.addEventListener('keydown', (event) => {
            const target = event.target instanceof Element ? event.target : document.activeElement;
            if (this._shadowId && this._site.video()?.paused && !target?.closest('input,textarea,select,[contenteditable]') &&
            !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat && [' ', 'r', 'R'].includes(event.key)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                this._cancelShadowCountdown();
                if (event.key === ' ') {
                    reader.continueShadow();
                } else {
                    reader.replayShadow();
                }
            }
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
        const video = this._site.video();
        if (video !== this._playVideo) {
            this._playVideo?.removeEventListener('play', this._onPlay);
            this._playVideo = video; video?.addEventListener('play', this._onPlay);
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
            this._resize = new ResizeObserver(() => {
                this._fit();
                this._positionPanel();
            });
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
        const choice = (label, key, values, change) => {
            const select = document.createElement('select'); select.dataset.label = label; select.dataset[key] = '';
            for (const [value, text] of values) { select.append(Object.assign(document.createElement('option'), {value, textContent:text})); }
            panel.append(select); select.addEventListener('change', () => change(select.value)); menuSelect(select); return select;
        };
        choice('字幕', 'subtitleMode', [['original','原文'],['bilingual','双语'],['blur','双语·译文模糊'],['off','关闭']], (mode) =>
            this._reader.updatePrefs(mode === 'off' ? {overlay:false} : {overlay:true,bilingual:mode !== 'original',blur:mode === 'blur'}));
        choice('跟读', 'shadowMode', [['0','关'],['1','每句 1 遍'],['2','每句 2 遍'],['3','每句 3 遍']], (value) =>
            this._reader.updatePrefs(value === '0' ? {shadow:false} : {shadow:true,shadowRepeats:Number(value)}));
        choice('字幕偏移', 'offsetMenu', [['current','0 秒'],['minus','−0.5 秒'],['plus','+0.5 秒'],['reset','归零']], (value) => {
            if (value !== 'current') { this._reader.setOffset(value === 'reset' ? 0 : this._reader.offsetMs + (value === 'minus' ? -500 : 500)); }
            this._applyPrefs();
        });
        const note = document.createElement('small'); note.className = 'p-note';
        note.textContent = '更多设置在右侧字幕栏 ⋯'; panel.append(note);
        return panel;
    }

    /** @param {boolean} open */
    _togglePanel(open) {
        if (!this._panel) { return; }
        this._panel.hidden = !open;
        this._button?.setAttribute('aria-expanded', String(open));
        if (open) { this._applyPrefs(); }
    }

    /** Keep the panel above its button and within the player's rectangle. */
    _positionPanel() {
        const panel = this._panel;
        const player = this._player();
        if (!panel || panel.hidden || !player || !this._button) { return; }
        const rect = player.getBoundingClientRect();
        const button = this._button.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) { return; }
        const width = Math.min(380, rect.width - 16);
        const bottom = Math.max(8, rect.bottom - button.top + 8);
        Object.assign(panel.style, {top: 'auto',
            right: 'auto',
            width: `${width}px`,
            left: `${Math.max(8, Math.min(rect.width - width - 8, button.right - rect.left - width))}px`,
            bottom: `${bottom}px`,
            maxHeight: `${Math.max(0, rect.height - bottom - 8)}px`});
    }

    /** Mirrors preferences and session state into the overlay and the panel. */
    _applyPrefs() {
        const prefs = this._reader.prefs;
        const loaded = this._reader.session !== null;
        if (this._button) { this._button.hidden = !prefs.enabled; }
        if (this._panel && !prefs.enabled) { this._togglePanel(false); }
        this._site.hideNative(prefs.overlay && loaded);
        if (this._overlay) {
            this._overlay.hidden = (!prefs.overlay || !loaded || !this._shown) && (this._chip?.hidden ?? true);
            this._overlay.classList.toggle('o-mono', !prefs.bilingual);
            this._overlay.classList.toggle('o-blur', prefs.blur);
        }
        if (this._panel) {
            let mode = 'off';
            if (prefs.overlay) {
                mode = 'original';
                if (prefs.bilingual) { mode = prefs.blur ? 'blur' : 'bilingual'; }
            }
            this._panel.querySelector('select[data-subtitle-mode]').value = mode;
            const offset = this._panel.querySelector('select[data-offset-menu]');
            offset.options[0].textContent = `${this._reader.offsetMs / 1000} 秒`; offset.value = 'current';
            const shadow = /** @type {HTMLSelectElement} */ (this._panel.querySelector('[data-shadow-mode]'));
            shadow.querySelector('[data-legacy]')?.remove();
            if (prefs.shadow && prefs.shadowRepeats > 3) {
                const old = Object.assign(document.createElement('option'), {value: String(prefs.shadowRepeats), textContent: `每句 ${prefs.shadowRepeats} 遍（原设置）`, hidden: true});
                old.dataset.legacy = ''; shadow.append(old);
            }
            shadow.value = prefs.shadow ? String(prefs.shadowRepeats) : '0';
            syncControls(this._panel, this._reader);
            for (const select of this._panel.querySelectorAll('select')) { select.dispatchEvent(new Event('study-ui-sync')); }
            /** @type {HTMLElement} */ (this._panel.querySelector('.p-note')).hidden = Boolean(document.fullscreenElement);
            this._positionPanel();
        }
    }

    /** Cancel the resume countdown without dismissing the actions. */
    _cancelShadowCountdown() {
        clearInterval(this._shadowCountdown); this._shadowCountdown = 0;
        this._chip?.querySelector('.o-countdown')?.remove();
    }

    /** Dismiss pause actions once playback resumes or this video changes. */
    _clearShadow() {
        this._cancelShadowCountdown(); this._shadowId = '';
        if (this._chip?.classList.contains('o-shadow')) {
            this._chip.hidden = true;
            this._chip.classList.remove('o-shadow');
        }
    }

    /** @param {{id: string, plays: number}} detail */
    _showShadow({id, plays}) {
        this._clearShadow();
        this._hint('已暂停跟读');
        this._shadowId = id;
        const chip = this._chip;
        if (!chip) { return; }
        chip.classList.add('o-shadow');
        /**
         * @param {string} label
         * @param {() => void} action
         */
        const add = (label, action) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.addEventListener('click', () => {
                this._cancelShadowCountdown();
                action();
            });
            chip.append(button);
        };
        add('空格 继续', () => this._reader.continueShadow());
        add('R 再听一遍', () => this._reader.replayShadow());
        add('关闭跟读', () => {
            this._reader.updatePrefs({shadow: false});
            this._clearShadow();
        });
        if (plays >= 2) {
            add('看译文', () => {
                const line = chip.querySelector('.o-shadow-translation') || document.createElement('p');
                line.className = 'o-shadow-translation';
                line.textContent = '翻译中…';
                chip.append(line);
                void this._reader.showSentenceTranslation(id).then((value) => {
                    if (this._shadowId === id) {
                        line.textContent = value;
                    }
                });
            });
            add('查这句', () => { void this._reader.lookupCaption(id).catch(() => {}); });
        }
        let left = this._reader.prefs.shadowContinueSeconds;
        if (left > 0) {
            const countdown = document.createElement('span');
            countdown.className = 'o-countdown';
            chip.append(countdown);
            countdown.textContent = `${left} 秒后继续`;
            this._shadowCountdown = window.setInterval(() => {
                --left; countdown.textContent = `${left} 秒后继续`;
                if (left <= 0) {
                    this._cancelShadowCountdown();
                    this._reader.continueShadow();
                }
            }, 1000);
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
        chip.classList.remove('o-shadow');
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
        if (/^en(?:-|$)/i.test(this._reader.session?.source.language || '')) { youtubeStudyContext.register(text, info); } else { text.classList.add('scan-disable'); }
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
    row.className = 'r-offset p-row p-offset';
    const label = document.createElement('span');
    label.className = 'p-label';
    label.textContent = '字幕偏移';
    const controls = document.createElement('span'); controls.className = 'p-offset-controls';
    row.append(label, controls);
    /** @type {[string, string, () => number][]} */
    const steps = [['−0.5', '字幕提前 0.5 秒', () => reader.offsetMs - 500], ['', '', () => 0], ['+0.5', '字幕延后 0.5 秒', () => reader.offsetMs + 500], ['归零', '取消偏移', () => 0]];
    for (const [text, title, next] of steps) {
        if (!text) {
            const output = document.createElement('output');
            output.dataset.offset = '';
            output.textContent = '0 秒';
            controls.append(output);
            continue;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.dataset.offsetStep = '';
        button.addEventListener('click', () => reader.setOffset(next()));
        controls.append(button);
    }
    return row;
}

/**
 * Mirrors the repeat count and caption offset into a menu (sidebar or in-video panel).
 * @param {ParentNode} menu
 * @param {import('./youtube-reader.js').YoutubeReader} reader
 */
export function syncControls(menu, reader) {
    for (const select of menu.querySelectorAll('select[data-shadow-continue]')) { /** @type {HTMLSelectElement} */ (select).value = String(reader.prefs.shadowContinueSeconds); }
    for (const select of menu.querySelectorAll('select[data-engine]')) {
        const picker = /** @type {HTMLSelectElement} */ (select);
        if (!['apple', 'model'].includes(reader.prefs.engine)) { picker.options[0].value = reader.prefs.engine; }
        picker.value = reader.prefs.engine;
    }
    for (const select of menu.querySelectorAll('select[data-repeats]')) { /** @type {HTMLSelectElement} */ (select).value = String(reader.prefs.shadowRepeats); }
    for (const output of menu.querySelectorAll('output[data-offset]')) {
        const seconds = reader.offsetMs / 1000;
        output.textContent = `${seconds > 0 ? '+' : ''}${Number(seconds.toFixed(2))} 秒`;
    }
    for (const select of menu.querySelectorAll('select')) { select.dispatchEvent(new Event('study-ui-sync')); }
    for (const button of menu.querySelectorAll('[data-offset-step]')) { /** @type {HTMLButtonElement} */ (button).disabled = !reader.session; }
}

/**
 * The same global translation choice in both video menus.
 * @param {(engine: import('./subtitle-prefs.js').SubtitleEngine) => void} onChange
 * @returns {HTMLLabelElement}
 */
export function translationEngineSelect(onChange) {
    const label = document.createElement('label'); label.className = 'r-engine';
    label.append('翻译：');
    const select = document.createElement('select'); select.dataset.engine = '';
    for (const [value, text] of [['chrome', '免费引擎'], ['apple', 'Apple'], ['model', 'AI 模型']]) {
        select.append(Object.assign(document.createElement('option'), {value, textContent: text}));
    }
    select.addEventListener('change', () => onChange(/** @type {import('./subtitle-prefs.js').SubtitleEngine} */ (select.value)));
    label.append(select); return label;
}

/**
 * @param {(seconds: number) => void} onChange
 * @returns {HTMLLabelElement}
 */
export function shadowContinueSelect(onChange) {
    const label = document.createElement('label');
    label.className = 'p-row';
    label.append('暂停后自动继续');
    const select = document.createElement('select'); select.dataset.shadowContinue = '';
    for (const [value, text] of [[0, '不自动'], [3, '3 秒'], [5, '5 秒']]) {
        select.append(Object.assign(document.createElement('option'), {value: String(value), textContent: String(text)}));
    }
    select.addEventListener('change', () => onChange(Number(select.value)));
    label.append(select);
    return label;
}
