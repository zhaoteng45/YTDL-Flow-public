import { describe, expect, it, vi } from 'vitest';

import type {
  CurrentAnalysisMedia,
  DownloadStartRequest,
  EngineUpdate,
} from '../../packages/contracts/src';
import type {
  CurrentMediaAnalyzer,
  DownloadEngine,
  EngineUpdateListener,
} from '../../packages/application/src';
import {
  createCurrentTaskRuntime,
  type CurrentTaskRuntimeEnvironment,
} from '../../src/v2-runtime/currentTaskRuntime';
import { TauriDownloadEngine } from '../../src/v2-runtime/tauriDownloadEngine';
import { projectDownloadList } from '../../src/components/downloadList.projection';

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

class FakeEngine implements DownloadEngine {
  readonly starts: DownloadStartRequest[] = [];
  readonly cancels: string[] = [];
  readonly listeners = new Set<EngineUpdateListener>();
  unsubscribeCount = 0;
  disposeCount = 0;
  disposeError?: Error;
  disposeSyncError?: Error;

  async start(request: DownloadStartRequest): Promise<void> {
    this.starts.push(request);
  }

  async cancel(taskId: string): Promise<void> {
    this.cancels.push(taskId);
  }

  subscribeUpdates(listener: EngineUpdateListener): () => void {
    this.listeners.add(listener);
    return () => {
      if (this.listeners.delete(listener)) this.unsubscribeCount++;
    };
  }

  emit(update: EngineUpdate): void {
    for (const listener of this.listeners) listener(update);
  }

  dispose(): Promise<void> | void {
    this.disposeCount++;
    if (this.disposeSyncError) {
      const error = this.disposeSyncError;
      this.disposeSyncError = undefined;
      throw error;
    }
    if (this.disposeError) {
      const error = this.disposeError;
      this.disposeError = undefined;
      return Promise.reject(error);
    }
  }
}

function media(url: string): CurrentAnalysisMedia {
  return {
    title: 'Video',
    thumbnail: 'thumb.jpg',
    duration: '1:00',
    channel: 'Channel',
    url,
  };
}

describe('current task runtime composition', () => {
  it('presents FIFO admission order even when download order differs from analysis order', async () => {
    let rowSequence = 0;
    const runtime = createCurrentTaskRuntime({
      engine: new FakeEngine(), analyzer: { async analyze(request) { return media(request.sourceUrl); } },
      environment: { getGlobalExtraArgs: () => ({}), getDownloadDir: () => undefined },
      effectsPort: { playSuccess: vi.fn(), playError: vi.fn(), setTaskbar: vi.fn() },
      createRowId: () => `fifo-${++rowSequence}`,
    });
    runtime.actions.analyzeUrls(['https://example.com/1', 'https://example.com/2', 'https://example.com/3']);
    await flush();
    await runtime.tasks.start('fifo-3');
    await runtime.tasks.start('fifo-2');
    await runtime.tasks.start('fifo-1');
    expect([...projectDownloadList(runtime.listRows()).queuePositions]).toEqual([['fifo-2', 1], ['fifo-1', 2]]);
    await runtime.dispose();
  });
  it('composes candidate services and exposes presentation rows/actions with dynamic dispatch settings', async () => {
    const engine = new FakeEngine();
    const analyzerRequests: unknown[] = [];
    const analyzer: CurrentMediaAnalyzer = {
      async analyze(request) {
        analyzerRequests.push(request);
        return media(request.sourceUrl);
      },
    };

    let proxy = 'http://proxy-a';
    let downloadDir = 'C:/A';
    const environment: CurrentTaskRuntimeEnvironment = {
      getGlobalExtraArgs: () => ({ proxy }),
      getDownloadDir: () => downloadDir,
    };

    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer,
      environment,
      effectsPort: {
        playSuccess: vi.fn(),
        playError: vi.fn(),
        setTaskbar: vi.fn(),
      },
      createRowId: () => 'row-1',
      createAnalysisAttemptId: () => 'analysis-1',
      createDownloadAttemptId: () => 'download-1',
      createPlaylistAttemptId: () => 'playlist-1',
    });

    const snapshots: string[][] = [];
    const unsubscribe = runtime.subscribeRows((rows) => snapshots.push(rows.map((row) => row.status)));

    runtime.actions.analyzeUrls(['https://example.com/video']);
    await flush();

    expect(analyzerRequests).toHaveLength(1);
    expect(runtime.listRows()).toMatchObject([
      {
        rowId: 'row-1',
        id: 'analysis-1',
        status: 'analyzed',
        url: 'https://example.com/video',
      },
    ]);

    proxy = 'http://proxy-b';
    downloadDir = 'C:/B';
    runtime.actions.startDownload('row-1', 'flac');
    await flush();

    expect(engine.starts).toHaveLength(1);
    expect(engine.starts[0]).toMatchObject({
      taskId: 'download-1',
      sourceUrl: 'https://example.com/video',
      downloadType: 'audio',
      downloadDir: 'C:/B',
      extraArgs: { proxy: 'http://proxy-b', audioCodec: 'flac' },
    });
    expect(snapshots.length).toBeGreaterThan(1);

    unsubscribe();
    await runtime.dispose();
  });

  it('preserves the browser-cookie lock hint from native logs through a terminal download failure', async () => {
    const engine = new FakeEngine();
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: { analyze: async (request) => media(request.sourceUrl) },
      environment: {
        getGlobalExtraArgs: () => ({ cookies: 'chrome' }),
        getDownloadDir: () => 'C:/Downloads',
      },
      effectsPort: {
        playSuccess: vi.fn(),
        playError: vi.fn(),
        setTaskbar: vi.fn(),
      },
      createRowId: () => 'row-browser-lock',
      createAnalysisAttemptId: () => 'analysis-browser-lock',
      createDownloadAttemptId: () => 'download-browser-lock',
      createPlaylistAttemptId: () => 'playlist-browser-lock',
    });

    runtime.actions.analyzeUrls(['https://youtube.com/watch?v=browser-lock']);
    await flush();
    runtime.actions.startDownload('row-browser-lock', 'video');
    await flush();

    expect(runtime.tasks.ingestLog(
      'download-browser-lock',
      '[ERR] ERROR: unable to copy Chrome cookie database: database is locked (winerror 32)',
    )).toBe(true);
    engine.emit({
      type: 'result',
      taskId: 'download-browser-lock',
      outcome: 'Failed',
      error: 'yt-dlp failed while reading browser cookies',
    });

    expect(runtime.listRows()[0]).toMatchObject({
      status: 'error',
      errorMsg: '检测到浏览器未关闭或占用 Cookies，请关闭浏览器后重试',
    });

    await runtime.dispose();
  });

  it('does not produce browser-cookie lock hint on destination Permission denied even if cookies = chrome (Case 1)', async () => {
    const engine = new FakeEngine();
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: { analyze: async (request) => media(request.sourceUrl) },
      environment: {
        getGlobalExtraArgs: () => ({ cookies: 'chrome' }),
        getDownloadDir: () => 'C:/Downloads',
      },
      effectsPort: {
        playSuccess: vi.fn(),
        playError: vi.fn(),
        setTaskbar: vi.fn(),
      },
      createRowId: () => 'row-dest-perm',
      createAnalysisAttemptId: () => 'analysis-dest-perm',
      createDownloadAttemptId: () => 'download-dest-perm',
      createPlaylistAttemptId: () => 'playlist-dest-perm',
    });

    runtime.actions.analyzeUrls(['https://youtube.com/watch?v=dest-perm']);
    await flush();
    runtime.actions.startDownload('row-dest-perm', 'video');
    await flush();

    expect(runtime.tasks.ingestLog(
      'download-dest-perm',
      '[ERR] ERROR: unable to open for writing: C:\\Downloads\\video.mp4: Permission denied',
    )).toBe(true);
    engine.emit({
      type: 'result',
      taskId: 'download-dest-perm',
      outcome: 'Failed',
      error: 'unable to open for writing: C:\\Downloads\\video.mp4: Permission denied',
    });

    expect(runtime.listRows()[0]?.errorMsg).not.toBe('检测到浏览器未关闭或占用 Cookies，请关闭浏览器后重试');

    await runtime.dispose();
  });

  it('uses task override cookies file to suppress browser lock hint at runtime (Case A)', async () => {
    const engine = new FakeEngine();
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: { analyze: async (request) => media(request.sourceUrl) },
      environment: {
        getGlobalExtraArgs: () => ({ cookies: 'chrome' }),
        getDownloadDir: () => 'C:/Downloads',
      },
      effectsPort: {
        playSuccess: vi.fn(),
        playError: vi.fn(),
        setTaskbar: vi.fn(),
      },
      createRowId: () => 'row-override-suppress',
      createAnalysisAttemptId: () => 'analysis-override-suppress',
      createDownloadAttemptId: () => 'download-override-suppress',
      createPlaylistAttemptId: () => 'playlist-override-suppress',
    });

    runtime.actions.analyzeUrls(['https://youtube.com/watch?v=override-suppress']);
    await flush();
    await runtime.tasks.start('row-override-suppress', 'video', { cookies: 'C:\\temp\\cookies.txt' });
    await flush();

    expect(runtime.tasks.ingestLog(
      'download-override-suppress',
      '[ERR] ERROR: unable to copy Chrome cookie database: database is locked',
    )).toBe(true);
    engine.emit({
      type: 'result',
      taskId: 'download-override-suppress',
      outcome: 'Failed',
      error: 'Cookie lock',
    });

    expect(runtime.listRows()[0]?.errorMsg).not.toBe('检测到浏览器未关闭或占用 Cookies，请关闭浏览器后重试');

    await runtime.dispose();
  });

  it('preserves terminal effects when a completed row is removed before the effects drain catches up', async () => {
    const engine = new FakeEngine();
    const playSuccess = vi.fn();
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: { analyze: async (request) => media(request.sourceUrl) },
      environment: {
        getGlobalExtraArgs: () => ({}),
        getDownloadDir: () => 'C:/Downloads',
      },
      effectsPort: {
        playSuccess,
        playError: vi.fn(),
        setTaskbar: vi.fn(),
      },
      createRowId: () => 'row-terminal',
      createAnalysisAttemptId: () => 'analysis-terminal',
      createDownloadAttemptId: () => 'download-terminal',
      createPlaylistAttemptId: () => 'playlist-terminal',
    });

    runtime.actions.analyzeUrls(['https://example.com/terminal']);
    await flush();
    runtime.actions.startDownload('row-terminal', 'video');
    await flush();

    engine.emit({
      type: 'result',
      taskId: 'download-terminal',
      outcome: 'Completed',
      filePath: 'C:/Downloads/terminal.mp4',
    });
    runtime.actions.remove('row-terminal');

    await runtime.flushEffects();

    expect(playSuccess).toHaveBeenCalledTimes(1);
    expect(runtime.listRows()).toEqual([]);

    await runtime.dispose();
  });

  it('captures terminal obligations before a busy effects drain can coalesce the terminal snapshot away', async () => {
    const engine = new FakeEngine();
    const gate = deferred();
    const playSuccess = vi.fn();
    let blockFirstNormal = true;
    const setTaskbar = vi.fn(async (projection: { progress: number; status: string }) => {
      if (projection.status === 'normal' && blockFirstNormal) {
        blockFirstNormal = false;
        await gate.promise;
      }
    });
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: { analyze: async (request) => media(request.sourceUrl) },
      environment: {
        getGlobalExtraArgs: () => ({}),
        getDownloadDir: () => 'C:/Downloads',
      },
      effectsPort: {
        playSuccess,
        playError: vi.fn(),
        setTaskbar,
      },
      createRowId: () => 'row-busy-terminal',
      createAnalysisAttemptId: () => 'analysis-busy-terminal',
      createDownloadAttemptId: () => 'download-busy-terminal',
    });

    runtime.actions.analyzeUrls(['https://example.com/busy-terminal']);
    await flush();
    runtime.actions.startDownload('row-busy-terminal', 'video');
    await runtime.flushEffects();

    engine.emit({
      type: 'progress',
      taskId: 'download-busy-terminal',
      phase: 'Downloading',
      progress: 10,
    });
    await vi.waitFor(() => {
      expect(setTaskbar).toHaveBeenCalledWith({ progress: 10, status: 'normal' });
    });

    engine.emit({
      type: 'result',
      taskId: 'download-busy-terminal',
      outcome: 'Completed',
      filePath: 'C:/Downloads/busy-terminal.mp4',
    });
    runtime.actions.remove('row-busy-terminal');

    gate.resolve();
    await runtime.flushEffects();

    expect(playSuccess).toHaveBeenCalledTimes(1);
    expect(runtime.listRows()).toEqual([]);

    await runtime.dispose();
  });

  it('retries a failed latest taskbar projection on explicit flush without a new row event', async () => {
    const engine = new FakeEngine();
    const analysis = deferred<CurrentAnalysisMedia>();
    let failIndeterminate = true;
    const setTaskbar = vi.fn(async (projection: { progress: number; status: string }) => {
      if (projection.status === 'indeterminate' && failIndeterminate) {
        failIndeterminate = false;
        throw new Error('taskbar unavailable');
      }
    });
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: { analyze: async () => analysis.promise },
      environment: {
        getGlobalExtraArgs: () => ({}),
        getDownloadDir: () => 'C:/Downloads',
      },
      effectsPort: {
        playSuccess: vi.fn(),
        playError: vi.fn(),
        setTaskbar,
      },
      createRowId: () => 'row-taskbar-retry',
      createAnalysisAttemptId: () => 'analysis-taskbar-retry',
    });

    runtime.actions.analyzeUrls(['https://example.com/taskbar-retry']);
    await vi.waitFor(() => {
      expect(setTaskbar).toHaveBeenCalledWith({ progress: 0, status: 'indeterminate' });
    });

    await expect(runtime.flushEffects()).resolves.toBeUndefined();
    expect(
      setTaskbar.mock.calls.filter(([projection]) => projection.status === 'indeterminate'),
    ).toHaveLength(2);

    analysis.resolve(media('https://example.com/taskbar-retry'));
    await flush();
    await runtime.dispose();
  });

  it('never lets an older non-terminal taskbar snapshot overwrite a newer terminal projection', async () => {
    const engine = new FakeEngine();
    const gate = deferred();
    let blockNextNormal = true;
    const taskbar: Array<{ progress: number; status: string }> = [];
    const setTaskbar = vi.fn(async (projection: { progress: number; status: string }) => {
      taskbar.push(projection);
      if (projection.status === 'normal' && blockNextNormal) {
        blockNextNormal = false;
        await gate.promise;
      }
    });
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: { analyze: async (request) => media(request.sourceUrl) },
      environment: {
        getGlobalExtraArgs: () => ({}),
        getDownloadDir: () => 'C:/Downloads',
      },
      effectsPort: {
        playSuccess: vi.fn(),
        playError: vi.fn(),
        setTaskbar,
      },
      createRowId: () => 'row-taskbar-order',
      createAnalysisAttemptId: () => 'analysis-taskbar-order',
      createDownloadAttemptId: () => 'download-taskbar-order',
    });

    runtime.actions.analyzeUrls(['https://example.com/taskbar-order']);
    await flush();
    runtime.actions.startDownload('row-taskbar-order', 'video');
    await runtime.flushEffects();

    engine.emit({ type: 'progress', taskId: 'download-taskbar-order', phase: 'Downloading', progress: 10 });
    await flush();
    engine.emit({ type: 'progress', taskId: 'download-taskbar-order', phase: 'Downloading', progress: 20 });
    engine.emit({
      type: 'result',
      taskId: 'download-taskbar-order',
      outcome: 'Completed',
      filePath: 'C:/Downloads/taskbar-order.mp4',
    });

    gate.resolve();
    await runtime.flushEffects();

    expect(runtime.listRows()[0]?.status).toBe('completed');
    expect(taskbar.at(-1)).toEqual({ progress: 0, status: 'none' });

    await runtime.dispose();
  });

  it('coalesces high-frequency progress even while completed rows remain visible', async () => {
    const engine = new FakeEngine();
    const gate = deferred();
    let blockNextNormal = false;
    const setTaskbar = vi.fn(async (projection: { progress: number; status: string }) => {
      if (projection.status === 'normal' && blockNextNormal) {
        blockNextNormal = false;
        await gate.promise;
      }
    });
    let rowIndex = 0;
    let analysisIndex = 0;
    let downloadIndex = 0;
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: { analyze: async (request) => media(request.sourceUrl) },
      environment: {
        getGlobalExtraArgs: () => ({}),
        getDownloadDir: () => 'C:/Downloads',
      },
      effectsPort: {
        playSuccess: vi.fn(),
        playError: vi.fn(),
        setTaskbar,
      },
      createRowId: () => `row-${++rowIndex}`,
      createAnalysisAttemptId: () => `analysis-${++analysisIndex}`,
      createDownloadAttemptId: () => `download-${++downloadIndex}`,
    });

    runtime.actions.analyzeUrls(['https://example.com/completed']);
    await flush();
    runtime.actions.startDownload('row-1', 'video');
    await flush();
    engine.emit({ type: 'result', taskId: 'download-1', outcome: 'Completed' });
    await runtime.flushEffects();

    runtime.actions.analyzeUrls(['https://example.com/active']);
    await flush();
    runtime.actions.startDownload('row-2', 'video');
    await runtime.flushEffects();

    const callsBeforeBurst = setTaskbar.mock.calls.length;
    blockNextNormal = true;
    engine.emit({ type: 'progress', taskId: 'download-2', phase: 'Downloading', progress: 1 });
    await flush();
    for (let progress = 2; progress <= 100; progress += 1) {
      engine.emit({ type: 'progress', taskId: 'download-2', phase: 'Downloading', progress });
    }
    gate.resolve();
    await runtime.flushEffects();

    expect(setTaskbar.mock.calls.length - callsBeforeBurst).toBeLessThan(10);
    expect(setTaskbar).toHaveBeenLastCalledWith({ progress: 100, status: 'normal' });

    await runtime.dispose();
  });

  it('prevents Tauri native start dispatch after runtime disposal while listeners are still installing', async () => {
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
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: { analyze: async (request) => media(request.sourceUrl) },
      environment: {
        getGlobalExtraArgs: () => ({}),
        getDownloadDir: () => undefined,
      },
      effectsPort: {
        playSuccess: vi.fn(),
        playError: vi.fn(),
        setTaskbar: vi.fn(),
      },
      createRowId: () => 'row-runtime-dispose',
      createAnalysisAttemptId: () => 'analysis-runtime-dispose',
      createDownloadAttemptId: () => 'download-runtime-dispose',
    });

    runtime.actions.analyzeUrls(['https://example.com/runtime-dispose']);
    await flush();
    runtime.actions.startDownload('row-runtime-dispose', 'video');

    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith('download-progress', expect.any(Function));
    });

    const disposePromise = runtime.dispose();
    expect(invoke).not.toHaveBeenCalledWith('start_download', expect.anything());

    resolveProgressListen(progressUnlisten);
    await expect(disposePromise).resolves.toBeUndefined();
    await flush();

    expect(invoke).not.toHaveBeenCalledWith('start_download', expect.anything());
    expect(progressUnlisten).toHaveBeenCalledTimes(1);
    expect(resultUnlisten).toHaveBeenCalledTimes(1);
    expect(runtime.listRows()).toEqual([]);
  });

  it('keeps disposal retryable when engine cleanup throws synchronously before returning a promise', async () => {
    const engine = new FakeEngine();
    engine.disposeSyncError = new Error('sync cleanup failure');
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: { analyze: async (request) => media(request.sourceUrl) },
      environment: {
        getGlobalExtraArgs: () => ({}),
        getDownloadDir: () => undefined,
      },
      effectsPort: {
        playSuccess: vi.fn(),
        playError: vi.fn(),
        setTaskbar: vi.fn(),
      },
    });

    const first = runtime.dispose();
    await expect(first).rejects.toThrow('sync cleanup failure');
    expect(engine.disposeCount).toBe(1);

    const second = runtime.dispose();
    expect(second).not.toBe(first);
    await expect(second).resolves.toBeUndefined();
    expect(engine.disposeCount).toBe(2);
  });

  it('keeps disposal retryable when engine cleanup fails and only finalizes after a successful retry', async () => {
    const engine = new FakeEngine();
    engine.disposeError = new Error('native cancel failed');
    const setTaskbar = vi.fn();
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: { analyze: async (request) => media(request.sourceUrl) },
      environment: {
        getGlobalExtraArgs: () => ({}),
        getDownloadDir: () => undefined,
      },
      effectsPort: {
        playSuccess: vi.fn(),
        playError: vi.fn(),
        setTaskbar,
      },
    });

    const resetsBeforeDispose = setTaskbar.mock.calls.filter(([projection]) =>
      projection.status === 'none' && projection.progress === 0,
    ).length;

    await expect(runtime.dispose()).rejects.toThrow('native cancel failed');
    expect(engine.disposeCount).toBe(1);
    expect(() => runtime.subscribeRows(() => {})).toThrow(/disposing|disposed/i);

    await expect(runtime.dispose()).resolves.toBeUndefined();
    expect(engine.disposeCount).toBe(2);
    const resetsAfterDispose = setTaskbar.mock.calls.filter(([projection]) =>
      projection.status === 'none' && projection.progress === 0,
    ).length;
    expect(resetsAfterDispose - resetsBeforeDispose).toBe(1);
  });

  it('shares concurrent disposal, rejects subscriptions while closing, and resets taskbar once', async () => {
    const engine = new FakeEngine();
    const gate = deferred();
    let blockFirstTaskbar = true;
    const setTaskbar = vi.fn(async () => {
      if (blockFirstTaskbar) {
        blockFirstTaskbar = false;
        await gate.promise;
      }
    });
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: { analyze: async (request) => media(request.sourceUrl) },
      environment: {
        getGlobalExtraArgs: () => ({}),
        getDownloadDir: () => undefined,
      },
      effectsPort: {
        playSuccess: vi.fn(),
        playError: vi.fn(),
        setTaskbar,
      },
    });

    const resetsBeforeDispose = setTaskbar.mock.calls.filter(([projection]) =>
      projection.status === 'none' && projection.progress === 0,
    ).length;

    const firstDispose = runtime.dispose();
    const secondDispose = runtime.dispose();

    expect(() => runtime.subscribeRows(() => {})).toThrow(/disposing|disposed/i);

    gate.resolve();
    await Promise.all([firstDispose, secondDispose]);

    expect(engine.unsubscribeCount).toBe(1);
    const resetsAfterDispose = setTaskbar.mock.calls.filter(([projection]) =>
      projection.status === 'none' && projection.progress === 0,
    ).length;
    expect(resetsAfterDispose - resetsBeforeDispose).toBe(1);
  });

  it('disposes the service chain once and resets taskbar projection', async () => {
    const engine = new FakeEngine();
    const setTaskbar = vi.fn();
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: { analyze: async (request) => media(request.sourceUrl) },
      environment: {
        getGlobalExtraArgs: () => ({}),
        getDownloadDir: () => undefined,
      },
      effectsPort: {
        playSuccess: vi.fn(),
        playError: vi.fn(),
        setTaskbar,
      },
    });

    await runtime.dispose();
    await runtime.dispose();

    expect(engine.unsubscribeCount).toBe(1);
    expect(setTaskbar).toHaveBeenLastCalledWith({ progress: 0, status: 'none' });
  });
});
