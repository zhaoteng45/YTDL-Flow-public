import { describe, expect, it } from 'vitest';

import type { CurrentAnalysisMedia, CurrentAnalysisRequest, CurrentExtraArgs } from '../../contracts/src';
import {
  CurrentAnalysisService,
  type CurrentMediaAnalyzer,
} from '../src/current-analysis-service';
import { CurrentTaskService } from '../src/current-task-service';
import { CurrentDownloadService, DownloadService, TaskQueryService } from '../src';
import { DownloadQueue } from '../../domain/src';
import type { DownloadEngine, EngineUpdateListener } from '../src';
import type { DownloadStartRequest, EngineUpdate } from '../../contracts/src';

class LifecycleEngine implements DownloadEngine {
  readonly starts: DownloadStartRequest[] = [];
  readonly cancels: string[] = [];
  private listener?: EngineUpdateListener;
  async start(request: DownloadStartRequest) { this.starts.push(request); }
  async cancel(id: string) { this.cancels.push(id); }
  subscribeUpdates(listener: EngineUpdateListener) {
    this.listener = listener;
    return () => { this.listener = undefined; };
  }
  emit(update: EngineUpdate) { this.listener?.(update); }
}

function lifecycle(getGlobalExtraArgs: () => CurrentExtraArgs = () => ({})) {
  let sequence = 0;
  const id = () => `id-${++sequence}`;
  const analyzer = new ControlledAnalyzer();
  const analysis = new CurrentAnalysisService(analyzer, id, () => getGlobalExtraArgs());
  const engine = new LifecycleEngine();
  const queue = new DownloadQueue();
  const core = new DownloadService(queue, engine, id, { maxConcurrent: 1, settlementDelayMs: 0 });
  const query = new TaskQueryService(queue);
  const downloads = new CurrentDownloadService(core, {
    getGlobalExtraArgs, getDownloadDir: () => undefined,
  }, query);
  const tasks = new CurrentTaskService(
    analysis,
    id,
    {
      query,
      downloads,
      subscribeTasks: (listener) => core.subscribeTasks(listener),
      dispose: () => core.dispose(),
    },
  );
  return { tasks, analyzer, engine, query, core, analysis };
}

class ControlledAnalyzer implements CurrentMediaAnalyzer {
  readonly requests: CurrentAnalysisRequest[] = [];
  private readonly resolvers: Array<(media: CurrentAnalysisMedia) => void> = [];
  private readonly rejecters: Array<(error: unknown) => void> = [];

  analyze(request: CurrentAnalysisRequest): Promise<CurrentAnalysisMedia> {
    this.requests.push(request);
    return new Promise((resolve, reject) => {
      this.resolvers.push(resolve);
      this.rejecters.push(reject);
    });
  }

  resolve(index: number, media: CurrentAnalysisMedia): void {
    this.resolvers[index]?.(media);
  }

  reject(index: number, error: unknown): void {
    this.rejecters[index]?.(error);
  }
}

const media = (url: string, title: string): CurrentAnalysisMedia => ({
  title,
  thumbnail: '',
  duration: '1:00',
  channel: 'Example',
  url,
});

describe('CurrentTaskService analysis lifecycle', () => {
  it.each(['web', 'mweb'])('uses SMART winner %s and anonymous auth policy for download and retry', async (winner) => {
    const globals = { playerClient: 'smart', cookies: 'edge' };
    const { tasks, analyzer, engine } = lifecycle(() => globals);
    try {
      const handle = tasks.analyze('https://www.youtube.com/watch?v=test');
      analyzer.resolve(0, {
        ...media('https://www.youtube.com/watch?v=test', 'Winner'),
        smartDecision: { playerClient: winner, maxHeight: 2160, authMode: 'anonymous', potMode: 'unknown', reason: 'usable inventory winner' },
      });
      await handle.result;
      await tasks.start(handle.rowId);
      expect(engine.starts[0]?.extraArgs).toMatchObject({ playerClient: winner, cookies: '' });
      const attempt = tasks.getRow(handle.rowId)!;
      engine.emit({ type: 'result', taskId: attempt.attemptId, outcome: 'Failed' });
      globals.playerClient = 'mweb';
      await tasks.retry(handle.rowId);
      expect(engine.starts[1]?.extraArgs).toMatchObject({ playerClient: winner, cookies: '' });
    } finally { tasks.dispose(); }
  });
  it('runs multiple independent rows through one-slot row-scoped lifecycle controls', async () => {
    const { tasks, analyzer, engine, query } = lifecycle();
    try {
      const handles = ['a', 'b', 'c', 'bad'].map((name) => tasks.analyze(`https://example.com/${name}`));
      handles.slice(0, 3).forEach((h, i) => analyzer.resolve(i, media(`https://example.com/${i}`, h.rowId)));
      analyzer.reject(3, new Error('analysis error'));
      await Promise.all(handles.map((h) => h.result));

      await tasks.start(handles[0].rowId, 'mp3');
      await tasks.start(handles[1].rowId, 'mp3');
      await tasks.start(handles[2].rowId, 'mp3');
      expect(engine.starts).toHaveLength(1);

      await tasks.cancel(handles[1].rowId);
      await tasks.cancel(handles[2].rowId);
      expect(handles.slice(1, 3).map((h) => tasks.getRow(h.rowId)?.failureKind)).toEqual(['cancelled', 'cancelled']);

      const original = tasks.getRow(handles[0].rowId)!;
      engine.emit({ type: 'result', taskId: original.attemptId, outcome: 'Failed' });
      await tasks.retry(handles[0].rowId);
      expect(engine.starts[1]?.sourceUrl).toBe('https://example.com/a');
      expect(tasks.getRow(handles[3].rowId)?.failureKind).toBe('analysis');

      const retried = tasks.getRow(handles[0].rowId)!;
      engine.emit({ type: 'result', taskId: retried.attemptId, outcome: 'Completed' });
      tasks.remove(handles[0].rowId);
      expect(tasks.getRow(handles[0].rowId)).toBeUndefined();
      expect(query.getTask(retried.attemptId)).toBeUndefined();

      tasks.remove(handles[1].rowId);
      tasks.remove(handles[2].rowId);
      expect(tasks.listRows().map((row) => row.rowId)).toEqual([handles[3].rowId]);
    } finally { tasks.dispose(); }
  });
  it('removes analysis and queued rows while detached active execution still occupies its slot', async () => {
    const { tasks, analyzer, engine, query } = lifecycle();
    try {
      const forgotten = tasks.analyze('https://example.com/forgotten');
      tasks.remove(forgotten.rowId);
      analyzer.resolve(0, media('https://example.com/forgotten', 'Late'));
      expect((await forgotten.result).status).toBe('stale');
      const handles = ['a', 'b', 'c'].map((name) => tasks.analyze(`https://example.com/${name}`));
      handles.forEach((h, index) => analyzer.resolve(index + 1, media(`https://example.com/${index}`, h.rowId)));
      await Promise.all(handles.map((h) => h.result));
      for (const h of handles) await tasks.start(h.rowId);
      const active = tasks.getRow(handles[0].rowId)!;
      tasks.remove(handles[0].rowId);
      tasks.remove(handles[1].rowId);
      expect(tasks.listRows().map((r) => r.rowId)).toEqual([handles[2].rowId]);
      expect(query.getTaskByRowId(handles[1].rowId)).toBeUndefined();
      expect(engine.starts).toHaveLength(1);
      expect(query.getTask(active.attemptId)?.status).toBe('Pending');
      engine.emit({ type: 'result', taskId: active.attemptId, outcome: 'Completed' });
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(query.getTask(active.attemptId)).toBeUndefined();
      expect(engine.starts.map((s) => s.sourceUrl)).toEqual(['https://example.com/a', 'https://example.com/c']);
    } finally { tasks.dispose(); }
  });
  it('projects one stable row through download failure, retry and trusted completion', async () => {
    const { tasks, analyzer, engine } = lifecycle();
    try {
      const handle = tasks.analyze('https://example.com/a');
      analyzer.resolve(0, media('https://example.com/a', 'A'));
      await handle.result;
      await tasks.start(handle.rowId, 'flac', { proxy: 'task-proxy' });
      const first = tasks.getRow(handle.rowId)!;
      expect(first).toMatchObject({ status: 'pending', selectedFormat: 'flac', actions: { canCancel: false } });
      expect(first.attemptId).not.toBe(handle.attemptId);
      expect((await tasks.cancel(handle.rowId)).outcome.type).toBe('not-cancellable');
      engine.emit({ type: 'result', taskId: first.attemptId, outcome: 'Failed', error: 'network' });
      expect(tasks.getRow(handle.rowId)).toMatchObject({ failureKind: 'download', actions: { canRetryDownload: true, canReanalyze: false } });
      await tasks.retry(handle.rowId);
      const second = tasks.getRow(handle.rowId)!;
      expect(second.attemptId).not.toBe(first.attemptId);
      expect(engine.starts[1]).toMatchObject({ downloadType: 'audio', extraArgs: { audioCodec: 'flac', proxy: 'task-proxy' } });
      engine.emit({ type: 'result', taskId: first.attemptId, outcome: 'Completed' });
      expect(tasks.getRow(handle.rowId)?.status).toBe('pending');
      engine.emit({ type: 'result', taskId: second.attemptId, outcome: 'Completed', filePath: 'C:/a.flac' });
      expect(tasks.listRows()).toHaveLength(1);
      expect(tasks.getRow(handle.rowId)).toMatchObject({ status: 'completed', finalPath: 'C:/a.flac', progress: 100 });
    } finally { tasks.dispose(); }
  });
  it('keeps stable row identity and position across analysis failure and reanalysis', async () => {
    const analyzer = new ControlledAnalyzer();
    const attemptIds = ['analysis-a-1', 'analysis-b-1', 'analysis-a-2'];
    const rowIds = ['row-a', 'row-b'];
    const analysis = new CurrentAnalysisService(
      analyzer,
      () => attemptIds.shift() ?? 'unexpected-attempt',
      () => ({}),
    );
    const tasks = new CurrentTaskService(
      analysis,
      () => rowIds.shift() ?? 'unexpected-row',
    );

    const first = tasks.analyze('https://example.com/a');
    const second = tasks.analyze('https://example.com/b');

    expect(tasks.listRows().map((row) => [row.rowId, row.attemptId, row.status])).toEqual([
      ['row-b', 'analysis-b-1', 'analyzing'],
      ['row-a', 'analysis-a-1', 'analyzing'],
    ]);

    analyzer.reject(0, new Error('metadata failed'));
    await first.result;

    expect(tasks.listRows().map((row) => row.rowId)).toEqual(['row-b', 'row-a']);
    expect(tasks.getRow('row-a')).toMatchObject({
      rowId: 'row-a',
      attemptId: 'analysis-a-1',
      sourceUrl: 'https://example.com/a',
      status: 'error',
      failureKind: 'analysis',
      failureReason: 'metadata failed',
      cancelRequested: false,
      progress: 0,
      actions: {
        canCancel: false,
        canRemove: true,
        canOpenFolder: false,
        canStartDownload: false,
        canRetryDownload: false,
        canReanalyze: true,
      },
    });

    const replacement = tasks.reanalyze('row-a');
    expect(replacement?.attemptId).toBe('analysis-a-2');
    expect(tasks.listRows().map((row) => row.rowId)).toEqual(['row-b', 'row-a']);
    expect(tasks.getRow('row-a')).toMatchObject({
      rowId: 'row-a',
      attemptId: 'analysis-a-2',
      status: 'analyzing',
      cancelRequested: false,
      progress: 0,
    });
    expect(tasks.getRow('row-a')?.failureKind).toBeUndefined();
    expect(tasks.getRow('row-a')?.failureReason).toBeUndefined();

    analyzer.resolve(2, media('https://example.com/a', 'A refreshed'));
    await replacement?.result;

    expect(tasks.getRow('row-a')).toMatchObject({
      rowId: 'row-a',
      attemptId: 'analysis-a-2',
      status: 'analyzed',
      metadata: { title: 'A refreshed' },
      cancelRequested: false,
      progress: 0,
      actions: {
        canCancel: true,
        canRemove: false,
        canOpenFolder: false,
        canStartDownload: true,
        canRetryDownload: false,
        canReanalyze: false,
      },
    });

    analyzer.resolve(1, media('https://example.com/b', 'B'));
    await second.result;
  });

  it('publishes unified product row snapshots across analysis and trusted execution updates', async () => {
    const { tasks, analyzer, engine } = lifecycle();
    const observed: Array<Array<{ status: string; attemptId: string; progress: number }>> = [];
    const unsubscribe = tasks.subscribeRows((rows) => {
      observed.push(rows.map((row) => ({
        status: row.status,
        attemptId: row.attemptId,
        progress: row.progress,
      })));
    });

    try {
      expect(observed).toEqual([[]]);

      const handle = tasks.analyze('https://example.com/observed');
      expect(observed.at(-1)).toEqual([{
        status: 'analyzing',
        attemptId: handle.attemptId,
        progress: 0,
      }]);

      analyzer.resolve(0, media('https://example.com/observed', 'Observed'));
      await handle.result;
      expect(observed.at(-1)?.[0]?.status).toBe('analyzed');

      await tasks.start(handle.rowId, 'video');
      const attemptId = tasks.getRow(handle.rowId)!.attemptId;
      expect(observed.at(-1)?.[0]).toMatchObject({
        status: 'pending',
        attemptId,
        progress: 0,
      });

      engine.emit({
        type: 'progress',
        taskId: attemptId,
        phase: 'Downloading',
        progress: 37,
      });
      expect(observed.at(-1)?.[0]).toMatchObject({
        status: 'downloading',
        attemptId,
        progress: 37,
      });

      engine.emit({
        type: 'result',
        taskId: attemptId,
        outcome: 'Completed',
        filePath: 'C:/observed.mp4',
      });
      expect(observed.at(-1)?.[0]).toMatchObject({
        status: 'completed',
        attemptId,
        progress: 100,
      });

      const count = observed.length;
      unsubscribe();
      tasks.remove(handle.rowId);
      expect(observed).toHaveLength(count);
    } finally {
      tasks.dispose();
    }
  });

  it('binds logs/debug data to the current attempt and clears transient presentation data on retry/reanalysis', async () => {
    const { tasks, analyzer, engine } = lifecycle();
    try {
      const first = tasks.analyze('https://example.com/logs');
      expect(tasks.ingestLog(first.attemptId, 'analysis start')).toBe(true);
      expect(tasks.setDebugCommand(first.attemptId, 'yt-dlp --dump-json ...')).toBe(true);
      analyzer.reject(0, new Error('analysis failed'));
      await first.result;
      expect(tasks.getRow(first.rowId)).toMatchObject({
        logs: ['analysis start'],
        debugCommand: 'yt-dlp --dump-json ...',
      });

      const second = tasks.reanalyze(first.rowId)!;
      expect(tasks.getRow(first.rowId)).toMatchObject({ logs: [] });
      expect(tasks.getRow(first.rowId)?.debugCommand).toBeUndefined();
      expect(tasks.ingestLog(first.attemptId, 'stale analysis log')).toBe(false);
      expect(tasks.ingestLog(second.attemptId, 'analysis retry')).toBe(true);
      analyzer.resolve(1, media('https://example.com/logs', 'Logs'));
      await second.result;

      await tasks.start(first.rowId, 'video');
      const execution1 = tasks.getRow(first.rowId)!.attemptId;
      expect(tasks.ingestLog(second.attemptId, 'late analysis log')).toBe(false);
      expect(tasks.ingestLog(execution1, 'download attempt 1')).toBe(true);
      expect(tasks.setDebugCommand(execution1, 'yt-dlp https://example.com/logs')).toBe(true);
      engine.emit({ type: 'result', taskId: execution1, outcome: 'Failed', error: 'network' });

      await tasks.retry(first.rowId);
      const execution2 = tasks.getRow(first.rowId)!.attemptId;
      expect(execution2).not.toBe(execution1);
      expect(tasks.getRow(first.rowId)).toMatchObject({ logs: [] });
      expect(tasks.getRow(first.rowId)?.debugCommand).toBeUndefined();
      expect(tasks.ingestLog(execution1, 'stale download log')).toBe(false);
      expect(tasks.ingestLog(execution2, 'download attempt 2')).toBe(true);
      expect(tasks.getRow(first.rowId)?.logs).toEqual(['download attempt 2']);
    } finally {
      tasks.dispose();
    }
  });

  it('does not let late analysis results revive rows after the product owner is disposed', async () => {
    const analyzer = new ControlledAnalyzer();
    const analysis = new CurrentAnalysisService(
      analyzer,
      () => 'analysis-late',
      () => ({}),
    );
    const tasks = new CurrentTaskService(analysis, () => 'row-late');

    const handle = tasks.analyze('https://example.com/late');
    expect(tasks.getRow('row-late')?.status).toBe('analyzing');

    tasks.dispose();
    tasks.dispose();
    expect(tasks.listRows()).toEqual([]);

    analyzer.resolve(0, media('https://example.com/late', 'Too late'));
    await expect(handle.result).resolves.toEqual({
      status: 'stale',
      rowId: 'row-late',
      attemptId: 'analysis-late',
    });
    expect(tasks.getRow('row-late')).toBeUndefined();

    expect(() => tasks.analyze('https://example.com/after')).toThrow(/disposed/i);
  });

  describe('P2-A: browser cookie lock hint false positive prevention', () => {
    it('does not trigger browser lock hint on destination file Permission denied even if cookies = chrome (Case 1)', async () => {
      const { tasks, analyzer } = lifecycle(() => ({ cookies: 'chrome' }));
      try {
        const handle = tasks.analyze('https://example.com/case1');
        analyzer.resolve(0, media('https://example.com/case1', 'Case 1'));
        await handle.result;
        await tasks.start(handle.rowId, 'video');

        const attemptId = tasks.getRow(handle.rowId)!.attemptId;
        expect(tasks.ingestLog(
          attemptId,
          '[ERR] ERROR: unable to open for writing: C:\\Downloads\\video.mp4: Permission denied',
        )).toBe(true);

        const row = tasks.getRow(handle.rowId)!;
        expect(row.failureReason).toBeUndefined();
      } finally {
        tasks.dispose();
      }
    });

    it('triggers browser lock hint on database is locked when reading browser cookies (Case 2)', async () => {
      const { tasks, analyzer } = lifecycle(() => ({ cookies: 'chrome' }));
      try {
        const handle = tasks.analyze('https://example.com/case2');
        analyzer.resolve(0, media('https://example.com/case2', 'Case 2'));
        await handle.result;
        await tasks.start(handle.rowId, 'video');

        const attemptId = tasks.getRow(handle.rowId)!.attemptId;
        expect(tasks.ingestLog(
          attemptId,
          '[ERR] ERROR: unable to copy Chrome cookie database: database is locked',
        )).toBe(true);

        const row = tasks.getRow(handle.rowId)!;
        expect(row.failureReason).toBe('检测到浏览器未关闭或占用 Cookies，请关闭浏览器后重试');
      } finally {
        tasks.dispose();
      }
    });

    it('triggers browser lock hint when browser cookie database is used by another process (Case 3)', async () => {
      const { tasks, analyzer } = lifecycle(() => ({ cookies: 'chrome' }));
      try {
        const handle = tasks.analyze('https://example.com/case3');
        analyzer.resolve(0, media('https://example.com/case3', 'Case 3'));
        await handle.result;
        await tasks.start(handle.rowId, 'video');

        const attemptId = tasks.getRow(handle.rowId)!.attemptId;
        expect(tasks.ingestLog(
          attemptId,
          '[ERR] ERROR: Could not copy Chrome cookie database. The process cannot access the file because it is being used by another process.',
        )).toBe(true);

        const row = tasks.getRow(handle.rowId)!;
        expect(row.failureReason).toBe('检测到浏览器未关闭或占用 Cookies，请关闭浏览器后重试');
      } finally {
        tasks.dispose();
      }
    });

    it('does not trigger browser lock hint when cookies is a file path even if log says database is locked (Case 4)', async () => {
      const { tasks, analyzer } = lifecycle(() => ({ cookies: 'C:\\temp\\cookies.txt' }));
      try {
        const handle = tasks.analyze('https://example.com/case4');
        analyzer.resolve(0, media('https://example.com/case4', 'Case 4'));
        await handle.result;
        await tasks.start(handle.rowId, 'video');

        const attemptId = tasks.getRow(handle.rowId)!.attemptId;
        expect(tasks.ingestLog(
          attemptId,
          '[ERR] ERROR: unable to open database file: database is locked',
        )).toBe(true);

        const row = tasks.getRow(handle.rowId)!;
        expect(row.failureReason).toBeUndefined();
      } finally {
        tasks.dispose();
      }
    });

    it('does not treat an unrelated locked application database as a browser cookie lock', async () => {
      const { tasks, analyzer } = lifecycle(() => ({ cookies: 'chrome' }));
      try {
        const handle = tasks.analyze('https://example.com/generic-db-lock');
        analyzer.resolve(0, media('https://example.com/generic-db-lock', 'Generic DB Lock'));
        await handle.result;
        await tasks.start(handle.rowId, 'video');

        const attemptId = tasks.getRow(handle.rowId)!.attemptId;
        expect(tasks.ingestLog(
          attemptId,
          '[ERR] ERROR: application metadata database is locked',
        )).toBe(true);

        expect(tasks.getRow(handle.rowId)!.failureReason).toBeUndefined();
      } finally {
        tasks.dispose();
      }
    });

    it('does not treat an unrelated database-file permission error as a browser cookie lock', async () => {
      const { tasks, analyzer } = lifecycle(() => ({ cookies: 'chrome' }));
      try {
        const handle = tasks.analyze('https://example.com/generic-db-permission');
        analyzer.resolve(0, media('https://example.com/generic-db-permission', 'Generic DB Permission'));
        await handle.result;
        await tasks.start(handle.rowId, 'video');

        const attemptId = tasks.getRow(handle.rowId)!.attemptId;
        expect(tasks.ingestLog(
          attemptId,
          '[ERR] ERROR: unable to open database file: Permission denied',
        )).toBe(true);

        expect(tasks.getRow(handle.rowId)!.failureReason).toBeUndefined();
      } finally {
        tasks.dispose();
      }
    });
  });

  describe('P2-B: browser hint uses effective cookies of the current download attempt', () => {
    it('uses task override cookies file to suppress browser lock hint when analysis had cookies = chrome (Case A)', async () => {
      const { tasks, analyzer } = lifecycle(() => ({ cookies: 'chrome' }));
      try {
        const handle = tasks.analyze('https://example.com/caseA');
        analyzer.resolve(0, media('https://example.com/caseA', 'Case A'));
        await handle.result;

        // Override with cookies file at start
        await tasks.start(handle.rowId, 'video', { cookies: 'C:\\temp\\cookies.txt' });

        const attemptId = tasks.getRow(handle.rowId)!.attemptId;
        expect(tasks.ingestLog(
          attemptId,
          '[ERR] ERROR: unable to copy Chrome cookie database: database is locked',
        )).toBe(true);

        const row = tasks.getRow(handle.rowId)!;
        expect(row.failureReason).toBeUndefined();
      } finally {
        tasks.dispose();
      }
    });

    it('uses task override chrome cookies to trigger browser lock hint when analysis had no cookies (Case B)', async () => {
      const { tasks, analyzer } = lifecycle(() => ({}));
      try {
        const handle = tasks.analyze('https://example.com/caseB');
        analyzer.resolve(0, media('https://example.com/caseB', 'Case B'));
        await handle.result;

        // Override with browser cookies at start
        await tasks.start(handle.rowId, 'video', { cookies: 'chrome' });

        const attemptId = tasks.getRow(handle.rowId)!.attemptId;
        expect(tasks.ingestLog(
          attemptId,
          '[ERR] ERROR: unable to copy Chrome cookie database: database is locked',
        )).toBe(true);

        const row = tasks.getRow(handle.rowId)!;
        expect(row.failureReason).toBe('检测到浏览器未关闭或占用 Cookies，请关闭浏览器后重试');
      } finally {
        tasks.dispose();
      }
    });

    it('inherits firefox cookies from analysis snapshot when start override does not specify cookies (Case C)', async () => {
      const { tasks, analyzer } = lifecycle(() => ({ cookies: 'firefox' }));
      try {
        const handle = tasks.analyze('https://example.com/caseC');
        analyzer.resolve(0, media('https://example.com/caseC', 'Case C'));
        await handle.result;

        // Start without cookies override
        await tasks.start(handle.rowId, 'video', { proxy: 'http://proxy.local:8080' });

        const attemptId = tasks.getRow(handle.rowId)!.attemptId;
        expect(tasks.ingestLog(
          attemptId,
          '[ERR] ERROR: unable to copy Firefox cookie database: database is locked',
        )).toBe(true);

        const row = tasks.getRow(handle.rowId)!;
        expect(row.failureReason).toBe('检测到浏览器未关闭或占用 Cookies，请关闭浏览器后重试');
      } finally {
        tasks.dispose();
      }
    });

    it('clears transient hint on retry, isolates old attempt logs, and keeps fresh attempt unpolluted (Case D)', async () => {
      const { tasks, analyzer, engine } = lifecycle(() => ({ cookies: 'chrome' }));
      try {
        const handle = tasks.analyze('https://example.com/caseD');
        analyzer.resolve(0, media('https://example.com/caseD', 'Case D'));
        await handle.result;

        await tasks.start(handle.rowId, 'video');
        const attempt1 = tasks.getRow(handle.rowId)!.attemptId;

        // Attempt 1 hits browser lock error
        expect(tasks.ingestLog(
          attempt1,
          '[ERR] ERROR: unable to copy Chrome cookie database: database is locked',
        )).toBe(true);
        expect(tasks.getRow(handle.rowId)!.failureReason).toBe('检测到浏览器未关闭或占用 Cookies，请关闭浏览器后重试');

        engine.emit({
          type: 'result',
          taskId: attempt1,
          outcome: 'Failed',
          error: 'Cookie lock',
        });

        // Retry the task
        await tasks.retry(handle.rowId);
        const attempt2 = tasks.getRow(handle.rowId)!.attemptId;
        expect(attempt2).not.toBe(attempt1);

        // Verification 1: Old hint does not pollute retry attempt
        expect(tasks.getRow(handle.rowId)!.failureReason).toBeUndefined();
        expect(tasks.getRow(handle.rowId)!.logs).toEqual([]);

        // Verification 2: Stale log from attempt 1 is rejected
        expect(tasks.ingestLog(attempt1, '[ERR] late error from attempt 1')).toBe(false);

        // Verification 3: Non-cookie error on attempt 2 does not trigger browser lock hint
        expect(tasks.ingestLog(
          attempt2,
          '[ERR] ERROR: unable to open for writing: C:\\Downloads\\video.mp4: Permission denied',
        )).toBe(true);
        expect(tasks.getRow(handle.rowId)!.failureReason).toBeUndefined();
      } finally {
        tasks.dispose();
      }
    });
  });
});
