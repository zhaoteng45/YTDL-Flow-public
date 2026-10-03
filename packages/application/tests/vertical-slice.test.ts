import { describe, expect, test } from 'vitest';

import type { EngineUpdate } from '../../contracts/src/index';
import { DownloadQueue } from '../../domain/src/index';
import { DownloadService, TaskQueryService } from '../src/index';
import { MockDownloadEngine } from '../testing/mock-download-engine';

describe('YTDL-Flow v2 vertical slice', () => {
  test('runs URL -> Task -> Queue -> Mock Engine -> Updates without UI', async () => {
    const queue = new DownloadQueue();
    const engine = new MockDownloadEngine();
    const downloads = new DownloadService(queue, engine, () => 'slice-001');
    const queries = new TaskQueryService(queue);
    const updates: EngineUpdate[] = [];

    const unsubscribe = engine.subscribeUpdates((update) => updates.push(update));

    const returnedTask = await downloads.createTask('https://example.com/video');

    // In MockDownloadEngine with autoComplete: true, start() resolves synchronously with Completed
    // Therefore createTask returns the latest consistent snapshot (Completed):
    expect(returnedTask).toEqual({
      id: 'slice-001',
      sourceUrl: 'https://example.com/video',
      status: 'Completed',
      progress: 100,
    });

    // TaskQueryService also returns the same consistent latest snapshot
    const latestTask = queries.getTask(returnedTask.id);
    expect(latestTask).toEqual(returnedTask);

    expect(updates).toEqual([
      { type: 'progress', taskId: 'slice-001', phase: 'Downloading', progress: 0 },
      { type: 'progress', taskId: 'slice-001', phase: 'Processing', progress: 100 },
      { type: 'result', taskId: 'slice-001', outcome: 'Completed' },
    ]);

    unsubscribe();
    downloads.dispose();
  });
});
