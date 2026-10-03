export type DownloadTypePayload = 'video' | 'audio' | 'mkv';

/**
 * Execution target. Exactly one of `sourceUrl` / `captureContextId` is present.
 * A captured task carries the opaque native context instead of a raw URL.
 */
export interface DownloadStartRequest {
  taskId: string;
  downloadType: DownloadTypePayload;
  downloadDir?: string;
  extraArgs?: Record<string, unknown>;
  sourceUrl?: string;
  captureContextId?: string;
}

export type EngineProgressUpdate = {
  type: 'progress';
  taskId: string;
  phase: 'Downloading' | 'Processing';
  progress: number;
  speed?: string;
};

export type EngineResultOutcome = 'Completed' | 'Failed' | 'Cancelled';

export type EngineResultUpdate = {
  type: 'result';
  taskId: string;
  outcome: EngineResultOutcome;
  error?: string;
  /** Trusted final output path from the native terminal result, when available. */
  filePath?: string;
};

export type EngineUpdate = EngineProgressUpdate | EngineResultUpdate;
