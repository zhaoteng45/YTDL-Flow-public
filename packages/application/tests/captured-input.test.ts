import { describe, expect, it } from 'vitest';

import { DownloadQueue } from '../../domain/src';
import {
  CurrentAnalysisService,
  CurrentDownloadService,
  CurrentTaskService,
  type CurrentTaskExecution,
  DownloadService,
  TaskQueryService,
  type DownloadEngine,
  type EngineUpdateListener,
} from '../src';
import type {
  CurrentAnalysisMedia,
  CurrentAnalysisRequest,
  DownloadStartRequest,
  EngineUpdate,
} from '../../contracts/src';

class RecordingEngine implements DownloadEngine {
  readonly starts: DownloadStartRequest[] = [];
  readonly cancels: string[] = [];
  private listener?: EngineUpdateListener;

  async start(request: DownloadStartRequest) {
    this.starts.push(request);
  }

  async cancel(taskId: string) {
    this.cancels.push(taskId);
  }

  subscribeUpdates(listener: EngineUpdateListener) {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  emit(update: EngineUpdate) {
    this.listener?.(update);
  }
}

class RecordingAnalyzer {
  readonly requests: CurrentAnalysisRequest[] = [];
  private readonly pending: Array<(media: CurrentAnalysisMedia) => void> = [];
  private readonly rejections: Array<(error: unknown) => void> = [];

  analyze(request: CurrentAnalysisRequest): Promise<CurrentAnalysisMedia> {
    this.requests.push({ ...request });
    return new Promise((resolve, reject) => {
      this.pending.push(resolve);
      this.rejections.push(reject);
    });
  }

  complete(index: number, media: CurrentAnalysisMedia) {
    this.pending[index]?.(media);
  }

  fail(index: number, error: unknown) {
    this.rejections[index]?.(error);
  }
}

const media: CurrentAnalysisMedia = {
  title: 'Captured clip',
  thumbnail: '',
  duration: '00:10',
  channel: 'capture',
  url: 'cdn.example.com',
};

function lifecycle() {
  let sequence = 0;
  const id = () => `id-${++sequence}`;
  const queue = new DownloadQueue();
  const engine = new RecordingEngine();
  const downloadService = new DownloadService(queue, engine, id);
  const taskQueryService = new TaskQueryService(queue);
  const currentDownloadService = new CurrentDownloadService(
    downloadService,
    { getGlobalExtraArgs: () => ({}), getDownloadDir: () => undefined },
    taskQueryService,
  );
  const analyzer = new RecordingAnalyzer();
  const analysisService = new CurrentAnalysisService(analyzer, id, () => ({}));
  const execution: CurrentTaskExecution = {
    downloads: currentDownloadService,
    query: taskQueryService,
    subscribeTasks: (listener) => downloadService.subscribeTasks(listener),
    dispose: () => downloadService.dispose(),
  };
  const tasks = new CurrentTaskService(analysisService, id, execution);
  return { tasks, analyzer, engine, queue };
}

describe('captured input seam', () => {
  it('imports a claimed capture context as a normal CurrentTask row', async () => {
    const { tasks, analyzer } = lifecycle();

    const handle = tasks.analyzeCaptured({
      captureContextId: 'context-1',
      siteLabel: 'cdn.example.com',
      mediaKind: 'video',
    });

    expect(handle.rowId).toBeTruthy();
    const row = tasks.getRow(handle.rowId);
    expect(row?.status).toBe('analyzing');
    expect(row?.capture?.contextId).toBe('context-1');
    expect(row?.capture?.siteLabel).toBe('cdn.example.com');
    // The capture path must not leak an executable address into the row.
    expect(row?.sourceUrl).not.toContain('http');

    expect(analyzer.requests).toHaveLength(1);
    expect(analyzer.requests[0]).toMatchObject({
      attemptId: handle.attemptId,
      captureContextId: 'context-1',
    });
    expect(analyzer.requests[0].sourceUrl).toBeUndefined();

    analyzer.complete(0, media);
    await handle.result;
    expect(tasks.getRow(handle.rowId)?.status).toBe('analyzed');
  });

  it('keeps captured and pasted tasks in one task model', async () => {
    const { tasks, analyzer } = lifecycle();

    const captured = tasks.analyzeCaptured({
      captureContextId: 'context-1',
      siteLabel: 'cdn.example.com',
      mediaKind: 'hls',
    });
    const pasted = tasks.analyze('https://example.com/video');

    analyzer.complete(1, media);
    analyzer.complete(0, media);
    await Promise.all([captured.result, pasted.result]);

    const rows = tasks.listRows();
    expect(rows).toHaveLength(2);
    // One row model: same status vocabulary and action surface for both.
    for (const row of rows) {
      expect(row.status).toBe('analyzed');
      expect(row.actions.canStartDownload).toBe(true);
    }
    expect(rows.find((row) => row.rowId === captured.rowId)?.capture?.contextId).toBe('context-1');
    expect(rows.find((row) => row.rowId === pasted.rowId)?.capture).toBeUndefined();
    expect(rows.find((row) => row.rowId === pasted.rowId)?.sourceUrl).toBe(
      'https://example.com/video',
    );
  });

  it('starts a captured download with the opaque context instead of a URL', async () => {
    const { tasks, analyzer, engine } = lifecycle();

    const handle = tasks.analyzeCaptured({
      captureContextId: 'context-1',
      siteLabel: 'cdn.example.com',
      mediaKind: 'video',
    });
    analyzer.complete(0, media);
    await handle.result;

    await tasks.start(handle.rowId, 'video');

    expect(engine.starts).toHaveLength(1);
    expect(engine.starts[0]).toMatchObject({ captureContextId: 'context-1' });
    expect(engine.starts[0].sourceUrl).toBeUndefined();
    expect(tasks.getRow(handle.rowId)?.capture?.contextId).toBe('context-1');
  });

  it('reanalyzes a captured row through the context, never through the label', async () => {
    const { tasks, analyzer } = lifecycle();

    const handle = tasks.analyzeCaptured({
      captureContextId: 'context-1',
      siteLabel: 'cdn.example.com',
      mediaKind: 'video',
    });
    analyzer.fail(0, new Error('analysis failed'));
    await handle.result;
    expect(tasks.getRow(handle.rowId)?.status).toBe('error');

    const reanalyzed = tasks.reanalyze(handle.rowId);
    expect(reanalyzed).toBeTruthy();
    expect(analyzer.requests).toHaveLength(2);
    expect(analyzer.requests[1]).toMatchObject({ captureContextId: 'context-1' });
    expect(analyzer.requests[1].sourceUrl).toBeUndefined();

    analyzer.complete(1, media);
    await reanalyzed?.result;
    expect(tasks.getRow(handle.rowId)?.status).toBe('analyzed');
  });

  it('leaves the pasted-URL path byte-for-byte compatible', async () => {
    const { tasks, analyzer, engine } = lifecycle();

    const handle = tasks.analyze('https://example.com/video');
    analyzer.complete(0, media);
    await handle.result;

    expect(analyzer.requests[0]).toEqual({
      sourceUrl: 'https://example.com/video',
      attemptId: handle.attemptId,
      extraArgs: {},
    });

    await tasks.start(handle.rowId, 'mp3', { cookies: 'edge' });
    expect(engine.starts[0]).toMatchObject({
      sourceUrl: 'https://example.com/video',
      downloadType: 'audio',
      extraArgs: { cookies: 'edge', audioCodec: 'mp3' },
    });
    expect(engine.starts[0].captureContextId).toBeUndefined();
  });
});
