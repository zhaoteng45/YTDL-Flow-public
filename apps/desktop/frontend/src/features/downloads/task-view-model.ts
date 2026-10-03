import type { ErrorPayload, TaskPayload, TaskStatusPayload } from '@ytdl-flow/contracts';

const statusLabels: Record<TaskStatusPayload, string> = {
  Created: '已创建',
  Queued: '排队中',
  Pending: '启动中',
  Downloading: '下载中',
  Processing: '处理中',
  Completed: '已完成',
  Failed: '失败',
  Cancelled: '已取消',
};

const cancellableStatuses: ReadonlySet<TaskStatusPayload> = new Set([
  'Created',
  'Queued',
  'Downloading',
  'Processing',
]);

export interface TaskViewModel {
  id: string;
  sourceUrl: string;
  status: TaskStatusPayload;
  statusLabel: string;
  progress: number;
  progressLabel: string;
  /** Trusted failure reason from the terminal Failed result, when present. */
  failureReason?: string;
  canCancel: boolean;
  cancelPending: boolean;
  /** Cancel command rejection; never implies a Cancelled task state. */
  cancelErrorMessage?: string;
}

export interface TaskViewModelContext {
  cancelPending?: boolean;
  cancelError?: ErrorPayload;
}

export function toTaskViewModel(
  task: TaskPayload,
  context: TaskViewModelContext = {},
): TaskViewModel {
  const progress = Math.min(100, Math.max(0, Math.round(task.progress)));

  return {
    id: task.id,
    sourceUrl: task.sourceUrl,
    status: task.status,
    statusLabel: statusLabels[task.status],
    progress,
    progressLabel: `${progress}%`,
    ...(task.failureReason ? { failureReason: task.failureReason } : {}),
    canCancel: cancellableStatuses.has(task.status),
    cancelPending: context.cancelPending === true,
    ...(context.cancelError ? { cancelErrorMessage: context.cancelError.message } : {}),
  };
}
