import type {
  DownloadStartRequest,
  EngineProgressUpdate,
  EngineResultOutcome,
  EngineResultUpdate,
  EngineUpdate,
  ErrorPayload,
  TaskPayload,
} from '../../contracts/src';
import { DownloadQueue, DownloadStatus, DownloadTask } from '../../domain/src';
import { isDownloadStartError, type DownloadEngine } from './download-engine';
import { classifyCaptureFailure } from './capture-failure';
import { toErrorPayload } from './error-payload';
import { toTaskPayload } from './task-payload';

type TaskIdFactory = () => string;
export type DownloadStartOptions = Partial<Omit<DownloadStartRequest, 'taskId' | 'sourceUrl'>>;
export type DownloadStartOptionsProvider = () => DownloadStartOptions;
export type DownloadTaskListener = (task: TaskPayload) => void;

interface TaskCoordination {
  optionsProvider?: DownloadStartOptionsProvider;
  orderSeq: number;
  dispatched?: boolean;
  retired?: boolean;
  startSettled?: boolean;
  startPromise?: Promise<void>;
  localSettlement?: Promise<void>;
  startResolved: boolean;
  lateStartCleanupRequired?: boolean;
  cleanupSlotHeld?: boolean;
  pendingTimer?: ReturnType<typeof setTimeout>;
  deferredSettlement?: Promise<CancelCommandOutcome>;
}

export interface DownloadServiceOptions {
  maxConcurrent?: number;
  settlementDelayMs?: number;
  pendingStartTimeoutMs?: number;
}

export type CancelCommandOutcome =
  | { type: 'not-cancellable' }
  | { type: 'cancelled' }
  | { type: 'cancel-requested' }
  | { type: 'cancel-rejected'; error: ErrorPayload };

export interface CancelCommandResult {
  /** Outcome known when the cancel command itself returns. */
  outcome: CancelCommandOutcome;
  /**
   * Present only when cancellation was deferred until a pending start settles.
   * Never rejects: a delayed engine rejection resolves as `cancel-rejected`
   * so the caller can observe it without an unhandled rejection.
   */
  settlement?: Promise<CancelCommandOutcome>;
}

export class DownloadService {
  private readonly coordination = new Map<string, TaskCoordination>();
  private readonly unsubscribeEngine?: () => void;
  private readonly maxConcurrent: number;
  private readonly settlementDelayMs: number;
  private readonly pendingStartTimeoutMs: number;
  private readonly taskListeners = new Set<DownloadTaskListener>();
  private orderSequence = 0;
  private scheduling = false;
  private rescheduleRequested = false;
  private rescheduleTimer: ReturnType<typeof setTimeout> | null = null;
  private isDisposed = false;

  constructor(
    private readonly queue: DownloadQueue,
    private readonly engine: DownloadEngine,
    private readonly createTaskId: TaskIdFactory = () => crypto.randomUUID(),
    options: DownloadServiceOptions = {},
  ) {
    this.maxConcurrent = options.maxConcurrent ?? 1;
    this.settlementDelayMs = options.settlementDelayMs ?? 500;
    this.pendingStartTimeoutMs = options.pendingStartTimeoutMs ?? 60_000;
    this.unsubscribeEngine = this.engine.subscribeUpdates((update: EngineUpdate) => {
      this.handleEngineUpdate(update);
    });
  }

  subscribeTasks(listener: DownloadTaskListener): () => void {
    this.assertActive();
    this.taskListeners.add(listener);
    return () => {
      this.taskListeners.delete(listener);
    };
  }

  async createTask(
    sourceUrl: string,
    options?: DownloadStartOptions | DownloadStartOptionsProvider,
    identity?: { rowId?: string; captureContextId?: string },
  ): Promise<TaskPayload> {
    this.assertActive();
    const taskId = this.createTaskId();
    const rowId = identity?.rowId ?? taskId;
    if (this.queue.getByRowId(rowId)) {
      throw new Error(`Cannot create task: duplicate rowId '${rowId}'`);
    }

    const task = new DownloadTask({
      rowId,
      attemptId: taskId,
      sourceUrl,
      ...(identity?.captureContextId
        ? { captureContextId: identity.captureContextId }
        : {}),
    });

    task.transitionTo(DownloadStatus.Queued);
    this.queue.add(task);

    const optionsProvider: DownloadStartOptionsProvider =
      typeof options === 'function'
        ? options
        : () => ({
            ...options,
            ...(options?.extraArgs ? { extraArgs: { ...options.extraArgs } } : {}),
          });

    const coord: TaskCoordination = {
      optionsProvider,
      orderSeq: ++this.orderSequence,
      startResolved: false,
    };
    this.coordination.set(taskId, coord);
    this.publishTask(task);
    this.scheduleNow();

    return toTaskPayload(task);
  }

  async retryTask(rowId: string): Promise<TaskPayload | undefined> {
    this.assertActive();
    const previous = this.queue.getByRowId(rowId);
    if (!previous) return undefined;
    if (
      previous.getStatus() !== DownloadStatus.Failed &&
      previous.getStatus() !== DownloadStatus.Cancelled
    ) {
      return undefined;
    }

    const previousCoord = this.coordination.get(previous.attemptId);
    if (!previousCoord || previousCoord.retired) return undefined;
    this.clearPendingTimer(previousCoord);

    const attemptId = this.createTaskId();
    const task = new DownloadTask({
      rowId,
      attemptId,
      sourceUrl: previous.sourceUrl,
      ...(previous.captureContextId
        ? { captureContextId: previous.captureContextId }
        : {}),
    });
    task.transitionTo(DownloadStatus.Queued);

    const coord: TaskCoordination = {
      optionsProvider: previousCoord.optionsProvider,
      orderSeq: ++this.orderSequence,
      startResolved: false,
    };

    this.queue.replaceByRowId(task);
    this.retireAttempt(previous.attemptId);
    this.coordination.set(attemptId, coord);
    this.publishTask(task);
    this.scheduleNow();

    return toTaskPayload(task);
  }

  async cancelTask(taskId: string): Promise<CancelCommandResult> {
    this.assertActive();
    const task = this.queue.get(taskId);
    if (!task || task.isTerminal()) {
      return { outcome: { type: 'not-cancellable' } };
    }

    const coord = this.coordination.get(taskId);

    // 1. Cancel before start was dispatched (no coordination / startPromise)
    if (!coord || !coord.dispatched) {
      task.requestCancellation();
      task.transitionTo(DownloadStatus.Cancelled);
      this.publishTask(task);
      return { outcome: { type: 'cancelled' } };
    }

    // Record cancellation intent on the domain task; trusted terminal settlement remains separate.
    task.requestCancellation();
    this.publishTask(task);

    // 2. Start is still pending: report the request immediately and expose
    //    the delayed settlement so a rejection stays observable.
    if (!coord.startResolved) {
      const startSettlement = coord.localSettlement ?? coord.startPromise;
      if (!startSettlement) {
        task.clearCancellationRequest();
        this.publishTask(task);
        return { outcome: { type: 'not-cancellable' } };
      }
      coord.deferredSettlement ??= this.createDeferredSettlement(
        taskId,
        startSettlement,
      );
      return {
        outcome: { type: 'cancel-requested' },
        settlement: coord.deferredSettlement,
      };
    }

    // 3. Start was already accepted/resolved
    try {
      await this.engine.cancel(taskId);
      return { outcome: { type: 'cancel-requested' } };
    } catch (err) {
      task.clearCancellationRequest();
      this.publishTask(task);
      return {
        outcome: { type: 'cancel-rejected', error: toErrorPayload(err, 'cancel-rejected') },
      };
    }
  }

  removeTask(rowId: string): boolean {
    this.assertActive();
    const task = this.queue.getByRowId(rowId);
    if (!task) return false;

    this.retireAttempt(task.attemptId);
    this.scheduleNow();
    return true;
  }

  /** Detach presentation ownership; dispatched work stays controlled until terminal. */
  retireAttempt(attemptId: string): void {
    const coord = this.coordination.get(attemptId);
    if (!coord) return;
    coord.retired = true;
    coord.optionsProvider = undefined;
    this.finishRetirement(attemptId, coord);
  }

  private classifyCaptureFailureFor(task: DownloadTask, message: string | undefined): void {
    const code = classifyCaptureFailure(message);
    if (code) {
      task.setCaptureFailureCode(code);
    }
  }

  private finishRetirement(attemptId: string, coord: TaskCoordination): void {
    if (!coord.retired) return;
    const task = this.queue.get(attemptId);
    if (coord.dispatched && task && !task.isTerminal()) return;
    this.clearPendingTimer(coord);
    this.queue.remove(attemptId);
    // A cleanup-held execution still owns the real native slot even after its
    // presentation row has been retired/replaced. Keep coordination until a
    // trusted terminal result or definitive start rejection proves that slot is free.
    if (coord.cleanupSlotHeld) return;
    // A late start can still require compensation. Its closure owns that obligation.
    if (!coord.dispatched || coord.startSettled) {
      if (this.coordination.get(attemptId) === coord) this.coordination.delete(attemptId);
      coord.startPromise = undefined;
      coord.localSettlement = undefined;
      coord.deferredSettlement = undefined;
    }
  }

  private publishTask(task: DownloadTask): void {
    if (this.taskListeners.size === 0) return;
    const payload = toTaskPayload(task);
    for (const listener of this.taskListeners) {
      try {
        listener(payload);
      } catch (error) {
        console.error('[DownloadService] Task listener failed:', error);
      }
    }
  }

  private assertActive(): void {
    if (this.isDisposed) throw new Error('DownloadService is disposed');
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    if (this.rescheduleTimer) {
      clearTimeout(this.rescheduleTimer);
      this.rescheduleTimer = null;
    }
    if (this.unsubscribeEngine) {
      this.unsubscribeEngine();
    }
    for (const coord of this.coordination.values()) {
      this.clearPendingTimer(coord);
      coord.optionsProvider = undefined;
    }
    this.coordination.clear();
    this.taskListeners.clear();
  }

  private scheduleNow(): void {
    if (this.isDisposed) return;
    if (this.scheduling) {
      this.rescheduleRequested = true;
      return;
    }

    this.scheduling = true;
    try {
      const activeCount = this.queue
        .all()
        .filter((task) => {
          const status = task.getStatus();
          return (
            status === DownloadStatus.Pending ||
            status === DownloadStatus.Downloading ||
            status === DownloadStatus.Processing
          );
        }).length;
      const cleanupHeldCount = [...this.coordination.values()]
        .filter((coord) => coord.cleanupSlotHeld)
        .length;
      const openSlots = Math.max(0, this.maxConcurrent - activeCount - cleanupHeldCount);
      if (openSlots === 0) return;

      const queued = this.queue
        .all()
        .filter((task) => task.getStatus() === DownloadStatus.Queued)
        .sort((a, b) => {
          const aOrder = this.coordination.get(a.attemptId)?.orderSeq ?? Number.MAX_SAFE_INTEGER;
          const bOrder = this.coordination.get(b.attemptId)?.orderSeq ?? Number.MAX_SAFE_INTEGER;
          return aOrder - bOrder;
        })
        .slice(0, openSlots);

      for (const task of queued) {
        const coord = this.coordination.get(task.attemptId);
        if (coord) this.dispatch(task, coord);
      }
    } finally {
      this.scheduling = false;
      if (this.rescheduleRequested) {
        this.rescheduleRequested = false;
        this.scheduleNow();
      }
    }
  }

  private scheduleAfterSettlement(): void {
    if (this.isDisposed) return;
    if (this.rescheduleTimer) clearTimeout(this.rescheduleTimer);
    this.rescheduleTimer = setTimeout(() => {
      this.rescheduleTimer = null;
      this.scheduleNow();
    }, this.settlementDelayMs);
  }

  private releaseCleanupSlot(attemptId: string, coord: TaskCoordination): void {
    if (!coord.cleanupSlotHeld) return;
    coord.cleanupSlotHeld = false;
    this.scheduleAfterSettlement();
    this.finishRetirement(attemptId, coord);
  }

  private clearPendingTimer(coord: TaskCoordination): void {
    if (coord.pendingTimer) {
      clearTimeout(coord.pendingTimer);
      coord.pendingTimer = undefined;
    }
  }

  private handlePendingStartTimeout(attemptId: string): void {
    const coord = this.coordination.get(attemptId);
    if (!coord) return;
    this.clearPendingTimer(coord);

    const task = this.queue.get(attemptId);
    if (!task || task.getStatus() !== DownloadStatus.Pending) return;

    if (!coord.startResolved) {
      coord.lateStartCleanupRequired = true;
    }
    task.requestCancellation();
    task.failPendingStart('任务启动超时，正在自动清理');
    coord.cleanupSlotHeld = true;
    this.publishTask(task);

    try {
      void Promise.resolve(this.engine.cancel(attemptId))
        .then(() => {
          // Cancel acceptance is not cleanup proof: native cancellation may only
          // have recorded intent before the child is attached. Hold the slot until
          // a trusted terminal result (or definitive start rejection) arrives.
          coord.lateStartCleanupRequired = false;
        })
        .catch((e) => {
          console.error(`[DownloadService] Watchdog cancel failed for ${attemptId}:`, e);
        });
    } catch (e) {
      console.error(`[DownloadService] Watchdog cancel failed for ${attemptId}:`, e);
    }

    this.finishRetirement(attemptId, coord);
  }

  private buildRequest(task: DownloadTask, coord: TaskCoordination): DownloadStartRequest {
    const options = coord.optionsProvider?.() ?? {};
    const captureContextId = options.captureContextId ?? task.captureContextId;
    const request: DownloadStartRequest = {
      taskId: task.attemptId,
      ...options,
      downloadType: options.downloadType ?? 'video',
      ...(options.extraArgs ? { extraArgs: { ...options.extraArgs } } : {}),
    };
    if (captureContextId) {
      // The captured display label is display-only: the native layer resolves
      // the raw URL from the opaque context.
      delete (request as { sourceUrl?: string }).sourceUrl;
      return { ...request, captureContextId };
    }
    return { ...request, sourceUrl: task.sourceUrl };
  }

  private dispatch(task: DownloadTask, coord: TaskCoordination): void {
    if (task.getStatus() !== DownloadStatus.Queued || coord.startPromise) return;

    task.transitionTo(DownloadStatus.Pending);
    coord.dispatched = true;
    this.publishTask(task);

    if (this.pendingStartTimeoutMs > 0) {
      this.clearPendingTimer(coord);
      coord.pendingTimer = setTimeout(() => {
        this.handlePendingStartTimeout(task.attemptId);
      }, this.pendingStartTimeoutMs);
    }

    let request: DownloadStartRequest;
    try {
      request = this.buildRequest(task, coord);
    } catch (error) {
      coord.startSettled = true;
      this.clearPendingTimer(coord);
      task.transitionTo(DownloadStatus.Failed, messageFor(error));
      this.publishTask(task);
      this.scheduleAfterSettlement();
      this.finishRetirement(task.attemptId, coord);
      return;
    }

    let startPromise: Promise<void>;
    try {
      startPromise = Promise.resolve(this.engine.start(request));
    } catch (error) {
      coord.startSettled = true;
      this.clearPendingTimer(coord);

      const startError = isDownloadStartError(error) ? error : undefined;
      const executionMayExist = startError?.executionMayExist !== false;
      if (executionMayExist) {
        coord.cleanupSlotHeld = true;
      }

      task.transitionTo(DownloadStatus.Failed, messageFor(error));
      this.classifyCaptureFailureFor(task, messageFor(error));
      this.publishTask(task);

      if (executionMayExist) {
        try {
          void Promise.resolve(this.engine.cancel(task.attemptId)).catch((cancelError) => {
            console.error(
              `[DownloadService] Synchronous-start cleanup cancel failed for ${task.attemptId}:`,
              cancelError,
            );
          });
        } catch (cancelError) {
          console.error(
            `[DownloadService] Synchronous-start cleanup cancel failed for ${task.attemptId}:`,
            cancelError,
          );
        }
      } else {
        this.scheduleAfterSettlement();
      }

      this.finishRetirement(task.attemptId, coord);
      return;
    }

    coord.startPromise = startPromise;
    coord.localSettlement = startPromise
      .then(async () => {
        coord.startResolved = true;
        if (coord.lateStartCleanupRequired) {
          coord.lateStartCleanupRequired = false;
          try {
            await Promise.resolve().then(() => this.engine.cancel(task.attemptId));
            // Keep cleanupSlotHeld until trusted terminal settlement. A successful
            // cancel command can still represent recorded intent before child attach.
          } catch (e) {
            console.error(
              `[DownloadService] Late-start cleanup cancel failed for ${task.attemptId}:`,
              e,
            );
          }
        }
      })
      .catch((err: unknown) => {
        this.clearPendingTimer(coord);
        if (this.isDisposed) return;

        const startError = isDownloadStartError(err) ? err : undefined;
        const definitelyNotStarted = startError?.executionMayExist === false;
        // Unknown engine rejections are conservative: absence of an explicit
        // definitely-not-started marker means native execution may exist.
        const executionMayExist = startError?.executionMayExist !== false;
        const currentTask = this.queue.get(task.attemptId);

        if (!currentTask) {
          if (coord.cleanupSlotHeld && definitelyNotStarted) {
            this.releaseCleanupSlot(task.attemptId, coord);
          }
          return;
        }

        if (currentTask.isTerminal()) {
          if (coord.cleanupSlotHeld && definitelyNotStarted) {
            this.releaseCleanupSlot(task.attemptId, coord);
          }
          console.error(
            `[DownloadService] Contract violation: start rejected after task ${task.attemptId} already terminal:`,
            err,
          );
          return;
        }

        if (executionMayExist) {
          // An invoke rejection can race after Rust registered/spawned native work.
          // Keep the real slot reserved until a trusted terminal result proves cleanup.
          coord.cleanupSlotHeld = true;
        }

        if (currentTask.isCancellationRequested()) {
          currentTask.transitionTo(DownloadStatus.Cancelled);
        } else {
          currentTask.transitionTo(DownloadStatus.Failed, messageFor(err));
          this.classifyCaptureFailureFor(currentTask, messageFor(err));
        }
        this.publishTask(currentTask);

        if (executionMayExist) {
          void Promise.resolve(this.engine.cancel(task.attemptId)).catch((cancelError) => {
            console.error(
              `[DownloadService] Ambiguous-start cleanup cancel failed for ${task.attemptId}:`,
              cancelError,
            );
          });
          return;
        }

        this.scheduleAfterSettlement();
      }).finally(() => {
        coord.startSettled = true;
        this.finishRetirement(task.attemptId, coord);
      });
  }

  private createDeferredSettlement(
    taskId: string,
    startSettlement: Promise<void>,
  ): Promise<CancelCommandOutcome> {
    const settle = (): Promise<CancelCommandOutcome> => this.settleDeferredCancel(taskId);
    return startSettlement.then(settle, settle);
  }

  private async settleDeferredCancel(taskId: string): Promise<CancelCommandOutcome> {
    const task = this.queue.get(taskId);
    if (!task) {
      return { type: 'not-cancellable' };
    }

    if (task.isTerminal()) {
      return task.getStatus() === DownloadStatus.Cancelled
        ? { type: 'cancelled' }
        : { type: 'not-cancellable' };
    }

    try {
      await this.engine.cancel(taskId);
      return { type: 'cancel-requested' };
    } catch (err) {
      console.error(`[DownloadService] Engine cancel rejected for task ${taskId}:`, err);
      // Cancel rejection must not synthesize Cancelled; restore the live product state.
      task.clearCancellationRequest();
      this.publishTask(task);
      return { type: 'cancel-rejected', error: toErrorPayload(err, 'cancel-rejected') };
    }
  }

  private handleEngineUpdate(update: EngineUpdate): void {
    if (this.isDisposed) {
      return;
    }

    const coord = this.coordination.get(update.taskId);
    if (!coord) {
      console.warn(
        `[DownloadService] Unknown task id in update: ${update.taskId}; not owned by this service`,
      );
      return;
    }

    const task = this.queue.get(update.taskId);
    if (!task) {
      if (update.type === 'result' && coord.cleanupSlotHeld) {
        this.releaseCleanupSlot(update.taskId, coord);
        return;
      }
      console.warn(`[DownloadService] Unknown task id in update: ${update.taskId}`);
      return;
    }

    if (task.isTerminal()) {
      if (coord) {
        this.clearPendingTimer(coord);
      }
      if (update.type === 'result' && coord?.cleanupSlotHeld) {
        this.releaseCleanupSlot(update.taskId, coord);
        return;
      }
      if (update.type === 'result') {
        console.warn(
          `[DownloadService] Contract violation: conflicting or duplicate terminal result for task ${update.taskId} (current: ${task.getStatus()}, received: ${update.outcome})`,
        );
      }
      return;
    }

    if (update.type === 'progress') {
      this.handleProgressUpdate(task, update, coord);
    } else if (update.type === 'result') {
      this.handleResultUpdate(task, update, coord);
      this.scheduleAfterSettlement();
      if (coord) this.finishRetirement(task.attemptId, coord);
    }
  }

  private handleProgressUpdate(
    task: DownloadTask,
    update: EngineProgressUpdate,
    coord?: TaskCoordination,
  ): void {
    const phaseStatus =
      update.phase === 'Downloading' ? DownloadStatus.Downloading : DownloadStatus.Processing;

    if (!task.applyExecutionProgress(phaseStatus, update.progress, update.speed)) {
      console.warn(
        `[DownloadService] Contract violation: invalid progress update for task ${update.taskId}`,
      );
      return;
    }

    if (coord) {
      this.clearPendingTimer(coord);
    }
    this.publishTask(task);
  }

  private handleResultUpdate(
    task: DownloadTask,
    update: EngineResultUpdate,
    coord?: TaskCoordination,
  ): void {
    if (coord) {
      this.clearPendingTimer(coord);
    }

    const outcomeMap: Record<EngineResultOutcome, DownloadStatus> = {
      Completed: DownloadStatus.Completed,
      Failed: DownloadStatus.Failed,
      Cancelled: DownloadStatus.Cancelled,
    };

    const targetStatus = outcomeMap[update.outcome];
    if (targetStatus === DownloadStatus.Completed) {
      task.complete(update.filePath);
      this.publishTask(task);
      return;
    }
    task.transitionTo(targetStatus, update.outcome === 'Failed' ? update.error : undefined);
    if (update.outcome === 'Failed') {
      this.classifyCaptureFailureFor(task, update.error);
    }
    this.publishTask(task);
  }
}

function messageFor(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return typeof error === 'string' ? error : String(error);
}
