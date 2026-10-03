/**
 * Product-facing Stage-3 analyze/download contracts.
 *
 * These are deliberately narrower than the native/legacy IPC DTOs: the native
 * VideoMetadata (entries, codecs, extra args, raw duration strings) must never
 * reach React components directly. The Tauri adapter normalizes the native
 * response into `AnalyzedMedia` and rejects playlist results.
 */

/**
 * Closed Stage-3 output selection. `video-auto` lets the existing execution
 * path pick the source format automatically; `audio-mp3` extracts audio to
 * MP3 with internally generated codec options. React cannot submit arbitrary
 * yt-dlp arguments or source format ids.
 */
export type DownloadSelection = 'video-auto' | 'audio-mp3';

export interface AnalyzedMedia {
  /** Exact source URL that was analyzed; binds the later download command. */
  sourceUrl: string;
  title: string;
  /** Omitted when the native response carries no usable channel/author. */
  channel?: string;
  /** Omitted when the native response carries no usable duration. */
  durationLabel?: string;
  /** Reference only; Stage-3 UI renders a placeholder (CSP blocks remote images). */
  thumbnailUrl?: string;
}

export interface CreateDownloadCommand {
  sourceUrl: string;
  selection: DownloadSelection;
}
