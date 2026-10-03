import type { AnalyzedMedia, CreateDownloadCommand, TaskPayload } from '@ytdl-flow/contracts';
import type {
  AnalyzeMediaResult,
  CancelCommandResult,
  CreateDownloadResult,
} from '@ytdl-flow/application';

/**
 * Product-facing React API seam.
 *
 * Read capability stays the small `listTasks` contract; the product flow adds
 * analyze/create/cancel. Components and ViewModels depend on this interface
 * only, so they never invoke or listen to Tauri directly.
 */
export interface ProductApplicationApi {
  analyze(sourceUrl: string): Promise<AnalyzeMediaResult>;
  createDownload(command: CreateDownloadCommand): Promise<CreateDownloadResult>;
  cancelTask(taskId: string): Promise<CancelCommandResult>;
  listTasks(): Promise<TaskPayload[]>;
}

export type { AnalyzedMedia, TaskPayload };
