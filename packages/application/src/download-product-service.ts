import type {
  AnalyzedMedia,
  CreateDownloadCommand,
  DownloadSelection,
  DownloadStartRequest,
  ErrorPayload,
  TaskPayload,
} from '../../contracts/src';
import type { CancelCommandResult } from './download-service';
import { toErrorPayload } from './error-payload';
import { MediaAnalysisError, type MediaAnalyzer } from './media-analyzer';
import { validateSingleSourceUrl } from './source-url';

/**
 * The execution capability the product flow needs. Keeping it structural
 * (instead of importing DownloadService) lets tests provide a fake without
 * reaching into Application internals.
 */
export interface DownloadTaskCreator {
  createTask(
    sourceUrl: string,
    options?: Partial<Omit<DownloadStartRequest, 'taskId' | 'sourceUrl'>>,
  ): Promise<TaskPayload>;
  cancelTask(taskId: string): Promise<CancelCommandResult>;
}

export type AnalyzeMediaResult =
  | { ok: true; media: AnalyzedMedia }
  | { ok: false; error: ErrorPayload };

export type CreateDownloadResult =
  | { ok: true; task: TaskPayload }
  | { ok: false; error: ErrorPayload };

const SELECTION_OPTIONS: ReadonlyMap<
  DownloadSelection,
  Partial<Omit<DownloadStartRequest, 'taskId' | 'sourceUrl'>>
> = new Map([
  ['video-auto', { downloadType: 'video' }],
  ['audio-mp3', { downloadType: 'audio', extraArgs: { audioCodec: 'mp3' } }],
]);

/**
 * Small product use-case module that owns analyze -> create validation and
 * the closed output-selection mapping. React cannot submit arbitrary yt-dlp
 * arguments or source format ids through this seam.
 */
export class DownloadProductService {
  constructor(
    private readonly deps: {
      analyzer: MediaAnalyzer;
      downloads: DownloadTaskCreator;
    },
  ) {}

  async analyze(rawSourceUrl: string): Promise<AnalyzeMediaResult> {
    const validation = validateSingleSourceUrl(rawSourceUrl);
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }

    try {
      const media = await this.deps.analyzer.analyze(validation.sourceUrl);
      return { ok: true, media };
    } catch (error) {
      if (error instanceof MediaAnalysisError) {
        return { ok: false, error: { code: error.code, message: error.message } };
      }
      return { ok: false, error: toErrorPayload(error, 'analyze-failed') };
    }
  }

  async createDownload(command: CreateDownloadCommand): Promise<CreateDownloadResult> {
    const validation = validateSingleSourceUrl(command.sourceUrl);
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }

    const options = SELECTION_OPTIONS.get(command.selection);
    if (!options) {
      return {
        ok: false,
        error: {
          code: 'invalid-selection',
          message: `不支持的下载类型：${String(command.selection)}`,
        },
      };
    }

    try {
      const task = await this.deps.downloads.createTask(validation.sourceUrl, options);
      return { ok: true, task };
    } catch (error) {
      return { ok: false, error: toErrorPayload(error, 'create-task-failed') };
    }
  }

  async cancel(taskId: string): Promise<CancelCommandResult> {
    return this.deps.downloads.cancelTask(taskId);
  }
}
