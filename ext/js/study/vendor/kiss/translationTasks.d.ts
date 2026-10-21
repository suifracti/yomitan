export function runTranslationTasks<T>(tasks:((signal:AbortSignal)=>Promise<T>)[],signal?:AbortSignal):Promise<T[]>;
