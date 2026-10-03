export interface AppUpdateDownloadEvent {
  event: string;
  data: {
    contentLength?: number;
  };
}

export interface AppUpdateHandle {
  version: string;
  downloadAndInstall(
    listener: (event: AppUpdateDownloadEvent) => void,
  ): Promise<void>;
}

export type AppUpdateProgress =
  | { phase: 'downloading'; version: string; totalBytes: number | null }
  | { phase: 'restarting'; version: string };

export type AppUpdateResult =
  | { status: 'latest' }
  | { status: 'installed'; version: string };

interface AppUpdateDependencies {
  check(): Promise<AppUpdateHandle | null>;
  relaunch(): Promise<void>;
}

export interface AppUpdateOperations {
  run(listener?: (event: AppUpdateProgress) => void): Promise<AppUpdateResult>;
}

export function createAppUpdateOperations(
  deps: AppUpdateDependencies,
): AppUpdateOperations {
  return {
    async run(listener) {
      const update = await deps.check();
      if (update === null) {
        return { status: 'latest' };
      }

      listener?.({
        phase: 'downloading',
        version: update.version,
        totalBytes: null,
      });

      await update.downloadAndInstall((event) => {
        if (event.event !== 'Started') return;
        listener?.({
          phase: 'downloading',
          version: update.version,
          totalBytes: event.data.contentLength ?? 0,
        });
      });

      listener?.({ phase: 'restarting', version: update.version });
      await deps.relaunch();

      return { status: 'installed', version: update.version };
    },
  };
}
