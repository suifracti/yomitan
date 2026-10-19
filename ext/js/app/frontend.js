/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2016-2022  Yomichan Authors
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

import {createApiMap, invokeApiMapHandler} from '../core/api-map.js';
import {EventListenerCollection} from '../core/event-listener-collection.js';
import {log} from '../core/log.js';
import {parseJson} from '../core/json.js';
import {promiseAnimationFrame} from '../core/promise-animation-frame.js';
import {safePerformance} from '../core/safe-performance.js';
import {setProfile} from '../data/profiles-util.js';
import {addFullscreenChangeEventListener, getFullscreenElement} from '../dom/document-util.js';
import {TextSourceElement} from '../dom/text-source-element.js';
import {TextSourceGenerator} from '../dom/text-source-generator.js';
import {TextSourceRange} from '../dom/text-source-range.js';
import {TextScanner} from '../language/text-scanner.js';
import {youtubeStudyContext} from '../study/youtube-study-context.js';

/**
 * @typedef {object} StudySubtitle
 * @property {number} version
 * @property {string} text
 * @property {number} trackIndex
 * @property {number} cueIndex
 * @property {string|null} trackName
 * @property {'en'|'ja'|null} language
 * @property {number|null} originalStartMs
 * @property {number|null} originalEndMs
 * @property {number|null} subtitleOffsetMs
 * @property {string|null} url
 * @property {{index:number,text:string,originalStartMs:number,originalEndMs:number}[]} adjacentCues
 * @property {number|null} playbackSeconds
 * @property {number} selectionStart
 * @property {number} selectionEnd
 * @property {string} word
 * @property {string} revision
 * @property {string|null} sourceRevision
 * @property {boolean} [sourceConfirmed]
 * @property {string} [queryId]
 * @property {'unknown'} [sourceState]
 */

/**
 * @param {Node} node
 * @returns {string}
 */
function subtitlePlainText(node) {
    if (node instanceof Element && node.matches('rt, rp, .asb-gloss-text')) { return ''; }
    if (node.nodeType === Node.TEXT_NODE) { return node.textContent ?? ''; }
    return [...node.childNodes].map(subtitlePlainText).join('');
}

/**
 * Page metadata is untrusted, display-only input. It never grants Native capabilities.
 * @param {import('text-source').TextSource} textSource
 * @returns {StudySubtitle|null}
 */
export function readStudySubtitle(textSource) {
    if (!(textSource instanceof TextSourceRange)) { return null; }
    const {range} = textSource;
    const parent = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const root = parent?.closest('[data-asb-study-cue]');
    const raw = root?.getAttribute('data-asb-study-cue');
    if (root?.closest('[aria-hidden=true], [hidden]') || (root && window.getComputedStyle(root).visibility === 'hidden')) { return null; }
    if (!root || !root.isConnected || !raw || raw.length > 16000 || !root.contains(range.endContainer) || parent?.closest('rt, rp, .asb-gloss-text')) { return null; }
    try {
        const s = /** @type {StudySubtitle} */ (parseJson(raw));
        if (s.version !== 1 || typeof s.text !== 'string' || !s.text || s.text.length > 2000 ||
        !Number.isInteger(s.trackIndex) || s.trackIndex < 0 || !Number.isInteger(s.cueIndex) || s.cueIndex < 0) { return null; }
        const token = parent?.closest('[data-asb-token-start]');
        const base = token ?? parent?.closest('.asbplayer-subtitle-text, .asbplayer-subtitle-rich') ?? root;
        const baseOffset = token ? Number(/** @type {HTMLElement} */ (token).dataset.asbTokenStart) : 0;
        if (!Number.isInteger(baseOffset) || baseOffset < 0 || s.text.slice(baseOffset, baseOffset + subtitlePlainText(base).length) !== subtitlePlainText(base)) { return null; }
        const prefix = range.cloneRange();
        prefix.selectNodeContents(base);
        prefix.setEnd(range.startContainer, range.startOffset);
        const selectionStart = baseOffset + subtitlePlainText(prefix.cloneContents()).length;
        const selected = subtitlePlainText(range.cloneContents());
        const word = selected || '';
        if (word && s.text.slice(selectionStart, selectionStart + word.length) !== word) { return null; }
        const validTime = [s.originalStartMs, s.originalEndMs, s.subtitleOffsetMs].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
        /** @type {number} */ (s.originalStartMs) >= 0 && /** @type {number} */ (s.originalEndMs) > /** @type {number} */ (s.originalStartMs) &&
        /** @type {number} */ (s.originalEndMs) <= 604800000;
        const playbackSeconds = validTime ? (/** @type {number} */ (s.originalStartMs) + /** @type {number} */ (s.subtitleOffsetMs)) / 1000 : null;
        return Object.freeze({
            version: 1,
            sourceRevision: typeof s.sourceRevision === 'string' ? s.sourceRevision : null,
            text: s.text,
            cueIndex: s.cueIndex,
            trackIndex: s.trackIndex,
            trackName: typeof s.trackName === 'string' ? s.trackName.slice(0, 200) : null,
            language: s.language === 'en' || s.language === 'ja' ? s.language : null,
            url: typeof s.url === 'string' && s.url.length <= 2000 && /^https?:\/\//.test(s.url) ? s.url : null,
            originalStartMs: validTime ? s.originalStartMs : null,
            originalEndMs: validTime ? s.originalEndMs : null,
            subtitleOffsetMs: validTime ? s.subtitleOffsetMs : null,
            playbackSeconds: playbackSeconds !== null && playbackSeconds >= 0 && playbackSeconds <= 604800 ? playbackSeconds : null,
            adjacentCues: Array.isArray(s.adjacentCues) ?
s.adjacentCues.slice(0, 2).filter((c) => c && typeof c.text === 'string' && c.text.length <= 600 &&
Number.isInteger(c.index) && Number.isFinite(c.originalStartMs) && c.originalStartMs >= 0 && Number.isFinite(c.originalEndMs) && c.originalEndMs > c.originalStartMs)
    .map((c) => ({index: c.index, text: c.text, originalStartMs: c.originalStartMs, originalEndMs: c.originalEndMs})) :
[],
            selectionStart,
            selectionEnd: selectionStart + word.length,
            word,
            revision: raw,
        });
    } catch { return null; }
}

/** Freeze provenance before TextScanner awaits dictionary lookup; ordinary pages use the unchanged parent. */
export class SubtitleTextScanner extends TextScanner {
    /** @type {WeakMap<import('text-source').TextSource, StudySubtitle>} */
    studySources = new WeakMap();
    /** @type {number} */
    studyQuery = 0;
    /** @type {import('text-source').TextSource|null} */
    studyRequestSource = null;
    /** @type {WeakMap<import('text-source').TextSource, {query:number, revision:string|null, word:string, selectionStart:number}>} */
    studyRequests = new WeakMap();

    /**
     * @param {import('text-source').TextSource} textSource
     * @param {boolean} searchTerms
     * @param {boolean} searchKanji
     * @param {import('text-scanner').InputInfo} inputInfo
     * @param {boolean} [showEmpty]
     * @param {boolean} [disallowExpandStartOffset]
     * @returns {Promise<void>}
     */
    async _search(textSource, searchTerms, searchKanji, inputInfo, showEmpty = false, disallowExpandStartOffset = false) {
        const snapshot = readStudySubtitle(textSource);
        this.studyRequestSource = snapshot ? textSource : null;
        this.studyRequests.set(textSource, {query: ++this.studyQuery, revision: snapshot?.revision ?? null, word: snapshot?.word ?? '', selectionStart: snapshot?.selectionStart ?? -1});
        // Freeze before even getSearchContext can yield, not just before dictionary IO.
        // eslint-disable-next-line no-underscore-dangle
        await super._search(textSource, searchTerms, searchKanji, inputInfo, showEmpty, disallowExpandStartOffset);
    }

    /** Explicit close invalidates pending article and subtitle lookup alike. */
    cancelStudySearch() {
        ++this.studyQuery;
        this.studyRequestSource = null;
    }

    /**
     * Recover article context without expanding or replacing the user's selection.
     * A lazy range deliberately prevents dictionary lookup from changing its text;
     * sentence extraction needs a separate expandable clone of that same DOM range.
     * @param {TextSourceRange} textSource
     * @returns {{text: string, offset: number, adjacent: string}|null}
     */
    extractArticleSentence(textSource) {
        if (this.studySources.has(textSource) || readStudySubtitle(textSource) ||
        !textSource.range.startContainer.isConnected || !textSource.range.endContainer.isConnected ||
        textSource.range.toString() !== textSource.text()) { return null; }
        const sentence = this._textSourceGenerator.extractSentence(
            TextSourceRange.create(textSource.range.cloneRange()),
            this._layoutAwareScan,
            Math.min(1000, Math.max(0, this._sentenceScanExtent)),
            this._sentenceTerminateAtNewlines,
            this._sentenceTerminatorMap,
            this._sentenceForwardQuoteMap,
            this._sentenceBackwardQuoteMap,
        );
        return sentence.text.length <= 2400 ? sentence : null;
    }

    /**
     * @param {import('text-source').TextSource} textSource
     * @param {number} length
     * @param {boolean} layoutAwareScan
     * @param {import('input').PointerType | undefined} pointerType
     * @returns {string}
     */
    getTextSourceContent(textSource, length, layoutAwareScan, pointerType) {
        const snapshot = readStudySubtitle(textSource);
        if (snapshot) {
            const text = textSource instanceof TextSourceRange && textSource.disallowExpandSelection ?
                snapshot.word :
                snapshot.text.slice(snapshot.selectionStart);
            return [...text].slice(0, length).join('');
        }
        return super.getTextSourceContent(textSource, length, layoutAwareScan, pointerType);
    }

    /**
     * @param {import('text-source').TextSource} textSource
     * @param {boolean} searchTerms
     * @param {boolean} searchKanji
     * @param {import('settings').OptionsContext} optionsContext
     * @returns {Promise<import('text-scanner').TermSearchResults|import('text-scanner').KanjiSearchResults|null>}
     */
    async _findDictionaryEntries(textSource, searchTerms, searchKanji, optionsContext) {
        const started = this.studyRequests?.get(textSource);
        const query = started?.query ?? ++this.studyQuery;
        const frozen = readStudySubtitle(textSource);
        if (query !== this.studyQuery || (started && started.revision !== (frozen?.revision ?? null)) ||
        (started?.word && (started.word !== frozen?.word || started.selectionStart !== frozen?.selectionStart))) { return null; }
        if (textSource instanceof TextSourceRange && textSource.range.startContainer.parentElement?.closest('[data-asb-study-cue]') && !frozen) { return null; }
        if (frozen) { this.studySources.set(textSource, frozen); }
        // Existing TextScanner extension seam.
        // eslint-disable-next-line no-underscore-dangle
        const result = await super._findDictionaryEntries(textSource, searchTerms, searchKanji, optionsContext);
        if (query !== this.studyQuery) { return null; }
        if (!frozen) { return result; }
        const current = readStudySubtitle(textSource);
        if (!current || query !== this.studyQuery || current.revision !== frozen.revision || current.selectionStart !== frozen.selectionStart || !current.word) { return null; }
        let sourceConfirmed = false;
        const queryId = crypto.randomUUID();
        const cue = {
            version: 1,
            sourceRevision: frozen.sourceRevision,
            text: frozen.text,
            cueIndex: frozen.cueIndex,
            trackIndex: frozen.trackIndex,
            trackName: frozen.trackName,
            language: frozen.language,
            originalStartMs: frozen.originalStartMs,
            originalEndMs: frozen.originalEndMs,
            subtitleOffsetMs: frozen.subtitleOffsetMs,
            url: frozen.url,
            selectionStart: current.selectionStart,
            selectionEnd: current.selectionEnd,
            word: current.word,
        };
        try {
            const confirmation = /** @type {{ok?: boolean, queryId?: string, writeAuthorized?: boolean}|undefined} */ (await /** @type {Promise<unknown>} */ (chrome.runtime.sendMessage({studyCueAttest: true, data: {queryId, cue}})));
            sourceConfirmed = confirmation?.ok === true && confirmation.queryId === queryId && confirmation.writeAuthorized === false;
        } catch { /* Missing ASB/private transport leaves the card display-only and unconfirmed. */ }
        const after = readStudySubtitle(textSource);
        if (query !== this.studyQuery || !after || after.revision !== frozen.revision ||
        after.selectionStart !== current.selectionStart || after.word !== current.word) { return null; }
        this.studySources.set(textSource, Object.freeze({...frozen, word: current.word, selectionEnd: current.selectionEnd, sourceConfirmed, queryId}));
        return result;
    }
}

/**
 * This is the main class responsible for scanning and handling webpage content.
 */
export class Frontend {
    /** @type {{source: import('text-source').TextSource, query: number, snapshot: StudySubtitle}|null} */
    _studyCueCurrent = null;
    /** @type {import('text-source').TextSource|null} */
    _studyLastLookupSource = null;
    /** @type {number} */
    _studyLastLookupQuery = 0;
    /** @type {{x: number, y: number}|null} */
    _studyLastShortcutPoint = null;
    /**
     * Creates a new instance.
     * @param {import('frontend').ConstructorDetails} details Details about how to set up the instance.
     */
    constructor({
        application,
        pageType,
        popupFactory,
        depth,
        parentPopupId,
        parentFrameId,
        useProxyPopup,
        canUseWindowPopup = true,
        allowRootFramePopupProxy,
        childrenSupported = true,
        hotkeyHandler,
        browser,
    }) {
        /** @type {import('../application.js').Application} */
        this._application = application;
        /** @type {import('frontend').PageType} */
        this._pageType = pageType;
        /** @type {import('./popup-factory.js').PopupFactory} */
        this._popupFactory = popupFactory;
        /** @type {number} */
        this._depth = depth;
        /** @type {?string} */
        this._parentPopupId = parentPopupId;
        /** @type {?number} */
        this._parentFrameId = parentFrameId;
        /** @type {boolean} */
        this._useProxyPopup = useProxyPopup;
        /** @type {boolean} */
        this._canUseWindowPopup = canUseWindowPopup;
        /** @type {boolean} */
        this._allowRootFramePopupProxy = allowRootFramePopupProxy;
        /** @type {boolean} */
        this._childrenSupported = childrenSupported;
        /** @type {import('../input/hotkey-handler.js').HotkeyHandler} */
        this._hotkeyHandler = hotkeyHandler;
        /** @type {?import('popup').PopupAny} */
        this._popup = null;
        /** @type {boolean} */
        this._disabledOverride = false;
        /** @type {?import('settings').ProfileOptions} */
        this._options = null;
        /** @type {number} */
        this._pageZoomFactor = 1;
        /** @type {number} */
        this._contentScale = 1;
        /** @type {Promise<void>} */
        this._lastShowPromise = Promise.resolve();
        /** @type {TextSourceGenerator} */
        this._textSourceGenerator = new TextSourceGenerator();
        /** @type {TextScanner} */
        this._textScanner = new SubtitleTextScanner({
            api: application.api,
            node: window,
            ignoreElements: this._ignoreElements.bind(this),
            ignorePoint: this._ignorePoint.bind(this),
            getSearchContext: this._getSearchContext.bind(this),
            searchTerms: true,
            searchKanji: true,
            textSourceGenerator: this._textSourceGenerator,
            browser: browser,
            onLookupKey: this._onStudyLookupKey.bind(this),
        });
        /** @type {boolean} */
        this._textScannerHasBeenEnabled = false;
        /** @type {Map<'default'|'window'|'iframe'|'proxy', Promise<?import('popup').PopupAny>>} */
        this._popupCache = new Map();
        /** @type {EventListenerCollection} */
        this._popupEventListeners = new EventListenerCollection();
        /** @type {?import('core').TokenObject} */
        this._updatePopupToken = null;
        /** @type {?import('core').Timeout} */
        this._clearSelectionTimer = null;
        /** @type {boolean} */
        this._isPointerOverPopup = false;
        /** @type {?import('settings').OptionsContext} */
        this._optionsContextOverride = null;

        /* eslint-disable @stylistic/no-multi-spaces */
        /** @type {import('application').ApiMap} */
        this._runtimeApiMap = createApiMap([
            ['frontendRequestReadyBroadcast',   this._onMessageRequestFrontendReadyBroadcast.bind(this)],
            ['frontendSetAllVisibleOverride',   this._onApiSetAllVisibleOverride.bind(this)],
            ['frontendClearAllVisibleOverride', this._onApiClearAllVisibleOverride.bind(this)],
            ['frontendScanSelectedText',        this._onApiScanSelectedText.bind(this)],
        ]);

        this._hotkeyHandler.registerActions([
            ['scanSelectedText', this._onActionScanSelectedText.bind(this)],
            ['scanTextAtSelection', this._onActionScanTextAtSelection.bind(this)],
            ['scanTextAtCaret',  this._onActionScanTextAtCaret.bind(this)],
            ['profilePrevious',   async () => { await setProfile(-1, this._application); }],
            ['profileNext',       async () => { await setProfile(1, this._application); }],
        ]);
        /* eslint-enable @stylistic/no-multi-spaces */
    }

    /**
     * Get whether or not the text selection can be cleared.
     * @type {boolean}
     */
    get canClearSelection() {
        return this._textScanner.canClearSelection;
    }

    /**
     * Set whether or not the text selection can be cleared.
     * @param {boolean} value The new value to assign.
     */
    set canClearSelection(value) {
        this._textScanner.canClearSelection = value;
    }

    /**
     * Gets the popup instance.
     * @type {?import('popup').PopupAny}
     */
    get popup() {
        return this._popup;
    }

    /**
     * Prepares the instance for use.
     */
    async prepare() {
        await this.updateOptions();
        try {
            const {zoomFactor} = await this._application.api.getZoom();
            this._pageZoomFactor = zoomFactor;
        } catch (e) {
            // Ignore exceptions which may occur due to being on an unsupported page (e.g. about:blank)
        }

        this._textScanner.on('selectionShortcut', this._onSelectionShortcut.bind(this));
        this._textScanner.prepare();
        // Only a completed valid original-text selection initiates a phrase lookup.
        let gestureRevision = '';
        window.addEventListener('mousedown', (event) => {
            gestureRevision = event.button === 0 && !event.defaultPrevented && event.target instanceof Element ? event.target.closest('[data-asb-study-cue]')?.getAttribute('data-asb-study-cue') ?? '' : '';
        }, true);
        window.addEventListener('mouseup', (event) => {
            const range = this._getFirstSelectionRange(false);
            const snapshot = range ? readStudySubtitle(TextSourceRange.createLazy(range)) : null;
            if (event.button === 0 && !event.defaultPrevented && snapshot?.word && gestureRevision === snapshot.revision) {
                // A confirmed larger phrase may share the previous hovered word's start.
                this._textScanner.setCurrentTextSource(null);
                void this._scanSelectedText(false, true);
            }
            gestureRevision = '';
        });

        window.addEventListener('resize', this._onResize.bind(this), false);
        addFullscreenChangeEventListener(this._updatePopup.bind(this));

        const {visualViewport} = window;
        if (typeof visualViewport !== 'undefined' && visualViewport !== null) {
            visualViewport.addEventListener('scroll', this._onVisualViewportScroll.bind(this));
            visualViewport.addEventListener('resize', this._onVisualViewportResize.bind(this));
        }

        this._application.on('optionsUpdated', this.updateOptions.bind(this));
        this._application.on('zoomChanged', this._onZoomChanged.bind(this));
        this._application.on('closePopups', this._onClosePopups.bind(this));
        chrome.runtime.onMessage.addListener(this._onRuntimeMessage.bind(this));

        this._textScanner.on('clear', this._onTextScannerClear.bind(this));
        this._textScanner.on('searchSuccess', this._onSearchSuccess.bind(this));
        this._textScanner.on('searchEmpty', this._onSearchEmpty.bind(this));
        this._textScanner.on('searchError', this._onSearchError.bind(this));

        /* eslint-disable @stylistic/no-multi-spaces */
        this._application.crossFrame.registerHandlers([
            ['frontendClosePopup',       this._onApiClosePopup.bind(this)],
            ['frontendCaptureStudyMedia', (/** @type {{token: string, start: number, duration: number}} */ {token, start, duration}) => youtubeStudyContext.capture(token, start, duration)],
            ['frontendCancelStudyMedia', (/** @type {{token: string}} */ {token}) => { youtubeStudyContext.cancel(token); }],
            ['frontendStudyShortcut',    this._onApiStudyShortcut.bind(this)],
            ['frontendCopySelection',    this._onApiCopySelection.bind(this)],
            ['frontendGetPopupSelectionText', this._onApiGetPopupSelectionText.bind(this)],
            ['frontendGetPopupInfo',     this._onApiGetPopupInfo.bind(this)],
            ['frontendGetPageInfo',      this._onApiGetPageInfo.bind(this)],
        ]);
        /* eslint-enable @stylistic/no-multi-spaces */

        this._prepareSiteSpecific();
        this._updateContentScale();
        this._signalFrontendReady(null);
    }

    /**
     * Set whether or not the instance is disabled.
     * @param {boolean} disabled Whether or not the instance is disabled.
     */
    setDisabledOverride(disabled) {
        this._disabledOverride = disabled;
        this._updateTextScannerEnabled();
    }

    /**
     * Set or clear an override options context object.
     * @param {?import('settings').OptionsContext} optionsContext An options context object to use as the override, or `null` to clear the override.
     */
    setOptionsContextOverride(optionsContext) {
        this._optionsContextOverride = optionsContext;
    }

    /**
     * Performs a new search on a specific source.
     * @param {import('text-source').TextSource} textSource The text source to search.
     */
    async setTextSource(textSource) {
        this._textScanner.setCurrentTextSource(null);
        await this._textScanner.search(textSource, null, false, true);
    }

    /**
     * Updates the internal options representation.
     */
    async updateOptions() {
        try {
            await this._updateOptionsInternal();
        } catch (e) {
            if (!this._application.webExtension.unloaded) {
                throw e;
            }
        }
    }

    /**
     * Waits for the previous `showContent` call to be completed.
     * @returns {Promise<void>} A promise which is resolved when the previous `showContent` call has completed.
     */
    showContentCompleted() {
        return this._lastShowPromise;
    }

    // Message handlers

    /** @type {import('application').ApiHandler<'frontendRequestReadyBroadcast'>} */
    _onMessageRequestFrontendReadyBroadcast({frameId}) {
        this._signalFrontendReady(frameId);
    }

    // Action handlers

    /**
     * @returns {void}
     */
    _onActionScanSelectedText() {
        void this._studySelectionShortcut(true, true);
    }

    /**
     * @returns {void}
     */
    _onApiScanSelectedText() {
        void this._scanSelectedText(false, true, true);
    }

    /**
     * @returns {void}
     */
    _onActionScanTextAtSelection() {
        void this._studySelectionShortcut(false, true);
    }

    /**
     * @returns {void}
     */
    _onActionScanTextAtCaret() {
        void this._scanSelectedText(true, false);
    }

    /** @param {import('text-scanner').EventArgument<'selectionShortcut'>} details */
    _onSelectionShortcut({event}) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) { void this._studySelectionShortcut(true, true); }
    }

    /** @type {import('cross-frame-api').ApiHandler<'frontendStudyShortcut'>} */
    async _onApiStudyShortcut({usePointer}) {
        await this._studySelectionShortcut(true, usePointer);
    }

    /**
     * @param {boolean} disallowExpandSelection
     * @param {boolean} [usePointer] Modifier scanning follows the pointer, not the previously focused iframe.
     */
    async _studySelectionShortcut(disallowExpandSelection, usePointer = false) {
        const scanner = this._textScanner;
        const consumedSelection = scanner.isSelectionFromLookup(true);
        const range = consumedSelection ? null : this._getFirstSelectionRange(false);
        if (!range && usePointer && this._pageType === 'popup' && !document.documentElement.matches(':hover')) {
            const forward = new CustomEvent('study-shortcut-forward', {cancelable: true, detail: {usePointer}});
            document.dispatchEvent(forward);
            if (forward.defaultPrevented) { return; }
        }
        // A hidden root is recovery, not a new lookup at whatever moved behind it.
        if (!range && this._pageType === 'web' && this._popup !== null && !await this._popup.isVisible() &&
        await this._popup.toggleStudyLayer()) { return; }
        const point = usePointer ? scanner.getPointerPosition() : null;
        const moved = point && (!this._studyLastShortcutPoint || point.x !== this._studyLastShortcutPoint.x || point.y !== this._studyLastShortcutPoint.y);
        this._studyLastShortcutPoint = point;
        const pointer = moved ? scanner.getTextSourceAtPointer() : null;
        const last = this._studyLastLookupSource ?? scanner.getCurrentTextSource();
        if (range) {
            pointer?.cleanup();
            scanner.setCurrentTextSource(null);
            await this._scanSelectedText(false, disallowExpandSelection, true);
            return;
        }
        if (pointer) {
            const sameWord = (!(scanner instanceof SubtitleTextScanner) || this._studyLastLookupQuery === scanner.studyQuery) &&
            last instanceof TextSourceRange && pointer instanceof TextSourceRange &&
            !/\s/.test(last.text()) && last.range.toString() === last.text() &&
            last.range.isPointInRange(pointer.range.startContainer, pointer.range.startOffset);
            if (!sameWord) {
                // Release only the already-used range before retargeting. Otherwise a
                // manual highlight can survive and win again on every other shortcut.
                if (consumedSelection) { window.getSelection()?.removeAllRanges(); }
                scanner.setCurrentTextSource(null);
                try {
                    await scanner.search(pointer, {focus: true});
                } finally { pointer.cleanup(); }
                return;
            }
            pointer.cleanup();
        }
        const toggle = new CustomEvent('study-shortcut-toggle', {cancelable: true});
        document.dispatchEvent(toggle);
        if (toggle.defaultPrevented) { return; }
        if (this._popup !== null) {
            try {
                if (await this._popup.toggleStudyLayer()) { return; }
            } catch { /* A discarded frame falls back to root close. */ }
        }
        this._clearSelection(false, true);
    }

    // API message handlers

    /** @type {import('cross-frame-api').ApiHandler<'frontendClosePopup'>} */
    _onApiClosePopup() {
        this._clearSelection(false, true, true);
    }

    /**
     * @param {KeyboardEvent} event
     * @returns {Promise<boolean>}
     */
    async _onStudyLookupKey(event) {
        if (event.key === 'Escape') {
            const closeMini = new CustomEvent('study-mini-close', {cancelable: true});
            if (this._pageType === 'popup') { document.dispatchEvent(closeMini); }
            if (closeMini.defaultPrevented) {
                event.preventDefault();
                event.stopImmediatePropagation();
                this._textScanner.clearSelection();
                return true;
            }
            this._clearSelection(false, true, true);
            return true;
        }
        if (this._pageType === 'popup') {
            this._textScanner.clearSelection();
            return false;
        }
        if (await this._isPointerOverAnyPopup()) { return true; }
        if (this._popup !== null && await this._popup.isVisible()) {
            this._clearSelection(false, true, true);
            return true;
        }
        this._textScanner.clearSelection();
        return false;
    }

    /** @type {import('cross-frame-api').ApiHandler<'frontendCopySelection'>} */
    _onApiCopySelection() {
        // This will not work on Firefox if a popup has focus, which is usually the case when this function is called.
        document.execCommand('copy');
    }

    /** @type {import('cross-frame-api').ApiHandler<'frontendGetPopupSelectionText'>} */
    _onApiGetPopupSelectionText() {
        const selection = document.getSelection();
        return selection !== null ? selection.toString() : '';
    }

    /** @type {import('cross-frame-api').ApiHandler<'frontendGetPopupInfo'>} */
    _onApiGetPopupInfo() {
        return {
            popupId: (this._popup !== null ? this._popup.id : null),
        };
    }

    /** @type {import('cross-frame-api').ApiHandler<'frontendGetPageInfo'>} */
    _onApiGetPageInfo() {
        return {
            url: window.location.href,
            documentTitle: document.title,
        };
    }

    /** @type {import('application').ApiHandler<'frontendSetAllVisibleOverride'>} */
    async _onApiSetAllVisibleOverride({value, priority, awaitFrame}) {
        const result = await this._popupFactory.setAllVisibleOverride(value, priority);
        if (awaitFrame) {
            await promiseAnimationFrame(100);
        }
        return result;
    }

    /** @type {import('application').ApiHandler<'frontendClearAllVisibleOverride'>} */
    async _onApiClearAllVisibleOverride({token}) {
        return await this._popupFactory.clearAllVisibleOverride(token);
    }

    // Private

    /**
     * @returns {void}
     */
    _onResize() {
        void this._updatePopupPosition();
    }

    /** @type {import('extension').ChromeRuntimeOnMessageCallback<import('application').ApiMessageAny>} */
    _onRuntimeMessage({action, params}, _sender, callback) {
        if (String(action) === 'studyCueValidate') {
            const request = /** @type {{queryId?: string}} */ (/** @type {unknown} */ (params));
            const active = this._studyCueCurrent;
            const scanner = this._textScanner;
            callback({ok: _sender.id === chrome.runtime.id && scanner instanceof SubtitleTextScanner &&
            !!active && active.snapshot.queryId === request?.queryId && scanner.studyQuery === active.query &&
            active.snapshot.sourceConfirmed === true});
            return false;
        }
        return invokeApiMapHandler(this._runtimeApiMap, action, params, [], callback);
    }

    /**
     * @param {{newZoomFactor: number}} params
     */
    _onZoomChanged({newZoomFactor}) {
        this._pageZoomFactor = newZoomFactor;
        this._updateContentScale();
    }

    /**
     * @returns {void}
     */
    _onClosePopups() {
        // Display history cleanup closes nested lookups, not the newly shown host card.
        // Explicit close/Esc use the dedicated force=true action instead.
        this._clearSelection(true);
        this._clearMousePosition();
    }

    /**
     * @returns {void}
     */
    _onVisualViewportScroll() {
        void this._updatePopupPosition();
    }

    /**
     * @returns {void}
     */
    _onVisualViewportResize() {
        this._updateContentScale();
    }

    /**
     * @returns {void}
     */
    _onTextScannerClear() {
        this._clearSelection(false);
    }

    /**
     * @param {import('text-scanner').EventArgument<'searchSuccess'>} details
     */
    _onSearchSuccess({type, dictionaryEntries, sentence, inputInfo: {eventType, detail: inputInfoDetail}, textSource, optionsContext, detail, pageTheme}) {
        const scanner = this._textScanner;
        if (scanner instanceof SubtitleTextScanner) {
            const request = scanner.studyRequests.get(textSource);
            if (request && request.query !== scanner.studyQuery) { return; }
        }
        this._studyLastLookupSource = typeof textSource.clone === 'function' ? textSource.clone() : textSource;
        if (scanner instanceof SubtitleTextScanner) { this._studyLastLookupQuery = scanner.studyQuery; }
        this._stopClearSelectionDelayed();
        let focus = (eventType === 'mouseMove');
        if (typeof inputInfoDetail === 'object' && inputInfoDetail !== null) {
            const focus2 = inputInfoDetail.focus;
            if (typeof focus2 === 'boolean') { focus = focus2; }
        }
        if (this._pageType === 'web' && textSource instanceof TextSourceRange &&
        this._textScanner instanceof SubtitleTextScanner && textSource.text().length <= 128 &&
        (!sentence?.text.trim() || sentence.text === textSource.text())) {
            sentence = this._textScanner.extractArticleSentence(textSource) ?? sentence;
        }
        // If no DOM context is available, keep only the actual selected text.
        if (this._pageType === 'web' && dictionaryEntries.length === 0 && !sentence?.text.trim()) {
            const selected = textSource.text();
            if (selected.length <= 128 && /[A-Za-z]/.test(selected) && !/\p{Cc}/u.test(selected)) {
                sentence = {text: selected, offset: 0};
            }
        }
        this._showContent(textSource, focus, dictionaryEntries, type, sentence, detail !== null ? detail.documentTitle : null, optionsContext, pageTheme);
    }

    /** */
    _onSearchEmpty() {
        const scanningOptions = /** @type {import('settings').ProfileOptions} */ (this._options).scanning;
        if (scanningOptions.autoHideResults) {
            void this._clearSelectionDelayed(scanningOptions.hideDelay, false, false);
        }
    }

    /**
     * @param {import('text-scanner').EventArgument<'searchError'>} details
     */
    _onSearchError({error, textSource, inputInfo: {passive}}) {
        if (this._application.webExtension.unloaded) {
            if (textSource !== null && !passive) {
                this._showExtensionUnloaded(textSource);
            }
        } else {
            log.error(error);
        }
    }

    /**
     * @returns {void}
     */
    _onPopupFramePointerOver() {
        this._isPointerOverPopup = true;
    }

    /**
     * @returns {void}
     */
    _onPopupFramePointerOut() {
        this._isPointerOverPopup = false;
        if (!this._options) { return; }
        const {scanning: {hidePopupOnCursorExit, hidePopupOnCursorExitDelay}} = this._options;
        if (hidePopupOnCursorExit) {
            void this._clearSelectionDelayed(hidePopupOnCursorExitDelay, false, false);
        }
    }

    /**
     * @param {boolean} passive
     * @param {boolean} [force] Explicit close or disabling the scanner.
     * @param {boolean} [closeOwner] Explicit user close, not a nested scanner lifecycle reset.
     */
    _clearSelection(passive, force = false, closeOwner = false) {
        this._stopClearSelectionDelayed();
        if (force) { this._studyCueCurrent = null; }
        if (force && this._textScanner instanceof SubtitleTextScanner) { this._textScanner.cancelStudySearch(); }
        if (this._popup !== null) {
            void this._popup.clearAutoPlayTimer();
            const ownsPopup = this._pageType !== 'popup' || this._popup.id !== this._parentPopupId;
            if (ownsPopup || closeOwner) {
                void this._popup.hide(!passive, force);
                this._isPointerOverPopup = false;
            }
        }
        this._textScanner.clearSelection();
        if (force) {
            if (typeof this._textScanner.suppressStudyScan === 'function') {
                this._textScanner.suppressStudyScan();
            }
            // selectText=false leaves the user's native subtitle range behind. Chrome
            // can then treat the next drag as manipulation of that old selection.
            // Only an explicit close releases it; mousedown/passive clears and article
            // selections retain the existing behavior.
            const selection = window.getSelection();
            const range = this._getFirstSelectionRange ? this._getFirstSelectionRange(false) : null;
            if (range && readStudySubtitle(TextSourceRange.createLazy(range))) {
                selection?.removeAllRanges();
            }
        }
    }

    /** */
    _clearMousePosition() {
        this._textScanner.clearMousePosition();
    }

    /**
     * Checks if the pointer is over any popup in the hierarchy (parent or child popups).
     * @returns {Promise<boolean>}
     * @private
     */
    async _isPointerOverAnyPopup() {
        if (this._isPointerOverPopup) {
            return true;
        }

        let childPopup = this._popup?.child;
        while (typeof childPopup !== 'undefined' && childPopup !== null) {
            try {
                const isOver = childPopup.isPointerOver();
                if (isOver) {
                    return true;
                }
                childPopup = childPopup.child;
            } catch (e) {
                log.warn(new Error('Error checking child popup pointer state'));
            }
        }

        let parentPopup = this._popup?.parent;
        while (typeof parentPopup !== 'undefined' && parentPopup !== null) {
            try {
                const isOver = parentPopup.isPointerOver();
                if (isOver) {
                    return true;
                }
                parentPopup = parentPopup.parent;
            } catch (e) {
                log.warn(new Error('Error checking parent popup pointer state'));
            }
        }

        return false;
    }

    /**
     * @param {number} delay
     * @param {boolean} restart
     * @param {boolean} passive
     */
    async _clearSelectionDelayed(delay, restart, passive) {
        if (!this._textScanner.hasSelection()) { return; }

        // Add a small delay to allow mouseover events to be processed
        await new Promise((resolve) => {
            setTimeout(resolve, 50);
        });

        // Always check if pointer is over any popup before clearing
        if (await this._isPointerOverAnyPopup()) { return; }

        if (delay > 0) {
            if (this._clearSelectionTimer !== null && !restart) { return; } // Already running
            this._stopClearSelectionDelayed();
            this._clearSelectionTimer = setTimeout(async () => {
                this._clearSelectionTimer = null;
                if (await this._isPointerOverAnyPopup()) { return; }
                this._clearSelection(passive);
            }, delay);
        } else {
            this._clearSelection(passive);
        }
    }

    /**
     * @returns {void}
     */
    _stopClearSelectionDelayed() {
        if (this._clearSelectionTimer !== null) {
            clearTimeout(this._clearSelectionTimer);
            this._clearSelectionTimer = null;
        }
    }

    /**
     * @returns {Promise<void>}
     */
    async _updateOptionsInternal() {
        const optionsContext = await this._getOptionsContext();
        const options = await this._application.api.optionsGet(optionsContext);
        const {scanning: scanningOptions, sentenceParsing: sentenceParsingOptions} = options;
        this._options = options;

        this._hotkeyHandler.setHotkeys('web', options.inputs.hotkeys);

        await this._updatePopup();

        const preventMiddleMouseOnPage = this._getPreventSecondaryMouseValueForPageType(scanningOptions.preventMiddleMouse);
        const preventMiddleMouseOnTextHover = scanningOptions.preventMiddleMouse.onTextHover;
        const preventBackForwardOnPage = this._getPreventSecondaryMouseValueForPageType(scanningOptions.preventBackForward);
        const preventBackForwardOnTextHover = scanningOptions.preventBackForward.onTextHover;
        this._textScanner.language = options.general.language;
        this._textScanner.setOptions({
            inputs: scanningOptions.inputs,
            deepContentScan: scanningOptions.deepDomScan,
            normalizeCssZoom: scanningOptions.normalizeCssZoom,
            selectText: scanningOptions.selectText,
            delay: scanningOptions.delay,
            scanLength: scanningOptions.length,
            layoutAwareScan: scanningOptions.layoutAwareScan,
            preventMiddleMouseOnPage,
            preventMiddleMouseOnTextHover,
            preventBackForwardOnPage,
            preventBackForwardOnTextHover,
            sentenceParsingOptions,
            scanWithoutMousemove: scanningOptions.scanWithoutMousemove,
            scanResolution: scanningOptions.scanResolution,
        });
        this._updateTextScannerEnabled();

        if (this._pageType !== 'web') {
            const excludeSelectors = ['.scan-disable', '.scan-disable *'];
            if (!scanningOptions.enableOnPopupExpressions) {
                excludeSelectors.push('.source-text', '.source-text *');
            }
            this._textScanner.excludeSelector = excludeSelectors.join(',');
            this._textScanner.touchEventExcludeSelector = '.gloss-link, .gloss-link *, .tag, .tag *, .inflection';
        }

        this._updateContentScale();

        await this._textScanner.searchLast();
    }

    /**
     * @returns {Promise<void>}
     */
    async _updatePopup() {
        const {usePopupWindow, showIframePopupsInRootFrame} = /** @type {import('settings').ProfileOptions} */ (this._options).general;
        const isIframe = !this._useProxyPopup && (window !== window.parent);

        const currentPopup = this._popup;

        /** @type {Promise<?import('popup').PopupAny>|undefined} */
        let popupPromise;
        if (usePopupWindow && this._canUseWindowPopup) {
            popupPromise = this._popupCache.get('window');
            if (typeof popupPromise === 'undefined') {
                popupPromise = this._getPopupWindow();
                this._popupCache.set('window', popupPromise);
            }
        } else if (
            isIframe &&
            showIframePopupsInRootFrame &&
            getFullscreenElement() === null &&
            this._allowRootFramePopupProxy
        ) {
            popupPromise = this._popupCache.get('iframe');
            if (typeof popupPromise === 'undefined') {
                popupPromise = this._getIframeProxyPopup();
                this._popupCache.set('iframe', popupPromise);
            }
        } else if (this._useProxyPopup) {
            popupPromise = this._popupCache.get('proxy');
            if (typeof popupPromise === 'undefined') {
                popupPromise = this._getProxyPopup();
                this._popupCache.set('proxy', popupPromise);
            }
        } else {
            popupPromise = this._popupCache.get('default');
            if (typeof popupPromise === 'undefined') {
                popupPromise = this._getDefaultPopup();
                this._popupCache.set('default', popupPromise);
            }
        }

        /**
         * The token below is used as a unique identifier to ensure that a new _updatePopup call
         * hasn't been started during the await.
         * @type {?import('core').TokenObject}
         */
        const token = {};
        this._updatePopupToken = token;
        const popup = await popupPromise;
        const optionsContext = await this._getOptionsContext();
        if (this._updatePopupToken !== token) { return; }
        if (popup !== null) {
            await popup.setOptionsContext(optionsContext);
        }
        if (this._updatePopupToken !== token) { return; }

        if (popup !== currentPopup) {
            this._clearSelection(true, true);
        }

        this._popupEventListeners.removeAllEventListeners();
        this._popup = popup;
        if (popup !== null) {
            this._popupEventListeners.on(popup, 'mouseOver', this._onPopupFramePointerOver.bind(this));
            this._popupEventListeners.on(popup, 'mouseOut', this._onPopupFramePointerOut.bind(this));
        }
        this._isPointerOverPopup = false;
    }

    /**
     * @returns {Promise<?import('popup').PopupAny>}
     */
    async _getDefaultPopup() {
        const isXmlDocument = (typeof XMLDocument !== 'undefined' && document instanceof XMLDocument);
        if (isXmlDocument) {
            return null;
        }

        const {frameId} = this._application;
        if (frameId === null) {
            return null;
        }

        return await this._popupFactory.getOrCreatePopup({
            frameId,
            depth: this._depth,
            childrenSupported: this._childrenSupported,
        });
    }

    /**
     * @returns {Promise<import('popup').PopupAny>}
     */
    async _getProxyPopup() {
        // A lookup inside our card replaces that card, never creates a second layer.
        const sameCard = this._pageType === 'popup';
        return await this._popupFactory.getOrCreatePopup({
            frameId: this._parentFrameId,
            depth: this._depth,
            id: sameCard ? this._parentPopupId : null,
            parentPopupId: sameCard ? null : this._parentPopupId,
            childrenSupported: this._childrenSupported,
        });
    }

    /**
     * @returns {Promise<?import('popup').PopupAny>}
     */
    async _getIframeProxyPopup() {
        const targetFrameId = 0; // Root frameId
        try {
            await this._waitForFrontendReady(targetFrameId, 10000);
        } catch (e) {
            // Root frame not available
            return await this._getDefaultPopup();
        }

        const {popupId} = await this._application.crossFrame.invoke(targetFrameId, 'frontendGetPopupInfo', void 0);
        if (popupId === null) {
            return null;
        }

        const popup = await this._popupFactory.getOrCreatePopup({
            frameId: targetFrameId,
            id: popupId,
            childrenSupported: this._childrenSupported,
        });
        popup.on('offsetNotFound', () => {
            this._allowRootFramePopupProxy = false;
            void this._updatePopup();
        });
        return popup;
    }

    /**
     * @returns {Promise<import('popup').PopupAny>}
     */
    async _getPopupWindow() {
        return await this._popupFactory.getOrCreatePopup({
            depth: this._depth,
            popupWindow: true,
            childrenSupported: this._childrenSupported,
        });
    }

    /**
     * @returns {Element[]}
     */
    _ignoreElements() {
        if (this._popup !== null) {
            const container = this._popup.container;
            if (container !== null) {
                return [container];
            }
        }
        return [];
    }

    /**
     * @param {number} x
     * @param {number} y
     * @returns {Promise<boolean>}
     */
    async _ignorePoint(x, y) {
        // This frontend proxies the root card itself. Its bounds must not block
        // modifier lookups over the original sentence or dictionary in that card.
        if (this._pageType === 'popup') { return false; }
        try {
            return this._popup !== null && await this._popup.containsPoint(x, y);
        } catch (e) {
            if (!this._application.webExtension.unloaded) {
                throw e;
            }
            return false;
        }
    }

    /**
     * @param {import('text-source').TextSource} textSource
     */
    _showExtensionUnloaded(textSource) {
        void this._showPopupContent(textSource, null, null);
    }

    /**
     * @param {import('text-source').TextSource} textSource
     * @param {boolean} focus
     * @param {?import('dictionary').DictionaryEntry[]} dictionaryEntries
     * @param {import('display').PageType} type
     * @param {?import('display').HistoryStateSentence} sentence
     * @param {?string} documentTitle
     * @param {import('settings').OptionsContext} optionsContext
     * @param {'dark' | 'light'} pageTheme
     */
    _showContent(textSource, focus, dictionaryEntries, type, sentence, documentTitle, optionsContext, pageTheme) {
        const query = textSource.text();
        // A collapsed/blank/punctuation miss must not replace the parent's content or origin.
        // Deliberately selected expressions without dictionary hits still keep their learning entry.
        if (type === 'terms' && dictionaryEntries?.length === 0 && !/[\p{L}\p{N}]/u.test(query)) { return; }
        if (this._pageType !== 'web' && type === 'terms' && dictionaryEntries !== null) {
            const rect = typeof textSource.getRects === 'function' ? textSource.getRects()[0] : null;
            const event = new CustomEvent('study-mini-lookup', {cancelable: true, detail: {query, entries: dictionaryEntries, rect}});
            document.dispatchEvent(event);
            if (event.defaultPrevented) { return; }
        }
        const {url} = optionsContext;
        /** @type {import('display').HistoryState} */
        const detailsState = {
            focusEntry: 0,
            optionsContext,
            url,
            pageTheme,
        };
        if (sentence !== null) { detailsState.sentence = sentence; }
        const start = textSource instanceof TextSourceRange ? textSource.range.startContainer : null;
        const parent = start instanceof Element ? start : start?.parentElement;
        const youtube = textSource instanceof TextSourceRange ? youtubeStudyContext.read(textSource.range) : null;
        let subtitle = parent?.closest('.asbplayer-subtitles, .asbplayer-fullscreen-subtitles, .asbplayer-subtitles-container-bottom, .asbplayer-subtitles-container-top, #movie_player, .html5-video-player, .bpx-player-container, .bilibili-player-video-wrap, [data-asb-subtitle-index], .ytp-caption-window-container, .bpx-player-subtitle-panel, [data-asb-study-cue]');
        if (!youtube && !subtitle && parent && this._pageType === 'web' && /^https:\/\/(?:www\.|m\.)?(?:youtube\.com|bilibili\.com)\//.test(url ?? '')) {
            // Some caption extensions portal their overlay into body, outside the player DOM.
            // Video geometry is deny-only, never evidence for trusting a caption or authorizing writes.
            const rects = textSource.getRects();
            const overVideo = [...document.querySelectorAll('video')].some((video) => {
                const v = video.getBoundingClientRect();
                return v.width > 0 && v.height > 0 && rects.some((r) => r.width > 0 && r.height > 0 &&
                (r.left + r.right) / 2 >= v.left && (r.left + r.right) / 2 <= v.right &&
                (r.top + r.bottom) / 2 >= v.top && (r.top + r.bottom) / 2 <= v.bottom);
            });
            if (overVideo) { subtitle = parent; }
        }
        const scanner = /** @type {SubtitleTextScanner} */ (this._textScanner);
        const snapshot = scanner?.studySources?.get ? scanner.studySources.get(textSource) : null;
        this._studyCueCurrent = snapshot?.sourceConfirmed && snapshot.queryId ? {source: textSource, query: scanner.studyQuery, snapshot} : null;
        if (youtube) {
            detailsState.sentence = {...sentence, ...youtube.sentence};
            detailsState.url = youtube.url;
            detailsState.videoTime = youtube.videoTime;
            detailsState.studyMediaToken = youtube.token;
            detailsState.studyMediaRange = youtube.mediaRange;
            detailsState.studySentenceTranslation = youtube.translation;
        } else if (snapshot) {
            // Keep the entire frozen snapshot in the existing history sentence; no Native schema changes.
            const frozenSentence = {...sentence, text: snapshot.text, offset: snapshot.selectionStart, adjacent: snapshot.adjacentCues.map((c) => c.text).join('\n'), studySubtitle: snapshot};
            detailsState.sentence = frozenSentence;
            if (snapshot.url) { detailsState.url = snapshot.url; }
            if (snapshot.playbackSeconds !== null) { detailsState.videoTime = snapshot.playbackSeconds; }
        } else if (subtitle) {
            // Container recognition is deny-only, never proof or permission from page attributes.
            // Keep an internal unknown sentinel even with no extracted sentence, and through history.
            const unknown = {version: 0,
                sourceState: /** @type {const} */ ('unknown'),
                sourceConfirmed: false,
                text: sentence?.text ?? query,
                word: query,
                selectionStart: sentence?.offset ?? 0,
                selectionEnd: (sentence?.offset ?? 0) + query.length,
                trackIndex: -1,
                cueIndex: -1,
                trackName: null,
                language: null,
                originalStartMs: null,
                originalEndMs: null,
                subtitleOffsetMs: null,
                url: null,
                playbackSeconds: null,
                adjacentCues: [],
                revision: '',
                sourceRevision: null};
            const unknownSentence = {...sentence, text: unknown.text, offset: unknown.selectionStart, adjacent: '', studySubtitle: unknown};
            detailsState.sentence = unknownSentence;
        }
        if (documentTitle !== null) { detailsState.documentTitle = documentTitle; }
        if (this._pageType === 'popup') {
            detailsState.url = '';
            detailsState.documentTitle = '词典解释';
            if (sentence !== null && !snapshot && !subtitle) { detailsState.sentence = {...sentence, sourceKind: 'dictionary'}; }
        }
        const {tabId, frameId} = this._application;
        /** @type {import('display').HistoryContent} */
        const detailsContent = {
            contentOrigin: {tabId, frameId},
        };
        if (dictionaryEntries !== null) {
            detailsContent.dictionaryEntries = dictionaryEntries;
        }
        /** @type {import('display').ContentDetails} */
        const details = {
            focus,
            historyMode: 'clear',
            params: {
                type,
                query,
                wildcards: 'off',
            },
            state: detailsState,
            content: detailsContent,
        };
        if (textSource instanceof TextSourceElement && textSource.fullContent !== query) {
            details.params.full = textSource.fullContent;
            details.params['full-visible'] = 'true';
        }
        void this._showPopupContent(textSource, optionsContext, details);
    }

    /**
     * @param {import('text-source').TextSource} textSource
     * @param {?import('settings').OptionsContext} optionsContext
     * @param {?import('display').ContentDetails} details
     * @returns {Promise<void>}
     */
    _showPopupContent(textSource, optionsContext, details) {
        const sourceRects = [];
        for (const {left, top, right, bottom} of textSource.getRects()) {
            sourceRects.push({left, top, right, bottom});
        }
        this._lastShowPromise = (
            this._popup !== null ?
            this._popup.showContent(
                {
                    optionsContext,
                    sourceRects,
                    writingMode: textSource.getWritingMode(),
                },
                details,
            ) :
            Promise.resolve()
        );
        this._lastShowPromise.catch((error) => {
            if (this._application.webExtension.unloaded) { return; }
            log.error(error);
        });
        return this._lastShowPromise;
    }

    /**
     * @returns {void}
     */
    _updateTextScannerEnabled() {
        const enabled = (this._options !== null && this._options.general.enable && !this._disabledOverride);
        if (enabled === this._textScanner.isEnabled()) { return; }
        this._textScanner.setEnabled(enabled);
        if (this._textScannerHasBeenEnabled) {
            this._clearSelection(true, true);
        }
        if (enabled) {
            this._textScannerHasBeenEnabled = true;
        }
    }

    /**
     * @returns {void}
     */
    _updateContentScale() {
        const {popupScalingFactor, popupScaleRelativeToPageZoom, popupScaleRelativeToVisualViewport} = /** @type {import('settings').ProfileOptions} */ (this._options).general;
        let contentScale = popupScalingFactor;
        if (popupScaleRelativeToPageZoom) {
            contentScale /= this._pageZoomFactor;
        }
        if (popupScaleRelativeToVisualViewport) {
            const {visualViewport} = window;
            const visualViewportScale = (typeof visualViewport !== 'undefined' && visualViewport !== null ? visualViewport.scale : 1);
            contentScale /= visualViewportScale;
        }
        if (contentScale === this._contentScale) { return; }

        this._contentScale = contentScale;
        if (this._popup !== null) {
            void this._popup.setContentScale(this._contentScale);
        }
        void this._updatePopupPosition();
    }

    /**
     * @returns {Promise<void>}
     */
    async _updatePopupPosition() {
        const textSource = this._textScanner.getCurrentTextSource();
        if (
            textSource !== null &&
            this._popup !== null &&
            await this._popup.isVisible()
        ) {
            void this._showPopupContent(textSource, null, null);
        }
    }

    /**
     * @param {?number} targetFrameId
     */
    _signalFrontendReady(targetFrameId) {
        /** @type {import('application').ApiMessageNoFrameId<'frontendReady'>} */
        const message = {action: 'frontendReady', params: {frameId: this._application.frameId}};
        if (targetFrameId === null) {
            void this._application.api.broadcastTab(message);
        } else {
            void this._application.api.sendMessageToFrame(targetFrameId, message);
        }
    }

    /**
     * @param {number} frameId
     * @param {?number} timeout
     * @returns {Promise<void>}
     */
    async _waitForFrontendReady(frameId, timeout) {
        return new Promise((resolve, reject) => {
            /** @type {?import('core').Timeout} */
            let timeoutId = null;

            const cleanup = () => {
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                chrome.runtime.onMessage.removeListener(onMessage);
            };
            /** @type {import('extension').ChromeRuntimeOnMessageCallback<import('application').ApiMessageAny>} */
            const onMessage = (message, _sender, sendResponse) => {
                try {
                    const {action} = message;
                    if (action === 'frontendReady' && message.params.frameId === frameId) {
                        cleanup();
                        resolve();
                        sendResponse();
                    }
                } catch (e) {
                    // NOP
                }
            };

            if (timeout !== null) {
                timeoutId = setTimeout(() => {
                    timeoutId = null;
                    cleanup();
                    reject(new Error(`Wait for frontend ready timed out after ${timeout}ms`));
                }, timeout);
            }

            chrome.runtime.onMessage.addListener(onMessage);
            void this._application.api.broadcastTab({action: 'frontendRequestReadyBroadcast', params: {frameId: this._application.frameId}});
        });
    }

    /**
     * @param {import('settings').PreventSecondaryMouseOptions} preventSecondaryMouseOptions
     * @returns {boolean}
     */
    _getPreventSecondaryMouseValueForPageType(preventSecondaryMouseOptions) {
        switch (this._pageType) {
            case 'web': return preventSecondaryMouseOptions.onWebPages;
            case 'popup': return preventSecondaryMouseOptions.onPopupPages;
            case 'search': return preventSecondaryMouseOptions.onSearchPages;
        }
    }

    /**
     * @returns {Promise<import('settings').OptionsContext>}
     */
    async _getOptionsContext() {
        let optionsContext = this._optionsContextOverride;
        if (optionsContext === null) {
            optionsContext = (await this._getSearchContext()).optionsContext;
        }
        return optionsContext;
    }

    /**
     * @returns {Promise<import('text-scanner').SearchContext>}
     */
    async _getSearchContext() {
        let url = window.location.href;
        let documentTitle = document.title;
        if (this._useProxyPopup && this._parentFrameId !== null) {
            try {
                ({url, documentTitle} = await this._application.crossFrame.invoke(this._parentFrameId, 'frontendGetPageInfo', void 0));
            } catch (e) {
                // NOP
            }
        }

        let optionsContext = this._optionsContextOverride;
        if (optionsContext === null) {
            optionsContext = {depth: this._depth, url};
        }

        return {
            optionsContext,
            detail: {documentTitle},
        };
    }

    /**
     * @param {boolean} allowEmptyRange
     * @param {boolean} disallowExpandSelection
     * @param {boolean} showEmpty show empty popup if no results are found
     * @returns {Promise<boolean>}
     */
    async _scanSelectedText(allowEmptyRange, disallowExpandSelection, showEmpty = false) {
        safePerformance.mark('frontend:scanSelectedText:start');
        const range = this._getFirstSelectionRange(allowEmptyRange);
        if (range === null) { return false; }
        const source = disallowExpandSelection || !range.collapsed ? TextSourceRange.createLazy(range) : TextSourceRange.create(range);
        const selected = source.text();
        const articleSelection = this._pageType === 'web' && !allowEmptyRange && disallowExpandSelection &&
        !range.collapsed && selected.length <= 128 && /[A-Za-z]/.test(selected) && !/\p{Cc}/u.test(selected);
        await this._textScanner.search(source, {focus: true, restoreSelection: true}, showEmpty || articleSelection);
        safePerformance.mark('frontend:scanSelectedText:end');
        safePerformance.measure('frontend:scanSelectedText', 'frontend:scanSelectedText:start', 'frontend:scanSelectedText:end');
        return true;
    }

    /**
     * @param {boolean} allowEmptyRange
     * @returns {?Range}
     */
    _getFirstSelectionRange(allowEmptyRange) {
        const selection = window.getSelection();
        if (selection === null) { return null; }
        for (let i = 0, ii = selection.rangeCount; i < ii; ++i) {
            const range = selection.getRangeAt(i);
            if (range.toString().length > 0 || allowEmptyRange) {
                return range;
            }
        }
        return null;
    }

    /**
     * @returns {void}
     */
    _prepareSiteSpecific() {
        switch (location.hostname.toLowerCase()) {
            case 'docs.google.com':
                void this._prepareGoogleDocs();
                break;
        }
    }

    /**
     * @returns {Promise<void>}
     */
    async _prepareGoogleDocs() {
        const {GoogleDocsUtil} = await import('../accessibility/google-docs-util.js');
        const googleDocsUtil = new GoogleDocsUtil();
        this._textSourceGenerator.registerGetRangeFromPointHandler(googleDocsUtil.getRangeFromPoint.bind(googleDocsUtil));
    }
}
