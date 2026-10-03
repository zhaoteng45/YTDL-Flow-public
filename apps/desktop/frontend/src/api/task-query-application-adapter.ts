import type { TaskPayload } from '@ytdl-flow/contracts';

import type { TaskApplicationApi } from './task-application-api';

interface TaskQueryReader {
  listTasks(): TaskPayload[];
}

export class TaskQueryApplicationAdapter implements TaskApplicationApi {
  constructor(private readonly reader: TaskQueryReader) {}

  async listTasks(): Promise<TaskPayload[]> {
    return this.reader.listTasks();
  }
}
