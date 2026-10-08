import type {
  CurrentExtraArgs,
  CurrentTaskRow,
  DownloadStartRequest,
} from '../../packages/contracts/src';
import { DownloadQueue } from '../../packages/domain/src';
import {
  CurrentAnalysisService,
  CurrentDownloadService,
  type CurrentMediaAnalyzer,
  CurrentTaskEffectsCoordinator,
  type CurrentTaskEffectsPort,
  type CurrentTaskExecution,
  CurrentTaskService,
  type DownloadEngine,
  DownloadService,
  DownloadStartError,
  type DownloadServiceOptions,
  TaskQueryService,
} from '../../packages/application/src';
import {
  toCurrentTaskPresentationRow,
  type TaskPresentationRow,
} from '../application/taskPresentation';
import {
  createCurrentTaskPresentationActions,
  type TaskPresentationActions,
} from '../application/taskPresentationActions';
import type { PrepareCurrentAnalysis } from '../../packages/application/src/current-analysis-service';

export interface CurrentTaskRuntimeEnvironment {
  getGlobalExtraArgs(sourceUrl?: string): CurrentExtraArgs;
  getAnalysisExtraArgs?: PrepareCurrentAnalysis;
  /** Executed for each actual engine dispatch, including queued starts and retries. */
  validateDownloadCredential?: (request: DownloadStartRequest) => Promise<void>;
  getDownloadDir(): string | undefined;
}

export interface CurrentTaskRuntimeOptions {
  engine: DownloadEngine;
  analyzer: CurrentMediaAnalyzer;
  environment: CurrentTaskRuntimeEnvironment;
  effectsPort: CurrentTaskEffectsPort;
  createRowId?: () => string;
  createAnalysisAttemptId?: () => string;
  createDownloadAttemptId?: () => string;
  createPlaylistAttemptId?: () => string;
  downloadServiceOptions?: DownloadServiceOptions;
}

export type TaskPresentationRowListener = (rows: TaskPresentationRow[]) => void;

export interface CurrentTaskRuntime {
  readonly tasks: CurrentTaskService;
  readonly actions: TaskPresentationActions;
  listRows(): TaskPresentationRow[];
  subscribeRows(listener: TaskPresentationRowListener): () => void;
  flushEffects(): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Runs async credential preflight immediately before the native engine receives
 * a queued attempt. DownloadService remains the only FIFO/terminal state owner.
 */
function withCredentialPreflight(
  engine: DownloadEngine,
  verify: (request: DownloadStartRequest) => Promise<void>,
): DownloadEngine {
  const pending = new Map<string, { cancelled: boolean }>();
  let disposed = false;
  return {
    async start(request) {
      const guard = { cancelled: false };
      pending.set(request.taskId, guard);
      try {
        try {
          await verify(request);
        } catch {
          // No native process was created. Do not leak a local path or IPC error.
          throw new DownloadStartError(
            'COOKIE_FILE_REANALYSIS_REQUIRED: Cookie 文件不可用或已失效，请使用有效凭证重新解析',
            false,
          );
        }
        if (disposed || guard.cancelled) {
          throw new DownloadStartError('Start cancelled before native dispatch', false);
        }
        pending.delete(request.taskId);
        await engine.start(request);
      } finally {
        if (pending.get(request.taskId) === guard) pending.delete(request.taskId);
      }
    },
    async cancel(taskId) {
      const guard = pending.get(taskId);
      if (guard) {
        guard.cancelled = true;
        return;
      }
      await engine.cancel(taskId);
    },
    subscribeUpdates(listener) {
      return engine.subscribeUpdates(listener);
    },
    async dispose() {
      disposed = true;
      for (const guard of pending.values()) guard.cancelled = true;
      await engine.dispose?.();
    },
  };
}

export function createCurrentTaskRuntime(options: CurrentTaskRuntimeOptions): CurrentTaskRuntime {
  const queue = new DownloadQueue();
  const engine = options.environment.validateDownloadCredential
    ? withCredentialPreflight(options.engine, options.environment.validateDownloadCredential)
    : options.engine;
  const downloadService = new DownloadService(
    queue,
    engine,
    options.createDownloadAttemptId,
    options.downloadServiceOptions,
  );
  const taskQueryService = new TaskQueryService(queue);
  const currentDownloadService = new CurrentDownloadService(
    downloadService,
    options.environment,
    taskQueryService,
  );

  const analysisService = new CurrentAnalysisService(
    options.analyzer,
    options.createAnalysisAttemptId,
    (sourceUrl) => options.environment.getGlobalExtraArgs(sourceUrl),
    options.environment.getAnalysisExtraArgs,
  );

  const execution: CurrentTaskExecution = {
    downloads: currentDownloadService,
    query: taskQueryService,
    subscribeTasks: (listener) => downloadService.subscribeTasks(listener),
    dispose: () => downloadService.dispose(),
  };

  const taskService = new CurrentTaskService(
    analysisService,
    options.createRowId,
    execution,
  );

  const coordinator = new CurrentTaskEffectsCoordinator(options.effectsPort);

  const presentationListeners = new Set<TaskPresentationRowListener>();
  let latestObservedRows: readonly CurrentTaskRow[] = taskService.listRows();
  let latestEffectsRows: readonly CurrentTaskRow[] | undefined;
  let effectsDrain: Promise<void> = Promise.resolve();
  let effectsDrainRunning = false;
  let lastEffectsError: unknown;
  let lifecycle: 'active' | 'disposing' | 'disposed' = 'active';
  let disposalPromise: Promise<void> | null = null;
  let teardownStarted = false;

  const runtimeIsDisposed = () => lifecycle === 'disposed';

  function ensureEffectsDrain(): void {
    if (effectsDrainRunning || runtimeIsDisposed()) return;
    effectsDrainRunning = true;

    effectsDrain = (async () => {
      try {
        while (!runtimeIsDisposed() && latestEffectsRows !== undefined) {
          const rows = latestEffectsRows;
          latestEffectsRows = undefined;
          try {
            await coordinator.sync(rows);
            lastEffectsError = undefined;
          } catch (error) {
            lastEffectsError = error;
            console.error('[CurrentTaskRuntime] Effects coordinator sync failed:', error);
            if (latestEffectsRows === undefined) {
              break;
            }
          }
        }
      } finally {
        effectsDrainRunning = false;
        if (!runtimeIsDisposed() && latestEffectsRows !== undefined) {
          ensureEffectsDrain();
        }
      }
    })();
  }

  function scheduleEffects(rows: readonly CurrentTaskRow[]): void {
    if (lifecycle !== 'active') return;
    coordinator.observeRows(rows);
    latestObservedRows = rows;
    latestEffectsRows = rows;
    ensureEffectsDrain();
  }

  const unsubscribeTaskRows = taskService.subscribeRows((rawRows) => {
    scheduleEffects(rawRows);
    if (presentationListeners.size > 0) {
      const presentationRows = rawRows.map(toCurrentTaskPresentationRow);
      for (const listener of presentationListeners) {
        try {
          listener(presentationRows);
        } catch (error) {
          console.error('[CurrentTaskRuntime] Presentation listener error:', error);
        }
      }
    }
  });

  const actions = createCurrentTaskPresentationActions(taskService);

  function listRows(): TaskPresentationRow[] {
    return taskService.listRows().map(toCurrentTaskPresentationRow);
  }

  function subscribeRows(listener: TaskPresentationRowListener): () => void {
    if (lifecycle !== 'active') {
      throw new Error(`CurrentTaskRuntime is ${lifecycle}`);
    }
    presentationListeners.add(listener);
    listener(listRows());
    return () => {
      presentationListeners.delete(listener);
    };
  }

  async function flushEffects(): Promise<void> {
    if (
      !effectsDrainRunning &&
      latestEffectsRows === undefined &&
      (lastEffectsError !== undefined || coordinator.hasPendingTerminalEffects())
    ) {
      latestEffectsRows = latestObservedRows;
      lastEffectsError = undefined;
      ensureEffectsDrain();
    }

    while (effectsDrainRunning || latestEffectsRows !== undefined) {
      const current = effectsDrain;
      await current;
      if (
        current === effectsDrain &&
        !effectsDrainRunning &&
        latestEffectsRows === undefined
      ) {
        break;
      }
    }

    if (lastEffectsError !== undefined) {
      throw lastEffectsError;
    }
    if (coordinator.hasPendingTerminalEffects()) {
      throw new Error('CurrentTaskRuntime has pending terminal effects');
    }
  }

  function dispose(): Promise<void> {
    if (disposalPromise) return disposalPromise;
    if (lifecycle === 'disposed') return Promise.resolve();

    lifecycle = 'disposing';

    if (!teardownStarted) {
      teardownStarted = true;
      unsubscribeTaskRows();
      presentationListeners.clear();
      taskService.dispose();
    }

    const attempt = Promise.resolve()
      .then(() => engine.dispose?.())
      .then(() => flushEffects())
      .then(() => options.effectsPort.setTaskbar({ progress: 0, status: 'none' }))
      .then(() => {
        lifecycle = 'disposed';
      })
      .catch((error) => {
        disposalPromise = null;
        throw error;
      });

    disposalPromise = attempt;
    return attempt;
  }

  return {
    tasks: taskService,
    actions,
    listRows,
    subscribeRows,
    flushEffects,
    dispose,
  };
}
