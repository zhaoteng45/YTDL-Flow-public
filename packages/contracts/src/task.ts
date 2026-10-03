import type { CaptureContextFailureCode } from './capture';

export type TaskStatusPayload =
  | 'Created'
  | 'Queued'
  | 'Pending'
  | 'Downloading'
  | 'Processing'
  | 'Completed'
  | 'Failed'
  | 'Cancelled';

export interface TaskPayload {
  /** Compatibility alias for attemptId while the T010 React POC remains in-tree. */
  id: string;
  /** Stable product row identity across retry/reanalysis attempts. */
  rowId?: string;
  /** Native execution identity for the current attempt. */
  attemptId?: string;
  sourceUrl: string;
  status: TaskStatusPayload;
  progress: number;
  /** Latest transfer speed while downloading; omitted when not meaningful. */
  speed?: string;
  /** Cancellation has been requested but trusted terminal settlement has not necessarily arrived. */
  cancelRequested?: boolean;
  /** Trusted failure reason retained from the terminal Failed result. */
  failureReason?: string;
  /** Structured outcome, independent of display copy. */
  failureCode?: 'pending-start-timeout' | CaptureContextFailureCode;
  /** Trusted final output path retained from the terminal Completed result. */
  finalPath?: string;
}
