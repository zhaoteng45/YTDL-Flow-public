import { describe, expect, it } from 'vitest';

import type { DownloadStartRequest, EngineUpdate } from '../../contracts/src';
import { DownloadQueue } from '../../domain/src';
import type { DownloadEngine, EngineUpdateListener } from '../src';
import { DownloadService, DownloadStartError, TaskQueryService } from '../src';
import { projectCurrentExecution } from '../src/current-task-projection';

class ControllableEngine implements DownloadEngine {
  public readonly listeners = new Set<EngineUpdateListener>();
  public readonly cancelCalls: string[] = [];
  public readonly startCalls: DownloadStartRequest[] = [];
  public startSyncError?: Error;
  public startResolvers: Array<() => void> = [];
  public startRejecters: Array<(error: unknown) => void> = [];
  public cancelResolvers: Array<() => void> = [];
  public cancelRejecters: Array<(error: unknown) => void> = [];

  start(request: DownloadStartRequest): Promise<void> {
    this.startCalls.push(request);
    if (this.startSyncError) throw this.startSyncError;
    return new Promise((resolve, reject) => {
      this.startResolvers.push(resolve);
      this.startRejecters.push(reject);
    });
  }

  cancel(taskId: string): Promise<void> {
    this.cancelCalls.push(taskId);
    return new Promise((resolve, reject) => {
      this.cancelResolvers.push(resolve);
      this.cancelRejecters.push(reject);
    });
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

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('DownloadService trusted terminal read model', () => {
  it('retains the trusted final output path from a Completed result', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const service = new DownloadService(queue, engine, () => 'task-final-path');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/video');
    engine.emit({
      type: 'result',
      taskId: 'task-final-path',
      outcome: 'Completed',
      filePath: 'C:/downloads/final-video.mp4',
    });

    expect(query.getTask('task-final-path')).toEqual({
      id: 'task-final-path',
      sourceUrl: 'https://example.com/video',
      status: 'Completed',
      progress: 100,
      finalPath: 'C:/downloads/final-video.mp4',
    });
    service.dispose();
  });
});

describe('DownloadService trusted failure reason', () => {
  it('retains the trusted Failed reason in the task read model', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const service = new DownloadService(queue, engine, () => 'task-reason');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/video');
    engine.emit({ type: 'progress', taskId: 'task-reason', phase: 'Downloading', progress: 40 });
    engine.emit({
      type: 'result',
      taskId: 'task-reason',
      outcome: 'Failed',
      error: 'yt-dlp exited with code 1: HTTP Error 403',
    });

    expect(query.getTask('task-reason')).toEqual({
      id: 'task-reason',
      sourceUrl: 'https://example.com/video',
      status: 'Failed',
      progress: 40,
      failureReason: 'yt-dlp exited with code 1: HTTP Error 403',
    });
    service.dispose();
  });

  it('leaves the reason undefined when the trusted result carries none', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const service = new DownloadService(queue, engine, () => 'task-no-reason');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/video');
    engine.emit({ type: 'result', taskId: 'task-no-reason', outcome: 'Failed' });

    expect(query.getTask('task-no-reason')?.failureReason).toBeUndefined();
    service.dispose();
  });

  it('retains the start rejection message as the local failure reason', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const service = new DownloadService(queue, engine, () => 'task-start-reject');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/video');
    engine.startRejecters[0]?.(new Error('start_download rejected: not connected'));
    await flush();

    expect(query.getTask('task-start-reject')).toEqual({
      id: 'task-start-reject',
      sourceUrl: 'https://example.com/video',
      status: 'Failed',
      progress: 0,
      failureReason: 'start_download rejected: not connected',
    });
    service.dispose();
  });
});

describe('DownloadService cancel observability', () => {
  it('classifies watchdog failure structurally and preserves compensation through retirement and disposal', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const service = new DownloadService(queue, engine, () => 'retired-timeout', {
      pendingStartTimeoutMs: 5, settlementDelayMs: 0,
    });
    const query = new TaskQueryService(queue);
    await service.createTask('https://example.com/late');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const failed = query.getTask('retired-timeout')!;
    expect(failed.failureCode).toBe('pending-start-timeout');
    expect(projectCurrentExecution({ ...failed, failureReason: 'arbitrary localized copy' })).toMatchObject({
      failureKind: 'cancelled', failureCode: 'pending-start-timeout', actions: { canRetryDownload: true },
    });
    service.retireAttempt('retired-timeout');
    expect(query.listTasks()).toEqual([]);
    engine.cancelRejecters[0]?.(new Error('not registered yet'));
    service.dispose();
    engine.startResolvers[0]?.();
    await flush();
    expect(engine.cancelCalls).toEqual(['retired-timeout', 'retired-timeout']);
    engine.cancelResolvers[1]?.();
    await flush();
    expect(query.listTasks()).toEqual([]);
  });
  it('reports an immediate cancel rejection without synthesizing Cancelled', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const service = new DownloadService(queue, engine, () => 'task-cancel-immediate');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/video');
    engine.startResolvers[0]?.();
    await flush();
    engine.emit({ type: 'progress', taskId: 'task-cancel-immediate', phase: 'Downloading', progress: 25 });

    const pending = service.cancelTask('task-cancel-immediate');
    await flush();
    expect(query.getTask('task-cancel-immediate')?.cancelRequested).toBe(true);
    engine.cancelRejecters[0]?.(new Error('No active execution for task task-cancel-immediate'));
    const result = await pending;

    expect(result.outcome).toEqual({
      type: 'cancel-rejected',
      error: {
        code: 'cancel-rejected',
        message: 'No active execution for task task-cancel-immediate',
      },
    });
    expect(query.getTask('task-cancel-immediate')).toEqual({
      id: 'task-cancel-immediate',
      sourceUrl: 'https://example.com/video',
      status: 'Downloading',
      progress: 25,
    });
    expect(query.getTask('task-cancel-immediate')?.cancelRequested).toBeUndefined();
    service.dispose();
  });

  it('keeps a pending-start cancel immediate but exposes the delayed rejection as settlement', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const service = new DownloadService(queue, engine, () => 'task-cancel-deferred');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/video');

    const result = await service.cancelTask('task-cancel-deferred');
    expect(result.outcome).toEqual({ type: 'cancel-requested' });
    expect(result.settlement).toBeDefined();
    expect(query.getTask('task-cancel-deferred')?.cancelRequested).toBe(true);

    engine.startResolvers[0]?.();
    await flush();
    expect(engine.cancelCalls).toEqual(['task-cancel-deferred']);

    engine.cancelRejecters[0]?.(new Error('No active execution for task task-cancel-deferred'));
    await expect(result.settlement).resolves.toEqual({
      type: 'cancel-rejected',
      error: {
        code: 'cancel-rejected',
        message: 'No active execution for task task-cancel-deferred',
      },
    });

    // Rejection must never fabricate a Cancelled terminal state or leave stale cancel intent.
    expect(query.getTask('task-cancel-deferred')?.status).toBe('Pending');
    expect(query.getTask('task-cancel-deferred')?.cancelRequested).toBeUndefined();
    service.dispose();
  });

  it('reports an accepted delayed cancel without settling the task locally', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const service = new DownloadService(queue, engine, () => 'task-cancel-accepted');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/video');
    const result = await service.cancelTask('task-cancel-accepted');

    engine.startResolvers[0]?.();
    await flush();
    engine.cancelResolvers[0]?.();

    await expect(result.settlement).resolves.toEqual({ type: 'cancel-requested' });
    expect(query.getTask('task-cancel-accepted')?.status).toBe('Pending');

    engine.emit({ type: 'result', taskId: 'task-cancel-accepted', outcome: 'Cancelled' });
    expect(query.getTask('task-cancel-accepted')?.status).toBe('Cancelled');
    service.dispose();
  });

  it('settles a pending-start cancel as Cancelled when the start itself is rejected', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const service = new DownloadService(queue, engine, () => 'task-cancel-start-reject');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/video');
    const result = await service.cancelTask('task-cancel-start-reject');

    engine.startRejecters[0]?.(new Error('spawn failed'));
    await flush();

    await expect(result.settlement).resolves.toEqual({ type: 'cancelled' });
    expect(query.getTask('task-cancel-start-reject')?.status).toBe('Cancelled');
    service.dispose();
  });

  it('issues at most one delayed engine cancel when cancel is requested twice while pending', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const service = new DownloadService(queue, engine, () => 'task-cancel-twice');

    await service.createTask('https://example.com/video');
    const first = await service.cancelTask('task-cancel-twice');
    const second = await service.cancelTask('task-cancel-twice');

    expect(second.settlement).toBe(first.settlement);

    engine.startResolvers[0]?.();
    await flush();
    expect(engine.cancelCalls).toEqual(['task-cancel-twice']);
    service.dispose();
  });

  it('reports not-cancellable for unknown and already terminal tasks', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const service = new DownloadService(queue, engine, () => 'task-terminal');

    await service.createTask('https://example.com/video');
    engine.emit({ type: 'result', taskId: 'task-terminal', outcome: 'Completed' });

    await expect(service.cancelTask('task-terminal')).resolves.toEqual({
      outcome: { type: 'not-cancellable' },
    });
    await expect(service.cancelTask('missing')).resolves.toEqual({
      outcome: { type: 'not-cancellable' },
    });
    expect(engine.cancelCalls).toEqual([]);
    service.dispose();
  });

  it('reissues cleanup if a watchdog cancel is rejected before a late start is accepted', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const service = new DownloadService(queue, engine, () => 'task-late-start', {
      pendingStartTimeoutMs: 5,
      settlementDelayMs: 0,
    });
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/video');
    expect(query.getTask('task-late-start')?.status).toBe('Pending');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(query.getTask('task-late-start')).toMatchObject({
      status: 'Failed',
      failureReason: '任务启动超时，正在自动清理',
    });
    expect(engine.cancelCalls).toEqual(['task-late-start']);

    engine.cancelRejecters[0]?.(new Error('No active execution for task task-late-start'));
    await flush();

    engine.startResolvers[0]?.();
    await flush();

    expect(engine.cancelCalls).toEqual(['task-late-start', 'task-late-start']);

    engine.cancelResolvers[1]?.();
    service.dispose();
  });

  it('keeps the only slot reserved until watchdog cleanup is actually confirmed', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const ids = ['task-timeout-a', 'task-timeout-b'];
    let idIndex = 0;
    const service = new DownloadService(queue, engine, () => ids[idIndex++]!, {
      pendingStartTimeoutMs: 5,
      settlementDelayMs: 0,
    });
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/a');
    await service.createTask('https://example.com/b');
    expect(engine.startCalls.map((request) => request.taskId)).toEqual(['task-timeout-a']);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(query.getTask('task-timeout-a')).toMatchObject({
      status: 'Failed',
      failureCode: 'pending-start-timeout',
    });
    expect(query.getTask('task-timeout-b')?.status).toBe('Queued');
    expect(engine.cancelCalls).toEqual(['task-timeout-a']);
    expect(engine.startCalls.map((request) => request.taskId)).toEqual(['task-timeout-a']);

    engine.cancelRejecters[0]?.(new Error('cancel transport failed'));
    await flush();
    expect(engine.startCalls.map((request) => request.taskId)).toEqual(['task-timeout-a']);

    engine.startResolvers[0]?.();
    await flush();
    expect(engine.cancelCalls).toEqual(['task-timeout-a', 'task-timeout-a']);
    expect(engine.startCalls.map((request) => request.taskId)).toEqual(['task-timeout-a']);

    engine.cancelResolvers[1]?.();
    await flush();
    await flush();
    expect(engine.startCalls.map((request) => request.taskId)).toEqual(['task-timeout-a']);

    engine.emit({ type: 'result', taskId: 'task-timeout-a', outcome: 'Cancelled' });
    await flush();
    expect(engine.startCalls.map((request) => request.taskId)).toEqual(['task-timeout-a', 'task-timeout-b']);
    service.dispose();
  });

  it('keeps watchdog cleanup ownership across retry until the old attempt is proven terminal', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const ids = ['attempt-old', 'attempt-retry', 'attempt-trigger'];
    let idIndex = 0;
    const service = new DownloadService(queue, engine, () => ids[idIndex++]!, {
      pendingStartTimeoutMs: 5,
      settlementDelayMs: 0,
    });

    await service.createTask(
      'https://example.com/retry-cleanup',
      undefined,
      { rowId: 'row-retry-cleanup' },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    engine.cancelRejecters[0]?.(new Error('first cleanup transport failure'));
    await flush();

    const retry = await service.retryTask('row-retry-cleanup');
    expect(retry).toMatchObject({
      attemptId: 'attempt-retry',
      status: 'Queued',
    });
    expect(engine.startCalls.map((request) => request.taskId)).toEqual(['attempt-old']);

    engine.startResolvers[0]?.();
    await flush();
    expect(engine.cancelCalls).toEqual(['attempt-old', 'attempt-old']);

    engine.cancelRejecters[1]?.(new Error('late cleanup transport failure'));
    await flush();

    // Force another scheduling pass. The retry must still not start while the
    // old native attempt has no cleanup/terminal proof.
    await service.createTask('https://example.com/trigger');
    expect(engine.startCalls.map((request) => request.taskId)).toEqual(['attempt-old']);

    // A trusted result for the retired old attempt is sufficient cleanup proof.
    engine.emit({
      type: 'result',
      taskId: 'attempt-old',
      outcome: 'Failed',
      error: 'old attempt terminated',
    });
    await flush();
    await flush();
    expect(engine.startCalls.map((request) => request.taskId)).toEqual([
      'attempt-old',
      'attempt-retry',
    ]);

    service.dispose();
  });

  it('keeps the slot held when an unclassified synchronous start throw may have reached native execution', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    engine.startSyncError = new Error('unclassified synchronous start failure');
    const ids = ['attempt-sync-throw', 'attempt-after-sync-throw'];
    let idIndex = 0;
    const service = new DownloadService(queue, engine, () => ids[idIndex++]!, {
      pendingStartTimeoutMs: 60_000,
      settlementDelayMs: 0,
    });
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/sync-throw');
    engine.startSyncError = undefined;
    await service.createTask('https://example.com/after-sync-throw');
    await flush();

    expect(query.getTask('attempt-sync-throw')?.status).toBe('Failed');
    expect(query.getTask('attempt-after-sync-throw')?.status).toBe('Queued');
    expect(engine.startCalls.map((request) => request.taskId)).toEqual(['attempt-sync-throw']);

    engine.emit({ type: 'result', taskId: 'attempt-sync-throw', outcome: 'Failed' });
    await flush();
    expect(engine.startCalls.map((request) => request.taskId)).toEqual([
      'attempt-sync-throw',
      'attempt-after-sync-throw',
    ]);

    service.dispose();
  });

  it('keeps the slot held when an unclassified start rejection may have reached native execution', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const ids = ['attempt-plain-reject', 'attempt-after-plain-reject'];
    let idIndex = 0;
    const service = new DownloadService(queue, engine, () => ids[idIndex++]!, {
      pendingStartTimeoutMs: 60_000,
      settlementDelayMs: 0,
    });
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/plain-reject');
    await service.createTask('https://example.com/after-plain-reject');
    engine.startRejecters[0]?.(new Error('unclassified start transport failure'));
    await flush();
    await flush();

    expect(query.getTask('attempt-plain-reject')?.status).toBe('Failed');
    expect(query.getTask('attempt-after-plain-reject')?.status).toBe('Queued');
    expect(engine.startCalls.map((request) => request.taskId)).toEqual(['attempt-plain-reject']);

    engine.emit({ type: 'result', taskId: 'attempt-plain-reject', outcome: 'Failed' });
    await flush();
    expect(engine.startCalls.map((request) => request.taskId)).toEqual([
      'attempt-plain-reject',
      'attempt-after-plain-reject',
    ]);

    service.dispose();
  });

  it('keeps the slot held when a timed-out start later rejects without trusted terminal proof', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const ids = ['attempt-ambiguous-start', 'attempt-after-ambiguous'];
    let idIndex = 0;
    const service = new DownloadService(queue, engine, () => ids[idIndex++]!, {
      pendingStartTimeoutMs: 5,
      settlementDelayMs: 0,
    });
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/ambiguous-start');
    await service.createTask('https://example.com/after-ambiguous');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(query.getTask('attempt-ambiguous-start')?.status).toBe('Failed');
    expect(query.getTask('attempt-after-ambiguous')?.status).toBe('Queued');

    engine.startRejecters[0]?.(new Error('start transport failed after native dispatch may have begun'));
    await flush();
    await flush();

    expect(query.getTask('attempt-after-ambiguous')?.status).toBe('Queued');
    expect(engine.startCalls.map((request) => request.taskId)).toEqual(['attempt-ambiguous-start']);

    engine.emit({ type: 'result', taskId: 'attempt-ambiguous-start', outcome: 'Failed' });
    await flush();
    expect(engine.startCalls.map((request) => request.taskId)).toEqual([
      'attempt-ambiguous-start',
      'attempt-after-ambiguous',
    ]);

    service.dispose();
  });

  it('keeps cleanup ownership when a start-resolved timed-out row is retried', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const ids = ['attempt-resolved-old', 'attempt-resolved-retry'];
    let idIndex = 0;
    const service = new DownloadService(queue, engine, () => ids[idIndex++]!, {
      pendingStartTimeoutMs: 5,
      settlementDelayMs: 0,
    });

    await service.createTask(
      'https://example.com/resolved-retry',
      undefined,
      { rowId: 'row-resolved-retry' },
    );
    engine.startResolvers[0]?.();
    await flush();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(engine.cancelCalls).toEqual(['attempt-resolved-old']);

    const retry = await service.retryTask('row-resolved-retry');
    expect(retry).toMatchObject({
      attemptId: 'attempt-resolved-retry',
      status: 'Queued',
    });
    expect(engine.startCalls.map((request) => request.taskId)).toEqual(['attempt-resolved-old']);

    engine.cancelResolvers[0]?.();
    await flush();
    expect(engine.startCalls.map((request) => request.taskId)).toEqual(['attempt-resolved-old']);

    engine.emit({
      type: 'result',
      taskId: 'attempt-resolved-old',
      outcome: 'Cancelled',
    });
    await flush();
    expect(engine.startCalls.map((request) => request.taskId)).toEqual([
      'attempt-resolved-old',
      'attempt-resolved-retry',
    ]);

    service.dispose();
  });

  it('releases the slot immediately and starts the next queued task on definite preflight rejection (executionMayExist=false)', async () => {
    const queue = new DownloadQueue();
    const engine = new ControllableEngine();
    const ids = ['attempt-preflight-fail', 'attempt-next-queued'];
    let idIndex = 0;
    const service = new DownloadService(queue, engine, () => ids[idIndex++]!, {
      pendingStartTimeoutMs: 60_000,
      settlementDelayMs: 0,
    });
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/preflight-fail');
    await service.createTask('https://example.com/next-queued');

    // First task rejected with executionMayExist = false (e.g. tool busy or validation)
    engine.startRejecters[0]?.(new DownloadStartError('Media tool busy with update', false));
    await flush();
    await flush();

    expect(query.getTask('attempt-preflight-fail')?.status).toBe('Failed');
    // Because executionMayExist=false, slot was released immediately, no cancel issued, and next task started!
    expect(engine.cancelCalls).toEqual([]);
    expect(engine.startCalls.map((request) => request.taskId)).toEqual([
      'attempt-preflight-fail',
      'attempt-next-queued',
    ]);
    expect(query.getTask('attempt-next-queued')?.status).toBe('Pending');

    service.dispose();
  });
});
