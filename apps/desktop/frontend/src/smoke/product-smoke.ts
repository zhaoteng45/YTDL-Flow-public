import { DownloadProductService, DownloadService, TaskQueryService } from '@ytdl-flow/application';
import type { CancelCommandResult, DownloadTaskCreator } from '@ytdl-flow/application';
import type { EngineUpdate, TaskPayload } from '@ytdl-flow/contracts';
import { DownloadQueue } from '@ytdl-flow/domain';
import { exit } from '@tauri-apps/plugin-process';
import { createNativeSmokeAudit, type NativeSmokeTaskAudit } from '@v2-runtime/nativeSmokeAudit';
import { TauriDownloadEngine } from '@v2-runtime/tauriDownloadEngine';
import { TauriMediaAnalyzer } from '@v2-runtime/tauriMediaAnalyzer';

import { createNativeAppRuntime } from '../runtime/create-app-runtime';

const SUCCESS_URL = import.meta.env.VITE_V2_SMOKE_SUCCESS_URL;
const FAILURE_URL = import.meta.env.VITE_V2_SMOKE_FAILURE_URL;
const CANCEL_URL = import.meta.env.VITE_V2_SMOKE_CANCEL_URL;
const OUTPUT_DIR = import.meta.env.VITE_V2_SMOKE_OUTPUT_DIR;

const TRUSTED_RESULT_TIMEOUT_MS = 120_000;
const FINAL_RESULT_AUDIT_QUIET_MS = 1_000;

type DownloadScenarioName = 'video-success' | 'audio-success' | 'failure' | 'cancel';
type ScenarioName = 'analyze-contract' | DownloadScenarioName;

interface ScenarioReport {
  name: ScenarioName;
  url: string;
  taskId?: string;
  analyzedTitle?: string;
  resultCount?: number;
  terminal?: TaskPayload | null;
  cancelOutcome?: string;
  updates?: EngineUpdate[];
  passed: boolean;
  error?: string;
}

interface ScenarioObservation {
  name: DownloadScenarioName;
  url: string;
  taskId: string;
  mediaTitle?: string;
  terminal: TaskPayload | null;
  cancelOutcome?: string;
  taskAudit: NativeSmokeTaskAudit;
  error?: string;
}

async function waitForTrustedResult(taskAudit: NativeSmokeTaskAudit, taskId: string): Promise<void> {
  let timeout = 0;
  try {
    await Promise.race([
      taskAudit.firstResult,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => {
          reject(new Error(`Timed out waiting for trusted result for ${taskId}`));
        }, TRUSTED_RESULT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Deterministic native smoke for TICKET-010.
 *
 * Every download scenario starts from a real `get_video_metadata` analyze and
 * goes through the same Application product use case the React runtime uses.
 * React rendering itself is covered by the frontend tests and the Human Gate.
 */
export async function runProductSmoke(): Promise<void> {
  const startedAt = new Date().toISOString();

  if (!OUTPUT_DIR || !SUCCESS_URL || !FAILURE_URL || !CANCEL_URL) {
    throw new Error('V2 product smoke requires output, success, failure and cancel URL configuration');
  }

  const auditDisposers: Array<() => void> = [];
  const reports: ScenarioReport[] = [];

  try {
    reports.push(await runAnalyzeContract(SUCCESS_URL));
    reports.push(await runDownloadScenario('video-success', SUCCESS_URL, 'video-auto', auditDisposers));
    reports.push(await runDownloadScenario('audio-success', SUCCESS_URL, 'audio-mp3', auditDisposers));
    reports.push(await runDownloadScenario('failure', FAILURE_URL, 'video-auto', auditDisposers));
    reports.push(await runDownloadScenario('cancel', CANCEL_URL, 'video-auto', auditDisposers));

    // Keep every task-keyed audit subscription alive through a bounded final
    // quiet window so delayed duplicate terminal results cannot evade resultCount.
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, FINAL_RESULT_AUDIT_QUIET_MS);
    });
  } finally {
    for (const dispose of auditDisposers) {
      dispose();
    }
  }

  const passed = reports.every((report) => report.passed);
  await fetch('/__ytdl_v2_smoke_report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'v2-product',
      startedAt,
      finishedAt: new Date().toISOString(),
      passed,
      scenarios: reports,
    }),
  });

  document.body.textContent = passed
    ? 'TICKET-010 product smoke PASS'
    : 'TICKET-010 product smoke FAILED';

  await exit(passed ? 0 : 1);
}

async function runAnalyzeContract(url: string): Promise<ScenarioReport> {
  const runtime = createNativeAppRuntime();

  try {
    runtime.controller.setInput(url);
    await runtime.controller.analyze();
    const state = runtime.controller.getState();

    if (state.analyzeError) {
      return { name: 'analyze-contract', url, passed: false, error: state.analyzeError.message };
    }
    if (!state.analysis) {
      return { name: 'analyze-contract', url, passed: false, error: 'no analysis snapshot' };
    }
    if (state.analysis.sourceUrl !== url || state.analysis.title.trim().length === 0) {
      return {
        name: 'analyze-contract',
        url,
        passed: false,
        error: 'normalized media did not match the requested source',
      };
    }

    return { name: 'analyze-contract', url, analyzedTitle: state.analysis.title, passed: true };
  } finally {
    runtime.dispose();
  }
}

async function runDownloadScenario(
  name: DownloadScenarioName,
  url: string,
  selection: 'video-auto' | 'audio-mp3',
  auditDisposers: Array<() => void>,
): Promise<ScenarioReport> {
  const taskId = `ticket010-${name}-${Date.now()}`;
  const queue = new DownloadQueue();
  const engine = new TauriDownloadEngine();
  const service = new DownloadService(queue, engine, () => taskId);
  const query = new TaskQueryService(queue);
  const downloadDir = `${OUTPUT_DIR}/${name}`;
  // Smoke-only composition: route this run's artifacts into the disposable
  // scratch directory. The product flow itself keeps using the backend default
  // download directory.
  const smokeDownloads: DownloadTaskCreator = {
    createTask: (sourceUrl, options) =>
      service.createTask(sourceUrl, { ...options, downloadDir }),
    cancelTask: (id) => service.cancelTask(id),
  };
  const product = new DownloadProductService({
    analyzer: new TauriMediaAnalyzer(),
    downloads: smokeDownloads,
  });
  const audit = createNativeSmokeAudit(engine);
  auditDisposers.push(() => audit.dispose());

  let cancelPromise: Promise<CancelCommandResult> | null = null;
  const requestCancel = () => {
    cancelPromise ??= product.cancel(taskId);
  };
  const readCancelPromise = () => cancelPromise;
  const taskAudit = audit.registerTask(taskId, name === 'cancel' ? requestCancel : undefined);

  const observation: ScenarioObservation = {
    name,
    url,
    taskId,
    terminal: null,
    taskAudit,
  };

  try {
    const analyzeResult = await product.analyze(url);
    if (!analyzeResult.ok) {
      observation.error = `analyze failed: ${analyzeResult.error.message}`;
      return toReport(observation);
    }
    observation.mediaTitle = analyzeResult.media.title;

    const createResult = await product.createDownload({
      sourceUrl: analyzeResult.media.sourceUrl,
      selection,
    });
    if (!createResult.ok) {
      observation.error = `create failed: ${createResult.error.message}`;
      return toReport(observation);
    }

    await waitForTrustedResult(taskAudit, taskId);
    observation.terminal = query.getTask(taskId) ?? null;

    if (readCancelPromise()) {
      const cancelResult = await readCancelPromise();
      const settled = cancelResult?.settlement ? await cancelResult.settlement : undefined;
      observation.cancelOutcome = settled?.type ?? cancelResult?.outcome.type;
    }

    return toReport(observation);
  } catch (error) {
    observation.error = error instanceof Error ? error.message : String(error);
    observation.terminal = query.getTask(taskId) ?? null;
    return toReport(observation);
  } finally {
    // The Application subscription is released here; the independent audit
    // subscription stays alive until the whole smoke run finishes.
    service.dispose();
  }
}

function toReport(observation: ScenarioObservation): ScenarioReport {
  const snapshot = observation.taskAudit.snapshot();
  const terminal = observation.terminal;
  const isFailure = observation.name === 'failure';

  const terminalOk = isFailure
    ? terminal?.status === 'Failed' && (terminal.failureReason ?? '').trim().length > 0
    : terminal?.status === (observation.name === 'cancel' ? 'Cancelled' : 'Completed');

  return {
    name: observation.name,
    url: observation.url,
    taskId: observation.taskId,
    analyzedTitle: observation.mediaTitle,
    resultCount: snapshot.resultCount,
    terminal,
    cancelOutcome: observation.cancelOutcome,
    updates: snapshot.updates,
    passed:
      observation.error === undefined &&
      terminalOk &&
      snapshot.resultCount === 1 &&
      (observation.name !== 'cancel' || observation.cancelOutcome !== undefined),
    error: observation.error,
  };
}
