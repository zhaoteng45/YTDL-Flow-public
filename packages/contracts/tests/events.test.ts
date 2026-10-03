import { describe, expect, it } from 'vitest';
import type { ProgressEvent, TaskStatusPayload } from '../src';

describe('ProgressEvent', () => {
  it('conveys minimal progress information across boundaries', () => {
    const status: TaskStatusPayload = 'Downloading';
    const event: ProgressEvent = {
      taskId: 'task-201',
      progress: 65,
      status,
    };

    expect(event.taskId).toBe('task-201');
    expect(event.progress).toBe(65);
    expect(event.status).toBe('Downloading');
    expect(Object.keys(event).sort()).toEqual(['progress', 'status', 'taskId']);
  });

  it('enforces minimal contract keys with no speculative fields', () => {
    const event: ProgressEvent = {
      taskId: 'task-202',
      progress: 100,
      status: 'Completed',
    };

    const keys = Object.keys(event);
    expect(keys).toContain('taskId');
    expect(keys).toContain('progress');
    expect(keys).toContain('status');
    expect(keys.length).toBe(3);
  });
});
