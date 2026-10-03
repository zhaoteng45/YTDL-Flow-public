import type { TaskPresentationRow } from './application/taskPresentation';

export type TaskWatcherSnapshot = Pick<TaskPresentationRow, 'rowId' | 'id' | 'status'>;

export function getTaskSoundEffects(
  previousTasks: TaskWatcherSnapshot[] | undefined,
  currentTasks: TaskWatcherSnapshot[],
): Array<'success' | 'error'> {
  if (!previousTasks) {
    return [];
  }

  const effects: Array<'success' | 'error'> = [];
  const previousRows = new Map(previousTasks.map((task) => [task.rowId, task]));

  currentTasks.forEach((task) => {
    const previousTask = previousRows.get(task.rowId);
    if (!previousTask || previousTask.id !== task.id) {
      return;
    }

    if (task.status === 'completed' && previousTask.status !== 'completed' && previousTask.status !== 'error') {
      effects.push('success');
      return;
    }

    if (task.status === 'error' && previousTask.status !== 'completed' && previousTask.status !== 'error') {
      effects.push('error');
    }
  });

  return effects;
}

export function hasNewVisibleRows(previousRowIds: string[] | undefined, currentRowIds: string[]) {
  const previousRows = new Set(previousRowIds ?? []);
  return currentRowIds.some((rowId) => !previousRows.has(rowId));
}

export interface DisposableTaskRuntime {
  dispose(): Promise<void>;
}

export async function disposeTaskRuntimeWithRetry(
  runtime: DisposableTaskRuntime,
  maxAttempts = 2,
): Promise<void> {
  let lastError: unknown;
  const attempts = Math.max(1, maxAttempts);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await runtime.dispose();
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}
