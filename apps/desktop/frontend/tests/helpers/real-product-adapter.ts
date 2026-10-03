import type {
  AnalyzedMedia,
  DownloadStartRequest,
  EngineUpdate,
  TaskPayload,
} from '@ytdl-flow/contracts';
import type { EngineUpdateListener, MediaAnalyzer } from '@ytdl-flow/application';
import { DownloadProductService, DownloadService, TaskQueryService } from '@ytdl-flow/application';
import { DownloadQueue, DownloadStatus, DownloadTask } from '@ytdl-flow/domain';

import { ApplicationProductApplicationAdapter } from '../../src/api/application-product-adapter';

export class RecordingEngine {
  public readonly started: DownloadStartRequest[] = [];
  public readonly cancelCalls: string[] = [];
  private readonly listeners = new Set<EngineUpdateListener>();

  async start(request: DownloadStartRequest): Promise<void> {
    this.started.push(request);
  }

  async cancel(taskId: string): Promise<void> {
    this.cancelCalls.push(taskId);
  }

  subscribeUpdates(listener: EngineUpdateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(update: EngineUpdate): void {
    for (const listener of this.listeners) {
      listener(update);
    }
  }
}

class FakeAnalyzer implements MediaAnalyzer {
  async analyze(sourceUrl: string): Promise<AnalyzedMedia> {
    return { sourceUrl, title: 'Real chain title' };
  }
}

/**
 * Builds the real Application product chain (DownloadProductService +
 * DownloadService + TaskQueryService) with a controllable engine, so tests can
 * exercise the same adapter composition the React runtime uses.
 */
export function createRealProductChain() {
  const queue = new DownloadQueue();
  const engine = new RecordingEngine();
  const downloads = new DownloadService(queue, engine, () => 'task-adapter');
  const product = new DownloadProductService({ analyzer: new FakeAnalyzer(), downloads });
  const api = new ApplicationProductApplicationAdapter(product, new TaskQueryService(queue));

  return {
    api,
    engine,
    queue,
    downloads,
    seedTask(task: TaskPayload): void {
      const domainTask = new DownloadTask({ id: task.id, sourceUrl: task.sourceUrl });
      domainTask.transitionTo(DownloadStatus.Queued);
      if (task.status === 'Downloading') {
        domainTask.transitionTo(DownloadStatus.Pending);
        domainTask.applyExecutionProgress(DownloadStatus.Downloading, task.progress);
      }
      queue.add(domainTask);
    },
  };
}
