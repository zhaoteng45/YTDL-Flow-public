import type { DownloadEngine } from '../../packages/application/src/download-engine';
import type { EngineUpdate } from '../../packages/contracts/src';

export interface NativeSmokeTaskAuditSnapshot {
  resultCount: number;
  updates: EngineUpdate[];
}

export interface NativeSmokeTaskAudit {
  firstResult: Promise<void>;
  snapshot(): NativeSmokeTaskAuditSnapshot;
}

export interface NativeSmokeAudit {
  registerTask(taskId: string, onProgress?: () => void): NativeSmokeTaskAudit;
  dispose(): void;
}

interface TaskAuditState {
  updates: EngineUpdate[];
  resultCount: number;
  onProgress?: () => void;
  resolveFirstResult: () => void;
  firstResultResolved: boolean;
  firstResult: Promise<void>;
}

export function createNativeSmokeAudit(
  engine: Pick<DownloadEngine, 'subscribeUpdates'>,
): NativeSmokeAudit {
  const tasks = new Map<string, TaskAuditState>();
  let disposed = false;

  const unsubscribe = engine.subscribeUpdates((update) => {
    if (disposed) {
      return;
    }

    const task = tasks.get(update.taskId);
    if (!task) {
      return;
    }

    task.updates.push(update);

    if (update.type === 'progress') {
      task.onProgress?.();
      return;
    }

    task.resultCount += 1;
    if (!task.firstResultResolved) {
      task.firstResultResolved = true;
      task.resolveFirstResult();
    }
  });

  return {
    registerTask(taskId, onProgress) {
      if (disposed) {
        throw new Error('Native smoke audit is already disposed');
      }
      if (tasks.has(taskId)) {
        throw new Error(`Native smoke task already registered: ${taskId}`);
      }

      let resolveFirstResult!: () => void;
      const firstResult = new Promise<void>((resolve) => {
        resolveFirstResult = resolve;
      });

      const state: TaskAuditState = {
        updates: [],
        resultCount: 0,
        onProgress,
        resolveFirstResult,
        firstResultResolved: false,
        firstResult,
      };
      tasks.set(taskId, state);

      return {
        firstResult,
        snapshot() {
          return {
            resultCount: state.resultCount,
            updates: [...state.updates],
          };
        },
      };
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribe();
    },
  };
}
