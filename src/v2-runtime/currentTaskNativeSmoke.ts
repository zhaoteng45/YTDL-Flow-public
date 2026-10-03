import { exit } from '@tauri-apps/plugin-process';

import type {
  CurrentMediaAnalyzer,
  CurrentTaskEffectsPort,
  CurrentTaskbarProjection,
  DownloadEngine,
} from '../../packages/application/src';
import type { TaskPresentationRow } from '../application/taskPresentation';
import {
  createNativeSmokeAudit,
  type NativeSmokeAudit,
  type NativeSmokeTaskAudit,
} from './nativeSmokeAudit';
import {
  createCurrentTaskRuntime,
  type CurrentTaskRuntime,
} from './currentTaskRuntime';
import { CurrentTauriMediaAnalyzer } from './currentTauriMediaAnalyzer';
import { TauriDownloadEngine } from './tauriDownloadEngine';

/**
 * Candidate-runtime native smoke. It proves the approved CurrentTaskRuntime
 * composition (CurrentTauriMediaAnalyzer + TauriDownloadEngine +
 * createCurrentTaskRuntime) can drive the real Tauri/Rust/bundled yt-dlp chain
 * without switching the production App/store owner.
 */

export type CurrentTaskNativeSmokeScenarioName =
  | 'success'
  | 'native-failure'
  | 'active-cancel'
  | 'active-dispose';

export interface CurrentTaskNativeSmokeConfig {
  successUrl: string;
  slowUrl: string;
  failureDownloadDir: string;
  outputDir: string;
}

export interface CurrentTaskNativeSmokeEffectsSummary {
  successSounds: number;
  errorSounds: number;
  taskbarProjections: CurrentTaskbarProjection[];
}

export interface CurrentTaskNativeSmokeRowSnapshot {
  rowId: string;
  attemptId: string;
  status: TaskPresentationRow['status'];
  failureKind?: TaskPresentationRow['failureKind'];
  failureReason?: string;
  cancelRequested: boolean;
  progress: number;
  speed?: string;
  finalPath?: string;
}

export interface CurrentTaskNativeSmokeScenarioReport {
  name: CurrentTaskNativeSmokeScenarioName;
  passed: boolean;
  rowId: string;
  analysisAttemptId: string;
  attemptId: string;
  resultCount: number;
  resultOutcomes: string[];
  terminal: CurrentTaskNativeSmokeRowSnapshot | null;
  progressObserved: boolean;
  cancelRequestedDuringProgress: boolean;
  disposeResolved: boolean | null;
  effects: CurrentTaskNativeSmokeEffectsSummary;
  error?: string;
}

export interface CurrentTaskNativeSmokeReport {
  mode: 'current-task-runtime';
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  quietWindowMs: number;
  scenarioQuietMs: number;
  scenarios: CurrentTaskNativeSmokeScenarioReport[];
  error?: string;
}

export interface RunCurrentTaskNativeSmokeInput {
  config: CurrentTaskNativeSmokeConfig;
  createEngine?: (scenario: CurrentTaskNativeSmokeScenarioName) => DownloadEngine;
  createAnalyzer?: (scenario: CurrentTaskNativeSmokeScenarioName) => CurrentMediaAnalyzer;
  scenarioQuietMs?: number;
  finalQuietMs?: number;
  analysisTimeoutMs?: number;
  terminalTimeoutMs?: number;
  progressTimeoutMs?: number;
  flushTimeoutMs?: number;
  disposeTimeoutMs?: number;
}

export interface RecordingEffectsPort {
  port: CurrentTaskEffectsPort;
  snapshot(): CurrentTaskNativeSmokeEffectsSummary;
}

const SCENARIO_ORDER: readonly CurrentTaskNativeSmokeScenarioName[] = [
  'success',
  'native-failure',
  'active-cancel',
  'active-dispose',
];

const DEFAULT_SCENARIO_QUIET_MS = 750;
const DEFAULT_FINAL_QUIET_MS = 1_500;
const DEFAULT_ANALYSIS_TIMEOUT_MS = 45_000;
const DEFAULT_TERMINAL_TIMEOUT_MS = 120_000;
const DEFAULT_PROGRESS_TIMEOUT_MS = 60_000;
const DEFAULT_FLUSH_TIMEOUT_MS = 30_000;
const DEFAULT_DISPOSE_TIMEOUT_MS = 60_000;
const ROW_POLL_INTERVAL_MS = 50;

interface ResolvedRunOptions {
  config: CurrentTaskNativeSmokeConfig;
  createEngine: (scenario: CurrentTaskNativeSmokeScenarioName) => DownloadEngine;
  createAnalyzer: (scenario: CurrentTaskNativeSmokeScenarioName) => CurrentMediaAnalyzer;
  scenarioQuietMs: number;
  finalQuietMs: number;
  analysisTimeoutMs: number;
  terminalTimeoutMs: number;
  progressTimeoutMs: number;
  flushTimeoutMs: number;
  disposeTimeoutMs: number;
}

interface ScenarioExecution {
  name: CurrentTaskNativeSmokeScenarioName;
  rowId: string;
  analysisAttemptId: string;
  downloadAttemptId: string;
  error?: string;
  terminal: CurrentTaskNativeSmokeRowSnapshot | null;
  progressObserved: boolean;
  cancelRequestedDuringProgress: boolean;
  disposeResolved: boolean | null;
  effects: CurrentTaskNativeSmokeEffectsSummary;
  audit: NativeSmokeAudit | null;
  taskAudit: NativeSmokeTaskAudit | null;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return typeof error === 'string' ? error : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function snapshotRow(
  rows: readonly TaskPresentationRow[],
  rowId: string,
): CurrentTaskNativeSmokeRowSnapshot | null {
  const row = rows.find((candidate) => candidate.rowId === rowId);
  if (!row) {
    return null;
  }
  return {
    rowId: row.rowId,
    attemptId: row.id,
    status: row.status,
    ...(row.failureKind ? { failureKind: row.failureKind } : {}),
    ...(row.errorMsg ? { failureReason: row.errorMsg } : {}),
    cancelRequested: row.cancelRequested,
    progress: row.progress,
    ...(row.speed ? { speed: row.speed } : {}),
    ...(row.path ? { finalPath: row.path } : {}),
  };
}

async function waitForRow(
  runtime: CurrentTaskRuntime,
  rowId: string,
  predicate: (row: TaskPresentationRow) => boolean,
  timeoutMs: number,
  label: string,
): Promise<TaskPresentationRow> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'missing';

  for (;;) {
    const row = runtime.listRows().find((candidate) => candidate.rowId === rowId);
    if (row) {
      lastStatus = row.status;
      if (predicate(row)) {
        return row;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${label} (last status: ${lastStatus})`);
    }
    await delay(ROW_POLL_INTERVAL_MS);
  }
}

export function createRecordingEffectsPort(): RecordingEffectsPort {
  const taskbarProjections: CurrentTaskbarProjection[] = [];
  let successSounds = 0;
  let errorSounds = 0;

  const port: CurrentTaskEffectsPort = {
    playSuccess() {
      // Smoke-only recording port: never plays real audio.
      successSounds += 1;
    },
    playError() {
      errorSounds += 1;
    },
    setTaskbar(projection) {
      taskbarProjections.push({ ...projection });
    },
  };

  return {
    port,
    snapshot() {
      return {
        successSounds,
        errorSounds,
        taskbarProjections: taskbarProjections.map((projection) => ({ ...projection })),
      };
    },
  };
}

function resolveOptions(input: RunCurrentTaskNativeSmokeInput): ResolvedRunOptions {
  return {
    config: input.config,
    createEngine: input.createEngine ?? (() => new TauriDownloadEngine()),
    createAnalyzer: input.createAnalyzer ?? (() => new CurrentTauriMediaAnalyzer()),
    scenarioQuietMs: input.scenarioQuietMs ?? DEFAULT_SCENARIO_QUIET_MS,
    finalQuietMs: input.finalQuietMs ?? DEFAULT_FINAL_QUIET_MS,
    analysisTimeoutMs: input.analysisTimeoutMs ?? DEFAULT_ANALYSIS_TIMEOUT_MS,
    terminalTimeoutMs: input.terminalTimeoutMs ?? DEFAULT_TERMINAL_TIMEOUT_MS,
    progressTimeoutMs: input.progressTimeoutMs ?? DEFAULT_PROGRESS_TIMEOUT_MS,
    flushTimeoutMs: input.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS,
    disposeTimeoutMs: input.disposeTimeoutMs ?? DEFAULT_DISPOSE_TIMEOUT_MS,
  };
}

function failedExecution(
  name: CurrentTaskNativeSmokeScenarioName,
  error: string,
): ScenarioExecution {
  return {
    name,
    rowId: `${name}-row-1`,
    analysisAttemptId: `${name}-analysis-1`,
    downloadAttemptId: `${name}-download-1`,
    error,
    terminal: null,
    progressObserved: false,
    cancelRequestedDuringProgress: false,
    disposeResolved: null,
    effects: createRecordingEffectsPort().snapshot(),
    audit: null,
    taskAudit: null,
  };
}

async function runScenario(
  name: CurrentTaskNativeSmokeScenarioName,
  options: ResolvedRunOptions,
): Promise<ScenarioExecution> {
  const rowId = `${name}-row-1`;
  const analysisAttemptId = `${name}-analysis-1`;
  const downloadAttemptId = `${name}-download-1`;
  const url =
    name === 'success' || name === 'native-failure'
      ? options.config.successUrl
      : options.config.slowUrl;

  const effects = createRecordingEffectsPort();
  const engine = options.createEngine(name);
  const analyzer = options.createAnalyzer(name);

  let downloadDir: string | undefined = options.config.outputDir;
  let rowCounter = 0;
  let analysisCounter = 0;
  let downloadCounter = 0;

  const runtime = createCurrentTaskRuntime({
    engine,
    analyzer,
    environment: {
      getGlobalExtraArgs: () => ({}),
      getDownloadDir: () => downloadDir,
    },
    effectsPort: effects.port,
    createRowId: () => `${name}-row-${++rowCounter}`,
    createAnalysisAttemptId: () => `${name}-analysis-${++analysisCounter}`,
    createDownloadAttemptId: () => `${name}-download-${++downloadCounter}`,
  });

  const audit = createNativeSmokeAudit(engine);
  let progressObserved = false;
  let cancelRequestedDuringProgress = false;
  let resolveProgress: () => void = () => {};
  const progressSeen = new Promise<void>((resolve) => {
    resolveProgress = resolve;
  });

  const taskAudit = audit.registerTask(downloadAttemptId, () => {
    if (!progressObserved) {
      progressObserved = true;
      resolveProgress();
    }
    if (name === 'active-cancel' && !cancelRequestedDuringProgress) {
      cancelRequestedDuringProgress = true;
      runtime.actions.cancel(rowId);
    }
  });

  let error: string | undefined;
  let disposeResolved: boolean | null = null;
  let terminal: CurrentTaskNativeSmokeRowSnapshot | null = null;

  const captureTerminal = (): void => {
    terminal = snapshotRow(runtime.listRows(), rowId) ?? terminal;
  };

  try {
    runtime.actions.analyzeUrls([url]);
    const analyzed = await waitForRow(
      runtime,
      rowId,
      (row) => row.status === 'analyzed' || row.status === 'error',
      options.analysisTimeoutMs,
      `analysis of ${name}`,
    );
    captureTerminal();
    if (analyzed.status !== 'analyzed') {
      throw new Error(
        `Analysis for ${name} did not reach analyzed (status: ${analyzed.status})`,
      );
    }

    if (name === 'native-failure') {
      // Deterministic native failure: an existing regular file cannot be used
      // as yt-dlp's output directory, so the real execution must fail.
      downloadDir = options.config.failureDownloadDir;
    }

    runtime.actions.startDownload(rowId, 'video');

    if (name === 'active-dispose') {
      await withTimeout(progressSeen, options.progressTimeoutMs, `first native progress for ${name}`);
      captureTerminal();
      await withTimeout(runtime.dispose(), options.disposeTimeoutMs, `dispose for ${name}`);
      disposeResolved = true;
    } else {
      await withTimeout(
        taskAudit.firstResult,
        options.terminalTimeoutMs,
        `trusted terminal result for ${name}`,
      );
      await waitForRow(
        runtime,
        rowId,
        (row) => row.status === 'completed' || row.status === 'error',
        options.terminalTimeoutMs,
        `terminal row for ${name}`,
      );
      captureTerminal();
      await withTimeout(
        runtime.flushEffects(),
        options.flushTimeoutMs,
        `flushEffects for ${name}`,
      );
    }

    // Bounded quiet window before the runtime is disposed so an immediately
    // duplicated trusted result cannot evade the audit counter.
    await delay(options.scenarioQuietMs);
  } catch (caught) {
    error = toMessage(caught);
  } finally {
    captureTerminal();
    if (!(name === 'active-dispose' && disposeResolved === true)) {
      try {
        await withTimeout(runtime.dispose(), options.disposeTimeoutMs, `dispose for ${name}`);
      } catch (caught) {
        error ??= toMessage(caught);
      }
    }
  }

  return {
    name,
    rowId,
    analysisAttemptId,
    downloadAttemptId,
    ...(error !== undefined ? { error } : {}),
    terminal,
    progressObserved,
    cancelRequestedDuringProgress,
    disposeResolved,
    effects: effects.snapshot(),
    audit,
    taskAudit,
  };
}

function evaluateScenario(
  execution: ScenarioExecution,
  resultOutcomes: string[],
): boolean {
  if (execution.error !== undefined) {
    return false;
  }

  const { terminal, effects } = execution;

  switch (execution.name) {
    case 'success':
      return (
        resultOutcomes.length === 1 &&
        resultOutcomes[0] === 'Completed' &&
        terminal?.status === 'completed' &&
        typeof terminal.finalPath === 'string' &&
        terminal.finalPath.length > 0 &&
        execution.progressObserved &&
        effects.successSounds === 1 &&
        effects.errorSounds === 0
      );
    case 'native-failure':
      return (
        resultOutcomes.length === 1 &&
        resultOutcomes[0] === 'Failed' &&
        terminal?.status === 'error' &&
        terminal.failureKind === 'download' &&
        effects.successSounds === 0 &&
        effects.errorSounds === 1
      );
    case 'active-cancel':
      return (
        resultOutcomes.length === 1 &&
        resultOutcomes[0] === 'Cancelled' &&
        terminal?.status === 'error' &&
        terminal.failureKind === 'cancelled' &&
        execution.progressObserved &&
        execution.cancelRequestedDuringProgress &&
        effects.successSounds === 0 &&
        effects.errorSounds === 0
      );
    case 'active-dispose':
      return execution.disposeResolved === true && execution.progressObserved;
  }
}

function finalizeScenario(execution: ScenarioExecution): CurrentTaskNativeSmokeScenarioReport {
  const snapshot = execution.taskAudit?.snapshot();
  const updates = snapshot?.updates ?? [];
  const resultOutcomes = updates
    .filter((update) => update.type === 'result')
    .map((update) => update.outcome);

  return {
    name: execution.name,
    passed: evaluateScenario(execution, resultOutcomes),
    rowId: execution.rowId,
    analysisAttemptId: execution.analysisAttemptId,
    attemptId: execution.terminal?.attemptId ?? execution.downloadAttemptId,
    resultCount: resultOutcomes.length,
    resultOutcomes,
    terminal: execution.terminal,
    progressObserved: execution.progressObserved,
    cancelRequestedDuringProgress: execution.cancelRequestedDuringProgress,
    disposeResolved: execution.disposeResolved,
    effects: execution.effects,
    ...(execution.error !== undefined ? { error: execution.error } : {}),
  };
}

export async function runCurrentTaskNativeSmoke(
  input: RunCurrentTaskNativeSmokeInput,
): Promise<CurrentTaskNativeSmokeReport> {
  const startedAt = new Date().toISOString();
  const options = resolveOptions(input);
  const executions: ScenarioExecution[] = [];

  // Sequential scenarios: exactly one candidate runtime may be active at a time.
  for (const name of SCENARIO_ORDER) {
    try {
      executions.push(await runScenario(name, options));
    } catch (caught) {
      executions.push(failedExecution(name, toMessage(caught)));
    }
  }

  // Bounded final quiet window: every scenario audit stays subscribed until
  // after this window so a delayed duplicate terminal result is still counted.
  await delay(options.finalQuietMs);

  const scenarios = executions.map((execution) => finalizeScenario(execution));
  for (const execution of executions) {
    execution.audit?.dispose();
  }

  return {
    mode: 'current-task-runtime',
    startedAt,
    finishedAt: new Date().toISOString(),
    passed: scenarios.every((scenario) => scenario.passed),
    quietWindowMs: options.finalQuietMs,
    scenarioQuietMs: options.scenarioQuietMs,
    scenarios,
  };
}

function readConfigFromEnv(): CurrentTaskNativeSmokeConfig {
  const successUrl = import.meta.env.VITE_CURRENT_TASK_SMOKE_SUCCESS_URL as
    | string
    | undefined;
  const slowUrl = import.meta.env.VITE_CURRENT_TASK_SMOKE_SLOW_URL as string | undefined;
  const failureDownloadDir = import.meta.env.VITE_CURRENT_TASK_SMOKE_FAILURE_DIR as
    | string
    | undefined;
  const outputDir = import.meta.env.VITE_CURRENT_TASK_SMOKE_OUTPUT_DIR as
    | string
    | undefined;

  const missing = [
    ['VITE_CURRENT_TASK_SMOKE_SUCCESS_URL', successUrl],
    ['VITE_CURRENT_TASK_SMOKE_SLOW_URL', slowUrl],
    ['VITE_CURRENT_TASK_SMOKE_FAILURE_DIR', failureDownloadDir],
    ['VITE_CURRENT_TASK_SMOKE_OUTPUT_DIR', outputDir],
  ]
    .filter(([, value]) => typeof value !== 'string' || value.length === 0)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Current task native smoke is missing config: ${missing.join(', ')}`);
  }

  return {
    successUrl: successUrl as string,
    slowUrl: slowUrl as string,
    failureDownloadDir: failureDownloadDir as string,
    outputDir: outputDir as string,
  };
}

function createFailedReport(startedAt: string, error: string): CurrentTaskNativeSmokeReport {
  return {
    mode: 'current-task-runtime',
    startedAt,
    finishedAt: new Date().toISOString(),
    passed: false,
    quietWindowMs: 0,
    scenarioQuietMs: 0,
    scenarios: [],
    error,
  };
}

async function persistSmokeReport(report: CurrentTaskNativeSmokeReport): Promise<void> {
  const response = await fetch('/__ytdl_v2_smoke_report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (!response.ok) {
    throw new Error(`Failed to persist current task native smoke report: ${response.status}`);
  }
}

export async function runCurrentTaskNativeSmokeFromEnv(): Promise<void> {
  const startedAt = new Date().toISOString();
  let report: CurrentTaskNativeSmokeReport;

  try {
    const config = readConfigFromEnv();
    report = await runCurrentTaskNativeSmoke({ config });
  } catch (error) {
    report = createFailedReport(startedAt, toMessage(error));
  }

  let persisted = true;
  try {
    await persistSmokeReport(report);
  } catch (error) {
    persisted = false;
    console.error('[CurrentTaskNativeSmoke] Failed to persist report:', error);
  }

  document.body.textContent =
    report.passed && persisted
      ? 'CurrentTaskRuntime native smoke PASS'
      : 'CurrentTaskRuntime native smoke FAILED';

  await exit(report.passed && persisted ? 0 : 1);
}
