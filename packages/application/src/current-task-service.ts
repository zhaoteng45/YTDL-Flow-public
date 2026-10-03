import type {
  CaptureContextFailureCode,
  CapturedMediaKind,
  CurrentAnalysisMedia,
  CurrentCapturedTaskRef,
  CurrentDownloadCommand,
  CurrentDownloadFormat,
  CurrentExtraArgs,
  CurrentTaskRow,
  TaskPayload,
} from '../../contracts/src';
import type {
  CurrentAnalysisHandle,
  CurrentAnalysisOutcome,
} from './current-analysis-service';
import { CurrentAnalysisService } from './current-analysis-service';
import { resolveCurrentTaskActions } from './current-task-projection';
import { projectCurrentExecution } from './current-task-projection';
import { stripCaptureForbiddenExtraArgs } from './capture-extra-args';
import { classifyCaptureFailure } from './capture-failure';
import type { CancelCommandResult } from './download-service';

/** Captured import input: opaque context id plus sanitized display metadata. */
export interface CapturedAnalysisInput {
  captureContextId: string;
  siteLabel: string;
  mediaKind: CapturedMediaKind;
}

/**
 * Display label for a captured row. It is deliberately not URL-shaped so it can
 * never be confused with, or fall back to, an executable address.
 */
export function buildCapturedDisplayLabel(input: CapturedAnalysisInput): string {
  const site = input.siteLabel.trim();
  return site ? `capture:${site}` : 'capture';
}

export interface CurrentTaskDownloadPort {
  createTask(command: CurrentDownloadCommand): Promise<TaskPayload>;
  retryTask(rowId: string): Promise<TaskPayload | undefined>;
  cancelTask(rowId: string): Promise<CancelCommandResult>;
  removeTask(rowId: string): boolean;
}

export interface CurrentTaskQueryPort {
  getTaskByRowId(rowId: string): TaskPayload | undefined;
}

export interface CurrentTaskExecution {
  downloads: CurrentTaskDownloadPort;
  query: CurrentTaskQueryPort;
  subscribeTasks?: (listener: (task: TaskPayload) => void) => () => void;
  dispose?: () => void;
}

export type CurrentTaskRowListener = (rows: readonly CurrentTaskRow[]) => void;

interface AnalysisCatalogRow {
  rowId: string;
  attemptId: string;
  sourceUrl: string;
  status: 'analyzing' | 'analyzed' | 'error';
  orderKey: number;
  metadata?: CurrentAnalysisMedia;
  failureKind?: 'analysis' | 'cancelled';
  failureReason?: string;
  logFailureHint?: string;
  capture?: CurrentCapturedTaskRef;
  captureFailureCode?: CaptureContextFailureCode;
  selectedFormat?: CurrentDownloadFormat;
  baseExtraArgsSnapshot?: CurrentExtraArgs;
  taskOverrideArgs?: Partial<CurrentExtraArgs>;
  activeDownloadCookies?: string;
  logs: string[];
  debugCommand?: string;
}

function cloneMedia(media: CurrentAnalysisMedia | undefined): CurrentAnalysisMedia | undefined {
  if (!media) return undefined;
  return { ...media };
}

export const BROWSER_COOKIE_NAMES = new Set([
  'chrome',
  'firefox',
  'edge',
  'brave',
  'vivaldi',
  'opera',
  'safari',
  'chromium',
]);

const SPECIFIC_DATABASE_LOCK_SIGNALS = [
  'cookies database is locked',
];

const BROWSER_COOKIE_CONTEXT_SIGNALS = [
  'cookie',
  'cookies',
  'cookie database',
  'browser profile',
  'chrome',
  'chromium',
  'edge',
  'firefox',
  'brave',
  'vivaldi',
  'opera',
  'safari',
];

const GENERAL_COOKIE_LOCK_SIGNALS = [
  'database is locked',
  'used by another process',
  'being used by another process',
  'the process cannot access the file',
  'cannot access the file',
  'access is denied',
  'permission denied',
  'winerror 32',
];

export const BROWSER_COOKIE_LOCK_HINT = '检测到浏览器未关闭或占用 Cookies，请关闭浏览器后重试';

export function getBrowserCookieLockHint(line: string, cookiesValue?: string): string | undefined {
  if (!cookiesValue || !BROWSER_COOKIE_NAMES.has(cookiesValue.trim().toLowerCase())) return undefined;
  const normalizedLine = line.toLowerCase();

  if (SPECIFIC_DATABASE_LOCK_SIGNALS.some((signal) => normalizedLine.includes(signal))) {
    return BROWSER_COOKIE_LOCK_HINT;
  }

  const hasContext = BROWSER_COOKIE_CONTEXT_SIGNALS.some((ctx) => normalizedLine.includes(ctx));
  if (!hasContext) return undefined;

  const hasLockSignal = GENERAL_COOKIE_LOCK_SIGNALS.some((signal) => normalizedLine.includes(signal));
  if (!hasLockSignal) return undefined;

  return BROWSER_COOKIE_LOCK_HINT;
}

export class CurrentTaskService {
  private readonly catalog = new Map<string, AnalysisCatalogRow>();
  private readonly rowOrder: string[] = [];
  private readonly rowListeners = new Set<CurrentTaskRowListener>();
  private readonly unsubscribeExecution?: () => void;
  private orderSequence = 0;
  private isDisposed = false;

  constructor(
    private readonly analysis: CurrentAnalysisService,
    private readonly createRowId: () => string = () => crypto.randomUUID(),
    private readonly execution?: CurrentTaskExecution,
  ) {
    this.unsubscribeExecution = this.execution?.subscribeTasks?.((task) => {
      const row = this.catalog.get(task.rowId ?? task.id);
      if (row) row.orderKey = this.nextOrderKey();
      this.publishRows();
    });
  }

  analyze(sourceUrl: string): CurrentAnalysisHandle {
    this.assertActive();
    const rowId = this.createRowId();
    const handle = this.analysis.startAnalysis(rowId, sourceUrl);
    this.catalog.set(rowId, {
      rowId,
      attemptId: handle.attemptId,
      sourceUrl,
      status: 'analyzing',
      orderKey: this.nextOrderKey(),
      baseExtraArgsSnapshot: { cookies: handle.extraArgs.cookies },
      logs: [],
    });
    this.rowOrder.unshift(rowId);
    this.publishRows();
    return this.bindAnalysisResult(handle);
  }

  /**
   * Captured-input seam. A captured resource becomes a normal task row; there
   * is no second task type or state machine. Only the opaque context id and
   * sanitized display metadata cross this boundary.
   */
  analyzeCaptured(input: CapturedAnalysisInput): CurrentAnalysisHandle {
    this.assertActive();
    const rowId = this.createRowId();
    const handle = this.analysis.startCapturedAnalysis(rowId, input.captureContextId);
    this.catalog.set(rowId, {
      rowId,
      attemptId: handle.attemptId,
      sourceUrl: buildCapturedDisplayLabel(input),
      capture: {
        contextId: input.captureContextId,
        siteLabel: input.siteLabel,
        mediaKind: input.mediaKind,
      },
      status: 'analyzing',
      orderKey: this.nextOrderKey(),
      logs: [],
    });
    this.rowOrder.unshift(rowId);
    this.publishRows();
    return this.bindAnalysisResult(handle);
  }

  reanalyze(rowId: string): CurrentAnalysisHandle | undefined {
    this.assertActive();
    const row = this.catalog.get(rowId);
    if (
      !row ||
      !this.getRow(rowId)?.actions.canReanalyze
    ) return undefined;

    const handle = row.capture
      ? this.analysis.startCapturedAnalysis(rowId, row.capture.contextId)
      : this.analysis.reanalyze(rowId, row.sourceUrl);
    row.attemptId = handle.attemptId;
    row.status = 'analyzing';
    row.metadata = undefined;
    row.failureKind = undefined;
    row.failureReason = undefined;
    row.logFailureHint = undefined;
    row.baseExtraArgsSnapshot = { cookies: handle.extraArgs.cookies };
    row.selectedFormat = undefined;
    row.taskOverrideArgs = undefined;
    row.activeDownloadCookies = undefined;
    row.logs = [];
    row.debugCommand = undefined;
    row.orderKey = this.nextOrderKey();
    this.publishRows();

    return this.bindAnalysisResult(handle);
  }

  /** A pasted group is prepended in source order, matching the current product. */
  analyzeMany(sourceUrls: readonly string[]): readonly CurrentAnalysisHandle[] {
    this.assertActive();
    const handles = sourceUrls.map((sourceUrl) => this.analyze(sourceUrl));
    this.rowOrder.splice(0, handles.length, ...handles.map((handle) => handle.rowId));
    this.publishRows();
    return handles;
  }

  async start(
    rowId: string,
    format: CurrentDownloadFormat = 'video',
    taskOverrideArgs?: Partial<CurrentExtraArgs>,
  ): Promise<CurrentTaskRow | undefined> {
    this.assertActive();
    const row = this.catalog.get(rowId);
    if (!row || !this.getRow(rowId)?.actions.canStartDownload || !this.execution) return undefined;

    const selectedFormat = format;
    const overrideSnapshot = taskOverrideArgs ? { ...taskOverrideArgs } : undefined;
    row.logFailureHint = undefined;

    let effectiveExtraArgs: Partial<CurrentExtraArgs>;
    if (row.capture) {
      // Capture identity is a closed set: never inherit global cookies, proxy,
      // PO token, visitor data, player client or user agent.
      row.activeDownloadCookies = undefined;
      effectiveExtraArgs = stripCaptureForbiddenExtraArgs(overrideSnapshot);
    } else {
      const effectiveCookies =
        taskOverrideArgs?.cookies !== undefined
          ? taskOverrideArgs.cookies
          : row.baseExtraArgsSnapshot?.cookies;
      row.activeDownloadCookies = effectiveCookies;
      effectiveExtraArgs = {
        ...(row.baseExtraArgsSnapshot ?? {}),
        ...(overrideSnapshot ?? {}),
        ...(effectiveCookies !== undefined ? { cookies: effectiveCookies } : {}),
      };
    }

    const pending = this.execution.downloads.createTask({
      rowId,
      sourceUrl: row.sourceUrl,
      format: selectedFormat,
      taskOverrideArgs: effectiveExtraArgs,
      ...(row.capture ? { captureContextId: row.capture.contextId } : {}),
    });

    const attached = this.execution.query.getTaskByRowId(rowId);
    if (attached) {
      row.selectedFormat = selectedFormat;
      row.taskOverrideArgs = overrideSnapshot;
      this.analysis.forget(rowId);
      this.publishRows();
    }

    try {
      await pending;
    } catch (error) {
      if (!attached) {
        row.selectedFormat = undefined;
        row.taskOverrideArgs = undefined;
        row.activeDownloadCookies = undefined;
      }
      throw error;
    }

    if (!attached) {
      const lateAttachment = this.execution.query.getTaskByRowId(rowId);
      if (!lateAttachment) {
        throw new Error(`Current download start completed without an execution for row '${rowId}'`);
      }
      row.selectedFormat = selectedFormat;
      row.taskOverrideArgs = overrideSnapshot;
      this.analysis.forget(rowId);
      this.publishRows();
    }

    return this.getRow(rowId);
  }

  async retry(rowId: string): Promise<CurrentTaskRow | undefined> {
    this.assertActive();
    const row = this.getRow(rowId);
    if (row?.actions.canReanalyze) {
      await this.reanalyze(rowId)?.result;
    } else if (row?.actions.canRetryDownload) {
      const retried = await this.execution?.downloads.retryTask(rowId);
      if (retried) {
        const catalogRow = this.catalog.get(rowId);
        if (catalogRow) {
          catalogRow.logFailureHint = undefined;
          catalogRow.logs = [];
          catalogRow.debugCommand = undefined;
          this.publishRows();
        }
      }
    }
    return this.getRow(rowId);
  }

  async cancel(rowId: string): Promise<CancelCommandResult> {
    this.assertActive();
    const row = this.catalog.get(rowId);
    if (!row || !this.getRow(rowId)?.actions.canCancel) {
      return { outcome: { type: 'not-cancellable' } };
    }
    if (this.execution?.query.getTaskByRowId(rowId)) {
      return this.execution.downloads.cancelTask(rowId);
    }
    row.status = 'error';
    row.failureKind = 'cancelled';
    row.orderKey = this.nextOrderKey();
    this.analysis.forget(rowId);
    this.publishRows();
    return { outcome: { type: 'cancelled' } };
  }

  ingestLog(attemptId: string, line: string): boolean {
    this.assertActive();
    const row = this.findRowForAttempt(attemptId);
    if (!row) return false;
    row.logs.push(line);
    const projected = this.projectRow(row);
    if (line.startsWith('[ERR] ') && !projected.cancelRequested) {
      const execution = this.execution?.query.getTaskByRowId(row.rowId);
      const isDownloadAttempt = execution !== undefined && (execution.attemptId ?? execution.id) === attemptId;
      const effectiveCookies = isDownloadAttempt
        ? row.activeDownloadCookies
        : row.baseExtraArgsSnapshot?.cookies;
      const hint = getBrowserCookieLockHint(line, effectiveCookies);
      if (hint) row.logFailureHint = hint;
    }
    const status = projected.status;
    if (status === 'pending' || status === 'downloading' || status === 'processing') {
      row.orderKey = this.nextOrderKey();
    }
    this.publishRows();
    return true;
  }

  setDebugCommand(attemptId: string, command: string): boolean {
    this.assertActive();
    const row = this.findRowForAttempt(attemptId);
    if (!row) return false;
    row.debugCommand = command;
    const status = this.projectRow(row).status;
    if (status === 'pending' || status === 'downloading' || status === 'processing') {
      row.orderKey = this.nextOrderKey();
    }
    this.publishRows();
    return true;
  }

  getRow(rowId: string): CurrentTaskRow | undefined {
    const row = this.catalog.get(rowId);
    return row ? this.projectRow(row) : undefined;
  }

  listRows(): readonly CurrentTaskRow[] {
    return this.rowOrder
      .map((rowId) => this.catalog.get(rowId))
      .filter((row): row is AnalysisCatalogRow => row !== undefined)
      .map((row) => this.projectRow(row));
  }

  subscribeRows(listener: CurrentTaskRowListener): () => void {
    this.assertActive();
    this.rowListeners.add(listener);
    listener(this.listRows());
    return () => {
      this.rowListeners.delete(listener);
    };
  }

  /** Administrative removal is allowed in any phase; canRemove is the UI affordance. */
  remove(rowId: string): boolean {
    this.assertActive();
    if (!this.catalog.has(rowId)) return false;
    this.analysis.forget(rowId);
    const task = this.execution?.query.getTaskByRowId(rowId);
    if (task) this.execution?.downloads.removeTask(rowId);
    this.catalog.delete(rowId);
    const index = this.rowOrder.indexOf(rowId);
    if (index !== -1) this.rowOrder.splice(index, 1);
    this.publishRows();
    return true;
  }


  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.unsubscribeExecution?.();
    this.rowListeners.clear();
    this.analysis.dispose();
    this.execution?.dispose?.();
    this.catalog.clear();
    this.rowOrder.length = 0;
  }

  private bindAnalysisResult(handle: CurrentAnalysisHandle): CurrentAnalysisHandle {
    const result = handle.result.then((outcome) => {
      this.commitAnalysisOutcome(outcome);
      return outcome;
    });
    return { ...handle, result };
  }

  private commitAnalysisOutcome(outcome: CurrentAnalysisOutcome): void {
    if (this.isDisposed || outcome.status === 'stale') return;

    const row = this.catalog.get(outcome.rowId);
    if (!row || row.attemptId !== outcome.attemptId || row.status !== 'analyzing') {
      return;
    }

    if (outcome.status === 'analyzed') {
      row.status = 'analyzed';
      row.captureFailureCode = undefined;
      row.metadata = cloneMedia(outcome.media);
      row.baseExtraArgsSnapshot = { cookies: outcome.extraArgs.cookies };
      if (!row.capture && outcome.media.smartDecision) {
        const decision = { ...outcome.media.smartDecision };
        row.baseExtraArgsSnapshot = {
          ...row.baseExtraArgsSnapshot,
          playerClient: decision.playerClient,
          smartDecision: decision,
          ...(decision.authMode === 'anonymous' ? { cookies: '' } : {}),
          ...(decision.clearSessionInputs ? { poToken: '', visitorData: '' } : {}),
        };
      }
      row.failureKind = undefined;
      row.failureReason = undefined;
      row.logFailureHint = undefined;
      row.orderKey = this.nextOrderKey();
      this.publishRows();
      return;
    }

    row.status = 'error';
    row.failureKind = 'analysis';
    row.failureReason = outcome.error.message;
    row.captureFailureCode = row.capture
      ? classifyCaptureFailure(outcome.error.message)
      : undefined;
    row.orderKey = this.nextOrderKey();
    this.publishRows();
  }

  private publishRows(): void {
    if (this.isDisposed || this.rowListeners.size === 0) return;
    const rows = this.listRows();
    for (const listener of this.rowListeners) {
      try {
        listener(rows);
      } catch (error) {
        console.error('[CurrentTaskService] Row listener failed:', error);
      }
    }
  }

  private findRowForAttempt(attemptId: string): AnalysisCatalogRow | undefined {
    for (const rowId of this.rowOrder) {
      const row = this.catalog.get(rowId);
      if (!row) continue;
      const execution = this.execution?.query.getTaskByRowId(rowId);
      const currentAttemptId = execution?.attemptId ?? execution?.id ?? row.attemptId;
      if (currentAttemptId === attemptId) return row;
    }
    return undefined;
  }

  private nextOrderKey(): number {
    return ++this.orderSequence;
  }

  private assertActive(): void {
    if (this.isDisposed) {
      throw new Error('CurrentTaskService is disposed');
    }
  }

  private projectRow(row: AnalysisCatalogRow): CurrentTaskRow {
    const metadata = cloneMedia(row.metadata);
    const execution = this.execution?.query.getTaskByRowId(row.rowId);
    if (execution) {
      const projectedExecution = projectCurrentExecution(execution);
      return {
        ...projectedExecution,
        orderKey: row.orderKey,
        ...(row.logFailureHint ? { failureReason: row.logFailureHint } : {}),
        ...(metadata ? { metadata } : {}),
        ...(row.capture ? { capture: { ...row.capture } } : {}),
        selectedFormat: row.selectedFormat,
        ...(row.taskOverrideArgs ? { taskOverrideArgs: { ...row.taskOverrideArgs } } : {}),
        logs: [...row.logs],
        ...(row.debugCommand ? { debugCommand: row.debugCommand } : {}),
      };
    }
    return {
      rowId: row.rowId,
      attemptId: row.attemptId,
      sourceUrl: row.sourceUrl,
      status: row.status,
      orderKey: row.orderKey,
      ...(metadata ? { metadata } : {}),
      ...(row.capture ? { capture: { ...row.capture } } : {}),
      ...(row.failureKind ? { failureKind: row.failureKind } : {}),
      ...(row.captureFailureCode ? { failureCode: row.captureFailureCode } : {}),
      ...((row.logFailureHint ?? row.failureReason) ? { failureReason: row.logFailureHint ?? row.failureReason } : {}),
      cancelRequested: false,
      progress: 0,
      logs: [...row.logs],
      ...(row.debugCommand ? { debugCommand: row.debugCommand } : {}),
      actions: resolveCurrentTaskActions({
        status: row.status,
        failureKind: row.failureKind,
      }),
    };
  }
}
