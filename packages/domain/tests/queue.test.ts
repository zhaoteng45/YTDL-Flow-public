import { describe, expect, it } from 'vitest';
import { DownloadQueue, DownloadTask } from '../src';

describe('DownloadQueue', () => {
  it('adds and retrieves tasks', () => {
    const queue = new DownloadQueue();
    const task = new DownloadTask({ id: 'task-1', sourceUrl: 'https://example.com' });

    queue.add(task);

    expect(queue.get('task-1')).toBe(task);
    expect(queue.all()).toHaveLength(1);
  });

  it('removes tasks', () => {
    const queue = new DownloadQueue();
    const task = new DownloadTask({ id: 'task-1', sourceUrl: 'https://example.com' });

    queue.add(task);
    queue.remove('task-1');

    expect(queue.get('task-1')).toBeUndefined();
    expect(queue.all()).toHaveLength(0);
  });

  it('rejects adding a task with a duplicate rowId', () => {
    const queue = new DownloadQueue();
    const task1 = new DownloadTask({ id: 'task-1', rowId: 'row-same', sourceUrl: 'https://example.com/1' });
    const task2 = new DownloadTask({ id: 'task-2', rowId: 'row-same', sourceUrl: 'https://example.com/2' });

    queue.add(task1);
    expect(() => queue.add(task2)).toThrow(/duplicate rowId/i);
    expect(queue.all()).toHaveLength(1);
    expect(queue.getByRowId('row-same')).toBe(task1);
  });

  it('replaces an attempt in place without moving the stable row', () => {
    const queue = new DownloadQueue();
    const first = new DownloadTask({ id: 'a-1', rowId: 'row-a', sourceUrl: 'https://example.com/a' });
    const middle = new DownloadTask({ id: 'b-1', rowId: 'row-b', sourceUrl: 'https://example.com/b' });
    const last = new DownloadTask({ id: 'c-1', rowId: 'row-c', sourceUrl: 'https://example.com/c' });
    queue.add(first);
    queue.add(middle);
    queue.add(last);

    const replacement = new DownloadTask({
      id: 'b-2',
      rowId: 'row-b',
      sourceUrl: 'https://example.com/b',
    });
    queue.replaceByRowId(replacement);

    expect(queue.all().map((task) => [task.rowId, task.attemptId])).toEqual([
      ['row-a', 'a-1'],
      ['row-b', 'b-2'],
      ['row-c', 'c-1'],
    ]);
  });
});
