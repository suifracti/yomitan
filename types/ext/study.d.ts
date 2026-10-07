export type StudyConfig = {model: string; effort: string; level: string; goal: string; style: string; memoryEnabled: boolean; cacheEnabled: boolean};
export type Lookup = {sentence: string; word: string; context: string; mode?: string};
export type Result = {translation: string; meaning: string; notes: string};
export type NativeResult = {ok?: boolean; error?: string; result?: Result; models?: Model[]};
export type Model = {model: string; displayName: string; efforts: string[]; defaultEffort: string};
export type SavedWord = {id: string; word: string; sentence: string; context: string; url: string; title: string; created: number; videoTime?: number};
export type CacheEntry = {key: string; sentenceKey: string; created: number; result: Result};
export type NativeCall = (payload: object) => {promise: Promise<NativeResult>; cancel: () => void};
export type Storage = {get: (key: string) => Promise<Record<string, unknown>>; set: (value: Record<string, unknown>) => Promise<void>};
