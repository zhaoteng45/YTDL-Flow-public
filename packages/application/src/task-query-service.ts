import type { TaskPayload } from '../../contracts/src/index';
import { DownloadQueue } from '../../domain/src/index';
import { toTaskPayload } from './task-payload';

export class TaskQueryService {
  constructor(private readonly queue: DownloadQueue) {}

  getTask(taskId: string): TaskPayload | undefined {
    const task = this.queue.get(taskId);
    return task ? toTaskPayload(task) : undefined;
  }

  getTaskByRowId(rowId: string): TaskPayload | undefined {
    const task = this.queue.getByRowId(rowId);
    return task ? toTaskPayload(task) : undefined;
  }

  listTasks(): TaskPayload[] {
    return this.queue.all().map(toTaskPayload);
  }
}
