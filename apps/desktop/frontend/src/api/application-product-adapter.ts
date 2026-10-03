import type { CreateDownloadCommand, TaskPayload } from '@ytdl-flow/contracts';
import type {
  AnalyzeMediaResult,
  CancelCommandResult,
  CreateDownloadResult,
  DownloadProductService,
  TaskQueryService,
} from '@ytdl-flow/application';

import type { ProductApplicationApi } from './product-application-api';

/**
 * Composes the Application product use cases with the existing read seam.
 * This is the only product API implementation the React runtime uses.
 */
export class ApplicationProductApplicationAdapter implements ProductApplicationApi {
  constructor(
    private readonly product: DownloadProductService,
    private readonly queries: Pick<TaskQueryService, 'listTasks'>,
  ) {}

  analyze(sourceUrl: string): Promise<AnalyzeMediaResult> {
    return this.product.analyze(sourceUrl);
  }

  createDownload(command: CreateDownloadCommand): Promise<CreateDownloadResult> {
    return this.product.createDownload(command);
  }

  cancelTask(taskId: string): Promise<CancelCommandResult> {
    return this.product.cancel(taskId);
  }

  async listTasks(): Promise<TaskPayload[]> {
    return this.queries.listTasks();
  }
}
