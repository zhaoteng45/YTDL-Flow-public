import { describe, expect, it, vi } from 'vitest';

import type { DownloadStartRequest, EngineUpdate } from '../../packages/contracts/src';
import { DownloadQueue } from '../../packages/domain/src';
import type { DownloadEngine, EngineUpdateListener } from '../../packages/application/src';
import { CurrentDownloadService, DownloadService, TaskQueryService } from '../../packages/application/src';

class ControlledEngine implements DownloadEngine {
  private readonly listeners = new Set<EngineUpdateListener>();
  readonly starts: DownloadStartRequest[] = [];
  readonly cancels: string[] = [];
  cancelError?: Error;

  async start(request: DownloadStartRequest): Promise<void> {
    this.starts.push(request);
  }
  async cancel(taskId: string): Promise<void> {
    this.cancels.push(taskId);
    if (this.cancelError) throw this.cancelError;
  }

  subscribeUpdates(listener: EngineUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(update: EngineUpdate): void {
    for (const listener of this.listeners) listener(update);
  }
}

describe('candidate task-core parity seam', () => {
  it('keeps a stable row identity while each execution gets a fresh attempt identity via retry replacement', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledEngine();
    const attemptIds = ['attempt-1', 'attempt-2'];
    const service = new DownloadService(queue, engine, () => attemptIds.shift() ?? 'unexpected', {
      settlementDelayMs: 0,
    });
    const query = new TaskQueryService(queue);

    const first = await service.createTask('https://example.com/video', undefined, { rowId: 'row-stable' });
    expect(first).toMatchObject({ id: 'attempt-1', rowId: 'row-stable', attemptId: 'attempt-1' });
    expect(query.getTaskByRowId('row-stable')?.attemptId).toBe('attempt-1');

    engine.emit({ type: 'result', taskId: 'attempt-1', outcome: 'Failed', error: 'network error' });

    const retried = await service.retryTask('row-stable');
    expect(retried).toMatchObject({ id: 'attempt-2', rowId: 'row-stable', attemptId: 'attempt-2' });

    expect(query.listTasks()).toHaveLength(1);
    expect(query.getTaskByRowId('row-stable')).toMatchObject({
      rowId: 'row-stable',
      attemptId: 'attempt-2',
      status: 'Pending',
    });

    service.dispose();
  });

  it('re-resolves current settings at dispatch and retry while preserving format and task overrides', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledEngine();
    const attemptIds = ['blocker-attempt', 'attempt-config-1', 'attempt-config-2'];
    const taskCore = new DownloadService(queue, engine, () => attemptIds.shift() ?? 'unexpected', {
      maxConcurrent: 1,
      settlementDelayMs: 0,
    });

    let globalExtraArgs = {
      proxy: 'global-proxy-1',
      audioCodec: 'aac',
      writeInfoJson: true,
    };
    let downloadDir = 'C:/Downloads-1';
    const currentDownloads = new CurrentDownloadService(
      taskCore,
      {
        getGlobalExtraArgs: () => ({ ...globalExtraArgs }),
        getDownloadDir: () => downloadDir,
      },
      new TaskQueryService(queue),
    );

    await taskCore.createTask('https://example.com/blocker');

    const first = await currentDownloads.createTask({
      sourceUrl: 'https://example.com/config-retry',
      format: 'flac',
      taskOverrideArgs: {
        proxy: 'task-proxy',
        writeThumbnail: true,
      },
      rowId: 'row-config-retry',
    });
    expect(first).toMatchObject({
      id: 'attempt-config-1',
      rowId: 'row-config-retry',
      attemptId: 'attempt-config-1',
      status: 'Queued',
    });

    globalExtraArgs = {
      proxy: 'global-proxy-2',
      audioCodec: 'opus',
      writeInfoJson: false,
    };
    downloadDir = 'C:/Downloads-2';

    engine.emit({ type: 'result', taskId: 'blocker-attempt', outcome: 'Completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(engine.starts[1]).toEqual({
      taskId: 'attempt-config-1',
      sourceUrl: 'https://example.com/config-retry',
      downloadType: 'audio',
      downloadDir: 'C:/Downloads-2',
      extraArgs: {
        proxy: 'task-proxy',
        audioCodec: 'flac',
        writeInfoJson: false,
        writeThumbnail: true,
      },
    });

    engine.emit({
      type: 'result',
      taskId: 'attempt-config-1',
      outcome: 'Failed',
      error: 'simulated retry',
    });

    globalExtraArgs = {
      proxy: 'global-proxy-3',
      audioCodec: 'aac',
      writeInfoJson: true,
    };
    downloadDir = 'C:/Downloads-3';

    const retried = await currentDownloads.retryTask('row-config-retry');
    expect(retried).toMatchObject({
      id: 'attempt-config-2',
      rowId: 'row-config-retry',
      attemptId: 'attempt-config-2',
    });
    expect(engine.starts[2]).toEqual({
      taskId: 'attempt-config-2',
      sourceUrl: 'https://example.com/config-retry',
      downloadType: 'audio',
      downloadDir: 'C:/Downloads-3',
      extraArgs: {
        proxy: 'task-proxy',
        audioCodec: 'flac',
        writeInfoJson: true,
        writeThumbnail: true,
      },
    });

    taskCore.dispose();
  });

  it('rejects creating a task with a duplicate rowId and leaves getByRowId unambiguous', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledEngine();
    const ids = ['attempt-first', 'attempt-duplicate'];
    const service = new DownloadService(queue, engine, () => ids.shift() ?? 'unexpected');
    const query = new TaskQueryService(queue);

    const first = await service.createTask('https://example.com/video-1', undefined, { rowId: 'row-unique' });
    expect(first.rowId).toBe('row-unique');

    await expect(
      service.createTask('https://example.com/video-2', undefined, { rowId: 'row-unique' }),
    ).rejects.toThrow(/duplicate rowId/i);

    expect(query.listTasks()).toHaveLength(1);
    expect(query.getTaskByRowId('row-unique')?.id).toBe('attempt-first');

    service.dispose();
  });

  it('dispatches queued work FIFO without exceeding the configured active slots', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledEngine();
    const ids = ['attempt-a', 'attempt-b'];
    const service = new DownloadService(queue, engine, () => ids.shift() ?? 'unexpected', {
      maxConcurrent: 1,
      settlementDelayMs: 0,
    });
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/a');
    await service.createTask('https://example.com/b');

    expect(engine.starts.map((request) => request.taskId)).toEqual(['attempt-a']);
    expect(query.getTask('attempt-a')?.status).toBe('Pending');
    expect(query.getTask('attempt-b')?.status).toBe('Queued');

    engine.emit({ type: 'result', taskId: 'attempt-a', outcome: 'Completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(engine.starts.map((request) => request.taskId)).toEqual(['attempt-a', 'attempt-b']);
    expect(query.getTask('attempt-b')?.status).toBe('Pending');

    service.dispose();
  });

  it('retries a failed row with a fresh attempt and ignores late events from the old attempt', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledEngine();
    const ids = ['attempt-old', 'attempt-new'];
    const service = new DownloadService(queue, engine, () => ids.shift() ?? 'unexpected', { settlementDelayMs: 0 });
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/retry', undefined, { rowId: 'row-retry' });
    engine.emit({ type: 'result', taskId: 'attempt-old', outcome: 'Failed', error: 'network error' });

    const retried = await service.retryTask('row-retry');
    expect(retried).toMatchObject({
      id: 'attempt-new',
      rowId: 'row-retry',
      attemptId: 'attempt-new',
      status: 'Pending',
    });
    expect(query.listTasks()).toHaveLength(1);

    engine.emit({ type: 'progress', taskId: 'attempt-old', phase: 'Downloading', progress: 88 });
    expect(query.getTaskByRowId('row-retry')).toMatchObject({
      attemptId: 'attempt-new',
      status: 'Pending',
      progress: 0,
    });

    service.dispose();
  });

  it('fails a Pending task on watchdog expiry but releases its slot only after trusted terminal cleanup', async () => {
    vi.useFakeTimers();
    try {
      const queue = new DownloadQueue();
      const engine = new ControlledEngine();
      const ids = ['attempt-timeout', 'attempt-queued'];
      const service = new DownloadService(queue, engine, () => ids.shift() ?? 'unexpected', {
        maxConcurrent: 1,
        pendingStartTimeoutMs: 60_000,
        settlementDelayMs: 0,
      });
      const query = new TaskQueryService(queue);

      await service.createTask('https://example.com/timeout');
      await service.createTask('https://example.com/queued');
      expect(query.getTask('attempt-timeout')?.status).toBe('Pending');
      expect(query.getTask('attempt-queued')?.status).toBe('Queued');

      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(1);

      expect(query.getTask('attempt-timeout')).toMatchObject({
        status: 'Failed',
        failureReason: '任务启动超时，正在自动清理',
      });
      expect(engine.cancels).toEqual(['attempt-timeout']);
      expect(query.getTask('attempt-queued')?.status).toBe('Queued');
      expect(engine.starts.map((r) => r.taskId)).toEqual(['attempt-timeout']);

      engine.emit({ type: 'result', taskId: 'attempt-timeout', outcome: 'Cancelled' });
      await vi.advanceTimersByTimeAsync(1);

      expect(query.getTask('attempt-queued')?.status).toBe('Pending');
      expect(engine.starts.map((r) => r.taskId)).toEqual(['attempt-timeout', 'attempt-queued']);

      service.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails visibly but keeps the slot reserved if watchdog cleanup is rejected', async () => {
    vi.useFakeTimers();
    try {
      const queue = new DownloadQueue();
      const engine = new ControlledEngine();
      engine.cancelError = new Error('simulated native cancel failure');
      const ids = ['attempt-timeout-err', 'attempt-queued-err'];
      const service = new DownloadService(queue, engine, () => ids.shift() ?? 'unexpected', {
        maxConcurrent: 1,
        pendingStartTimeoutMs: 60_000,
        settlementDelayMs: 0,
      });
      const query = new TaskQueryService(queue);

      await service.createTask('https://example.com/timeout');
      await service.createTask('https://example.com/queued');
      expect(query.getTask('attempt-timeout-err')?.status).toBe('Pending');
      expect(query.getTask('attempt-queued-err')?.status).toBe('Queued');

      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(1);

      expect(query.getTask('attempt-timeout-err')).toMatchObject({
        status: 'Failed',
        failureReason: '任务启动超时，正在自动清理',
      });
      expect(engine.cancels).toEqual(['attempt-timeout-err']);
      expect(query.getTask('attempt-queued-err')?.status).toBe('Queued');
      expect(engine.starts.map((request) => request.taskId)).toEqual(['attempt-timeout-err']);

      service.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fail a Pending task if progress arrives before the watchdog expires', async () => {
    vi.useFakeTimers();
    try {
      const queue = new DownloadQueue();
      const engine = new ControlledEngine();
      const service = new DownloadService(queue, engine, () => 'attempt-progress-cancels-timer', {
        pendingStartTimeoutMs: 60_000,
        settlementDelayMs: 0,
      });
      const query = new TaskQueryService(queue);

      await service.createTask('https://example.com/progress-in-time');
      expect(query.getTask('attempt-progress-cancels-timer')?.status).toBe('Pending');

      await vi.advanceTimersByTimeAsync(30_000);
      engine.emit({
        type: 'progress',
        taskId: 'attempt-progress-cancels-timer',
        phase: 'Downloading',
        progress: 10,
      });
      expect(query.getTask('attempt-progress-cancels-timer')?.status).toBe('Downloading');

      await vi.advanceTimersByTimeAsync(60_000);

      expect(query.getTask('attempt-progress-cancels-timer')?.status).toBe('Downloading');
      expect(engine.cancels).toEqual([]);

      service.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not clear the pending watchdog on invalid non-finite progress and still times out', async () => {
    vi.useFakeTimers();
    try {
      const queue = new DownloadQueue();
      const engine = new ControlledEngine();
      const ids = ['attempt-nan', 'attempt-queued-after-nan'];
      const service = new DownloadService(queue, engine, () => ids.shift() ?? 'unexpected', {
        maxConcurrent: 1,
        pendingStartTimeoutMs: 60_000,
        settlementDelayMs: 0,
      });
      const query = new TaskQueryService(queue);

      await service.createTask('https://example.com/nan');
      await service.createTask('https://example.com/queued');
      expect(query.getTask('attempt-nan')?.status).toBe('Pending');
      expect(query.getTask('attempt-queued-after-nan')?.status).toBe('Queued');

      // Emit invalid non-finite progress
      engine.emit({
        type: 'progress',
        taskId: 'attempt-nan',
        phase: 'Downloading',
        progress: Number.NaN,
      });

      // Domain rejected invalid progress, task must still be Pending with 0 progress
      expect(query.getTask('attempt-nan')).toMatchObject({
        status: 'Pending',
        progress: 0,
      });

      // Advance time past watchdog timeout
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(1);

      // Watchdog must fire, but cancel acceptance alone is not cleanup proof.
      expect(query.getTask('attempt-nan')).toMatchObject({
        status: 'Failed',
        failureReason: '任务启动超时，正在自动清理',
      });
      expect(engine.cancels).toEqual(['attempt-nan']);
      expect(query.getTask('attempt-queued-after-nan')?.status).toBe('Queued');

      engine.emit({ type: 'result', taskId: 'attempt-nan', outcome: 'Cancelled' });
      await vi.advanceTimersByTimeAsync(1);
      expect(query.getTask('attempt-queued-after-nan')?.status).toBe('Pending');

      service.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let an old attempt watchdog fail a replacement attempt', async () => {
    vi.useFakeTimers();
    try {
      const queue = new DownloadQueue();
      const engine = new ControlledEngine();
      const ids = ['attempt-first', 'attempt-second'];
      const service = new DownloadService(queue, engine, () => ids.shift() ?? 'unexpected', {
        pendingStartTimeoutMs: 60_000,
        settlementDelayMs: 0,
      });
      const query = new TaskQueryService(queue);

      await service.createTask('https://example.com/retry-watchdog', undefined, { rowId: 'row-retry-watchdog' });
      expect(query.getTask('attempt-first')?.status).toBe('Pending');

      // Fail first attempt via native result
      engine.emit({ type: 'result', taskId: 'attempt-first', outcome: 'Failed', error: 'early fail' });
      await vi.advanceTimersByTimeAsync(1);

      // Retry immediately
      await service.retryTask('row-retry-watchdog');
      expect(query.getTask('attempt-second')?.status).toBe('Pending');

      // Advance time so the first attempt's timer would have expired if not cleared
      await vi.advanceTimersByTimeAsync(59_999);
      expect(query.getTask('attempt-second')?.status).toBe('Pending');

      service.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a pending watchdog tied to the current attempt after retry replacement', async () => {
    vi.useFakeTimers();
    try {
      const queue = new DownloadQueue();
      const engine = new ControlledEngine();
      const ids = ['attempt-retry-a', 'attempt-retry-b'];
      const service = new DownloadService(queue, engine, () => ids.shift() ?? 'unexpected', {
        pendingStartTimeoutMs: 60_000,
        settlementDelayMs: 0,
      });
      const query = new TaskQueryService(queue);

      await service.createTask('https://example.com/retry-timeout', undefined, { rowId: 'row-retry-timeout' });
      engine.emit({ type: 'result', taskId: 'attempt-retry-a', outcome: 'Failed', error: 'early fail' });
      await vi.advanceTimersByTimeAsync(1);

      await service.retryTask('row-retry-timeout');
      expect(query.getTask('attempt-retry-b')?.status).toBe('Pending');

      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(1);

      expect(query.getTask('attempt-retry-b')).toMatchObject({
        status: 'Failed',
        failureReason: '任务启动超时，正在自动清理',
      });

      service.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores trusted terminal updates from an old attempt after replacement', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledEngine();
    const ids = ['attempt-old-terminal', 'attempt-new-terminal'];
    const service = new DownloadService(queue, engine, () => ids.shift() ?? 'unexpected');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/old-terminal', undefined, { rowId: 'row-terminal' });
    engine.emit({ type: 'result', taskId: 'attempt-old-terminal', outcome: 'Failed', error: 'first failure' });
    await service.retryTask('row-terminal');

    engine.emit({ type: 'result', taskId: 'attempt-old-terminal', outcome: 'Completed', filePath: 'C:/old.mp4' });
    expect(query.getTaskByRowId('row-terminal')).toMatchObject({
      attemptId: 'attempt-new-terminal',
      status: 'Pending',
      progress: 0,
    });

    service.dispose();
  });

  it('keeps speed from active progress and trusted finalPath from terminal result', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledEngine();
    const service = new DownloadService(queue, engine, () => 'attempt-evidence');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/evidence');
    engine.emit({
      type: 'progress',
      taskId: 'attempt-evidence',
      phase: 'Downloading',
      progress: 25,
      speed: '3.4 MiB/s',
    });
    expect(query.getTask('attempt-evidence')).toMatchObject({
      status: 'Downloading',
      progress: 25,
      speed: '3.4 MiB/s',
    });

    engine.emit({
      type: 'result',
      taskId: 'attempt-evidence',
      outcome: 'Completed',
      filePath: 'C:/downloads/final.mp4',
    });
    expect(query.getTask('attempt-evidence')).toMatchObject({
      status: 'Completed',
      progress: 100,
      finalPath: 'C:/downloads/final.mp4',
    });

    service.dispose();
  });
});
