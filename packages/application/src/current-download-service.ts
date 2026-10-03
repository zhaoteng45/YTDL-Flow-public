import type {
  CurrentDownloadCommand,
  CurrentDownloadFormat,
  CurrentExtraArgs,
  DownloadStartRequest,
  DownloadTypePayload,
  TaskPayload,
} from '../../contracts/src';
import type { CancelCommandResult } from './download-service';
import { resolveCurrentExecutionTaskActions } from './current-task-projection';

type CurrentAudioCodec = Extract<CurrentDownloadFormat, 'mp3' | 'flac' | 'm4a' | 'opus'>;
type CurrentTaskCoreOptions = Partial<Omit<DownloadStartRequest, 'taskId' | 'sourceUrl'>>;
type CurrentTaskCoreOptionsProvider = () => CurrentTaskCoreOptions;

export interface ResolvedCurrentDownloadFormat {
  downloadType: DownloadTypePayload;
  audioCodec?: CurrentAudioCodec;
}

export interface CurrentDownloadOptionsInput {
  format?: CurrentDownloadFormat;
  downloadDir?: string;
  globalExtraArgs?: CurrentExtraArgs;
  taskOverrideArgs?: Partial<CurrentExtraArgs>;
  /** Opaque native capture context; present only for captured tasks. */
  captureContextId?: string;
}

export interface CurrentDownloadEnvironment {
  getGlobalExtraArgs(): CurrentExtraArgs;
  getDownloadDir(): string | undefined;
}

export interface CurrentDownloadTaskQuery {
  getTaskByRowId(rowId: string): TaskPayload | undefined;
}

export interface CurrentDownloadTaskCore {
  createTask(
    sourceUrl: string,
    options?: CurrentTaskCoreOptions | CurrentTaskCoreOptionsProvider,
    identity?: { rowId?: string },
  ): Promise<TaskPayload>;
  retryTask(rowId: string): Promise<TaskPayload | undefined>;
  cancelTask(taskId: string): Promise<CancelCommandResult>;
  removeTask?(rowId: string): boolean;
}

export const resolveCurrentTaskActions = resolveCurrentExecutionTaskActions;

export function resolveCurrentDownloadFormat(
  format?: CurrentDownloadFormat,
): ResolvedCurrentDownloadFormat {
  if (format === 'mkv') {
    return { downloadType: 'mkv' };
  }
  if (format === 'mp3' || format === 'flac' || format === 'm4a' || format === 'opus') {
    return { downloadType: 'audio', audioCodec: format };
  }
  if (format === 'audio') {
    return { downloadType: 'audio' };
  }
  return { downloadType: 'video' };
}

export function buildCurrentDownloadOptions(
  input: CurrentDownloadOptionsInput,
): CurrentTaskCoreOptions {
  const resolved = resolveCurrentDownloadFormat(input.format);
  const mergedExtraArgs: CurrentExtraArgs = {
    ...input.globalExtraArgs,
    ...input.taskOverrideArgs,
  };

  if (resolved.audioCodec) {
    mergedExtraArgs.audioCodec = resolved.audioCodec;
  }

  return {
    downloadType: resolved.downloadType,
    downloadDir: input.downloadDir,
    extraArgs: { ...mergedExtraArgs },
    ...(input.captureContextId ? { captureContextId: input.captureContextId } : {}),
  };
}

export class CurrentDownloadService {
  constructor(
    private readonly taskCore: CurrentDownloadTaskCore,
    private readonly environment: CurrentDownloadEnvironment,
    private readonly taskQuery: CurrentDownloadTaskQuery,
  ) {}

  createTask(command: CurrentDownloadCommand): Promise<TaskPayload> {
    const sourceUrl = command.sourceUrl;
    const rowId = command.rowId;
    const format = command.format;
    const captureContextId = command.captureContextId;
    const taskOverrideArgs =
      command.taskOverrideArgs === undefined
        ? undefined
        : { ...command.taskOverrideArgs };

    const optionsProvider = (): CurrentTaskCoreOptions =>
      buildCurrentDownloadOptions({
        format,
        downloadDir: this.environment.getDownloadDir(),
        // A captured task never inherits global network identity.
        globalExtraArgs: captureContextId
          ? {}
          : this.environment.getGlobalExtraArgs(),
        taskOverrideArgs,
        ...(captureContextId ? { captureContextId } : {}),
      });

    return this.taskCore.createTask(
      sourceUrl,
      optionsProvider,
      rowId !== undefined ? { rowId } : undefined,
    );
  }

  retryTask(rowId: string): Promise<TaskPayload | undefined> {
    return this.taskCore.retryTask(rowId);
  }

  removeTask(rowId: string): boolean {
    return this.taskCore.removeTask?.(rowId) ?? false;
  }

  async cancelTask(rowId: string): Promise<CancelCommandResult> {
    const task = this.taskQuery.getTaskByRowId(rowId);
    if (!task || !resolveCurrentTaskActions(task).canCancel) {
      return { outcome: { type: 'not-cancellable' } };
    }

    return this.taskCore.cancelTask(task.attemptId ?? task.id);
  }
}
