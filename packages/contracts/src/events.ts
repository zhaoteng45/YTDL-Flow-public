import type { TaskStatusPayload } from './task';

export interface ProgressEvent {
  taskId: string;
  progress: number;
  status: TaskStatusPayload;
}
