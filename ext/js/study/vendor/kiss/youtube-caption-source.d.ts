/*
 * Types for the unmodified KISS Translator file next to this declaration.
 * The JavaScript file is kept byte-identical to upstream and is not type-checked.
 */

export type CaptionTrack = {
    vssId?: string;
    languageCode?: string;
    kind?: string;
    name?: string | {simpleText?: string; runs?: {text: string}[]};
    baseUrl?: string;
};

export type CaptionSnapshot = {
    captionTracks?: CaptionTrack[];
    selectedTrack?: CaptionTrack | null;
    defaultCaptionTrackIndex?: number;
};

export function youtubeVideoId(href?: string): string | null;
export function activeYoutubePlayer(root?: ParentNode, href?: string): Element | null;
export function captionUrl(value: string, videoId: string, base?: string): URL | null;
export function captionTrackId(track: CaptionTrack): string;
export function selectCaptionTrack(snapshot: CaptionSnapshot): CaptionTrack | null;
export function parseTimedText(text: string): unknown[];
