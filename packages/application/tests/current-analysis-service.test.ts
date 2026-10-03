import { describe, expect, it } from 'vitest';

import type { CurrentAnalysisMedia, CurrentAnalysisRequest, CurrentExtraArgs } from '../../contracts/src';
import {
  CurrentAnalysisService,
  type CurrentMediaAnalyzer,
} from '../src/current-analysis-service';

class ControlledCurrentAnalyzer implements CurrentMediaAnalyzer {
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

describe('CurrentAnalysisService', () => {
  it('settles forgotten, superseded and disposed handles without waiting for a native reply', async () => {
    const analyzer = new ControlledCurrentAnalyzer();
    let id = 0;
    const service = new CurrentAnalysisService(analyzer, () => `a-${++id}`);
    const forgotten = service.startAnalysis('forgotten', 'https://example.com/f');
    service.forget('forgotten');
    const old = service.startAnalysis('same', 'https://example.com/s');
    const current = service.reanalyze('same', 'https://example.com/s');
    service.dispose();
    const outcomes = await Promise.race([
      Promise.all([forgotten.result, old.result, current.result]),
      new Promise<string>((resolve) => setTimeout(() => resolve('unsettled'), 10)),
    ]);
    expect(outcomes).toEqual([
      { status: 'stale', rowId: 'forgotten', attemptId: 'a-1' },
      { status: 'stale', rowId: 'same', attemptId: 'a-2' },
      { status: 'stale', rowId: 'same', attemptId: 'a-3' },
    ]);
    analyzer.reject(0, new Error('late failure is consumed'));
    analyzer.resolve(1, media('https://example.com/s', 'Old'));
    analyzer.resolve(2, media('https://example.com/s', 'Current'));
  });
  it('mints an attempt id and resolves current ExtraArgs at each analysis dispatch', async () => {
    const analyzer = new ControlledCurrentAnalyzer();
    const ids = ['analysis-1'];
    let extraArgs: CurrentExtraArgs = { cookies: 'chrome', proxy: 'proxy-1' };
    const service = new CurrentAnalysisService(
      analyzer,
      () => ids.shift() ?? 'unexpected',
      () => ({ ...extraArgs }),
    );

    const handle = service.startAnalysis('row-1', 'https://example.com/1');
    expect(handle.rowId).toBe('row-1');
    expect(handle.attemptId).toBe('analysis-1');
    expect(analyzer.requests).toEqual([
      {
        sourceUrl: 'https://example.com/1',
        attemptId: 'analysis-1',
        extraArgs: { cookies: 'chrome', proxy: 'proxy-1' },
      },
    ]);

    extraArgs = { cookies: 'firefox', proxy: 'proxy-2' };
    analyzer.resolve(0, media('https://example.com/1', 'One'));

    await expect(handle.result).resolves.toEqual({
      status: 'analyzed',
      rowId: 'row-1',
      attemptId: 'analysis-1',
      media: media('https://example.com/1', 'One'),
      extraArgs: { cookies: 'chrome', proxy: 'proxy-1' },
    });
  });

  it('rejects late results from an older analysis attempt after reanalysis', async () => {
    const analyzer = new ControlledCurrentAnalyzer();
    const ids = ['analysis-old', 'analysis-new'];
    const service = new CurrentAnalysisService(analyzer, () => ids.shift() ?? 'unexpected', () => ({}));

    const old = service.startAnalysis('row-stable', 'https://example.com/video');
    const replacement = service.reanalyze('row-stable', 'https://example.com/video');

    expect(replacement.attemptId).toBe('analysis-new');

    analyzer.resolve(1, media('https://example.com/video', 'New'));
    await expect(replacement.result).resolves.toMatchObject({
      status: 'analyzed',
      rowId: 'row-stable',
      attemptId: 'analysis-new',
      media: { title: 'New' },
    });

    analyzer.resolve(0, media('https://example.com/video', 'Old'));
    await expect(old.result).resolves.toEqual({
      status: 'stale',
      rowId: 'row-stable',
      attemptId: 'analysis-old',
    });
  });

  it('classifies a current analysis failure without letting an old failure replace a newer attempt', async () => {
    const analyzer = new ControlledCurrentAnalyzer();
    const ids = ['analysis-failed-old', 'analysis-current'];
    const service = new CurrentAnalysisService(analyzer, () => ids.shift() ?? 'unexpected', () => ({}));

    const old = service.startAnalysis('row-failure', 'https://example.com/video');
    const current = service.reanalyze('row-failure', 'https://example.com/video');

    analyzer.reject(0, new Error('old failure'));
    await expect(old.result).resolves.toEqual({
      status: 'stale',
      rowId: 'row-failure',
      attemptId: 'analysis-failed-old',
    });

    analyzer.reject(1, new Error('metadata failed'));
    await expect(current.result).resolves.toEqual({
      status: 'failed',
      rowId: 'row-failure',
      attemptId: 'analysis-current',
      failureKind: 'analysis',
      error: {
        code: 'analysis-failed',
        message: 'metadata failed',
      },
    });
  });

  it('normalizes synchronous ExtraArgs and analyzer failures into the analysis result handle', async () => {
    const analyzer = new ControlledCurrentAnalyzer();
    const configFailure = new CurrentAnalysisService(
      analyzer,
      () => 'analysis-config-fail',
      () => {
        throw new Error('settings unavailable');
      },
    );

    const configHandle = configFailure.startAnalysis('row-config-fail', 'https://example.com/config');
    expect(configHandle.attemptId).toBe('analysis-config-fail');
    expect(analyzer.requests).toEqual([]);
    await expect(configHandle.result).resolves.toEqual({
      status: 'failed',
      rowId: 'row-config-fail',
      attemptId: 'analysis-config-fail',
      failureKind: 'analysis',
      error: {
        code: 'analysis-failed',
        message: 'settings unavailable',
      },
    });

    const syncAnalyzer: CurrentMediaAnalyzer = {
      analyze() {
        throw new Error('native analyzer unavailable');
      },
    };
    const analyzerFailure = new CurrentAnalysisService(
      syncAnalyzer,
      () => 'analysis-sync-fail',
      () => ({ cookies: 'chrome' }),
    );

    const analyzerHandle = analyzerFailure.startAnalysis('row-sync-fail', 'https://example.com/sync');
    expect(analyzerHandle.attemptId).toBe('analysis-sync-fail');
    await expect(analyzerHandle.result).resolves.toEqual({
      status: 'failed',
      rowId: 'row-sync-fail',
      attemptId: 'analysis-sync-fail',
      failureKind: 'analysis',
      error: {
        code: 'analysis-failed',
        message: 'native analyzer unavailable',
      },
    });
  });

  it('invalidates forgotten and disposed analysis attempts without reviving them', async () => {
    const analyzer = new ControlledCurrentAnalyzer();
    const ids = ['analysis-forgotten', 'analysis-disposed'];
    const service = new CurrentAnalysisService(
      analyzer,
      () => ids.shift() ?? 'unexpected',
      () => ({}),
    );

    const forgotten = service.startAnalysis('row-forgotten', 'https://example.com/forgotten');
    service.forget('row-forgotten');
    analyzer.resolve(0, media('https://example.com/forgotten', 'Forgotten'));
    await expect(forgotten.result).resolves.toEqual({
      status: 'stale',
      rowId: 'row-forgotten',
      attemptId: 'analysis-forgotten',
    });

    const disposed = service.startAnalysis('row-disposed', 'https://example.com/disposed');
    service.dispose();
    service.dispose();
    analyzer.reject(1, new Error('late failure'));
    await expect(disposed.result).resolves.toEqual({
      status: 'stale',
      rowId: 'row-disposed',
      attemptId: 'analysis-disposed',
    });

    expect(() =>
      service.startAnalysis('row-after-dispose', 'https://example.com/after'),
    ).toThrow(/disposed/i);
  });
});
