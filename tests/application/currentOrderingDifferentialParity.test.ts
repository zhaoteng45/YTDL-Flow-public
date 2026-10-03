import { describe, expect, it } from 'vitest';

import type {
  CurrentAnalysisMedia,
  CurrentAnalysisRequest,
  DownloadStartRequest,
} from '../../packages/contracts/src';
import type {
  CurrentMediaAnalyzer,
  DownloadEngine,
  EngineUpdateListener,
} from '../../packages/application/src';
import { projectDownloadList } from '../../src/components/downloadList.projection';
import { createCurrentTaskRuntime } from '../../src/v2-runtime/currentTaskRuntime';

type Resolver = (media: CurrentAnalysisMedia) => void;

class DeferredAnalyzer implements CurrentMediaAnalyzer {
  readonly resolvers = new Map<string, Resolver>();

  analyze(request: CurrentAnalysisRequest): Promise<CurrentAnalysisMedia> {
    return new Promise((resolve) => {
      this.resolvers.set(request.sourceUrl, resolve);
    });
  }
}

class RecordingEngine implements DownloadEngine {
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

const media = (url: string): CurrentAnalysisMedia => ({
  title: url.split('/').at(-1) ?? url,
  thumbnail: '',
  duration: '',
  channel: '',
  url,
});

async function flushMicrotasks(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

describe('current presentation ordering parity', () => {
  it('orders analyzed rows newest-first and dispatches the first one-slot start in that UI order', async () => {
    const urls = ['https://example.test/A', 'https://example.test/B'];
    const analyzer = new DeferredAnalyzer();
    const engine = new RecordingEngine();
    let candidateRowId = 0;
    let analysisAttemptId = 0;
    let downloadAttemptId = 0;
    const runtime = createCurrentTaskRuntime({
      engine,
      analyzer,
      environment: {
        getGlobalExtraArgs: () => ({}),
        getDownloadDir: () => undefined,
      },
      effectsPort: {
        playSuccess: () => {},
        playError: () => {},
        setTaskbar: () => {},
      },
      createRowId: () => `candidate-row-${++candidateRowId}`,
      createAnalysisAttemptId: () => `candidate-analysis-${++analysisAttemptId}`,
      createDownloadAttemptId: () => `candidate-download-${++downloadAttemptId}`,
      downloadServiceOptions: {
        maxConcurrent: 1,
        settlementDelayMs: 0,
      },
    });

    try {
      const handles = runtime.tasks.analyzeMany(urls);

      analyzer.resolvers.get(urls[0])?.(media(urls[0]));
      await flushMicrotasks();

      analyzer.resolvers.get(urls[1])?.(media(urls[1]));
      await Promise.all(handles.map((handle) => handle.result));
      await flushMicrotasks();

      // The presentation view must follow the service-owned orderKey authority:
      // the row that finished analysis most recently sorts first.
      const serviceOrder = [...runtime.tasks.listRows()]
        .sort((a, b) => b.orderKey - a.orderKey)
        .map((row) => row.sourceUrl);
      const projection = projectDownloadList(runtime.listRows());
      const analyzed = projection.visibleRows
        .filter((row) => row.status === 'analyzed')
        .map((row) => row.url);

      expect(analyzed).toEqual(serviceOrder);
      expect(analyzed).toEqual([urls[1], urls[0]]);

      for (const row of projection.visibleRows.filter((candidate) => candidate.status === 'analyzed')) {
        runtime.actions.startDownload(row.rowId, 'video');
      }
      await flushMicrotasks();

      expect(engine.starts.map((request) => request.sourceUrl)).toEqual([urls[1]]);
      const queuedRow = runtime.listRows().find((row) => row.url === urls[0]);
      expect(runtime.tasks.getRow(queuedRow?.rowId ?? '')?.status).toBe('queued');
    } finally {
      await runtime.dispose();
    }
  });
});
