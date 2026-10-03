import type { DownloadStartRequest, EngineUpdate } from '../../contracts/src/index';

export type EngineUpdateListener = (update: EngineUpdate) => void;

export class DownloadStartError extends Error {
  constructor(
    message: string,
    public readonly executionMayExist: boolean,
  ) {
    super(message);
    this.name = 'DownloadStartError';
  }
}

export function isDownloadStartError(error: unknown): error is DownloadStartError {
  return error instanceof DownloadStartError;
}

export interface DownloadEngine {
  start(request: DownloadStartRequest): Promise<void>;
  cancel(taskId: string): Promise<void>;
  subscribeUpdates(listener: EngineUpdateListener): () => void;
  dispose?(): Promise<void> | void;
}
