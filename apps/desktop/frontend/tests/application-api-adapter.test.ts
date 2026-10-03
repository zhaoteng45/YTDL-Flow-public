import { TaskQueryService } from '@ytdl-flow/application';
import { DownloadQueue, DownloadStatus, DownloadTask } from '@ytdl-flow/domain';
import { describe, expect, test } from 'vitest';

import { StaticTaskApplicationAdapter } from '../src/api/static-task-application-adapter';
import { TaskQueryApplicationAdapter } from '../src/api/task-query-application-adapter';

describe('TaskApplicationApi adapters', () => {
  test('reads TaskPayloads through the real TaskQueryService seam', async () => {
    const queue = new DownloadQueue();
    const task = new DownloadTask({
      id: 'task-real-001',
      sourceUrl: 'https://example.com/real',
    });
    task.transitionTo(DownloadStatus.Queued);
    queue.add(task);

    const api = new TaskQueryApplicationAdapter(new TaskQueryService(queue));

    const tasks = await api.listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 'task-real-001',
      sourceUrl: 'https://example.com/real',
      status: 'Queued',
      progress: 0,
    });
  });

  test('exposes static dev tasks through the same interface', async () => {
    const api = new StaticTaskApplicationAdapter([
      {
        id: 'task-static-001',
        sourceUrl: 'https://example.com/static',
        status: 'Downloading',
        progress: 42,
      },
    ]);

    await expect(api.listTasks()).resolves.toEqual([
      {
        id: 'task-static-001',
        sourceUrl: 'https://example.com/static',
        status: 'Downloading',
        progress: 42,
      },
    ]);
  });
});
