export type StudyConfig = {model: string; effort: string; autoDictionaryTranslate?: boolean; practiceEnabled?: boolean; cacheEnabled: boolean};
export type Lookup = {
    language?: string;
    dictionaryNotes?: string;
    sentence: string;
    word: string;
    context: string;
    mode?: string;
    question?: string;
};

export type Result = {translation: string; meaning: string; notes: string};
export type NativeResult = {
    usage?: Usage;
    usageStats?: UsageStats;
    ok?: boolean;
    error?: string;
    result?: Result | DictionaryResult | OrganizationResult | CardsResult;
    models?: Model[];
    library?: unknown;
};

export type OrganizationResult = {
    items: {id: string, text: string}[];
};

/** Frozen internal cue provenance, never a page-provided permission token. */
export type SubtitleSourceV1 = {
    version: 1; url: string; language: 'en' | 'ja'; trackIndex: number; trackName: string;
    text: string; originalStartMs: number; originalEndMs: number; subtitleOffsetMs: number;
    selectionStart: number; selectionEnd: number; word: string;
    provenance: {queryId: string; sourceRevision: string; cueIndex: number; tabId: number; frameId: 0; documentId: string};
};

export type CueSaveIntent = {targetId?: string; key: string; entry: LibraryEntry; turns: LearningTurn[]};

export type LibraryEntry = {
    sense?: {key: string; gloss: string};
    kind?: 'expression';
    baseWord?: string;
    recordId?: string;
    subtitleSource?: SubtitleSourceV1;
    language?: string;
    lemma?: string;
    reading?: string;
    dictionaryNotes?: string;
    dictionaryTranslation?: string;
    word: string;
    sentence: string;
    context: string;
    meaning: string;
    translation: string;
    notes: string;
    url: string;
    title: string;
    videoTime?: number;
    explanationSource?: string;
};

export type ReviewDraft = {
    id: string;
    reason: string;
    sourceHash?: string;
    cards: (CardDraft & {selected: boolean})[];
};

export type StudyTarget = {
    deck: string;
    model: string;
};

export type CardKind = 'meaning' | 'context' | 'expression' | 'grammar' | 'sentence' | 'listening';
export type SyncConflict = {key: string; local: unknown; remote: unknown};
export type SaveTargetSettings = {deckByKind?: Partial<Record<CardKind, string>>; ankiEnabled: boolean; targetId: string; vault: string; directory: string; deck: string; model: string};

export type LibraryRecord = {
    media?: {audio?: {name: string}};
    favorite?: boolean;
    learningState?: string;
    syncState?: string;
    conflicts?: SyncConflict[];
    ankiEnabled?: boolean;
    targetId?: string;
    reviewDraft?: ReviewDraft;
    draftStale?: boolean;
    target?: StudyTarget;
    cards?: (CardDraft & {
        id: string;
        state: string;
        noteId: number | null;
        kind?: CardKind;
        target?: StudyTarget;
        deck?: string;
        syncState?: string;
        error?: string;
        linkedExisting?: boolean;
        linkedByPoint?: boolean;
        reviewOnly?: boolean;
    })[];
    id: string;
    entry: LibraryEntry;
    version: string;
    path: string;
    openUrl: string;
    vaultSaved: boolean;
    ankiState: string;
    noteId: number | null;
    error?: string;
};

export type Model = {model: string; displayName: string; efforts: string[]; defaultEffort: string};
export type SavedWord = {sourceUrl?: string; language?: string; libraryId?: string; syncPending?: boolean; id: string; word: string; sentence: string; context: string; url: string; title: string; created: number; videoTime?: number};
export type CacheEntry = {key: string; sentenceKey: string; created: number; result: Result};
export type NativeCall = (payload: object) => {promise: Promise<NativeResult>; cancel: () => void};
export type Storage = {get: (key: string) => Promise<Record<string, unknown>>; set: (value: Record<string, unknown>) => Promise<void>};
export type DictionaryLookup = {
    language?: string;
    word: string;
    items: {id: string, text: string}[];
};

export type DictionaryResult = {items: {id: string; translation: string}[]};
export type DictionaryCacheEntry = {key: string; created: number; lookup: DictionaryLookup; result: DictionaryResult};
export type DetailSource = {
    language?: string;
    word: string;
    sentence: string;
    offset: number;
    context: string;
    url: string;
    title: string;
    videoTime?: number;
    profileIndex?: number;
};

export type DetailSnapshot = {id: string; source: DetailSource; created: number};

export type Usage = {
    requestId?: string;
    status: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    reasoningOutputTokens?: number;
};

export type UsageStats = {
    since: string | null;
    requests: number;
    unknown: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
};

export type LearningTurn = Result & {
    usage?: Usage;
    saved?: boolean;
    kind?: 'feedback';
    mode?: 'translate' | 'explain';
    relatedTurnId?: string;
    id: string;
    at: string;
    question: string;
    feedback: 'unconfirmed' | 'understood' | 'unclear';
};

export type JournalRow = {
    saved?: boolean;
    key: string;
    turn: LearningTurn;
};

export type LearningMaterial = {
    relatedMemory?: string;
    confirmedCards?: string;
    record?: LibraryRecord;
    language?: string;
    id: string;
    version: string;
    word: string;
    text: string;
    truncated: boolean;
};

export type CardDraft = {
    kind?: CardKind;
    front: string;
    back: string;
};

export type CardsResult = {
    items: {id: string, cards: CardDraft[], reason: string}[];
};

export type MediaAsset = {
    kind: string;
    mime: string;
    data: string;
};

export type MediaCapture = {
    assets: MediaAsset[];
    warnings: string[];
};

export type CaptureMedia = (start: number, duration: number, options?: {withFrame?: boolean, withVideo?: boolean}) => Promise<MediaCapture>;

export type MediaRange = {
    start: number;
    end: number;
};

export type ReviewView = {
    record: LibraryRecord;
    reason: string;
    cards: {
        front: HTMLTextAreaElement;
        back: HTMLTextAreaElement;
        check: HTMLInputElement;
    }[];
};

export type ReviewInput = {
    id: string;
    version: string;
    reason: string;
    cards: (CardDraft & {selected: boolean})[];
};

export type MiniLookup = {
    query: string;
    entries: import('dictionary').DictionaryEntry[];
    rect?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
    };
};

export type RememberSaveIntent = {targetId?: string; key: string; entry: LibraryEntry; turns: LearningTurn[]};

export type SyncLink = {key: string; id: string; language: string; targetId?: string};
export type SyncTask = {remember?: boolean; key: string; action: string; language: string; id?: string; targetId?: string; entry?: Partial<LibraryEntry>; turns?: LearningTurn[]; favorite?: boolean; revision?: string; error?: string};
