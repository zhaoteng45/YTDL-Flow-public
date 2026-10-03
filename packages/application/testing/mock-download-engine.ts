import type { DownloadStartRequest, EngineUpdate } from '../../contracts/src/index';
import type { DownloadEngine, EngineUpdateListener } from '../src/download-engine';

export interface MockDownloadEngineOptions {
  autoComplete?: boolean;
}

export class MockDownloadEngine implements DownloadEngine {
  private readonly listeners = new Set<EngineUpdateListener>();
  private readonly activeTasks = new Set<string>();
  private readonly autoComplete: boolean;

  constructor(options: MockDownloadEngineOptions = {}) {
    this.autoComplete = options.autoComplete ?? true;
  }

  async start(request: DownloadStartRequest): Promise<void> {
    this.activeTasks.add(request.taskId);
    this.emit({
      type: 'progress',
      taskId: request.taskId,
      phase: 'Downloading',
      progress: 0,
    });

    if (!this.autoComplete) {
      return;
    }

    this.emit({
      type: 'progress',
      taskId: request.taskId,
      phase: 'Processing',
      progress: 100,
    });
    this.emit({
      type: 'result',
      taskId: request.taskId,
      outcome: 'Completed',
    });
    this.activeTasks.delete(request.taskId);
  }

  async cancel(taskId: string): Promise<void> {
    if (!this.activeTasks.has(taskId)) {
      return;
    }

    this.emit({
      type: 'result',
      taskId,
      outcome: 'Cancelled',
    });
    this.activeTasks.delete(taskId);
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
