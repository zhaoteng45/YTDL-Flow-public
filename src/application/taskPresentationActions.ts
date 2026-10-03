import type { CancelCommandResult } from '../../packages/application/src';
import type { DownloadFormat, ExtraArgs } from '../types';

interface CurrentAnalysisResultHandle {
  readonly result: Promise<unknown>;
}

/**
 * Stable UI-facing command surface for task lifecycle events emitted by App.vue.
 * Async lifecycle commands preserve their settlement so the UI can surface
 * failures instead of creating unhandled renderer rejections.
 */
export interface TaskPresentationActions {
  analyzeUrls(urls: readonly string[]): void;
  startDownload(rowId: string, format: DownloadFormat, options?: Partial<ExtraArgs>): Promise<void>;
  cancel(rowId: string): Promise<CancelCommandResult>;
  remove(rowId: string): void;
  retryDownload(rowId: string): Promise<void>;
  reanalyze(rowId: string): Promise<void>;
}

/**
 * Structural port over the public CurrentTaskService surface needed by the UI.
 * No runtime dependency on the concrete class.
 */
export interface CurrentTaskPort {
  analyzeMany(urls: readonly string[]): unknown;
  start(rowId: string, format: DownloadFormat, options?: Partial<ExtraArgs>): Promise<unknown>;
  cancel(rowId: string): Promise<CancelCommandResult>;
  remove(rowId: string): unknown;
  retry(rowId: string): Promise<unknown>;
  reanalyze(rowId: string): CurrentAnalysisResultHandle | undefined;
}

/**
 * Current task adapter. Synchronous analysis/removal commands remain immediate,
 * while async task lifecycle settlement is kept observable by App.vue.
 */
export function createCurrentTaskPresentationActions(current: CurrentTaskPort): TaskPresentationActions {
  return {
    analyzeUrls: (urls) => {
      current.analyzeMany(urls);
    },
    startDownload: async (rowId, format, options) => {
      if (options) await current.start(rowId, format, options);
      else await current.start(rowId, format);
    },
    cancel: (rowId) => current.cancel(rowId),
    remove: (rowId) => {
      current.remove(rowId);
    },
    retryDownload: async (rowId) => {
      await current.retry(rowId);
    },
    reanalyze: async (rowId) => {
      const handle = current.reanalyze(rowId);
      await handle?.result;
    },
  };
}
