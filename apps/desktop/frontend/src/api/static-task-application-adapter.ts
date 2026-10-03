import type { TaskPayload } from '@ytdl-flow/contracts';

import type { TaskApplicationApi } from './task-application-api';

export class StaticTaskApplicationAdapter implements TaskApplicationApi {
  constructor(private readonly tasks: readonly TaskPayload[]) {}

  async listTasks(): Promise<TaskPayload[]> {
    return this.tasks.map((task) => ({ ...task }));
  }
}
