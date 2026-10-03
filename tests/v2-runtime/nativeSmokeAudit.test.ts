import { describe, expect, it, vi } from 'vitest';

import type { EngineUpdate, EngineUpdateListener } from '../../packages/contracts/src';
import { createNativeSmokeAudit } from '../../src/v2-runtime/nativeSmokeAudit';

function createFakeEngine() {
  const listeners = new Set<EngineUpdateListener>();

  return {
    engine: {
      subscribeUpdates(listener: EngineUpdateListener) {
        listeners.add(listener);
        let active = true;
        return () => {
          if (!active) {
            return;
          }
          active = false;
          listeners.delete(listener);
        };
      },
    },
    emit(update: EngineUpdate) {
      for (const listener of listeners) {
        listener(update);
      }
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

describe('native smoke result audit', () => {
  it('keeps counting delayed duplicate terminal results until explicit disposal', async () => {
    vi.useFakeTimers();

    try {
      const fake = createFakeEngine();
      const audit = createNativeSmokeAudit(fake.engine);
      const task = audit.registerTask('task-delayed-duplicate');

      fake.emit({
        type: 'result',
        taskId: 'task-delayed-duplicate',
        outcome: 'Completed',
      });

      await expect(task.firstResult).resolves.toBeUndefined();
      expect(task.snapshot().resultCount).toBe(1);

      setTimeout(() => {
        fake.emit({
          type: 'result',
          taskId: 'task-delayed-duplicate',
          outcome: 'Completed',
        });
      }, 500);

      await vi.advanceTimersByTimeAsync(500);

      expect(task.snapshot().resultCount).toBe(2);
      expect(task.snapshot().updates).toHaveLength(2);
      expect(fake.listenerCount()).toBe(1);

      audit.dispose();
      expect(fake.listenerCount()).toBe(0);

      fake.emit({
        type: 'result',
        taskId: 'task-delayed-duplicate',
        outcome: 'Completed',
      });
      expect(task.snapshot().resultCount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps task ids isolated while sharing one audit subscription', async () => {
    const fake = createFakeEngine();
    const audit = createNativeSmokeAudit(fake.engine);
    const first = audit.registerTask('task-a');
    const second = audit.registerTask('task-b');

    fake.emit({
      type: 'result',
      taskId: 'task-a',
      outcome: 'Completed',
    });
    fake.emit({
      type: 'result',
      taskId: 'task-b',
      outcome: 'Failed',
      error: 'expected failure',
    });

    await Promise.all([first.firstResult, second.firstResult]);

    expect(first.snapshot().resultCount).toBe(1);
    expect(second.snapshot().resultCount).toBe(1);
    expect(first.snapshot().updates[0]?.taskId).toBe('task-a');
    expect(second.snapshot().updates[0]?.taskId).toBe('task-b');

    audit.dispose();
  });
});
