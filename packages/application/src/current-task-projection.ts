import type {
  CurrentFailureKind,
  CurrentTaskActions,
  CurrentTaskStatus,
  CurrentTaskRow,
  TaskPayload,
} from '../../contracts/src';

/** Execution status is projected, never copied into the analysis catalog. */
export function projectCurrentExecution(task: TaskPayload): Omit<CurrentTaskRow, 'orderKey'> {
  const status: CurrentTaskStatus = task.status === 'Failed' || task.status === 'Cancelled'
    ? 'error'
    : task.status === 'Created' ? 'analyzing'
      : task.status.toLowerCase() as CurrentTaskStatus;
  const failureKind = task.status === 'Cancelled' || task.failureCode === 'pending-start-timeout'
    ? 'cancelled'
    : task.status === 'Failed' ? 'download' : undefined;
  return {
    rowId: task.rowId ?? task.id,
    attemptId: task.attemptId ?? task.id,
    sourceUrl: task.sourceUrl,
    status,
    failureKind,
    failureReason: task.failureReason,
    failureCode: task.failureCode,
    cancelRequested: task.cancelRequested === true,
    progress: task.progress,
    speed: task.speed,
    finalPath: task.finalPath,
    logs: [],
    actions: resolveCurrentTaskActions({ status, failureKind, cancelRequested: task.cancelRequested,
      hasExecution: true, hasDownloadIntent: true }),
  };
}

export interface CurrentTaskActionContext {
  status: CurrentTaskStatus;
  failureKind?: CurrentFailureKind;
  cancelRequested?: boolean;
  hasExecution?: boolean;
  hasDownloadIntent?: boolean;
}

type MutableCurrentTaskActions = {
  -readonly [K in keyof CurrentTaskActions]: CurrentTaskActions[K];
};

export function resolveCurrentTaskActions(
  context: CurrentTaskActionContext,
): CurrentTaskActions {
  const actions: MutableCurrentTaskActions = {
    canCancel: false,
    canRemove: false,
    canOpenFolder: false,
    canStartDownload: false,
    canRetryDownload: false,
    canReanalyze: false,
  };

  if (context.status === 'analyzed') {
    actions.canCancel = true;
    actions.canStartDownload = true;
    return actions;
  }

  if (
    (context.status === 'queued' ||
      context.status === 'downloading' ||
      context.status === 'processing') &&
    context.cancelRequested !== true
  ) {
    actions.canCancel = true;
    return actions;
  }

  if (context.status === 'completed') {
    actions.canOpenFolder = true;
    actions.canRemove = true;
    return actions;
  }

  if (context.status !== 'error') {
    return actions;
  }

  actions.canRemove = true;

  if (context.failureKind === 'analysis') {
    actions.canReanalyze = true;
    return actions;
  }

  const canRetryExecution =
    context.hasExecution === true && context.hasDownloadIntent === true;

  if (context.failureKind === 'download') {
    actions.canRetryDownload = canRetryExecution;
    return actions;
  }

  if (
    context.failureKind === 'cancelled' ||
    context.failureKind === 'unknown' ||
    context.failureKind === undefined
  ) {
    if (canRetryExecution) {
      actions.canRetryDownload = true;
    } else {
      actions.canReanalyze = true;
    }
  }

  return actions;
}

export function resolveCurrentExecutionTaskActions(task: TaskPayload): CurrentTaskActions {
  const attemptId = task.attemptId ?? task.id;
  const rowId = task.rowId ?? task.id;
  const hasExecution = Boolean(attemptId && rowId);

  switch (task.status) {
    case 'Queued':
      return resolveCurrentTaskActions({
        status: 'queued',
        cancelRequested: task.cancelRequested,
        hasExecution,
        hasDownloadIntent: true,
      });
    case 'Pending':
      return resolveCurrentTaskActions({
        status: 'pending',
        cancelRequested: task.cancelRequested,
        hasExecution,
        hasDownloadIntent: true,
      });
    case 'Downloading':
      return resolveCurrentTaskActions({
        status: 'downloading',
        cancelRequested: task.cancelRequested,
        hasExecution,
        hasDownloadIntent: true,
      });
    case 'Processing':
      return resolveCurrentTaskActions({
        status: 'processing',
        cancelRequested: task.cancelRequested,
        hasExecution,
        hasDownloadIntent: true,
      });
    case 'Completed':
      return resolveCurrentTaskActions({
        status: 'completed',
        hasExecution,
        hasDownloadIntent: true,
      });
    case 'Failed':
      return resolveCurrentTaskActions({
        status: 'error',
        failureKind: 'download',
        cancelRequested: task.cancelRequested,
        hasExecution,
        hasDownloadIntent: true,
      });
    case 'Cancelled':
      return resolveCurrentTaskActions({
        status: 'error',
        failureKind: 'cancelled',
        cancelRequested: task.cancelRequested,
        hasExecution,
        hasDownloadIntent: true,
      });
    case 'Created':
      return resolveCurrentTaskActions({ status: 'analyzing' });
  }
}
