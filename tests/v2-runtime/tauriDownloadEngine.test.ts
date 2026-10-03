import { describe, expect, it, vi } from 'vitest';

import type { EngineUpdate } from '../../packages/contracts/src';
import { DownloadStartError } from '../../packages/application/src/download-engine';
import { TauriDownloadEngine } from '../../src/v2-runtime/tauriDownloadEngine';

function createHarness() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const progressUnlisten = vi.fn();
  const resultUnlisten = vi.fn();

  const invoke = vi.fn(async () => undefined);
  const listen = vi.fn(async (event: string, handler: (payload: unknown) => void) => {
    handlers.set(event, handler);
    return event === 'download-progress' ? progressUnlisten : resultUnlisten;
  });

  return {
    handlers,
    invoke,
    listen,
    progressUnlisten,
    resultUnlisten,
  };
}

describe('TauriDownloadEngine', () => {
  it('marks listener-install failure as definitely not reaching native start', async () => {
    const invoke = vi.fn(async () => undefined);
    const listen = vi.fn(async () => {
      throw new Error('listener install failed');
    });
    const engine = new TauriDownloadEngine({ invoke, listen });
    engine.subscribeUpdates(() => {});

    const error = await engine.start({
      taskId: 'task-pre-invoke-failure',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DownloadStartError);
    expect((error as DownloadStartError).executionMayExist).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('marks start_download invoke rejection as possibly having reached native execution', async () => {
    const harness = createHarness();
    harness.invoke.mockRejectedValueOnce(new Error('invoke transport failed'));
    const engine = new TauriDownloadEngine({
      invoke: harness.invoke,
      listen: harness.listen,
    });
    engine.subscribeUpdates(() => {});

    const error = await engine.start({
      taskId: 'task-invoke-ambiguous',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DownloadStartError);
    expect((error as DownloadStartError).executionMayExist).toBe(true);
  });

  it('marks structured preflight rejection as definitely not having reached native execution', async () => {
    const harness = createHarness();
    harness.invoke.mockRejectedValueOnce({
      code: 'tool_busy',
      message: 'Media tool update in progress',
      executionMayExist: false,
    });
    const engine = new TauriDownloadEngine({
      invoke: harness.invoke,
      listen: harness.listen,
    });
    engine.subscribeUpdates(() => {});

    const error = await engine.start({
      taskId: 'task-preflight-busy',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DownloadStartError);
    expect((error as DownloadStartError).executionMayExist).toBe(false);
    expect((error as DownloadStartError).message).toBe('Media tool update in progress');
  });

  it('marks stringified structured preflight rejection as definitely not having reached native execution', async () => {
    const harness = createHarness();
    harness.invoke.mockRejectedValueOnce(
      JSON.stringify({
        code: 'tool_busy',
        message: 'Media tool update in progress',
        executionMayExist: false,
      }),
    );
    const engine = new TauriDownloadEngine({
      invoke: harness.invoke,
      listen: harness.listen,
    });
    engine.subscribeUpdates(() => {});

    const error = await engine.start({
      taskId: 'task-preflight-busy-string',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DownloadStartError);
    expect((error as DownloadStartError).executionMayExist).toBe(false);
    expect((error as DownloadStartError).message).toBe('Media tool update in progress');
  });

  it('installs listeners before invoking start_download and maps the start request', async () => {
    const harness = createHarness();
    const engine = new TauriDownloadEngine({
      invoke: harness.invoke,
      listen: harness.listen,
    });
    engine.subscribeUpdates(() => {});

    await engine.start({
      taskId: 'task-start',
      sourceUrl: 'https://example.com/video',
      downloadType: 'audio',
      downloadDir: 'C:/downloads',
      extraArgs: { audioCodec: 'flac' },
    });

    expect(harness.listen).toHaveBeenCalledTimes(2);
    expect(harness.invoke).toHaveBeenCalledWith('start_download', {
      id: 'task-start',
      url: 'https://example.com/video',
      downloadType: 'audio',
      downloadDir: 'C:/downloads',
      extraArgs: { audioCodec: 'flac' },
    });

    expect(harness.listen.mock.invocationCallOrder[0]).toBeLessThan(
      harness.invoke.mock.invocationCallOrder[0],
    );
    expect(harness.listen.mock.invocationCallOrder[1]).toBeLessThan(
      harness.invoke.mock.invocationCallOrder[0],
    );
  });

  it('maps only non-terminal legacy progress and ignores completed/error progress', async () => {
    const harness = createHarness();
    const engine = new TauriDownloadEngine({
      invoke: harness.invoke,
      listen: harness.listen,
    });
    const updates: EngineUpdate[] = [];
    engine.subscribeUpdates((update) => updates.push(update));

    await engine.start({
      taskId: 'task-progress',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    });

    const progress = harness.handlers.get('download-progress');
    expect(progress).toBeDefined();

    progress?.({
      id: 'task-progress',
      progress: 42,
      speed: '1 MiB/s',
      status: 'downloading',
    });
    progress?.({
      id: 'task-progress',
      progress: 90,
      speed: '',
      status: 'processing',
    });
    progress?.({
      id: 'task-progress',
      progress: 100,
      speed: '',
      status: 'completed',
    });
    progress?.({
      id: 'task-progress',
      progress: 0,
      speed: '',
      status: 'error',
    });

    expect(updates).toEqual([
      {
        type: 'progress',
        taskId: 'task-progress',
        phase: 'Downloading',
        progress: 42,
        speed: '1 MiB/s',
      },
      {
        type: 'progress',
        taskId: 'task-progress',
        phase: 'Processing',
        progress: 90,
        speed: '',
      },
    ]);
  });

  it('ignores malformed IPC payloads without throwing or emitting updates', async () => {
    const harness = createHarness();
    const engine = new TauriDownloadEngine({
      invoke: harness.invoke,
      listen: harness.listen,
    });
    const updates: EngineUpdate[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    engine.subscribeUpdates((update) => updates.push(update));

    await engine.start({
      taskId: 'task-malformed',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    });

    const progress = harness.handlers.get('download-progress');
    const result = harness.handlers.get('download-result');

    expect(() => progress?.(null)).not.toThrow();
    expect(() =>
      progress?.({
        id: 'task-malformed',
        status: 'downloading',
        progress: Number.NaN,
      }),
    ).not.toThrow();
    expect(() =>
      progress?.({
        id: 'task-malformed',
        status: 'mystery',
        progress: 10,
      }),
    ).not.toThrow();
    expect(() =>
      result?.({
        id: 'task-malformed',
        outcome: 'mystery',
      }),
    ).not.toThrow();
    expect(() =>
      result?.({
        id: 42,
        outcome: 'completed',
      }),
    ).not.toThrow();

    expect(updates).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('accepts Rust null Option fields on trusted terminal results', async () => {
    const harness = createHarness();
    const engine = new TauriDownloadEngine({
      invoke: harness.invoke,
      listen: harness.listen,
    });
    const updates: EngineUpdate[] = [];
    engine.subscribeUpdates((update) => updates.push(update));

    await engine.start({
      taskId: 'task-null-result',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    });

    const result = harness.handlers.get('download-result');
    expect(result).toBeDefined();

    result?.({
      id: 'task-null-result',
      outcome: 'completed',
      error: null,
      filePath: 'C:/downloads/video.mp4',
    });
    result?.({
      id: 'task-null-result',
      outcome: 'cancelled',
      error: null,
      filePath: null,
    });

    expect(updates).toEqual([
      {
        type: 'result',
        taskId: 'task-null-result',
        outcome: 'Completed',
        error: undefined,
        filePath: 'C:/downloads/video.mp4',
      },
      {
        type: 'result',
        taskId: 'task-null-result',
        outcome: 'Cancelled',
        error: undefined,
      },
    ]);
  });

  it('maps trusted download-result payloads to Engine result updates', async () => {
    const harness = createHarness();
    const engine = new TauriDownloadEngine({
      invoke: harness.invoke,
      listen: harness.listen,
    });
    const updates: EngineUpdate[] = [];
    engine.subscribeUpdates((update) => updates.push(update));

    await engine.start({
      taskId: 'task-result',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    });

    const result = harness.handlers.get('download-result');
    expect(result).toBeDefined();

    result?.({
      id: 'task-result',
      outcome: 'failed',
      error: 'exit code 7',
    });

    expect(updates).toEqual([
      {
        type: 'result',
        taskId: 'task-result',
        outcome: 'Failed',
        error: 'exit code 7',
      },
    ]);
  });

  it('redacts sensitive material from trusted failure text before publishing it', async () => {
    const harness = createHarness();
    const engine = new TauriDownloadEngine({
      invoke: harness.invoke,
      listen: harness.listen,
    });
    const updates: EngineUpdate[] = [];
    engine.subscribeUpdates((update) => updates.push(update));

    await engine.start({
      taskId: 'task-redacted-result',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    });

    const sensitiveValue = ['download', 'sensitive'].join('-');
    const queryKey = ['to', 'ken'].join('');
    harness.handlers.get('download-result')?.({
      id: 'task-redacted-result',
      outcome: 'failed',
      error: ['request failed: https://example.com/watch?v=ok&', queryKey, '=', sensitiveValue].join(''),
    });

    expect(updates).toHaveLength(1);
    const error = (updates[0] as { error?: string }).error ?? '';
    expect(error).toContain(`${queryKey}=<REDACTED>`);
    expect(error).not.toContain(sensitiveValue);
  });

  it('keeps duplicate callback subscriptions independent', async () => {
    const harness = createHarness();
    const engine = new TauriDownloadEngine({
      invoke: harness.invoke,
      listen: harness.listen,
    });
    const listener = vi.fn();

    const unsubscribeFirst = engine.subscribeUpdates(listener);
    const unsubscribeSecond = engine.subscribeUpdates(listener);

    await engine.start({
      taskId: 'task-duplicate-subscriptions',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    });

    const progress = harness.handlers.get('download-progress');
    progress?.({
      id: 'task-duplicate-subscriptions',
      progress: 10,
      speed: '1 MiB/s',
      status: 'downloading',
    });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribeFirst();
    expect(harness.progressUnlisten).not.toHaveBeenCalled();
    expect(harness.resultUnlisten).not.toHaveBeenCalled();

    progress?.({
      id: 'task-duplicate-subscriptions',
      progress: 20,
      speed: '1 MiB/s',
      status: 'downloading',
    });
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribeSecond();
    expect(harness.progressUnlisten).toHaveBeenCalledTimes(1);
    expect(harness.resultUnlisten).toHaveBeenCalledTimes(1);
  });

  it('reinstalls native listeners when a new subscriber arrives after full release', async () => {
    const harness = createHarness();
    const engine = new TauriDownloadEngine({
      invoke: harness.invoke,
      listen: harness.listen,
    });
    const firstListener = vi.fn();

    const unsubscribeFirst = engine.subscribeUpdates(firstListener);
    await engine.start({
      taskId: 'task-resubscribe',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    });

    unsubscribeFirst();
    expect(harness.progressUnlisten).toHaveBeenCalledTimes(1);
    expect(harness.resultUnlisten).toHaveBeenCalledTimes(1);

    const secondListener = vi.fn();
    const unsubscribeSecond = engine.subscribeUpdates(secondListener);

    await vi.waitFor(() => {
      expect(harness.listen).toHaveBeenCalledTimes(4);
    });

    const progress = harness.handlers.get('download-progress');
    progress?.({
      id: 'task-resubscribe',
      progress: 33,
      speed: '2 MiB/s',
      status: 'downloading',
    });
    expect(secondListener).toHaveBeenCalledWith({
      type: 'progress',
      taskId: 'task-resubscribe',
      phase: 'Downloading',
      progress: 33,
      speed: '2 MiB/s',
    });

    unsubscribeSecond();
    expect(harness.progressUnlisten).toHaveBeenCalledTimes(2);
    expect(harness.resultUnlisten).toHaveBeenCalledTimes(2);
  });

  it('keeps an in-flight native listener install when unsubscribe is followed by resubscribe', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const progressUnlisten = vi.fn();
    const resultUnlisten = vi.fn();
    let resolveProgress!: (unlisten: () => void) => void;

    const listen = vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
      if (event === 'download-progress') {
        return new Promise<() => void>((resolve) => {
          resolveProgress = resolve;
        });
      }
      return Promise.resolve(resultUnlisten);
    });

    const engine = new TauriDownloadEngine({
      invoke: vi.fn(async () => undefined),
      listen,
    });

    const unsubscribeFirst = engine.subscribeUpdates(() => {});
    expect(listen).toHaveBeenCalledTimes(1);

    unsubscribeFirst();

    const secondListener = vi.fn();
    const unsubscribeSecond = engine.subscribeUpdates(secondListener);
    resolveProgress(progressUnlisten);

    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledTimes(2);
    });

    expect(progressUnlisten).not.toHaveBeenCalled();
    expect(resultUnlisten).not.toHaveBeenCalled();

    handlers.get('download-progress')?.({
      id: 'task-install-race',
      progress: 18,
      speed: '1 MiB/s',
      status: 'downloading',
    });
    expect(secondListener).toHaveBeenCalledWith({
      type: 'progress',
      taskId: 'task-install-race',
      phase: 'Downloading',
      progress: 18,
      speed: '1 MiB/s',
    });

    unsubscribeSecond();
    expect(progressUnlisten).toHaveBeenCalledTimes(1);
    expect(resultUnlisten).toHaveBeenCalledTimes(1);
  });

  it('maps cancel_download and releases native listeners idempotently', async () => {
    const harness = createHarness();
    const engine = new TauriDownloadEngine({
      invoke: harness.invoke,
      listen: harness.listen,
    });
    const unsubscribe = engine.subscribeUpdates(() => {});

    await engine.start({
      taskId: 'task-cancel',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    });
    await engine.cancel('task-cancel');

    expect(harness.invoke).toHaveBeenLastCalledWith('cancel_download', {
      id: 'task-cancel',
    });

    unsubscribe();
    unsubscribe();

    expect(harness.progressUnlisten).toHaveBeenCalledTimes(1);
    expect(harness.resultUnlisten).toHaveBeenCalledTimes(1);
  });

  it('suppresses start_download when cancellation arrives before native listeners finish installing', async () => {
    let resolveProgressListen!: (unlisten: () => void) => void;
    const progressListen = new Promise<() => void>((resolve) => {
      resolveProgressListen = resolve;
    });
    const invoke = vi.fn(async () => undefined);
    const listen = vi.fn(async (event: string) => {
      if (event === 'download-progress') {
        return progressListen;
      }
      return () => {};
    });
    const engine = new TauriDownloadEngine({ invoke, listen });
    engine.subscribeUpdates(() => {});

    const startPromise = engine.start({
      taskId: 'task-pre-start-cancel',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    });

    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith('download-progress', expect.any(Function));
    });

    await expect(engine.cancel('task-pre-start-cancel')).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalledWith('start_download', expect.anything());
    expect(invoke).not.toHaveBeenCalledWith('cancel_download', expect.anything());

    resolveProgressListen(() => {});
    await expect(startPromise).rejects.toThrow(/cancelled before native execution/i);
    expect(invoke).not.toHaveBeenCalledWith('start_download', expect.anything());
  });

  it('prevents a delayed native start from dispatching after engine disposal during listener installation', async () => {
    let resolveProgressListen!: (unlisten: () => void) => void;
    const progressUnlisten = vi.fn();
    const resultUnlisten = vi.fn();
    const invoke = vi.fn(async () => undefined);
    const listen = vi.fn((event: string) => {
      if (event === 'download-progress') {
        return new Promise<() => void>((resolve) => {
          resolveProgressListen = resolve;
        });
      }
      return Promise.resolve(resultUnlisten);
    });
    const engine = new TauriDownloadEngine({ invoke, listen });
    engine.subscribeUpdates(() => {});

    const startPromise = engine.start({
      taskId: 'task-dispose-before-start',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    });

    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith('download-progress', expect.any(Function));
    });

    const disposePromise = engine.dispose?.();
    resolveProgressListen(progressUnlisten);

    await expect(Promise.resolve(disposePromise)).resolves.toBeUndefined();
    await expect(startPromise).rejects.toThrow(/disposed|cancelled before native execution/i);
    expect(invoke).not.toHaveBeenCalledWith('start_download', expect.anything());
    expect(progressUnlisten).toHaveBeenCalledTimes(1);
    expect(resultUnlisten).toHaveBeenCalledTimes(1);
  });

  it('retries native cancellation after start acceptance if the first cancel races before registration', async () => {
    let resolveStart!: () => void;
    const nativeStart = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
    let cancelCalls = 0;
    const invoke = vi.fn(async (command: string) => {
      if (command === 'start_download') {
        await nativeStart;
        return undefined;
      }
      if (command === 'cancel_download') {
        cancelCalls += 1;
        if (cancelCalls === 1) {
          throw new Error('No active execution for task task-late-start-cancel');
        }
      }
      return undefined;
    });
    const listen = vi.fn(async () => () => {});
    const engine = new TauriDownloadEngine({ invoke, listen });
    engine.subscribeUpdates(() => {});

    const startPromise = engine.start({
      taskId: 'task-late-start-cancel',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    });

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('start_download', expect.anything());
    });

    const cancelPromise = engine.cancel('task-late-start-cancel');
    await vi.waitFor(() => {
      expect(cancelCalls).toBe(1);
    });

    resolveStart();
    await expect(cancelPromise).resolves.toBeUndefined();
    await expect(startPromise).resolves.toBeUndefined();

    expect(cancelCalls).toBe(2);
    expect(invoke).toHaveBeenNthCalledWith(
      3,
      'cancel_download',
      { id: 'task-late-start-cancel' },
    );
  });

  it('owns accepted nonterminal executions until trusted result and cancels them during dispose', async () => {
    const harness = createHarness();
    const engine = new TauriDownloadEngine({
      invoke: harness.invoke,
      listen: harness.listen,
    });
    engine.subscribeUpdates(() => {});

    await engine.start({
      taskId: 'task-accepted-dispose',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    });

    await expect(engine.dispose()).resolves.toBeUndefined();

    expect(harness.invoke).toHaveBeenCalledWith('cancel_download', {
      id: 'task-accepted-dispose',
    });
  });

  it('surfaces dispose cancellation failure and allows a later dispose retry to finish cleanup', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const progressUnlisten = vi.fn();
    const resultUnlisten = vi.fn();
    let cancelCalls = 0;
    const invoke = vi.fn(async (command: string) => {
      if (command === 'cancel_download') {
        cancelCalls += 1;
        if (cancelCalls === 1) {
          throw new Error('cancel transport failed');
        }
      }
      return undefined;
    });
    const listen = vi.fn(async (event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
      return event === 'download-progress' ? progressUnlisten : resultUnlisten;
    });
    const engine = new TauriDownloadEngine({ invoke, listen });
    engine.subscribeUpdates(() => {});

    await engine.start({
      taskId: 'task-dispose-retry',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
    });

    await expect(engine.dispose()).rejects.toThrow('cancel transport failed');
    expect(cancelCalls).toBe(1);

    await expect(engine.dispose()).resolves.toBeUndefined();
    expect(cancelCalls).toBe(2);
    expect(progressUnlisten).toHaveBeenCalledTimes(1);
    expect(resultUnlisten).toHaveBeenCalledTimes(1);
  });
});
