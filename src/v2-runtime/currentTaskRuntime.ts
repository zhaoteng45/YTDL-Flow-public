import type {
  CurrentExtraArgs,
  CurrentTaskRow,
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

export interface CurrentTaskRuntimeEnvironment {
  getGlobalExtraArgs(sourceUrl?: string): CurrentExtraArgs;
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

export function createCurrentTaskRuntime(options: CurrentTaskRuntimeOptions): CurrentTaskRuntime {
  const queue = new DownloadQueue();
  const downloadService = new DownloadService(
    queue,
    options.engine,
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
      .then(() => options.engine.dispose?.())
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
