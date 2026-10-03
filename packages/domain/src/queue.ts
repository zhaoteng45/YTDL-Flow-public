import type { DownloadTask } from './task';

export class DownloadQueue {
  private readonly tasks = new Map<string, DownloadTask>();

  add(task: DownloadTask): void {
    if (this.getByRowId(task.rowId)) {
      throw new Error(`Cannot add task: duplicate rowId '${task.rowId}'`);
    }
    this.tasks.set(task.id, task);
  }

  remove(taskId: string): void {
    this.tasks.delete(taskId);
  }

  get(taskId: string): DownloadTask | undefined {
    return this.tasks.get(taskId);
  }

  getByRowId(rowId: string): DownloadTask | undefined {
    return [...this.tasks.values()].find((task) => task.rowId === rowId);
  }

  replaceByRowId(task: DownloadTask): void {
    const entries = [...this.tasks.entries()];
    let replaced = false;

    this.tasks.clear();
    for (const [taskId, current] of entries) {
      if (current.rowId === task.rowId) {
        this.tasks.set(task.attemptId, task);
        replaced = true;
      } else {
        this.tasks.set(taskId, current);
      }
    }

    if (!replaced) {
      this.tasks.set(task.attemptId, task);
    }
  }

  all(): DownloadTask[] {
    return [...this.tasks.values()];
  }
}
