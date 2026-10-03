import { exit } from '@tauri-apps/plugin-process';

import { DownloadService, TaskQueryService } from '../../packages/application/src';
import { DownloadQueue } from '../../packages/domain/src';
import type { EngineUpdate, TaskPayload } from '../../packages/contracts/src';
import { createNativeSmokeAudit, type NativeSmokeAudit, type NativeSmokeTaskAudit } from './nativeSmokeAudit';
import { TauriDownloadEngine } from './tauriDownloadEngine';

type ScenarioName = 'success' | 'failure' | 'cancel';

interface ScenarioReport {
  name: ScenarioName;
  taskId: string;
  url: string;
  resultCount: number;
  terminal: TaskPayload | null;
  updates: EngineUpdate[];
  passed: boolean;
  error?: string;
}

interface NativeSmokeReport {
  mode: 'v2-only';
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  scenarios: ScenarioReport[];
}

interface ScenarioObservation {
  name: ScenarioName;
  taskId: string;
  url: string;
  terminal: TaskPayload | null;
  cancelRequested: boolean;
  taskAudit: NativeSmokeTaskAudit;
  audit: NativeSmokeAudit;
  error?: string;
}

const SUCCESS_URL = import.meta.env.VITE_V2_SMOKE_SUCCESS_URL;
const FAILURE_URL =
  import.meta.env.VITE_V2_SMOKE_FAILURE_URL ??
  'invalid://ticket009-intentional-failure';
const CANCEL_URL = import.meta.env.VITE_V2_SMOKE_CANCEL_URL;

const OUTPUT_DIR = import.meta.env.VITE_V2_SMOKE_OUTPUT_DIR;
const TRUSTED_RESULT_TIMEOUT_MS = 120_000;
const FINAL_RESULT_AUDIT_QUIET_MS = 1_000;

async function waitForTrustedResult(
  firstResult: Promise<void>,
  taskId: string,
): Promise<void> {
  let timeout = 0;

  try {
    await Promise.race([
      firstResult,
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

function expectedStatusFor(name: ScenarioName): TaskPayload['status'] {
  return name === 'success' ? 'Completed' : name === 'failure' ? 'Failed' : 'Cancelled';
}

function toScenarioReport(observation: ScenarioObservation): ScenarioReport {
  const snapshot = observation.taskAudit.snapshot();

  return {
    name: observation.name,
    taskId: observation.taskId,
    url: observation.url,
    resultCount: snapshot.resultCount,
    terminal: observation.terminal,
    updates: snapshot.updates,
    passed:
      observation.error === undefined &&
      observation.terminal?.status === expectedStatusFor(observation.name) &&
      snapshot.resultCount === 1 &&
      (observation.name !== 'cancel' || observation.cancelRequested),
    error: observation.error,
  };
}

async function runScenario(
  name: ScenarioName,
  url: string,
  outputDir: string,
): Promise<ScenarioObservation> {
  const taskId = `ticket009-${name}-${Date.now()}`;
  const queue = new DownloadQueue();
  const engine = new TauriDownloadEngine();
  const service = new DownloadService(queue, engine, () => taskId);
  const query = new TaskQueryService(queue);
  const audit = createNativeSmokeAudit(engine);

  let cancelRequested = false;
  const taskAudit = audit.registerTask(
    taskId,
    name === 'cancel'
      ? () => {
          if (!cancelRequested) {
            cancelRequested = true;
            void service.cancelTask(taskId);
          }
        }
      : undefined,
  );

  try {
    await service.createTask(url, {
      downloadType: 'video',
      downloadDir: outputDir,
    });

    await waitForTrustedResult(taskAudit.firstResult, taskId);

    return {
      name,
      taskId,
      url,
      terminal: query.getTask(taskId) ?? null,
      cancelRequested,
      taskAudit,
      audit,
    };
  } catch (error) {
    return {
      name,
      taskId,
      url,
      terminal: query.getTask(taskId) ?? null,
      cancelRequested,
      taskAudit,
      audit,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Keep the independent audit subscription alive until the complete smoke run
    // finishes; only the Application subscription is released here.
    service.dispose();
  }
}

export async function runNativeSmoke(): Promise<void> {
  const startedAt = new Date().toISOString();

  if (!OUTPUT_DIR || !SUCCESS_URL || !CANCEL_URL) {
    throw new Error(
      'V2 native smoke requires output, success URL, and cancel URL configuration',
    );
  }

  const observations = [
    await runScenario('success', SUCCESS_URL, OUTPUT_DIR),
    await runScenario('failure', FAILURE_URL, OUTPUT_DIR),
    await runScenario('cancel', CANCEL_URL, OUTPUT_DIR),
  ];

  // Keep every task-keyed audit subscription alive through a bounded final
  // quiet window so delayed duplicate terminal results cannot evade resultCount.
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, FINAL_RESULT_AUDIT_QUIET_MS);
  });

  const scenarios = observations.map(toScenarioReport);
  for (const observation of observations) {
    observation.audit.dispose();
  }

  const report: NativeSmokeReport = {
    mode: 'v2-only',
    startedAt,
    finishedAt: new Date().toISOString(),
    passed: scenarios.every((scenario) => scenario.passed),
    scenarios,
  };

  const reportResponse = await fetch('/__ytdl_v2_smoke_report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (!reportResponse.ok) {
    throw new Error(`Failed to persist native smoke report: ${reportResponse.status}`);
  }

  document.body.textContent = report.passed
    ? 'TICKET-009 native smoke PASS'
    : 'TICKET-009 native smoke FAILED';

  await exit(report.passed ? 0 : 1);
}
