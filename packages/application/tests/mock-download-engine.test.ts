import { describe, expect, test } from 'vitest';

import type { DownloadStartRequest, EngineUpdate } from '../../contracts/src/index';
import { MockDownloadEngine } from '../testing/mock-download-engine';

describe('MockDownloadEngine', () => {
  test('simulates a complete download lifecycle with normalized updates', async () => {
    const engine = new MockDownloadEngine();
    const updates: EngineUpdate[] = [];
    const request: DownloadStartRequest = {
      taskId: 'task-001',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    };

    engine.subscribeUpdates((update) => updates.push(update));

    await engine.start(request);

    expect(updates).toEqual([
      { type: 'progress', taskId: 'task-001', phase: 'Downloading', progress: 0 },
      { type: 'progress', taskId: 'task-001', phase: 'Processing', progress: 100 },
      { type: 'result', taskId: 'task-001', outcome: 'Completed' },
    ]);
  });

  test('cancels an active task and emits a cancelled result update', async () => {
    const engine = new MockDownloadEngine({ autoComplete: false });
    const updates: EngineUpdate[] = [];
    const request: DownloadStartRequest = {
      taskId: 'task-002',
      sourceUrl: 'https://example.com/cancel',
      downloadType: 'video',
    };

    engine.subscribeUpdates((update) => updates.push(update));

    await engine.start(request);
    await engine.cancel(request.taskId);

    expect(updates).toEqual([
      { type: 'progress', taskId: 'task-002', phase: 'Downloading', progress: 0 },
      { type: 'result', taskId: 'task-002', outcome: 'Cancelled' },
    ]);
  });
});
