import { describe, expect, it } from 'vitest';

import { DownloadQueue } from '../../domain/src';
import {
  CurrentAnalysisService,
  CurrentDownloadService,
  CurrentTaskService,
  type CurrentTaskExecution,
  DownloadService,
  type DownloadEngine,
  type EngineUpdateListener,
  TaskQueryService,
} from '../src';
import type {
  CurrentAnalysisMedia,
  CurrentAnalysisRequest,
  DownloadStartRequest,
  EngineUpdate,
} from '../../contracts/src';

class ScriptedEngine implements DownloadEngine {
  readonly starts: DownloadStartRequest[] = [];
  startError?: Error;
  private listener?: EngineUpdateListener;

  async start(request: DownloadStartRequest) {
    if (this.startError) throw this.startError;
    this.starts.push(request);
  }

  async cancel() {}

  subscribeUpdates(listener: EngineUpdateListener) {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  emit(update: EngineUpdate) {
    this.listener?.(update);
  }
}

class ScriptedAnalyzer {
  requests: CurrentAnalysisRequest[] = [];
  private readonly pending: Array<{
    resolve: (media: CurrentAnalysisMedia) => void;
    reject: (error: unknown) => void;
  }> = [];

  analyze(request: CurrentAnalysisRequest): Promise<CurrentAnalysisMedia> {
    this.requests.push({ ...request });
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }

  complete(index: number, media: CurrentAnalysisMedia) {
    this.pending[index]?.resolve(media);
  }

  fail(index: number, error: unknown) {
    this.pending[index]?.reject(error);
  }
}

const media: CurrentAnalysisMedia = {
  title: 'Captured clip',
  thumbnail: '',
  duration: '00:10',
  channel: 'capture',
  url: 'cdn.example.com',
};

function lifecycle() {
  let sequence = 0;
  const id = () => `id-${++sequence}`;
  const queue = new DownloadQueue();
  const engine = new ScriptedEngine();
  const downloadService = new DownloadService(queue, engine, id, {
    pendingStartTimeoutMs: 0,
    settlementDelayMs: 0,
  });
  const taskQueryService = new TaskQueryService(queue);
  const currentDownloadService = new CurrentDownloadService(
    downloadService,
    { getGlobalExtraArgs: () => ({}), getDownloadDir: () => undefined },
    taskQueryService,
  );
  const analyzer = new ScriptedAnalyzer();
  const analysisService = new CurrentAnalysisService(analyzer, id, () => ({}));
  const execution: CurrentTaskExecution = {
    downloads: currentDownloadService,
    query: taskQueryService,
    subscribeTasks: (listener) => downloadService.subscribeTasks(listener),
    dispose: () => downloadService.dispose(),
  };
  const tasks = new CurrentTaskService(analysisService, id, execution);
  return { tasks, analyzer, engine, queue };
}

async function analyzedCapturedTask() {
  const context = lifecycle();
  const handle = context.tasks.analyzeCaptured({
    captureContextId: 'context-1',
    siteLabel: 'cdn.example.com',
    mediaKind: 'video',
  });
  context.analyzer.complete(0, media);
  await handle.result;
  return { ...context, rowId: handle.rowId };
}

describe('captured failure surfacing', () => {
  it('surfaces an expired context as a typed analysis failure', async () => {
    const { tasks, analyzer } = lifecycle();
    const handle = tasks.analyzeCaptured({
      captureContextId: 'context-1',
      siteLabel: 'cdn.example.com',
      mediaKind: 'video',
    });
    analyzer.fail(0, new Error('capture-context-expired: the captured resource is gone'));
    await handle.result;

    const row = tasks.getRow(handle.rowId);
    expect(row?.status).toBe('error');
    expect(row?.failureKind).toBe('analysis');
    expect(row?.failureCode).toBe('capture-context-expired');
  });

  it('surfaces a start rejection as a typed download failure without a url fallback', async () => {
    const { tasks, engine, rowId } = await analyzedCapturedTask();
    engine.startError = new Error('capture-context-expired: the captured resource is gone');

    await tasks.start(rowId, 'video');

    const row = tasks.getRow(rowId);
    expect(row?.status).toBe('error');
    expect(row?.failureKind).toBe('download');
    expect(row?.failureCode).toBe('capture-context-expired');
    expect(engine.starts).toHaveLength(0);
  });

  it('surfaces a runtime failure result as a typed download failure', async () => {
    const { tasks, engine, rowId } = await analyzedCapturedTask();

    await tasks.start(rowId, 'video');
    const attemptId = tasks.getRow(rowId)?.attemptId;
    expect(attemptId).toBeTruthy();
    engine.emit({
      type: 'result',
      taskId: attemptId as string,
      outcome: 'Failed',
      error: 'capture-context-revoked: the captured resource was released',
    });

    const row = tasks.getRow(rowId);
    expect(row?.failureCode).toBe('capture-context-revoked');
    expect(row?.failureKind).toBe('download');
  });

  it('keeps ordinary failures untyped', async () => {
    const { tasks, engine, rowId } = await analyzedCapturedTask();
    engine.startError = new Error('ffmpeg merge failed');

    await tasks.start(rowId, 'video');

    const row = tasks.getRow(rowId);
    expect(row?.failureKind).toBe('download');
    expect(row?.failureCode).toBeUndefined();
  });

  it('allows retry within the context lifetime and reuses the same context', async () => {
    const { tasks, engine, rowId } = await analyzedCapturedTask();

    await tasks.start(rowId, 'video');
    const firstAttempt = tasks.getRow(rowId)?.attemptId as string;
    engine.emit({ type: 'result', taskId: firstAttempt, outcome: 'Failed', error: 'boom' });

    await tasks.retry(rowId);

    expect(engine.starts).toHaveLength(2);
    expect(engine.starts[1].captureContextId).toBe('context-1');
    expect(engine.starts[1].sourceUrl).toBeUndefined();
  });

  it('cancels and retries a captured task through the same commands as a pasted task', async () => {
    const { tasks, analyzer, rowId } = await analyzedCapturedTask();

    // Cancel before any execution started.
    const cancelled = await tasks.cancel(rowId);
    expect(cancelled.outcome.type).toBe('cancelled');
    expect(tasks.getRow(rowId)?.status).toBe('error');

    // A cancelled captured row re-analyzes through its context, never through
    // the display label.
    const retry = tasks.retry(rowId);
    analyzer.complete(1, media);
    await retry;

    expect(analyzer.requests).toHaveLength(2);
    expect(analyzer.requests[1].captureContextId).toBe('context-1');
    expect(analyzer.requests[1].sourceUrl).toBeUndefined();
    expect(tasks.getRow(rowId)?.status).toBe('analyzed');
  });
});

describe('captured FIFO parity', () => {
  it('shares the one-slot execution queue with pasted tasks', async () => {
    const { tasks, analyzer, engine } = lifecycle();

    const captured = tasks.analyzeCaptured({
      captureContextId: 'context-1',
      siteLabel: 'cdn.example.com',
      mediaKind: 'video',
    });
    const pasted = tasks.analyze('https://example.com/video');
    analyzer.complete(0, media);
    analyzer.complete(1, media);
    await Promise.all([captured.result, pasted.result]);

    await tasks.start(captured.rowId, 'video');
    await tasks.start(pasted.rowId, 'video');

    // One native execution at a time: the pasted task waits in the queue.
    expect(engine.starts).toHaveLength(1);
    expect(engine.starts[0].captureContextId).toBe('context-1');
    expect(tasks.getRow(pasted.rowId)?.status).toBe('queued');

    engine.emit({
      type: 'result',
      taskId: engine.starts[0].taskId,
      outcome: 'Completed',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(engine.starts).toHaveLength(2);
    expect(engine.starts[1].sourceUrl).toBe('https://example.com/video');
    expect(engine.starts[1].captureContextId).toBeUndefined();
  });
});
