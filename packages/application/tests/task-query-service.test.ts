import { describe, expect, test } from 'vitest';

import { DownloadQueue, DownloadStatus, DownloadTask } from '../../domain/src/index';
import { TaskQueryService } from '../src/index';

describe('TaskQueryService', () => {
  test('returns read-only task payloads from the queue', () => {
    const queue = new DownloadQueue();
    const first = new DownloadTask({ id: 'task-001', sourceUrl: 'https://example.com/one' });
    const second = new DownloadTask({ id: 'task-002', sourceUrl: 'https://example.com/two' });

    first.transitionTo(DownloadStatus.Queued);
    second.transitionTo(DownloadStatus.Cancelled);
    queue.add(first);
    queue.add(second);

    const queries = new TaskQueryService(queue);

    expect(queries.getTask('task-001')).toEqual({
      id: 'task-001',
      sourceUrl: 'https://example.com/one',
      status: 'Queued',
      progress: 0,
    });
    expect(queries.listTasks()).toEqual([
      {
        id: 'task-001',
        sourceUrl: 'https://example.com/one',
        status: 'Queued',
        progress: 0,
      },
      {
        id: 'task-002',
        sourceUrl: 'https://example.com/two',
        status: 'Cancelled',
        progress: 0,
      },
    ]);
    expect(queries.getTask('missing')).toBeUndefined();
  });
});
