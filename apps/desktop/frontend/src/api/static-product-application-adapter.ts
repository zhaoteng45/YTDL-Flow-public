import type { CreateDownloadCommand, ErrorPayload, TaskPayload } from '@ytdl-flow/contracts';
import type {
  AnalyzeMediaResult,
  CancelCommandResult,
  CreateDownloadResult,
} from '@ytdl-flow/application';

import type { ProductApplicationApi } from './product-application-api';

const PREVIEW_ERROR: ErrorPayload = {
  code: 'preview-mode',
  message: '静态预览模式不连接真实下载后端',
};

/**
 * Preview/dev fixture adapter. It keeps the read seam honest without
 * fabricating successful analyze or download commands.
 */
export class StaticProductApplicationAdapter implements ProductApplicationApi {
  constructor(private readonly tasks: readonly TaskPayload[]) {}

  async analyze(_sourceUrl: string): Promise<AnalyzeMediaResult> {
    return { ok: false, error: PREVIEW_ERROR };
  }

  async createDownload(_command: CreateDownloadCommand): Promise<CreateDownloadResult> {
    return { ok: false, error: PREVIEW_ERROR };
  }

  async cancelTask(_taskId: string): Promise<CancelCommandResult> {
    return { outcome: { type: 'cancel-rejected', error: PREVIEW_ERROR } };
  }

  async listTasks(): Promise<TaskPayload[]> {
    return this.tasks.map((task) => ({ ...task }));
  }
}
