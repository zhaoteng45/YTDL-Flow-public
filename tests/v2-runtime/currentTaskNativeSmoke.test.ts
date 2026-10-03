import { describe, expect, it } from 'vitest';

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
  runCurrentTaskNativeSmoke,
  type CurrentTaskNativeSmokeConfig,
  type CurrentTaskNativeSmokeScenarioName,
} from '../../src/v2-runtime/currentTaskNativeSmoke';

type Behavior = 'complete' | 'fail' | 'cancel-on-request' | 'hold';

class ScriptedEngine implements DownloadEngine {
  readonly starts: DownloadStartRequest[] = [];
  readonly cancels: string[] = [];
  disposeCount = 0;
  private readonly listeners = new Set<EngineUpdateListener>();

  constructor(private readonly behavior: Behavior) {}

  async start(request: DownloadStartRequest): Promise<void> {
    this.starts.push(request);
    const taskId = request.taskId;

    if (this.behavior === 'complete') {
      this.schedule(() => {
        this.emit({ type: 'progress', taskId, phase: 'Downloading', progress: 25, speed: '1MiB/s' });
        this.emit({ type: 'progress', taskId, phase: 'Downloading', progress: 80, speed: '1MiB/s' });
        this.emit({
          type: 'result',
          taskId,
          outcome: 'Completed',
          filePath: 'C:/smoke/success.mp4',
        });
      });
      return;
    }

    if (this.behavior === 'fail') {
      this.schedule(() => {
        this.emit({ type: 'result', taskId, outcome: 'Failed', error: 'yt-dlp exited with code 1' });
      });
      return;
    }

    this.schedule(() => {
      this.emit({ type: 'progress', taskId, phase: 'Downloading', progress: 1, speed: '1MiB/s' });
    });
  }

  async cancel(taskId: string): Promise<void> {
    this.cancels.push(taskId);
    if (this.behavior === 'cancel-on-request') {
      this.emit({ type: 'result', taskId, outcome: 'Cancelled' });
    }
  }

  subscribeUpdates(listener: EngineUpdateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposeCount += 1;
    this.listeners.clear();
  }

  emit(update: EngineUpdate): void {
    for (const listener of [...this.listeners]) {
      listener(update);
    }
  }

  private schedule(run: () => void): void {
    setTimeout(run, 5);
  }
}

const DUPLICATE_RESULT_DELAY_MS = 12;
const DUPLICATE_RESULT_AUDIT_WINDOW_MS = DUPLICATE_RESULT_DELAY_MS + 20;

class DuplicateResultEngine extends ScriptedEngine {
  constructor() {
    super('complete');
  }

  override async start(request: DownloadStartRequest): Promise<void> {
    await super.start(request);
    const taskId = request.taskId;
    setTimeout(() => {
      this.emit({
        type: 'result',
        taskId,
        outcome: 'Completed',
        filePath: 'C:/smoke/success.mp4',
      });
    }, DUPLICATE_RESULT_DELAY_MS);
  }
}

const CONFIG: CurrentTaskNativeSmokeConfig = {
  successUrl: 'http://127.0.0.1:7001/success.mp4',
  slowUrl: 'http://127.0.0.1:7001/slow.mp4',
  failureDownloadDir: 'C:/smoke/failure-target.bin',
  outputDir: 'C:/smoke/output',
};

function media(url: string): CurrentAnalysisMedia {
  return {
    title: 'media',
    thumbnail: 'thumb.jpg',
    duration: '1:00',
    channel: 'Channel',
    url,
  };
}

const behaviorByScenario: Record<CurrentTaskNativeSmokeScenarioName, Behavior> = {
  success: 'complete',
  'native-failure': 'fail',
  'active-cancel': 'cancel-on-request',
  'active-dispose': 'hold',
};

function createAnalyzer(): CurrentMediaAnalyzer {
  return {
    analyze: async (request) => media(request.sourceUrl),
  };
}

function fastOptions(engines: Map<CurrentTaskNativeSmokeScenarioName, ScriptedEngine>) {
  return {
    config: CONFIG,
    createEngine: (scenario: CurrentTaskNativeSmokeScenarioName): DownloadEngine => {
      const engine = new ScriptedEngine(behaviorByScenario[scenario]);
      engines.set(scenario, engine);
      return engine;
    },
    createAnalyzer,
    scenarioQuietMs: 0,
    finalQuietMs: 0,
    analysisTimeoutMs: 2_000,
    terminalTimeoutMs: 2_000,
    progressTimeoutMs: 2_000,
    flushTimeoutMs: 2_000,
    disposeTimeoutMs: 2_000,
  };
}

describe('current task native smoke scenario runner', () => {
  it('drives the four candidate scenarios through the runtime and reports trusted evidence', async () => {
    const engines = new Map<CurrentTaskNativeSmokeScenarioName, ScriptedEngine>();
    const report = await runCurrentTaskNativeSmoke(fastOptions(engines));

    expect(report.mode).toBe('current-task-runtime');
    expect(report.error).toBeUndefined();
    expect(report.scenarios.map((scenario) => scenario.name)).toEqual([
      'success',
      'native-failure',
      'active-cancel',
      'active-dispose',
    ]);
    expect(report.passed).toBe(true);

    const [success, failure, cancel, dispose] = report.scenarios;

    expect(success.rowId).toBe('success-row-1');
    expect(success.attemptId).toBe('success-download-1');
    expect(success.resultCount).toBe(1);
    expect(success.terminal?.status).toBe('completed');
    expect(success.terminal?.finalPath).toBe('C:/smoke/success.mp4');
    expect(success.progressObserved).toBe(true);
    expect(success.effects.successSounds).toBe(1);
    expect(success.effects.errorSounds).toBe(0);
    expect(success.passed).toBe(true);

    expect(engines.get('success')?.starts[0]).toMatchObject({
      taskId: 'success-download-1',
      sourceUrl: CONFIG.successUrl,
      downloadType: 'video',
      downloadDir: CONFIG.outputDir,
      extraArgs: {},
    });

    expect(failure.terminal?.status).toBe('error');
    expect(failure.terminal?.failureKind).toBe('download');
    expect(failure.resultCount).toBe(1);
    expect(failure.effects.successSounds).toBe(0);
    expect(failure.effects.errorSounds).toBe(1);
    expect(failure.passed).toBe(true);
    expect(engines.get('native-failure')?.starts[0]?.downloadDir).toBe(
      CONFIG.failureDownloadDir,
    );

    expect(cancel.terminal?.status).toBe('error');
    expect(cancel.terminal?.failureKind).toBe('cancelled');
    expect(cancel.resultCount).toBe(1);
    expect(cancel.progressObserved).toBe(true);
    expect(cancel.cancelRequestedDuringProgress).toBe(true);
    expect(cancel.effects.successSounds).toBe(0);
    expect(cancel.effects.errorSounds).toBe(0);
    expect(cancel.passed).toBe(true);
    expect(engines.get('active-cancel')?.cancels).toEqual(['active-cancel-download-1']);

    expect(dispose.progressObserved).toBe(true);
    expect(dispose.disposeResolved).toBe(true);
    expect(dispose.passed).toBe(true);
    expect(engines.get('active-dispose')?.disposeCount).toBe(1);

    expect(engines.get('success')?.disposeCount).toBe(1);
    expect(engines.get('native-failure')?.disposeCount).toBe(1);
    expect(engines.get('active-cancel')?.disposeCount).toBe(1);
  });

  it('fails the scenario verdict when a duplicate trusted terminal result arrives', async () => {
    const engines = new Map<CurrentTaskNativeSmokeScenarioName, ScriptedEngine>();
    const report = await runCurrentTaskNativeSmoke({
      ...fastOptions(engines),
      // The duplicate must arrive before scenario disposal clears the mock engine listeners.
      scenarioQuietMs: DUPLICATE_RESULT_AUDIT_WINDOW_MS,
      createEngine: (scenario: CurrentTaskNativeSmokeScenarioName): DownloadEngine => {
        const engine =
          scenario === 'success'
            ? new DuplicateResultEngine()
            : new ScriptedEngine(behaviorByScenario[scenario]);
        engines.set(scenario, engine);
        return engine;
      },
    });

    const success = report.scenarios.find((scenario) => scenario.name === 'success');
    expect(success?.resultCount).toBe(2);
    expect(success?.passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('records a timeout error instead of faking a passed scenario', async () => {
    const engines = new Map<CurrentTaskNativeSmokeScenarioName, ScriptedEngine>();
    const report = await runCurrentTaskNativeSmoke({
      ...fastOptions(engines),
      createEngine: (scenario: CurrentTaskNativeSmokeScenarioName): DownloadEngine => {
        const engine = new ScriptedEngine(scenario === 'success' ? 'hold' : behaviorByScenario[scenario]);
        engines.set(scenario, engine);
        return engine;
      },
    });

    const success = report.scenarios.find((scenario) => scenario.name === 'success');
    expect(success?.passed).toBe(false);
    expect(success?.error).toMatch(/timed out/i);
    expect(report.passed).toBe(false);
  });
});
