import { describe, expect, test } from 'vitest';

import type { DownloadStartRequest } from '../../contracts/src/index';
import { DownloadQueue, DownloadStatus } from '../../domain/src/index';
import { DownloadService, type DownloadEngine } from '../src/index';

describe('DownloadService', () => {
  test('creates a task, queues it, and starts the engine through the application seam', async () => {
    const queue = new DownloadQueue();
    const started: DownloadStartRequest[] = [];
    const engine: DownloadEngine = {
      async start(request) {
        started.push(request);
      },
      async cancel() {},
      subscribeUpdates() {
        return () => {};
      },
    };
    const service = new DownloadService(queue, engine, () => 'task-001');

    const task = await service.createTask('https://example.com/video');

    expect(task).toEqual({
      id: 'task-001',
      sourceUrl: 'https://example.com/video',
      status: 'Pending',
      progress: 0,
    });
    expect(queue.get('task-001')?.getStatus()).toBe(DownloadStatus.Pending);
    expect(started).toEqual([
      {
        taskId: 'task-001',
        sourceUrl: 'https://example.com/video',
        downloadType: 'video',
      },
    ]);
  });

  test('keeps multiple queued videos serial by default', async () => {
    const queue = new DownloadQueue();
    const started: DownloadStartRequest[] = [];
    let engineListener: ((update: Parameters<Parameters<DownloadEngine['subscribeUpdates']>[0]>[0]) => void) | undefined;
    let sequence = 0;
    const engine: DownloadEngine = {
      async start(request) {
        started.push(request);
      },
      async cancel() {},
      subscribeUpdates(listener) {
        engineListener = listener;
        return () => { engineListener = undefined; };
      },
    };
    const service = new DownloadService(
      queue,
      engine,
      () => `task-00${++sequence}`,
      { settlementDelayMs: 0 },
    );

    await service.createTask('https://example.com/video-1');
    await service.createTask('https://example.com/video-2');

    expect(started.map((request) => request.taskId)).toEqual(['task-001']);
    expect(queue.get('task-002')?.getStatus()).toBe(DownloadStatus.Queued);

    engineListener?.({
      type: 'result',
      taskId: 'task-001',
      outcome: 'Completed',
      filePath: 'C:/video-1.mp4',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(started.map((request) => request.taskId)).toEqual(['task-001', 'task-002']);
    expect(queue.get('task-002')?.getStatus()).toBe(DownloadStatus.Pending);

    service.dispose();
  });

  test('publishes read-only task snapshots through an observer seam and stops after unsubscribe', async () => {
    const queue = new DownloadQueue();
    let engineListener: ((update: Parameters<Parameters<DownloadEngine['subscribeUpdates']>[0]>[0]) => void) | undefined;
    const engine: DownloadEngine = {
      async start() {},
      async cancel() {},
      subscribeUpdates(listener) {
        engineListener = listener;
        return () => { engineListener = undefined; };
      },
    };
    const service = new DownloadService(queue, engine, () => 'task-observed', { settlementDelayMs: 0 });
    const observed: Array<{ status: string; progress: number; finalPath?: string }> = [];
    const unsubscribe = service.subscribeTasks((task) => {
      observed.push({
        status: task.status,
        progress: task.progress,
        ...(task.finalPath ? { finalPath: task.finalPath } : {}),
      });
    });

    await service.createTask('https://example.com/observed');
    expect(observed.at(-1)).toEqual({ status: 'Pending', progress: 0 });

    engineListener?.({
      type: 'progress',
      taskId: 'task-observed',
      phase: 'Downloading',
      progress: 42,
    });
    expect(observed.at(-1)).toEqual({ status: 'Downloading', progress: 42 });

    engineListener?.({
      type: 'result',
      taskId: 'task-observed',
      outcome: 'Completed',
      filePath: 'C:/final.mp4',
    });
    expect(observed.at(-1)).toEqual({
      status: 'Completed',
      progress: 100,
      finalPath: 'C:/final.mp4',
    });

    const count = observed.length;
    unsubscribe();
    await service.createTask('https://example.com/unobserved', undefined, { rowId: 'row-2' });
    expect(observed).toHaveLength(count);

    service.dispose();
  });
});
