import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ErrorPayload, TaskPayload } from '@ytdl-flow/contracts';

import { ProductFlowController } from '../src/features/product/product-flow-controller';
import { deferred, FakeProductApi, taskPayload } from './helpers/fake-product-api';

function createController(api: FakeProductApi, pollIntervalMs = 1000) {
  return new ProductFlowController({ api, pollIntervalMs });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ProductFlowController analyze', () => {
  it('stores the normalized analysis for the current input', async () => {
    const api = new FakeProductApi();
    const controller = createController(api);

    controller.setInput('https://example.com/video');
    await controller.analyze();

    expect(api.analyzeCalls).toEqual(['https://example.com/video']);
    expect(controller.getState().analysis).toEqual({
      sourceUrl: 'https://example.com/video',
      title: 'Example title',
      channel: 'Example channel',
      durationLabel: '05:12',
    });
    expect(controller.getState().analyzing).toBe(false);
    expect(controller.canCreateDownload()).toBe(true);
  });

  it('rejects an empty input locally without calling the api', async () => {
    const api = new FakeProductApi();
    const controller = createController(api);

    controller.setInput('   ');
    await controller.analyze();

    expect(api.analyzeCalls).toEqual([]);
    expect(controller.getState().analyzeError?.code).toBe('invalid-source-url');
    expect(controller.canCreateDownload()).toBe(false);
  });

  it('surfaces the application URL validation error without creating a snapshot', async () => {
    const api = new FakeProductApi();
    const controller = createController(api);
    api.analyzeImpl = async () => ({
      ok: false,
      error: { code: 'invalid-source-url', message: '请输入单个有效的 http(s) 链接' },
    });

    controller.setInput('not a url');
    await controller.analyze();

    expect(api.analyzeCalls).toEqual(['not a url']);
    expect(controller.getState().analyzeError?.code).toBe('invalid-source-url');
    expect(controller.getState().analysis).toBeNull();
    expect(controller.canCreateDownload()).toBe(false);
  });

  it('surfaces an analyze failure as ErrorPayload', async () => {
    const api = new FakeProductApi();
    const controller = createController(api);
    api.analyzeImpl = async () => ({
      ok: false,
      error: { code: 'playlist-not-supported', message: '仅支持单个视频链接' },
    });

    controller.setInput('https://example.com/playlist');
    await controller.analyze();

    expect(controller.getState().analyzeError).toEqual({
      code: 'playlist-not-supported',
      message: '仅支持单个视频链接',
    });
    expect(controller.getState().analysis).toBeNull();
  });

  it('drops a stale analyze response after the input changed', async () => {
    const api = new FakeProductApi();
    const controller = createController(api);
    const slow = deferred<{ ok: true; media: { sourceUrl: string; title: string } }>();
    api.analyzeImpl = () => slow.promise;

    controller.setInput('https://example.com/first');
    const pending = controller.analyze();
    controller.setInput('https://example.com/second');

    slow.resolve({ ok: true, media: { sourceUrl: 'https://example.com/first', title: 'Stale' } });
    await pending;

    expect(controller.getState().analysis).toBeNull();
    expect(controller.canCreateDownload()).toBe(false);
  });

  it('drops an older analyze response when a newer request supersedes it', async () => {
    const api = new FakeProductApi();
    const controller = createController(api);
    const first = deferred<{ ok: true; media: { sourceUrl: string; title: string } }>();
    const second = deferred<{ ok: true; media: { sourceUrl: string; title: string } }>();
    let call = 0;
    api.analyzeImpl = () => (call++ === 0 ? first.promise : second.promise);

    controller.setInput('https://example.com/first');
    const firstRun = controller.analyze();

    // Editing the input cancels the visible wait and allows a fresh request.
    controller.setInput('https://example.com/second');
    const secondRun = controller.analyze();
    expect(api.analyzeCalls).toEqual(['https://example.com/first', 'https://example.com/second']);

    second.resolve({ ok: true, media: { sourceUrl: 'https://example.com/second', title: 'Newer' } });
    await secondRun;
    expect(controller.getState().analysis?.title).toBe('Newer');

    first.resolve({ ok: true, media: { sourceUrl: 'https://example.com/first', title: 'Older' } });
    await firstRun;

    expect(controller.getState().analysis?.title).toBe('Newer');
    expect(controller.getState().analysis?.sourceUrl).toBe('https://example.com/second');
  });
});

describe('ProductFlowController createDownload', () => {
  it('creates one task from the current snapshot and refreshes immediately', async () => {
    const api = new FakeProductApi();
    const controller = createController(api);
    api.listTasksImpl = async () => [taskPayload({ status: 'Queued' })];

    controller.setInput('https://example.com/video');
    await controller.analyze();
    const before = api.listTasksCalls;

    await controller.createDownload('audio-mp3');

    expect(api.createCalls).toEqual([
      { sourceUrl: 'https://example.com/video', selection: 'audio-mp3' },
    ]);
    expect(api.listTasksCalls).toBeGreaterThan(before);
    expect(controller.getState().tasks[0]?.status).toBe('Queued');
  });

  it('prevents duplicate submit while a create command is pending', async () => {
    const api = new FakeProductApi();
    const controller = createController(api);
    const create = deferred<{ ok: true; task: TaskPayload }>();
    api.createImpl = () => create.promise;

    controller.setInput('https://example.com/video');
    await controller.analyze();

    const first = controller.createDownload('video-auto');
    await controller.createDownload('video-auto');
    expect(api.createCalls).toHaveLength(1);

    create.resolve({ ok: true, task: taskPayload() });
    await first;
    expect(api.createCalls).toHaveLength(1);
  });

  it('refuses to submit when the snapshot no longer matches the input', async () => {
    const api = new FakeProductApi();
    const controller = createController(api);

    controller.setInput('https://example.com/video');
    await controller.analyze();
    controller.setInput('https://example.com/changed');

    await controller.createDownload('video-auto');

    expect(api.createCalls).toEqual([]);
    expect(controller.canCreateDownload()).toBe(false);
  });

  it('surfaces a create failure as a submit error', async () => {
    const api = new FakeProductApi();
    const controller = createController(api);
    const error: ErrorPayload = { code: 'create-task-failed', message: 'start_download rejected' };
    api.createImpl = async () => ({ ok: false, error });

    controller.setInput('https://example.com/video');
    await controller.analyze();
    await controller.createDownload('video-auto');

    expect(controller.getState().submitError).toEqual(error);
    expect(controller.getState().submitting).toBe(false);
  });
});

describe('ProductFlowController cancel', () => {
  it('keeps a cancel rejection observable without fabricating Cancelled', async () => {
    const api = new FakeProductApi();
    const controller = createController(api);
    api.listTasksImpl = async () => [taskPayload({ status: 'Downloading', progress: 40 })];
    const cancelError: ErrorPayload = { code: 'cancel-rejected', message: 'No active execution' };
    api.cancelImpl = async () => ({ outcome: { type: 'cancel-rejected', error: cancelError } });

    await controller.refreshTasks();
    await controller.cancelTask('task-1');

    expect(api.cancelCalls).toEqual(['task-1']);
    expect(controller.getState().cancelErrors['task-1']).toEqual(cancelError);
    expect(controller.getState().tasks[0]?.status).toBe('Downloading');
  });

  it('exposes a delayed cancel rejection through the settlement channel', async () => {
    const api = new FakeProductApi();
    const controller = createController(api);
    const settlement = deferred<{
      type: 'cancel-rejected';
      error: ErrorPayload;
    }>();
    api.cancelImpl = async () => ({
      outcome: { type: 'cancel-requested' },
      settlement: settlement.promise,
    });

    await controller.cancelTask('task-1');
    expect(controller.getState().cancelErrors['task-1']).toBeUndefined();
    expect(controller.getState().cancelPending['task-1']).toBeUndefined();

    settlement.resolve({
      type: 'cancel-rejected',
      error: { code: 'cancel-rejected', message: 'No active execution for task task-1' },
    });
    await vi.waitFor(() => {
      expect(controller.getState().cancelErrors['task-1']?.message).toBe(
        'No active execution for task task-1',
      );
    });
  });

  it('ignores a second cancel while the first is pending', async () => {
    const api = new FakeProductApi();
    const controller = createController(api);
    const cancel = deferred<{ outcome: { type: 'cancel-requested' } }>();
    api.cancelImpl = () => cancel.promise;

    const first = controller.cancelTask('task-1');
    await controller.cancelTask('task-1');
    expect(api.cancelCalls).toHaveLength(1);

    cancel.resolve({ outcome: { type: 'cancel-requested' } });
    await first;
  });

  it('clears stale cancel errors when the task reaches a terminal state', async () => {
    const api = new FakeProductApi();
    const controller = createController(api);
    api.cancelImpl = async () => ({
      outcome: {
        type: 'cancel-rejected',
        error: { code: 'cancel-rejected', message: 'No active execution' },
      },
    });
    api.listTasksImpl = async () => [taskPayload({ status: 'Downloading', progress: 60 })];

    await controller.refreshTasks();
    await controller.cancelTask('task-1');
    expect(controller.getState().cancelErrors['task-1']).toBeDefined();

    api.listTasksImpl = async () => [taskPayload({ status: 'Completed', progress: 100 })];
    await controller.refreshTasks();

    expect(controller.getState().cancelErrors['task-1']).toBeUndefined();
  });
});

describe('ProductFlowController polling lifecycle', () => {
  it('polls serially, applies snapshots without manual refresh, and stops on cleanup', async () => {
    vi.useFakeTimers();
    const api = new FakeProductApi();
    const controller = createController(api, 100);
    const pendingRead = deferred<TaskPayload[]>();
    api.listTasksImpl = () => pendingRead.promise;

    controller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.listTasksCalls).toBe(1);

    // A slow read must not be overlapped by the poll loop.
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.listTasksCalls).toBe(1);

    pendingRead.resolve([taskPayload({ status: 'Processing', progress: 90 })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState().tasks[0]?.status).toBe('Processing');

    api.listTasksImpl = async () => [taskPayload({ status: 'Completed', progress: 100 })];
    await vi.advanceTimersByTimeAsync(200);
    expect(controller.getState().tasks[0]?.status).toBe('Completed');

    controller.stop();
    const callsBeforeStop = api.listTasksCalls;
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.listTasksCalls).toBe(callsBeforeStop);
  });

  it('keeps polling when a read fails', async () => {
    vi.useFakeTimers();
    const api = new FakeProductApi();
    const controller = createController(api, 100);
    api.listTasksImpl = async () => {
      throw new Error('read failed');
    };

    controller.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(api.listTasksCalls).toBeGreaterThan(1);
    expect(controller.getState().tasks).toEqual([]);

    controller.stop();
  });

  it('notifies subscribers and stops after stop()', async () => {
    vi.useFakeTimers();
    const api = new FakeProductApi();
    const controller = createController(api, 100);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    controller.start();
    await vi.advanceTimersByTimeAsync(150);
    expect(listener).toHaveBeenCalled();

    controller.stop();
    unsubscribe();
    const calls = listener.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(listener.mock.calls.length).toBe(calls);
  });
});
