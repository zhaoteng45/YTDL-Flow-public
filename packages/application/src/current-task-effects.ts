import type { CurrentTaskRow } from '../../contracts/src';

export type CurrentTaskbarStatus = 'none' | 'normal' | 'indeterminate' | 'error';

export interface CurrentTaskbarProjection {
  progress: number;
  status: CurrentTaskbarStatus;
}

export interface CurrentTaskEffectsPort {
  playSuccess(): Promise<void> | void;
  playError(): Promise<void> | void;
  setTaskbar(projection: CurrentTaskbarProjection): Promise<void> | void;
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, progress));
}

export function projectCurrentTaskbar(
  rows: readonly CurrentTaskRow[],
): CurrentTaskbarProjection {
  const downloading = rows.filter((row) => row.status === 'downloading');
  if (downloading.length > 0) {
    const average = downloading.reduce(
      (sum, row) => sum + (Number.isFinite(row.progress) ? row.progress : 0),
      0,
    ) / downloading.length;
    return {
      progress: clampProgress(Math.round(average)),
      status: 'normal',
    };
  }

  if (rows.some((row) => row.status === 'analyzing' || row.status === 'processing')) {
    return { progress: 0, status: 'indeterminate' };
  }

  if (rows.some((row) => row.status === 'error' && row.failureKind !== 'cancelled')) {
    return { progress: 100, status: 'error' };
  }

  return { progress: 0, status: 'none' };
}

function taskbarKey(projection: CurrentTaskbarProjection): string {
  return `${projection.status}:${projection.progress}`;
}

export class CurrentTaskEffectsCoordinator {
  private readonly soundedAttempts = new Set<string>();
  private readonly pendingTerminalRows = new Map<string, CurrentTaskRow>();
  private lastTaskbarKey?: string;

  constructor(private readonly port: CurrentTaskEffectsPort) {}

  hasPendingTerminalEffects(): boolean {
    return this.pendingTerminalRows.size > 0;
  }

  observeRows(rows: readonly CurrentTaskRow[]): void {
    this.captureTerminalObligations(rows);
  }

  async sync(rows: readonly CurrentTaskRow[]): Promise<void> {
    this.observeRows(rows);

    const errors: unknown[] = [];
    const taskbar = projectCurrentTaskbar(rows);
    const nextTaskbarKey = taskbarKey(taskbar);
    if (nextTaskbarKey !== this.lastTaskbarKey) {
      try {
        await this.port.setTaskbar(taskbar);
        this.lastTaskbarKey = nextTaskbarKey;
      } catch (error) {
        errors.push(error);
      }
    }

    for (const [attemptId, row] of [...this.pendingTerminalRows.entries()]) {
      if (row.status === 'completed') {
        if (!this.soundedAttempts.has(attemptId)) {
          try {
            await this.port.playSuccess();
            this.soundedAttempts.add(attemptId);
          } catch (error) {
            errors.push(error);
          }
        }

        if (this.soundedAttempts.has(attemptId)) {
          this.pendingTerminalRows.delete(attemptId);
        }
        continue;
      }

      if (
        row.status === 'error' &&
        row.failureKind !== 'cancelled' &&
        !this.soundedAttempts.has(attemptId)
      ) {
        try {
          await this.port.playError();
          this.soundedAttempts.add(attemptId);
        } catch (error) {
          errors.push(error);
        }
      }

      if (
        row.status !== 'error' ||
        row.failureKind === 'cancelled' ||
        this.soundedAttempts.has(attemptId)
      ) {
        this.pendingTerminalRows.delete(attemptId);
      }
    }

    if (errors.length > 0) {
      throw errors[0];
    }
  }

  private captureTerminalObligations(rows: readonly CurrentTaskRow[]): void {
    for (const row of rows) {
      if (row.status === 'completed') {
        if (!this.soundedAttempts.has(row.attemptId)) {
          this.pendingTerminalRows.set(row.attemptId, row);
        }
        continue;
      }

      if (
        row.status === 'error' &&
        row.failureKind !== 'cancelled' &&
        !this.soundedAttempts.has(row.attemptId)
      ) {
        this.pendingTerminalRows.set(row.attemptId, row);
      }
    }
  }
}
