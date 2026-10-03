import type {
  DownloadStartRequest,
  EngineResultOutcome,
  EngineUpdate,
} from '../../packages/contracts/src';
import {
  DownloadStartError,
  type DownloadEngine,
  type EngineUpdateListener,
} from '../../packages/application/src/download-engine';
import { redactSensitiveText } from '../utils/redactSensitiveText';
import { safeInvoke, safeListen } from '../utils/tauri';

type RuntimeUnlisten = () => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface TauriDownloadEngineDeps {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  listen(event: string, handler: (payload: unknown) => void): Promise<RuntimeUnlisten>;
}

interface InFlightStart {
  phase: 'pre-invoke' | 'invoke-pending';
  cancelRequested: boolean;
  cancelConfirmed: boolean;
  terminalObserved: boolean;
  invokePromise?: Promise<void>;
}

function errorMessage(error: unknown): string {
  return redactSensitiveText(error instanceof Error ? error.message || error.name : String(error));
}

function isNoActiveExecutionError(error: unknown): boolean {
  return errorMessage(error).includes('No active execution for task');
}

const defaultDeps: TauriDownloadEngineDeps = {
  async invoke(command, args) {
    return safeInvoke(command, args);
  },
  async listen(event, handler) {
    return safeListen<unknown>(event, (message) => handler(message.payload));
  },
};

export class TauriDownloadEngine implements DownloadEngine {
  private readonly listeners = new Set<EngineUpdateListener>();
  private readonly inFlightStarts = new Map<string, InFlightStart>();
  private readonly activeExecutions = new Set<string>();
  private listenPromise: Promise<void> | null = null;
  private unlistenProgress: RuntimeUnlisten | null = null;
  private unlistenResult: RuntimeUnlisten | null = null;
  private releaseRequested = false;
  private isDisposed = false;
  private disposePromise: Promise<void> | null = null;

  constructor(private readonly deps: TauriDownloadEngineDeps = defaultDeps) {}

  async start(request: DownloadStartRequest): Promise<void> {
    if (this.isDisposed) {
      throw new DownloadStartError('TauriDownloadEngine is disposed', false);
    }

    const inFlight: InFlightStart = {
      phase: 'pre-invoke',
      cancelRequested: false,
      cancelConfirmed: false,
      terminalObserved: false,
    };
    this.inFlightStarts.set(request.taskId, inFlight);

    try {
      try {
        await this.ensureListening();
      } catch (error) {
        throw new DownloadStartError(errorMessage(error), false);
      }

      if (this.isDisposed || inFlight.cancelRequested) {
        throw new DownloadStartError(
          this.isDisposed
            ? `Start cancelled because engine is disposed for task ${request.taskId}`
            : `Start cancelled before native execution for task ${request.taskId}`,
          false,
        );
      }

      inFlight.phase = 'invoke-pending';
      const invokeArgs: Record<string, unknown> = {
        id: request.taskId,
        downloadType: request.downloadType,
        downloadDir: request.downloadDir,
        extraArgs: request.extraArgs,
      };
      if ((request.sourceUrl === undefined) === (request.captureContextId === undefined)) {
        throw new DownloadStartError(
          'Invalid download request: exactly one execution target is required',
          false,
        );
      }
      if (request.captureContextId !== undefined) {
        // The captured display label is display-only: the native layer resolves
        // the raw URL from the opaque context.
        invokeArgs.captureContextId = request.captureContextId;
      } else {
        invokeArgs.url = request.sourceUrl;
      }
      const invokePromise = this.deps
        .invoke('start_download', invokeArgs)
        .then(() => undefined);
      inFlight.invokePromise = invokePromise;

      try {
        await invokePromise;
      } catch (error) {
        let candidate: unknown = error;
        if (typeof error === 'string') {
          try {
            candidate = JSON.parse(error);
          } catch {
            // Not a JSON string
          }
        }
        if (
          candidate &&
          typeof candidate === 'object' &&
          'executionMayExist' in candidate &&
          typeof (candidate as { executionMayExist: unknown }).executionMayExist === 'boolean'
        ) {
          const typed = candidate as { message?: string; executionMayExist: boolean };
          throw new DownloadStartError(typed.message ?? errorMessage(error), typed.executionMayExist);
        }
        throw new DownloadStartError(errorMessage(error), true);
      }
      if (!inFlight.cancelConfirmed && !inFlight.terminalObserved) {
        this.activeExecutions.add(request.taskId);
      }
    } finally {
      if (this.inFlightStarts.get(request.taskId) === inFlight) {
        this.inFlightStarts.delete(request.taskId);
      }
    }
  }

  async cancel(taskId: string): Promise<void> {
    const inFlight = this.inFlightStarts.get(taskId);

    if (inFlight?.phase === 'pre-invoke') {
      inFlight.cancelRequested = true;
      inFlight.cancelConfirmed = true;
      return;
    }

    if (inFlight?.phase === 'invoke-pending') {
      inFlight.cancelRequested = true;
      try {
        await this.deps.invoke('cancel_download', { id: taskId });
        inFlight.cancelConfirmed = true;
        this.activeExecutions.delete(taskId);
        return;
      } catch (error) {
        if (!isNoActiveExecutionError(error)) {
          throw error;
        }

        try {
          await inFlight.invokePromise;
        } catch {
          inFlight.cancelConfirmed = true;
          this.activeExecutions.delete(taskId);
          return;
        }

        try {
          await this.deps.invoke('cancel_download', { id: taskId });
        } catch (retryError) {
          if (!isNoActiveExecutionError(retryError)) {
            throw retryError;
          }
        }
        inFlight.cancelConfirmed = true;
        this.activeExecutions.delete(taskId);
        return;
      }
    }

    await this.deps.invoke('cancel_download', { id: taskId });
    this.activeExecutions.delete(taskId);
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;

    this.isDisposed = true;
    const ownedTaskIds = new Set<string>([
      ...this.inFlightStarts.keys(),
      ...this.activeExecutions,
    ]);

    const attempt = Promise.all(
      [...ownedTaskIds].map(async (taskId) => {
        try {
          await this.cancel(taskId);
        } catch (error) {
          if (isNoActiveExecutionError(error)) {
            this.activeExecutions.delete(taskId);
            return;
          }
          throw error;
        }
      }),
    )
      .then(() => {
        this.listeners.clear();
        this.releaseUnderlyingListeners();
      })
      .catch((error) => {
        this.disposePromise = null;
        throw error;
      });

    this.disposePromise = attempt;
    return attempt;
  }

  subscribeUpdates(listener: EngineUpdateListener): () => void {
    if (this.isDisposed) {
      throw new Error('TauriDownloadEngine is disposed');
    }

    let active = true;
    const subscription: EngineUpdateListener = (update) => listener(update);
    const wasEmpty = this.listeners.size === 0;

    this.releaseRequested = false;
    this.listeners.add(subscription);

    if (wasEmpty) {
      void this.ensureListening().catch((error) => {
        console.error('[TauriDownloadEngine] Failed to install native listeners', error);
      });
    }

    return () => {
      if (!active) {
        return;
      }
      active = false;
      this.listeners.delete(subscription);

      if (this.listeners.size === 0) {
        this.releaseUnderlyingListeners();
      }
    };
  }

  private emit(update: EngineUpdate): void {
    for (const listener of this.listeners) {
      listener(update);
    }
  }

  private async ensureListening(): Promise<void> {
    if (this.listenPromise) {
      return this.listenPromise;
    }

    this.listenPromise = this.installListeners();

    try {
      await this.listenPromise;
    } catch (error) {
      this.listenPromise = null;
      throw error;
    }
  }

  private async installListeners(): Promise<void> {
    const unlistenProgress = await this.deps.listen('download-progress', (payload) => {
      this.handleProgress(payload);
    });

    let unlistenResult: RuntimeUnlisten;
    try {
      unlistenResult = await this.deps.listen('download-result', (payload) => {
        this.handleResult(payload);
      });
    } catch (error) {
      unlistenProgress();
      throw error;
    }

    if (this.releaseRequested || this.listeners.size === 0) {
      unlistenProgress();
      unlistenResult();
      this.listenPromise = null;
      return;
    }

    this.unlistenProgress = unlistenProgress;
    this.unlistenResult = unlistenResult;
  }

  private releaseUnderlyingListeners(): void {
    this.releaseRequested = true;

    const unlistenProgress = this.unlistenProgress;
    const unlistenResult = this.unlistenResult;
    this.unlistenProgress = null;
    this.unlistenResult = null;

    if (unlistenProgress) {
      unlistenProgress();
    }
    if (unlistenResult) {
      unlistenResult();
    }

    if (unlistenProgress || unlistenResult) {
      this.listenPromise = null;
    }
  }

  private handleProgress(payload: unknown): void {
    if (!isRecord(payload)) {
      console.warn('[TauriDownloadEngine] Ignoring malformed download-progress payload');
      return;
    }

    const { id, status, progress, speed } = payload;
    if (
      typeof id !== 'string' ||
      typeof status !== 'string' ||
      (speed !== undefined && speed !== null && typeof speed !== 'string')
    ) {
      console.warn('[TauriDownloadEngine] Ignoring malformed download-progress payload');
      return;
    }

    const normalizedStatus = status.toLowerCase();

    // Legacy terminal progress remains compatibility-only for the Vue runtime.
    if (normalizedStatus === 'completed' || normalizedStatus === 'error') {
      return;
    }

    if (normalizedStatus !== 'downloading' && normalizedStatus !== 'processing') {
      console.warn(
        `[TauriDownloadEngine] Ignoring unknown download-progress status: ${status}`,
      );
      return;
    }

    if (typeof progress !== 'number' || !Number.isFinite(progress)) {
      console.warn(
        `[TauriDownloadEngine] Ignoring invalid progress for task ${id}`,
      );
      return;
    }

    this.emit({
      type: 'progress',
      taskId: id,
      phase: normalizedStatus === 'downloading' ? 'Downloading' : 'Processing',
      progress,
      ...(typeof speed === 'string' ? { speed } : {}),
    });
  }

  private handleResult(payload: unknown): void {
    if (!isRecord(payload)) {
      console.warn('[TauriDownloadEngine] Ignoring malformed download-result payload');
      return;
    }

    const { id, outcome, error, filePath } = payload;
    if (
      typeof id !== 'string' ||
      (outcome !== 'completed' && outcome !== 'failed' && outcome !== 'cancelled') ||
      (error !== undefined && error !== null && typeof error !== 'string') ||
      (filePath !== undefined && filePath !== null && typeof filePath !== 'string')
    ) {
      console.warn('[TauriDownloadEngine] Ignoring malformed download-result payload');
      return;
    }

    const outcomeByPayload: Record<
      'completed' | 'failed' | 'cancelled',
      EngineResultOutcome
    > = {
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
    };

    const inFlight = this.inFlightStarts.get(id);
    if (inFlight) {
      inFlight.terminalObserved = true;
    }
    this.activeExecutions.delete(id);

    this.emit({
      type: 'result',
      taskId: id,
      outcome: outcomeByPayload[outcome],
      error: typeof error === 'string' ? redactSensitiveText(error) : undefined,
      filePath: typeof filePath === 'string' ? filePath : undefined,
    });
  }
}
