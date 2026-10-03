import type { TaskPayload } from '@ytdl-flow/contracts';

export interface TaskApplicationApi {
  listTasks(): Promise<TaskPayload[]>;
}
