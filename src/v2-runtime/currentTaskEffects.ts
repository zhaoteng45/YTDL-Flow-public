import type {
  CurrentTaskEffectsPort,
  CurrentTaskbarProjection,
} from '../../packages/application/src';
import { safeInvoke } from '../utils/tauri';

export interface CurrentTaskEffectsAdapterDeps {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

const defaultDeps: CurrentTaskEffectsAdapterDeps = {
  invoke(command, args) {
    return safeInvoke(command, args);
  },
};

export function createCurrentTaskEffectsPort(
  deps: CurrentTaskEffectsAdapterDeps = defaultDeps,
): CurrentTaskEffectsPort {
  return {
    async setTaskbar(projection: CurrentTaskbarProjection) {
      await deps.invoke('set_taskbar_progress', {
        progress: projection.progress,
        status: projection.status,
      });
    },
    // Preserve the application port without reviving a retired product sound preference.
    playSuccess() {},
    playError() {},
  };
}
