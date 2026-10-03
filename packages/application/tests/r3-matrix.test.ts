import { describe, expect, it, vi } from 'vitest';

import type { DownloadStartRequest, EngineUpdate } from '../../contracts/src';
import { DownloadQueue } from '../../domain/src';
import type { DownloadEngine, EngineUpdateListener } from '../src';
import { DownloadService, TaskQueryService } from '../src';

class ControlledMockEngine implements DownloadEngine {
  public listeners = new Set<EngineUpdateListener>();
  public startCalls: DownloadStartRequest[] = [];
  public cancelCalls: string[] = [];
  public startResolvers: Array<() => void> = [];
  public startRejecters: Array<(err: unknown) => void> = [];
  public cancelResolvers: Array<() => void> = [];
  public cancelRejecters: Array<(err: unknown) => void> = [];

  public startBehavior: 'manual' | 'resolveImmediate' | 'rejectImmediate' = 'manual';
  public cancelBehavior: 'manual' | 'resolveImmediate' | 'rejectImmediate' = 'resolveImmediate';

  start(request: DownloadStartRequest): Promise<void> {
    this.startCalls.push(request);

    if (this.startBehavior === 'resolveImmediate') {
      return Promise.resolve();
    }
    if (this.startBehavior === 'rejectImmediate') {
      return Promise.reject(new Error('Start rejected immediately'));
    }

    return new Promise((resolve, reject) => {
      this.startResolvers.push(resolve);
      this.startRejecters.push(reject);
    });
  }

  cancel(taskId: string): Promise<void> {
    this.cancelCalls.push(taskId);

    if (this.cancelBehavior === 'resolveImmediate') {
      return Promise.resolve();
    }
    if (this.cancelBehavior === 'rejectImmediate') {
      return Promise.reject(new Error('Cancel rejected immediately'));
    }

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

  resolveStart(index = 0): void {
    const resolver = this.startResolvers[index];
    if (resolver) {
      resolver();
    }
  }

  rejectStart(err: unknown, index = 0): void {
    const rejecter = this.startRejecters[index];
    if (rejecter) {
      rejecter(err);
    }
  }
}

describe('R3 §7 Stage 1 Behavior Matrix', () => {
  it('1. Pending snapshot can be observed after dispatch and before controlled Mock emits progress', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-1');
    const query = new TaskQueryService(queue);

    const task = await service.createTask('https://example.com/1');

    expect(task.status).toBe('Pending');
    expect(task.progress).toBe(0);
    expect(query.getTask('task-1')?.status).toBe('Pending');
    expect(query.getTask('task-1')?.progress).toBe(0);
  });

  it('2. synchronous Downloading -> Processing -> Completed before start Promise settles', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-2');
    const query = new TaskQueryService(queue);

    // When engine.start is called, emit updates synchronously while start Promise is unresolved
    const originalStart = engine.start.bind(engine);
    engine.start = (req) => {
      const p = originalStart(req);
      engine.emit({ type: 'progress', taskId: req.taskId, phase: 'Downloading', progress: 10 });
      engine.emit({ type: 'progress', taskId: req.taskId, phase: 'Processing', progress: 99 });
      engine.emit({ type: 'result', taskId: req.taskId, outcome: 'Completed' });
      return p;
    };

    const task = await service.createTask('https://example.com/2');

    expect(task.status).toBe('Completed');
    expect(task.progress).toBe(100);
    expect(query.getTask('task-2')?.status).toBe('Completed');
    expect(query.getTask('task-2')?.progress).toBe(100);
  });

  it('3. repeated Downloading updates latest progress', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-3');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/3');

    engine.emit({ type: 'progress', taskId: 'task-3', phase: 'Downloading', progress: 12.5 });
    expect(query.getTask('task-3')?.status).toBe('Downloading');
    expect(query.getTask('task-3')?.progress).toBe(12.5);

    engine.emit({ type: 'progress', taskId: 'task-3', phase: 'Downloading', progress: 45.8 });
    expect(query.getTask('task-3')?.progress).toBe(45.8);

    engine.emit({ type: 'progress', taskId: 'task-3', phase: 'Downloading', progress: 80.0 });
    expect(query.getTask('task-3')?.progress).toBe(80.0);
  });

  it('4. Processing -> Downloading does not fail ingestion', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-4');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/4');

    engine.emit({ type: 'progress', taskId: 'task-4', phase: 'Processing', progress: 50 });
    expect(query.getTask('task-4')?.status).toBe('Processing');

    // Backward transition from Processing to Downloading must not throw and should update
    expect(() => {
      engine.emit({ type: 'progress', taskId: 'task-4', phase: 'Downloading', progress: 60 });
    }).not.toThrow();

    expect(query.getTask('task-4')?.status).toBe('Downloading');
    expect(query.getTask('task-4')?.progress).toBe(60);
  });

  it('5. Pending -> Processing -> Completed', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-5');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/5');
    expect(query.getTask('task-5')?.status).toBe('Pending');

    engine.emit({ type: 'progress', taskId: 'task-5', phase: 'Processing', progress: 90 });
    expect(query.getTask('task-5')?.status).toBe('Processing');
    expect(query.getTask('task-5')?.progress).toBe(90);

    engine.emit({ type: 'result', taskId: 'task-5', outcome: 'Completed' });
    expect(query.getTask('task-5')?.status).toBe('Completed');
    expect(query.getTask('task-5')?.progress).toBe(100);
  });

  it('6. trusted Pending -> Completed', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-6');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/6');
    expect(query.getTask('task-6')?.status).toBe('Pending');

    engine.emit({ type: 'result', taskId: 'task-6', outcome: 'Completed' });
    expect(query.getTask('task-6')?.status).toBe('Completed');
    expect(query.getTask('task-6')?.progress).toBe(100);
  });

  it('7. start rejection -> Failed', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-7');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/7');

    // Reject start promise
    engine.rejectStart(new Error('Command failed'));
    await new Promise((resolve) => setTimeout(resolve, 0)); // wait for promise rejection settlement

    expect(query.getTask('task-7')?.status).toBe('Failed');
  });

  it('8. cancellation before start dispatch -> Queued -> Cancelled and Engine not called', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-8');
    const query = new TaskQueryService(queue);

    // Manually add a task into queue directly without dispatching start
    const { DownloadTask, DownloadStatus } = await import('../../domain/src');
    const task = new DownloadTask({ id: 'task-8-manual', sourceUrl: 'https://example.com' });
    task.transitionTo(DownloadStatus.Queued);
    queue.add(task);

    await service.cancelTask('task-8-manual');

    expect(query.getTask('task-8-manual')?.status).toBe('Cancelled');
    expect(engine.cancelCalls).toHaveLength(0);
  });

  it('9. cancellation while start pending -> cancel sent only after accepted start', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-9');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/9');
    expect(engine.startCalls).toHaveLength(1);
    expect(engine.cancelCalls).toHaveLength(0);

    // Cancel while start is pending
    await service.cancelTask('task-9');
    expect(engine.cancelCalls).toHaveLength(0);
    expect(query.getTask('task-9')?.status).toBe('Pending');

    // Now start resolves
    engine.resolveStart(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(engine.cancelCalls).toEqual(['task-9']);
  });

  it('10. pending cancellation + start rejection -> Cancelled', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-10');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/10');
    await service.cancelTask('task-10');

    engine.rejectStart(new Error('Spawn failed'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(query.getTask('task-10')?.status).toBe('Cancelled');
  });

  it('11. accepted execution remains Pending with no progress, cancel is requested, trusted Cancelled result arrives -> Query returns Cancelled', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-11');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/11');
    engine.resolveStart(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await service.cancelTask('task-11');
    expect(engine.cancelCalls).toEqual(['task-11']);
    expect(query.getTask('task-11')?.status).toBe('Pending'); // Still Pending before trusted result

    engine.emit({ type: 'result', taskId: 'task-11', outcome: 'Cancelled' });
    expect(query.getTask('task-11')?.status).toBe('Cancelled');
  });

  it('12. accepted execution + cancel request -> no immediate Cancelled; trusted result settles it', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-12');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/12');
    engine.resolveStart(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    engine.emit({ type: 'progress', taskId: 'task-12', phase: 'Downloading', progress: 30 });
    expect(query.getTask('task-12')?.status).toBe('Downloading');

    await service.cancelTask('task-12');
    expect(query.getTask('task-12')?.status).toBe('Downloading'); // not immediately Cancelled!

    engine.emit({ type: 'result', taskId: 'task-12', outcome: 'Cancelled' });
    expect(query.getTask('task-12')?.status).toBe('Cancelled');
    expect(query.getTask('task-12')?.progress).toBe(30); // preserves last valid progress
  });

  it('13. cancel rejection does not synthesize terminal', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    engine.cancelBehavior = 'rejectImmediate';
    const service = new DownloadService(queue, engine, () => 'task-13');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/13');
    engine.resolveStart(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    engine.emit({ type: 'progress', taskId: 'task-13', phase: 'Downloading', progress: 40 });

    await service.cancelTask('task-13');

    expect(query.getTask('task-13')?.status).toBe('Downloading');
    expect(query.getTask('task-13')?.progress).toBe(40);
  });

  it('14. Processing -> trusted Cancelled', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-14');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/14');
    engine.emit({ type: 'progress', taskId: 'task-14', phase: 'Processing', progress: 95 });
    expect(query.getTask('task-14')?.status).toBe('Processing');

    engine.emit({ type: 'result', taskId: 'task-14', outcome: 'Cancelled' });
    expect(query.getTask('task-14')?.status).toBe('Cancelled');
    expect(query.getTask('task-14')?.progress).toBe(95);
  });

  it('15. late progress after terminal ignored', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-15');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/15');
    engine.emit({ type: 'progress', taskId: 'task-15', phase: 'Downloading', progress: 50 });
    engine.emit({ type: 'result', taskId: 'task-15', outcome: 'Failed', error: 'Broken pipe' });
    expect(query.getTask('task-15')?.status).toBe('Failed');
    expect(query.getTask('task-15')?.progress).toBe(50);

    // Late progress arrived after terminal
    engine.emit({ type: 'progress', taskId: 'task-15', phase: 'Downloading', progress: 80 });
    expect(query.getTask('task-15')?.status).toBe('Failed');
    expect(query.getTask('task-15')?.progress).toBe(50);
  });

  it('16. conflicting second terminal result ignored for state mutation and reported', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-16');
    const query = new TaskQueryService(queue);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await service.createTask('https://example.com/16');
    engine.emit({ type: 'result', taskId: 'task-16', outcome: 'Completed' });
    expect(query.getTask('task-16')?.status).toBe('Completed');

    // Conflicting terminal result
    engine.emit({ type: 'result', taskId: 'task-16', outcome: 'Failed' });
    expect(query.getTask('task-16')?.status).toBe('Completed');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('conflicting or duplicate terminal result'));

    warnSpy.mockRestore();
  });

  it('17. unknown id ignored for state mutation', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-17');
    const query = new TaskQueryService(queue);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await service.createTask('https://example.com/17');

    engine.emit({ type: 'progress', taskId: 'unknown-999', phase: 'Downloading', progress: 70 });
    engine.emit({ type: 'result', taskId: 'unknown-999', outcome: 'Completed' });

    expect(query.getTask('unknown-999')).toBeUndefined();
    expect(query.getTask('task-17')?.status).toBe('Pending');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown task id in update: unknown-999'));

    warnSpy.mockRestore();
  });

  it('18. invalid NaN/Infinity progress preserves previous valid progress', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-18');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/18');
    engine.emit({ type: 'progress', taskId: 'task-18', phase: 'Downloading', progress: 42 });
    expect(query.getTask('task-18')?.progress).toBe(42);

    engine.emit({ type: 'progress', taskId: 'task-18', phase: 'Downloading', progress: Number.NaN });
    expect(query.getTask('task-18')?.progress).toBe(42);

    engine.emit({ type: 'progress', taskId: 'task-18', phase: 'Downloading', progress: Number.POSITIVE_INFINITY });
    expect(query.getTask('task-18')?.progress).toBe(42);
  });

  it('19. Query returns latest non-zero progress', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-19');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/19');
    engine.emit({ type: 'progress', taskId: 'task-19', phase: 'Downloading', progress: 73.4 });

    const task = query.getTask('task-19');
    expect(task?.progress).toBe(73.4);
    expect(query.listTasks()[0]?.progress).toBe(73.4);
  });

  it('20. release/dispose is idempotent and released subscription no longer mutates state', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-20');
    const query = new TaskQueryService(queue);

    await service.createTask('https://example.com/20');
    engine.emit({ type: 'progress', taskId: 'task-20', phase: 'Downloading', progress: 20 });
    expect(query.getTask('task-20')?.progress).toBe(20);

    service.dispose();
    service.dispose(); // Idempotent

    engine.emit({ type: 'progress', taskId: 'task-20', phase: 'Downloading', progress: 80 });
    expect(query.getTask('task-20')?.progress).toBe(20); // Not mutated after dispose
  });

  it('21. start rejects after prior terminal result -> terminal preserved and violation reported', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-21');
    const query = new TaskQueryService(queue);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await service.createTask('https://example.com/21');

    // Terminal result arrives first
    engine.emit({ type: 'result', taskId: 'task-21', outcome: 'Completed' });
    expect(query.getTask('task-21')?.status).toBe('Completed');

    // Start rejects afterwards
    engine.rejectStart(new Error('Delayed start error'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(query.getTask('task-21')?.status).toBe('Completed');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('start rejected after task task-21 already terminal'),
      expect.anything(),
    );

    errorSpy.mockRestore();
  });

  it('22. ignores Engine updates for tasks not created by this DownloadService', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'owned-task');
    const query = new TaskQueryService(queue);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { DownloadTask, DownloadStatus } = await import('../../domain/src');
    const foreignTask = new DownloadTask({
      id: 'foreign-task',
      sourceUrl: 'https://example.com/foreign',
    });
    foreignTask.transitionTo(DownloadStatus.Queued);
    queue.add(foreignTask);

    engine.emit({
      type: 'progress',
      taskId: 'foreign-task',
      phase: 'Downloading',
      progress: 75,
    });

    expect(query.getTask('foreign-task')).toEqual({
      id: 'foreign-task',
      sourceUrl: 'https://example.com/foreign',
      status: 'Queued',
      progress: 0,
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not owned by this service'));

    warnSpy.mockRestore();
    service.dispose();
  });

  it('23. invalid progress is reported and phase/progress are not partially applied', async () => {
    const queue = new DownloadQueue();
    const engine = new ControlledMockEngine();
    const service = new DownloadService(queue, engine, () => 'task-invalid-progress');
    const query = new TaskQueryService(queue);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await service.createTask('https://example.com/invalid-progress');
    engine.emit({
      type: 'progress',
      taskId: 'task-invalid-progress',
      phase: 'Downloading',
      progress: 42,
    });

    engine.emit({
      type: 'progress',
      taskId: 'task-invalid-progress',
      phase: 'Processing',
      progress: Number.NaN,
    });

    expect(query.getTask('task-invalid-progress')).toEqual({
      id: 'task-invalid-progress',
      sourceUrl: 'https://example.com/invalid-progress',
      status: 'Downloading',
      progress: 42,
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid progress'));

    warnSpy.mockRestore();
    service.dispose();
  });
});
