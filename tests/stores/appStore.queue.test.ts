import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { DownloadStartRequest } from '../../packages/contracts/src';
import type { EngineUpdateListener } from '../../packages/application/src';
import { createCurrentTaskRuntime } from '../../src/v2-runtime/currentTaskRuntime';

type Listener<T> = (event: { payload: T }) => void;

const listeners = new Map<string, Listener<unknown>>();
const safeInvokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
const safeListenMock = vi.fn(async <T>(event: string, handler: Listener<T>) => {
  listeners.set(event, handler as Listener<unknown>);
  return () => listeners.delete(event);
});
const storage = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
});

vi.mock('../../src/utils/tauri', () => ({
  safeInvoke: (command: string, args?: unknown) => safeInvokeMock(command, args),
  safeGetSystemDownloadDir: vi.fn(async () => null),
  safeListen: (event: string, handler: Listener<unknown>) => safeListenMock(event, handler),
  safeOpenDialog: vi.fn(async () => null),
  safeOpenExternal: vi.fn(async () => undefined),
}));

const { useAppStore } = await import('../../src/stores/appStore');
const appStoreSource = readFileSync(resolve('src/stores/appStore.ts'), 'utf8');

/** Every task-lifecycle member the settings store exposed before the cutover. */
const RETIRED_TASK_LIFECYCLE_SURFACE = [
  'tasks',
  'analyzeUrls',
  'startTaskDownload',
  'cancelTask',
  'removeTask',
  'retryTaskDownload',
  'reanalyzeTask',
  'retryFailedDownloads',
  'cancelQueuedTasks',
  'clearCompletedTasks',
  'flattenPlaylist',
  'openTaskFolder',
  'initListeners',
  'cleanupListeners',
] as const;

class RecordingEngine {
  readonly starts: DownloadStartRequest[] = [];
  private readonly listeners = new Set<EngineUpdateListener>();

  async start(request: DownloadStartRequest): Promise<void> {
    this.starts.push({ ...request });
  }

  async cancel(): Promise<void> {}

  subscribeUpdates(listener: EngineUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

async function flushMicrotasks(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

describe('appStore task lifecycle retirement', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listeners.clear();
    safeListenMock.mockClear();
    safeInvokeMock.mockReset();
    safeInvokeMock.mockResolvedValue(undefined);
    storage.clear();
  });

  it('does not own the task lifecycle surface; CurrentTaskRuntime is the single owner', () => {
    const store = useAppStore();

    for (const member of RETIRED_TASK_LIFECYCLE_SURFACE) {
      expect(member in store, `appStore must not own '${member}'`).toBe(false);
    }

    // Constructing the settings store must not dispatch task IPC or install task listeners.
    expect(safeInvokeMock).not.toHaveBeenCalled();
    expect(safeListenMock).not.toHaveBeenCalled();
  });

  it('keeps queue scheduling and task IPC out of the settings store module', () => {
    expect(appStoreSource).not.toMatch(/queue\/taskQueue|createTaskQueue/);
    expect(appStoreSource).not.toMatch(/download-progress|analysis-log/);
    expect(appStoreSource).not.toMatch(/start_download|cancel_download|set_taskbar_progress/);
    expect(appStoreSource).not.toMatch(/safeListen|cleanupPassiveResources/);
  });

  it('feeds the current runtime environment from the settings store instead of dispatching downloads itself', async () => {
    const store = useAppStore();
    store.setDownloadDir('C:/store-downloads');
    store.extraArgs.proxy = 'http://store-proxy';
    store.platformCookies.youtube = 'chrome';

    const engine = new RecordingEngine();
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: {
        analyze: async (request) => ({
          title: 'Store wiring',
          thumbnail: '',
          duration: '1:00',
          channel: 'Example',
          url: request.sourceUrl,
        }),
      },
      environment: {
        getGlobalExtraArgs: (sourceUrl) =>
          sourceUrl ? store.getExtraArgsForUrl(sourceUrl) : { ...store.extraArgs },
        getDownloadDir: () => store.downloadDir ?? store.systemDownloadDir ?? undefined,
      },
      effectsPort: {
        playSuccess: () => {},
        playError: () => {},
        setTaskbar: () => {},
      },
      createRowId: () => 'row-store-wiring',
      createAnalysisAttemptId: () => 'analysis-store-wiring',
      createDownloadAttemptId: () => 'download-store-wiring',
      downloadServiceOptions: {
        maxConcurrent: 1,
        settlementDelayMs: 0,
      },
    });

    try {
      runtime.actions.analyzeUrls(['https://www.youtube.com/watch?v=store-wiring']);
      await flushMicrotasks();
      runtime.actions.startDownload('row-store-wiring', 'video');
      await flushMicrotasks();

      expect(engine.starts).toHaveLength(1);
      expect(engine.starts[0]).toMatchObject({
        taskId: 'download-store-wiring',
        sourceUrl: 'https://www.youtube.com/watch?v=store-wiring',
        downloadDir: 'C:/store-downloads',
        extraArgs: {
          proxy: 'http://store-proxy',
          cookies: 'chrome',
        },
      });
    } finally {
      await runtime.dispose();
    }
  });

  it('uses a directly imported platform file for a new analysis while keeping Bilibili separate', async () => {
    const store = useAppStore();
    // Existing YouTube browser preference must be replaced by the direct file import.
    store.setPlatformCookie('youtube', 'edge');
    store.setPlatformCookie('bilibili', 'bilibili-fixture');

    safeInvokeMock.mockImplementation(async (command: string) => {
      if (command === 'inspect_cookie_file') {
        return { state: 'imported', total: 12, matching: 12, fresh: 12 };
      }
      return undefined;
    });

    const imported = await store.importPlatformCookieFile('youtube', 'C:/cookies/youtube.txt');
    expect(imported).toEqual({ ok: true, state: 'imported' });

    const analyzerCookies: Array<string | undefined> = [];
    const engine = new RecordingEngine();
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: {
        analyze: async (request) => {
          analyzerCookies.push((request.extraArgs as { cookies?: string } | undefined)?.cookies);
          return {
            title: 'Imported file source',
            thumbnail: '',
            duration: '1:00',
            channel: 'Example',
            url: request.sourceUrl,
          };
        },
      },
      environment: {
        getGlobalExtraArgs: (sourceUrl) =>
          sourceUrl ? store.getExtraArgsForUrl(sourceUrl) : { ...store.extraArgs },
        getDownloadDir: () => store.downloadDir ?? store.systemDownloadDir ?? undefined,
      },
      effectsPort: {
        playSuccess: () => {},
        playError: () => {},
        setTaskbar: () => {},
      },
      createRowId: () => 'row-file-import',
      createAnalysisAttemptId: () => 'analysis-file-import',
      createDownloadAttemptId: () => 'download-file-import',
      downloadServiceOptions: {
        maxConcurrent: 1,
        settlementDelayMs: 0,
      },
    });

    try {
      runtime.actions.analyzeUrls(['https://www.youtube.com/watch?v=file-import']);
      await flushMicrotasks();

      expect(analyzerCookies).toHaveLength(1);
      // The direct import becomes the effective source even though a browser was configured before.
      expect(analyzerCookies[0]).toBe('C:/cookies/youtube.txt');
      // Bilibili keeps its own independent source.
      expect(store.getExtraArgsForUrl('https://www.bilibili.com/video/BV1').cookies).toBe(
        'bilibili-fixture',
      );
    } finally {
      await runtime.dispose();
    }
  });

  it('does not reconnect when file inspection finishes after disconnect', async () => {
    const store = useAppStore();
    store.setPlatformCookie('youtube', 'edge');
    let finish!: (value: unknown) => void;
    safeInvokeMock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const importing = store.importPlatformCookieFile('youtube', 'C:/cookies/youtube.txt');
    store.clearPlatformCookie('youtube');
    finish({ state: 'imported', total: 1, matching: 1, fresh: 1 });
    expect((await importing).ok).toBe(false);
    expect(store.getEffectivePlatformSource('youtube').kind).toBe('none');
  });

  it('disconnect prevents an old global cookie from resurrecting after reload', async () => {
    // Older app versions could leave a global cookie plus a legacy platform value.
    storage.set('extraArgs', JSON.stringify({ cookies: 'edge' }));
    storage.set('platformCookies', JSON.stringify({ youtube: 'edge' }));

    const store = useAppStore();
    expect(store.getExtraArgsForUrl('https://www.youtube.com/watch?v=reload').cookies).toBe('edge');

    store.clearPlatformCookie('youtube');
    await flushMicrotasks();

    // Simulate an app reload that reads the same persisted storage.
    setActivePinia(createPinia());
    const reloaded = useAppStore();
    expect(reloaded.platformCookies.youtube ?? '').toBe('');
    expect(reloaded.getExtraArgsForUrl('https://www.youtube.com/watch?v=reload').cookies).not.toBe(
      'edge',
    );
  });
});
