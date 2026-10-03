import { describe, expect, it } from 'vitest';
import type { TaskPayload, TaskStatusPayload } from '../src';

describe('TaskPayload', () => {
  it('holds pure data for task transfer across layers', () => {
    const status: TaskStatusPayload = 'Downloading';
    const payload: TaskPayload = {
      id: 'task-101',
      sourceUrl: 'https://example.com/video',
      status,
      progress: 42.5,
    };

    expect(payload.id).toBe('task-101');
    expect(payload.sourceUrl).toBe('https://example.com/video');
    expect(payload.status).toBe('Downloading');
    expect(payload.progress).toBe(42.5);
  });

  it('contains no domain entity methods or state machine logic', () => {
    const payload: TaskPayload = {
      id: 'task-102',
      sourceUrl: 'https://example.com/video2',
      status: 'Created',
      progress: 0,
    };

    expect(Object.keys(payload).sort()).toEqual(['id', 'progress', 'sourceUrl', 'status']);
    expect((payload as unknown as Record<string, unknown>).transitionTo).toBeUndefined();
    expect((payload as unknown as Record<string, unknown>).pullEvents).toBeUndefined();
  });
});
