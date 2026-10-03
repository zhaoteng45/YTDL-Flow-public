import {
  isCaptureContextFailureCode,
  type TaskPayload,
  type TaskStatusPayload,
} from '../../contracts/src/index';
import { DownloadStatus, type DownloadTask } from '../../domain/src/index';

const statusPayloadByDomainStatus: Record<DownloadStatus, TaskStatusPayload> = {
  [DownloadStatus.Created]: 'Created',
  [DownloadStatus.Queued]: 'Queued',
  [DownloadStatus.Pending]: 'Pending',
  [DownloadStatus.Downloading]: 'Downloading',
  [DownloadStatus.Processing]: 'Processing',
  [DownloadStatus.Completed]: 'Completed',
  [DownloadStatus.Failed]: 'Failed',
  [DownloadStatus.Cancelled]: 'Cancelled',
};

export function toTaskPayload(task: DownloadTask): TaskPayload {
  const speed = task.getSpeed();
  const failureReason = task.getFailureReason();
  const finalPath = task.getFinalPath();
  const hasSplitIdentity = task.rowId !== task.attemptId;
  const captureFailureCode = task.getCaptureFailureCode();
  const failureCode =
    (isCaptureContextFailureCode(captureFailureCode) ? captureFailureCode : undefined) ??
    task.getFailureCode();

  return {
    id: task.attemptId,
    ...(hasSplitIdentity ? { rowId: task.rowId, attemptId: task.attemptId } : {}),
    sourceUrl: task.sourceUrl,
    status: statusPayloadByDomainStatus[task.getStatus()],
    progress: task.getProgress(),
    ...(speed ? { speed } : {}),
    ...(task.isCancellationRequested() ? { cancelRequested: true } : {}),
    ...(failureReason ? { failureReason } : {}),
    ...(failureCode ? { failureCode } : {}),
    ...(finalPath ? { finalPath } : {}),
  };
}
