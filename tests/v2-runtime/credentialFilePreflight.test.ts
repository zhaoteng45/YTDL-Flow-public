import { describe, expect, it } from 'vitest';
import type { DownloadStartRequest, EngineUpdate, CurrentAnalysisRequest } from '../../packages/contracts/src';
import type { DownloadEngine, EngineUpdateListener } from '../../packages/application/src/download-engine';
import { createCurrentTaskRuntime } from '../../src/v2-runtime/currentTaskRuntime';

class RecordingEngine implements DownloadEngine {
  readonly starts: DownloadStartRequest[] = [];
  private readonly listeners = new Set<EngineUpdateListener>();
  async start(request: DownloadStartRequest) { this.starts.push({ ...request }); }
  async cancel(_id: string) {}
  subscribeUpdates(listener: EngineUpdateListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(update: EngineUpdate) {
    for (const listener of this.listeners) listener(update);
  }
}

describe('A11 frozen file preflight before queued download dispatch', () => {
  it('does not start the native engine if runtime disposal occurs during an asynchronous file check', async () => {
    const engine = new RecordingEngine();
    let finishCheck!: () => void;
    let checkEntered!: () => void;
    const entered = new Promise<void>(resolve => { checkEntered = resolve; });
    const held = new Promise<void>(resolve => { finishCheck = resolve; });
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: { analyze: async (request) => ({
        title: 'Fixture', thumbnail: '', duration: '1:00',
        channel: 'Fixture', url: request.sourceUrl,
      }) },
      environment: {
        getGlobalExtraArgs: () => ({ cookies: 'C:/fixtures/yt-file.txt' }),
        getAnalysisExtraArgs: async () => ({ extraArgs: { cookies: 'C:/fixtures/yt-file.txt' } }),
        validateDownloadCredential: async () => { checkEntered(); await held; },
        getDownloadDir: () => undefined,
      },
      effectsPort: { playSuccess: () => {}, playError: () => {}, setTaskbar: () => {} },
      downloadServiceOptions: { maxConcurrent: 1, settlementDelayMs: 0 },
    });
    try {
      const handle = runtime.tasks.analyze('https://www.youtube.com/watch?v=cancel-fixture');
      await handle.result;
      await runtime.tasks.start(handle.rowId);
      await entered;
      const disposal = runtime.dispose();
      finishCheck();
      await disposal;
      expect(engine.starts).toHaveLength(0);
    } finally {
      finishCheck();
      await runtime.dispose();
    }
  });

  it('rejects a file that becomes invalid in the queue without changing the source or reaching the native engine', async () => {
    const engine = new RecordingEngine();
    const checks: Array<string | undefined> = [];
    const savedFile = 'C:/fixtures/yt-file.txt';
    let sequence = 0;
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer: {
        analyze: async (request: CurrentAnalysisRequest) => ({
          title: 'Fixture', thumbnail: '', duration: '1:00',
          channel: 'Fixture', url: request.sourceUrl,
        }),
      },
      environment: {
        getGlobalExtraArgs: () => ({ cookies: savedFile }),
        getAnalysisExtraArgs: async () => ({ extraArgs: { cookies: savedFile } }),
        validateDownloadCredential: async (request: DownloadStartRequest) => {
          checks.push(request.extraArgs?.cookies);
          if (checks.length === 2) throw new Error('file expired');
        },
        getDownloadDir: () => undefined,
      },
      effectsPort: { playSuccess: () => {}, playError: () => {}, setTaskbar: () => {} },
      createRowId: () => 'row-' + ++sequence,
      downloadServiceOptions: { maxConcurrent: 1, settlementDelayMs: 0 },
    });

    try {
      const first = runtime.tasks.analyze('https://www.youtube.com/watch?v=fixture-one');
      const second = runtime.tasks.analyze('https://www.youtube.com/watch?v=fixture-two');
      await Promise.all([first.result, second.result]);
      await runtime.tasks.start(first.rowId);
      await runtime.tasks.start(second.rowId);
      await Promise.resolve();
      expect(engine.starts).toHaveLength(1);
      expect(runtime.tasks.getRow(second.rowId)?.status).toBe('queued');

      engine.emit({
        type: 'result',
        taskId: runtime.tasks.getRow(first.rowId)!.attemptId,
        outcome: 'Completed',
      });
      await new Promise(resolve => setTimeout(resolve, 35));

      expect(checks).toEqual([savedFile, savedFile]);
      expect(engine.starts).toHaveLength(1);
      expect(runtime.tasks.getRow(second.rowId)?.status).toBe('error');
      expect(runtime.tasks.getRow(second.rowId)?.failureReason).toContain('COOKIE_FILE_REANALYSIS_REQUIRED');
    } finally {
      await runtime.dispose();
    }
  });
});
