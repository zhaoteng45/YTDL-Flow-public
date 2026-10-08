import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { CurrentAnalysisMedia, CurrentAnalysisRequest, DownloadStartRequest, EngineUpdate } from '../../packages/contracts/src';
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

  emit(update: EngineUpdate): void {
    for (const listener of this.listeners) listener(update);
  }
}

async function flushMicrotasks(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

function credentialRuntime(
  store: ReturnType<typeof useAppStore>,
  analyze: (request: CurrentAnalysisRequest) => Promise<CurrentAnalysisMedia> = async (request) => ({
    title: 'Credential fixture', thumbnail: '', duration: '1:00', channel: 'Fixture', url: request.sourceUrl,
  }),
  withPreflight = false,
) {
  const requests: CurrentAnalysisRequest[] = [];
  const engine = new RecordingEngine();
  let sequence = 0;
  const runtime = createCurrentTaskRuntime({
    engine,
    analyzer: {
      analyze: async (request) => {
        requests.push(request);
        return analyze(request);
      },
    },
    environment: {
      getGlobalExtraArgs: (url) => url ? store.getExtraArgsForUrl(url) : { ...store.extraArgs },
      getAnalysisExtraArgs: (url, isCurrent) => store.resolveAnalysisExtraArgs(url, isCurrent),
      ...(withPreflight ? { validateDownloadCredential: (request: DownloadStartRequest) => store.validateDownloadCredential(request) } : {}),
      getDownloadDir: () => undefined,
    },
    effectsPort: { playSuccess: () => {}, playError: () => {}, setTaskbar: () => {} },
    createRowId: () => `credential-row-${++sequence}`,
    downloadServiceOptions: { maxConcurrent: 1, settlementDelayMs: 0 },
  });
  return { runtime, requests, engine };
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

  it('ignores a legacy authorized backup in actual analyzer requests when the browser fails', async () => {
    const store = useAppStore();
    store.setPlatformCookie('youtube', 'edge');
    store.setPlatformBackupFile('youtube', 'C:/fixtures/backup.txt', true);
    safeInvokeMock.mockImplementation(async (command) => command === 'check_browser_cookies'
      ? { kind: 'locked', success: false, message: 'fixture' }
      : { state: 'imported', total: 1, matching: 1, fresh: 1 });
    const { runtime, requests } = credentialRuntime(store);
    try {
      const handle = runtime.tasks.analyze('https://youtu.be/fixture');
      await handle.result;
      expect(requests[0]?.extraArgs?.cookies).toBe('');
      expect(safeInvokeMock).toHaveBeenCalledWith('check_browser_cookies', { browser: 'edge' });
      expect(safeInvokeMock.mock.calls).toEqual([['check_browser_cookies', { browser: 'edge' }]]);
      expect(store.getEffectivePlatformSource('youtube')).toEqual({ kind: 'browser', ref: 'edge' });
      expect(runtime.tasks.getRow(handle.rowId)).toMatchObject({
        credential: { source: 'anonymous', reason: 'browser-unavailable', browserFailure: 'locked' },
      });
    } finally { await runtime.dispose(); }
  });

  it.each([false, undefined])('does not inspect an unauthorized or absent backup (%s), and explicitly analyzes anonymously', async (authorized) => {
    const store = useAppStore();
    store.extraArgs.cookies = 'legacy-global';
    store.setPlatformCookie('youtube', 'edge');
    if (authorized !== undefined) store.setPlatformBackupFile('youtube', 'C:/fixtures/backup.txt', authorized);
    safeInvokeMock.mockResolvedValue({ kind: 'decrypt_failed', success: false, message: 'sensitive native details' });
    const { runtime, requests } = credentialRuntime(store);
    try {
      const handle = runtime.tasks.analyze('https://www.youtube.com/watch?v=anonymous');
      await handle.result;
      expect(requests[0]?.extraArgs?.cookies).toBe('');
      expect(safeInvokeMock.mock.calls).toEqual([['check_browser_cookies', { browser: 'edge' }]]);
      expect(runtime.tasks.getRow(handle.rowId)?.credential).toEqual({
        source: 'anonymous', reason: 'browser-unavailable', browserFailure: 'decrypt_failed',
      });
    } finally { await runtime.dispose(); }
  });

  it.each(['invalid', 'expired', 'mismatch', 'unreadable'])('ignores legacy backup files regardless of their %s state', async (state) => {
    const store = useAppStore();
    store.setPlatformCookie('youtube', 'edge');
    store.setPlatformBackupFile('youtube', 'C:/fixtures/backup.txt', true);
    safeInvokeMock.mockImplementation(async (command) => {
      if (command === 'check_browser_cookies') return { kind: 'not_found', success: false, message: 'fixture' };
      if (state === 'unreadable') throw new Error('private native path must not be copied');
      return { state, total: 1, matching: 0, fresh: 0 };
    });
    const { runtime, requests } = credentialRuntime(store);
    try {
      const handle = runtime.tasks.analyze('https://youtu.be/invalid-backup');
      await handle.result;
      expect(requests[0]?.extraArgs?.cookies).toBe('');
      expect(runtime.tasks.getRow(handle.rowId)?.credential).toEqual({
        source: 'anonymous', reason: 'browser-unavailable', browserFailure: 'not_found',
      });
    } finally { await runtime.dispose(); }
  });

  it.each(['invalid', 'expired', 'mismatch', 'unreadable'])('checks only the preferred file when it is %s, never a browser or backup', async (state) => {
    const store = useAppStore();
    store.setPlatformCookie('youtube', 'C:/fixtures/preferred.txt');
    store.setPlatformBackupFile('youtube', 'C:/fixtures/backup.txt', true);
    safeInvokeMock.mockImplementation(async () => {
      if (state === 'unreadable') throw new Error('fixture unreadable');
      return { state, total: 1, matching: 0, fresh: 0 };
    });
    const { runtime, requests } = credentialRuntime(store);
    try {
      const handle = runtime.tasks.analyze('https://youtu.be/invalid-preferred');
      await handle.result;
      expect(requests[0]?.extraArgs?.cookies).toBe('');
      expect(safeInvokeMock.mock.calls).toEqual([['inspect_cookie_file', {
        path: 'C:/fixtures/preferred.txt', url: 'https://www.youtube.com/',
      }]]);
      expect(runtime.tasks.getRow(handle.rowId)?.credential).toEqual({
        source: 'anonymous', reason: 'preferred-file-unavailable', fileFailure: state,
      });
    } finally { await runtime.dispose(); }
  });

  it('checks a valid preferred file again on each new analysis, without probing a browser', async () => {
    const store = useAppStore();
    store.setPlatformCookie('youtube', 'C:/fixtures/preferred.txt');
    safeInvokeMock.mockResolvedValue({ state: 'imported', total: 1, matching: 1, fresh: 1 });
    const { runtime, requests } = credentialRuntime(store);
    try {
      await runtime.tasks.analyze('https://youtu.be/file-first').result;
      await runtime.tasks.analyze('https://youtu.be/file-second').result;
      expect(requests.map(request => request.extraArgs?.cookies)).toEqual([
        'C:/fixtures/preferred.txt', 'C:/fixtures/preferred.txt',
      ]);
      expect(safeInvokeMock.mock.calls).toEqual(Array.from({ length: 2 }, () => ['inspect_cookie_file', {
        path: 'C:/fixtures/preferred.txt', url: 'https://www.youtube.com/',
      }]));
    } finally { await runtime.dispose(); }
  });

  it('does not probe explicit none or Bilibili, and leaves the Bilibili QR source unchanged', async () => {
    const store = useAppStore();
    store.extraArgs.cookies = 'legacy-global';
    store.clearPlatformCookie('youtube');
    store.setPlatformCookie('bilibili', 'C:/fixtures/bilibili_cookies.txt');
    const { runtime, requests } = credentialRuntime(store);
    try {
      await runtime.tasks.analyze('https://youtu.be/none').result;
      await runtime.tasks.analyze('https://www.bilibili.com/video/BV1').result;
      expect(requests.map(request => request.extraArgs?.cookies)).toEqual(['', 'C:/fixtures/bilibili_cookies.txt']);
      expect(safeInvokeMock).not.toHaveBeenCalled();
    } finally { await runtime.dispose(); }
  });

  it('freezes preferred config before a pending check; disconnect and late results never save it back', async () => {
    const store = useAppStore();
    store.setPlatformCookie('youtube', 'edge');
    store.setPlatformBackupFile('youtube', 'C:/fixtures/original.txt', true);
    store.extraArgs.proxy = 'original-proxy';
    let finish!: (value: unknown) => void;
    safeInvokeMock.mockImplementation(async (command) => command === 'check_browser_cookies'
      ? new Promise(resolve => { finish = resolve; })
      : { state: 'imported', total: 1, matching: 1, fresh: 1 });
    const { runtime, requests } = credentialRuntime(store);
    try {
      const handle = runtime.tasks.analyze('https://youtu.be/pending');
      expect(runtime.tasks.getRow(handle.rowId)?.status).toBe('analyzing');
      expect(requests).toHaveLength(0);
      store.setPlatformCookie('youtube', 'firefox');
      store.setPlatformBackupFile('youtube', 'C:/fixtures/replacement.txt', false);
      store.clearPlatformCookie('youtube');
      store.extraArgs.proxy = 'new-proxy';
      finish({ kind: 'locked', success: false, message: 'fixture' });
      await handle.result;
      expect(requests[0]?.extraArgs).toMatchObject({ cookies: '', proxy: 'original-proxy' });
      expect(safeInvokeMock.mock.calls).toEqual([
        ['check_browser_cookies', { browser: 'edge' }],
      ]);
      expect(store.getPlatformCredentialConfig('youtube')).toEqual({ preferred: { kind: 'none' } });
    } finally { await runtime.dispose(); }
  });

  it('invalidates a pending browser check on row removal, and ignores its late result without reading backup or dispatching analysis', async () => {
    const store = useAppStore();
    store.setPlatformCookie('youtube', 'edge');
    store.setPlatformBackupFile('youtube', 'C:/fixtures/backup.txt', true);
    let finish!: (value: unknown) => void;
    safeInvokeMock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { runtime, requests } = credentialRuntime(store);
    try {
      const handle = runtime.tasks.analyze('https://youtu.be/cancel-check');
      // The existing product does not offer cancel in `analyzing`. Keep that
      // policy and exercise its public administrative invalidation instead.
      expect((await runtime.tasks.cancel(handle.rowId)).outcome.type).toBe('not-cancellable');
      expect(runtime.tasks.remove(handle.rowId)).toBe(true);
      expect((await handle.result).status).toBe('stale');
      finish({ kind: 'locked', success: false, message: 'fixture' });
      await flushMicrotasks();
      expect(requests).toHaveLength(0);
      expect(safeInvokeMock).toHaveBeenCalledTimes(1);
      expect(runtime.tasks.getRow(handle.rowId)).toBeUndefined();
      expect(store.getEffectivePlatformSource('youtube')).toEqual({ kind: 'browser', ref: 'edge' });
    } finally { await runtime.dispose(); }
  });

  it('never uses backup for a site 429; browser kind ok is authoritative even when success is false', async () => {
    const store = useAppStore();
    store.setPlatformCookie('youtube', 'edge');
    store.setPlatformBackupFile('youtube', 'C:/fixtures/backup.txt', true);
    safeInvokeMock.mockResolvedValue({ kind: 'ok', success: false, message: 'extracted fixture' });
    const { runtime, requests } = credentialRuntime(store, async () => { throw new Error('HTTP Error 429'); });
    try {
      const handle = runtime.tasks.analyze('https://youtu.be/rate-limit');
      expect((await handle.result).status).toBe('failed');
      expect(requests[0]?.extraArgs?.cookies).toBe('edge');
      expect(safeInvokeMock.mock.calls).toEqual([['check_browser_cookies', { browser: 'edge' }]]);
      expect(runtime.tasks.getRow(handle.rowId)).toMatchObject({
        failureKind: 'analysis', credential: { source: 'browser', reason: 'browser-ok' },
      });
    } finally { await runtime.dispose(); }
  });

  it('uses current settings only on explicit reanalysis, and rejects reanalysis during active download', async () => {
    const store = useAppStore();
    store.setPlatformCookie('youtube', 'edge');
    safeInvokeMock.mockResolvedValue({ kind: 'ok', success: true, message: 'fixture' });
    let attempts = 0;
    const { runtime, requests, engine } = credentialRuntime(store, async request => {
      if (++attempts === 1) throw new Error('HTTP Error 429');
      return { title: 'Reanalysis fixture', thumbnail: '', duration: '1:00', channel: 'Fixture', url: request.sourceUrl };
    });
    try {
      const handle = runtime.tasks.analyze('https://youtu.be/reanalysis');
      await handle.result;
      store.setPlatformCookie('youtube', 'firefox');
      const reanalyzed = runtime.tasks.reanalyze(handle.rowId);
      expect(reanalyzed?.attemptId).not.toBe(handle.attemptId);
      await reanalyzed?.result;
      expect(requests.map(request => request.extraArgs?.cookies)).toEqual(['edge', 'firefox']);
      await runtime.tasks.start(handle.rowId);
      store.clearPlatformCookie('youtube');
      expect(runtime.tasks.reanalyze(handle.rowId)).toBeUndefined();
      expect(engine.starts[0]?.extraArgs?.cookies).toBe('firefox');
      expect(safeInvokeMock.mock.calls).toEqual([
        ['check_browser_cookies', { browser: 'edge' }], ['check_browser_cookies', { browser: 'firefox' }],
      ]);
    } finally { await runtime.dispose(); }
  });

  it('fails closed anonymously when browser IPC throws, ignoring legacy backup', async () => {
    const store = useAppStore();
    store.setPlatformCookie('youtube', 'edge');
    store.setPlatformBackupFile('youtube', 'C:/fixtures/backup.txt', true);
    safeInvokeMock.mockImplementation(async command => {
      if (command === 'check_browser_cookies') throw new Error('private native error');
      return { state: 'imported', total: 1, matching: 1, fresh: 1 };
    });
    const { runtime, requests } = credentialRuntime(store);
    try {
      const handle = runtime.tasks.analyze('https://youtu.be/ipc-failure');
      await handle.result;
      expect(requests[0]?.extraArgs?.cookies).toBe('');
      expect(runtime.tasks.getRow(handle.rowId)?.credential).toEqual({
        source: 'anonymous', reason: 'browser-unavailable', browserFailure: 'execution_failed',
      });
    } finally { await runtime.dispose(); }
  });

  it('ignores a late file inspection after disposal without dispatching analysis or changing configuration', async () => {
    const store = useAppStore();
    store.setPlatformCookie('youtube', 'C:/fixtures/preferred.txt');
    let finish!: (value: unknown) => void;
    safeInvokeMock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { runtime, requests } = credentialRuntime(store);
    const handle = runtime.tasks.analyze('https://youtu.be/dispose-file');
    await runtime.dispose();
    expect((await handle.result).status).toBe('stale');
    finish({ state: 'imported', total: 1, matching: 1, fresh: 1 });
    await flushMicrotasks();
    expect(requests).toHaveLength(0);
    expect(store.getEffectivePlatformSource('youtube')).toEqual({ kind: 'file', ref: 'C:/fixtures/preferred.txt' });
  });

  it.each(['cookies', 'anonymous'] as const)('preserves preferred file and SMART %s policy through queued start and ordinary retry after configuration changes', async (authMode) => {
    const store = useAppStore();
    store.setPlatformCookie('youtube', 'C:/fixtures/frozen.txt');
    store.setPlatformBackupFile('youtube', 'C:/fixtures/frozen.txt', true);
    store.extraArgs.playerClient = 'smart';
    store.extraArgs.poToken = 'fixture-token';
    store.extraArgs.visitorData = 'fixture-visitor';
    safeInvokeMock.mockImplementation(async (command) => command === 'check_browser_cookies'
      ? { kind: 'locked', success: false, message: 'fixture' }
      : { state: 'imported', total: 1, matching: 1, fresh: 1 });
    const { runtime, engine } = credentialRuntime(store, async (request) => ({
      title: 'SMART fixture', thumbnail: '', duration: '1:00', channel: 'Fixture', url: request.sourceUrl,
      smartDecision: { playerClient: 'web', maxHeight: 1080, authMode, potMode: 'unknown', reason: 'fixture', clearSessionInputs: true },
    }));
    try {
      const first = runtime.tasks.analyze('https://youtu.be/first');
      const queued = runtime.tasks.analyze('https://youtu.be/queued');
      await Promise.all([first.result, queued.result]);
      store.setPlatformCookie('youtube', 'firefox');
      store.extraArgs.playerClient = 'mweb';
      await runtime.tasks.start(first.rowId);
      await runtime.tasks.start(queued.rowId);
      expect(runtime.tasks.getRow(queued.rowId)?.status).toBe('queued');
      engine.emit({ type: 'result', taskId: runtime.tasks.getRow(first.rowId)!.attemptId, outcome: 'Completed' });
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(engine.starts).toHaveLength(2);
      engine.emit({ type: 'result', taskId: runtime.tasks.getRow(queued.rowId)!.attemptId, outcome: 'Failed', error: 'HTTP Error 429' });
      await runtime.tasks.retry(queued.rowId);
      expect(engine.starts).toHaveLength(3);
      for (const request of engine.starts) {
        expect(request.extraArgs).toMatchObject({
          cookies: authMode === 'anonymous' ? '' : 'C:/fixtures/frozen.txt',
          playerClient: 'web', poToken: '', visitorData: '',
          smartDecision: { playerClient: 'web', authMode },
        });
      }
      expect(safeInvokeMock).toHaveBeenCalledTimes(2);
      const expectedCredential = authMode === 'anonymous'
        ? { source: 'anonymous', reason: 'smart-anonymous' }
        : { source: 'file', reason: 'file-ok' };
      expect(runtime.tasks.getRow(first.rowId)?.credential).toEqual(expectedCredential);
      expect(runtime.tasks.getRow(queued.rowId)?.credential).toEqual(expectedCredential);
      expect(runtime.listRows().map((row) => row.credential)).toEqual([
        expectedCredential,
        expectedCredential,
      ]);
    } finally { await runtime.dispose(); }
  });

  it('aligns final credential source for browser and preferred file across SMART authMode, skips A11 file preflight for anonymous winners, and updates only on explicit reanalyze', async () => {
    const store = useAppStore();
    store.setPlatformCookie('youtube', 'C:/fixtures/preferred.txt');
    store.extraArgs.playerClient = 'smart';
    let fileState: 'imported' | 'expired' = 'imported';
    let currentAuthMode: 'anonymous' | 'cookies' = 'anonymous';
    safeInvokeMock.mockImplementation(async (command) => {
      if (command === 'check_browser_cookies') {
        return { kind: 'ok', success: true, message: 'fixture' };
      }
      return { state: fileState, total: 1, matching: 1, fresh: fileState === 'imported' ? 1 : 0 };
    });
    const { runtime, engine } = credentialRuntime(store, async (request) => ({
      title: 'SMART source alignment',
      thumbnail: '',
      duration: '1:00',
      channel: 'Fixture',
      url: request.sourceUrl,
      smartDecision: {
        playerClient: 'web',
        maxHeight: 1080,
        authMode: currentAuthMode,
        potMode: 'unknown',
        reason: 'fixture',
        clearSessionInputs: currentAuthMode === 'anonymous',
      },
    }), true);
    try {
      const first = runtime.tasks.analyze('https://www.youtube.com/watch?v=file-anon-first');
      const second = runtime.tasks.analyze('https://www.youtube.com/watch?v=file-anon-queued');
      const third = runtime.tasks.analyze('https://www.youtube.com/watch?v=file-anon-reanalyze');
      await Promise.all([first.result, second.result, third.result]);
      for (const rowId of [first.rowId, second.rowId, third.rowId]) {
        expect(runtime.tasks.getRow(rowId)?.credential).toEqual({
          source: 'anonymous',
          reason: 'smart-anonymous',
        });
      }

      // Even if the file on disk later expires while tasks are queued/retried,
      // an anonymous SMART winner has frozen cookies === '' and must not fail A11 preflight.
      fileState = 'expired';
      await runtime.tasks.start(first.rowId);
      await runtime.tasks.start(second.rowId);
      await flushMicrotasks();
      expect(engine.starts).toHaveLength(1);
      expect(engine.starts[0]?.extraArgs?.cookies).toBe('');
      engine.emit({ type: 'result', taskId: runtime.tasks.getRow(first.rowId)!.attemptId, outcome: 'Completed' });
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(engine.starts).toHaveLength(2);
      expect(engine.starts[1]?.extraArgs?.cookies).toBe('');
      expect(safeInvokeMock).toHaveBeenCalledTimes(3);

      // Reanalyzing a cancelled analysis row with browser preference and a cookies SMART winner
      // clears the old credential while analyzing and adopts browser-ok once analyzed.
      await runtime.tasks.cancel(third.rowId);
      store.setPlatformCookie('youtube', 'edge');
      currentAuthMode = 'cookies';
      const reanalyzed = runtime.tasks.reanalyze(third.rowId);
      expect(runtime.tasks.getRow(third.rowId)?.status).toBe('analyzing');
      expect(runtime.tasks.getRow(third.rowId)?.credential).toBeUndefined();
      await reanalyzed?.result;
      expect(runtime.tasks.getRow(third.rowId)?.credential).toEqual({
        source: 'browser',
        reason: 'browser-ok',
      });
    } finally {
      await runtime.dispose();
    }
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

  it('persists backup file and authorization across reload, and explicit false revokes authorization on the same path', async () => {
    const store = useAppStore();
    store.setPlatformCookie('youtube', 'edge');
    store.setPlatformBackupFile('youtube', 'C:/fixtures/backup.txt');
    expect(store.getPlatformCredentialConfig('youtube')).toEqual({
      preferred: { kind: 'browser', ref: 'edge' },
      backup: { path: 'C:/fixtures/backup.txt', authorized: false },
    });

    store.setPlatformBackupFile('youtube', 'C:/fixtures/backup.txt', true);
    expect(store.getPlatformCredentialConfig('youtube')?.backup).toEqual({
      path: 'C:/fixtures/backup.txt',
      authorized: true,
    });

    // Re-selecting the same path without explicit false preserves accepted authorization
    store.setPlatformBackupFile('youtube', 'C:/fixtures/backup.txt');
    expect(store.getPlatformCredentialConfig('youtube')?.backup?.authorized).toBe(true);

    await flushMicrotasks();
    setActivePinia(createPinia());
    const reloaded = useAppStore();
    expect(reloaded.getPlatformCredentialConfig('youtube')).toEqual({
      preferred: { kind: 'browser', ref: 'edge' },
      backup: { path: 'C:/fixtures/backup.txt', authorized: true },
    });

    // Explicit false revokes authorization on the same path
    reloaded.setPlatformBackupFile('youtube', 'C:/fixtures/backup.txt', false);
    expect(reloaded.getPlatformCredentialConfig('youtube')?.backup).toEqual({
      path: 'C:/fixtures/backup.txt',
      authorized: false,
    });
  });

  it('keeps an unassigned legacy global cookie file out of platform config and requests across reload', async () => {
    storage.set('extraArgs', JSON.stringify({ cookies: 'C:/legacy/cookies.txt', proxy: 'legacy-proxy' }));
    const store = useAppStore();
    expect(store.getPlatformCredentialConfig('youtube')).toBeUndefined();
    expect(store.getPlatformCredentialConfig('bilibili')).toBeUndefined();
    expect(store.getExtraArgsForUrl('https://www.youtube.com/watch?v=legacy').cookies).toBe('');
    expect(store.getExtraArgsForUrl('https://www.bilibili.com/video/BV1').cookies).toBe('');
    expect(store.getExtraArgsForUrl('https://example.com/video.mp4').cookies).toBe('C:/legacy/cookies.txt');
    expect(store.extraArgs.cookies).toBe('C:/legacy/cookies.txt');
    expect(safeInvokeMock).not.toHaveBeenCalled();

    await flushMicrotasks();
    setActivePinia(createPinia());
    const reloaded = useAppStore();
    expect(reloaded.getPlatformCredentialConfig('youtube')).toBeUndefined();
    expect(reloaded.getExtraArgsForUrl('https://www.bilibili.com/video/BV1').cookies).toBe('');
    expect(reloaded.extraArgs.cookies).toBe('C:/legacy/cookies.txt');
    expect(safeInvokeMock).not.toHaveBeenCalled();
  });

  it('a legacy global browser keeps Bilibili compatibility without becoming a platform config across reload', async () => {
    storage.set('extraArgs', JSON.stringify({ cookies: 'chrome', proxy: 'legacy-proxy' }));
    const store = useAppStore();
    expect(store.getPlatformCredentialConfig('bilibili')).toBeUndefined();
    expect(store.getExtraArgsForUrl('https://www.bilibili.com/video/BV1').cookies).toBe('chrome');
    expect(store.getExtraArgsForUrl('https://www.bilibili.com/video/BV1').proxy).toBe('legacy-proxy');
    expect(store.getExtraArgsForUrl('https://www.youtube.com/watch?v=legacy').cookies).toBe('chrome');
    expect(safeInvokeMock).not.toHaveBeenCalled();

    await flushMicrotasks();
    setActivePinia(createPinia());
    const reloaded = useAppStore();
    expect(reloaded.getPlatformCredentialConfig('bilibili')).toBeUndefined();
    expect(reloaded.getExtraArgsForUrl('https://www.bilibili.com/video/BV1').cookies).toBe('chrome');
    expect(safeInvokeMock).not.toHaveBeenCalled();
  });

  it('a legacy global cookie file never becomes a new YouTube analysis or download source', async () => {
    storage.set('extraArgs', JSON.stringify({ cookies: 'C:/legacy/cookies.txt' }));
    const store = useAppStore();
    const { runtime, requests, engine } = credentialRuntime(store);
    try {
      const handle = runtime.tasks.analyze('https://www.youtube.com/watch?v=legacy-global');
      await handle.result;
      expect(requests[0]?.extraArgs?.cookies).toBe('');
      expect(runtime.tasks.getRow(handle.rowId)?.credential).toEqual({ source: 'anonymous', reason: 'unconfigured' });
      expect(safeInvokeMock).not.toHaveBeenCalledWith('inspect_cookie_file', expect.anything());

      runtime.actions.startDownload(handle.rowId, 'video');
      await flushMicrotasks();
      expect(engine.starts).toHaveLength(1);
      expect(engine.starts[0]?.extraArgs?.cookies ?? '').toBe('');
    } finally { await runtime.dispose(); }
  });

  it('explicit disconnect stays authoritative over an unassigned global file after reload', async () => {
    storage.set('extraArgs', JSON.stringify({ cookies: 'C:/legacy/cookies.txt' }));
    const store = useAppStore();
    store.clearPlatformCookie('youtube');
    await flushMicrotasks();

    setActivePinia(createPinia());
    const reloaded = useAppStore();
    expect(reloaded.getPlatformCredentialConfig('youtube')).toEqual({ preferred: { kind: 'none' } });
    expect(reloaded.getExtraArgsForUrl('https://www.youtube.com/watch?v=disconnected').cookies).toBe('');
  });

  it.each(['cookies.json', 'COOKIES.JSON'])('a bare relative global cookie json (%s) stays unassigned through store load, reload and new YouTube analysis', async (globalFile) => {
    storage.set('extraArgs', JSON.stringify({ cookies: globalFile, proxy: 'legacy-proxy' }));
    const store = useAppStore();
    expect(store.getPlatformCredentialConfig('youtube')).toBeUndefined();
    expect(store.getPlatformCredentialConfig('bilibili')).toBeUndefined();
    expect(store.getExtraArgsForUrl('https://www.youtube.com/watch?v=bare-json').cookies).toBe('');
    expect(store.getExtraArgsForUrl('https://www.bilibili.com/video/BV1').cookies).toBe('');
    expect(store.getExtraArgsForUrl('https://example.com/video.mp4').cookies).toBe(globalFile);
    expect(store.extraArgs.cookies).toBe(globalFile);
    expect(safeInvokeMock).not.toHaveBeenCalled();

    const { runtime, requests } = credentialRuntime(store);
    try {
      const handle = runtime.tasks.analyze('https://www.youtube.com/watch?v=bare-json-analysis');
      await handle.result;
      expect(requests[0]?.extraArgs?.cookies).toBe('');
      expect(runtime.tasks.getRow(handle.rowId)?.credential).toEqual({ source: 'anonymous', reason: 'unconfigured' });
    } finally { await runtime.dispose(); }
    expect(safeInvokeMock).not.toHaveBeenCalled();

    await flushMicrotasks();
    setActivePinia(createPinia());
    const reloaded = useAppStore();
    expect(reloaded.getPlatformCredentialConfig('youtube')).toBeUndefined();
    expect(reloaded.getPlatformCredentialConfig('bilibili')).toBeUndefined();
    expect(reloaded.getExtraArgsForUrl('https://www.youtube.com/watch?v=bare-json').cookies).toBe('');
    expect(reloaded.extraArgs.cookies).toBe(globalFile);
    expect(safeInvokeMock).not.toHaveBeenCalled();
  });

  it('normalize, backup setter and reload keep unknown platform config fields', async () => {
    storage.set('platformCredentialSources', JSON.stringify({
      youtube: {
        preferred: { kind: 'browser', ref: 'edge', pinned: true },
        futureFlag: 'keep',
        backup: { path: 'C:/fixtures/backup.txt', authorized: true, note: 'same-file' },
      },
    }));
    const store = useAppStore();
    store.setPlatformBackupFile('youtube', 'C:/fixtures/backup.txt');
    expect(store.getPlatformCredentialConfig('youtube')).toMatchObject({
      futureFlag: 'keep',
      preferred: { kind: 'browser', ref: 'edge', pinned: true },
      backup: { path: 'C:/fixtures/backup.txt', authorized: true, note: 'same-file' },
    });

    store.setPlatformBackupFile('youtube', 'C:/fixtures/next.txt');
    expect(store.getPlatformCredentialConfig('youtube')).toMatchObject({
      futureFlag: 'keep',
      preferred: { kind: 'browser', ref: 'edge', pinned: true },
      backup: { path: 'C:/fixtures/next.txt', authorized: false },
    });

    await flushMicrotasks();
    setActivePinia(createPinia());
    const reloaded = useAppStore();
    expect(reloaded.getPlatformCredentialConfig('youtube')).toMatchObject({
      futureFlag: 'keep',
      preferred: { kind: 'browser', ref: 'edge', pinned: true },
      backup: { path: 'C:/fixtures/next.txt', authorized: false },
    });
  });
});
