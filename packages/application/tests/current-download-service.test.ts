import { describe, expect, it, vi } from 'vitest';

import type { CurrentDownloadCommand, DownloadStartRequest, TaskPayload } from '../../contracts/src';
import {
  buildCurrentDownloadOptions,
  CurrentDownloadService,
  resolveCurrentDownloadFormat,
  resolveCurrentTaskActions,
} from '../src/current-download-service';

type StartOptions = Partial<Omit<DownloadStartRequest, 'taskId' | 'sourceUrl'>>;
type StartOptionsProvider = () => StartOptions;

describe('current Vue download candidate application seam', () => {
  it('maps every current Vue format to the legacy-equivalent engine shape', () => {
    expect(resolveCurrentDownloadFormat('video')).toEqual({ downloadType: 'video' });
    expect(resolveCurrentDownloadFormat('audio')).toEqual({ downloadType: 'audio' });
    expect(resolveCurrentDownloadFormat('mkv')).toEqual({ downloadType: 'mkv' });
    expect(resolveCurrentDownloadFormat('mp3')).toEqual({ downloadType: 'audio', audioCodec: 'mp3' });
    expect(resolveCurrentDownloadFormat('flac')).toEqual({ downloadType: 'audio', audioCodec: 'flac' });
    expect(resolveCurrentDownloadFormat('m4a')).toEqual({ downloadType: 'audio', audioCodec: 'm4a' });
    expect(resolveCurrentDownloadFormat('opus')).toEqual({ downloadType: 'audio', audioCodec: 'opus' });
    expect(resolveCurrentDownloadFormat(undefined)).toEqual({ downloadType: 'video' });
  });

  it('preserves the full typed ExtraArgs fixture with legacy override precedence', () => {
    const options = buildCurrentDownloadOptions({
      format: 'flac',
      downloadDir: 'C:/Downloads',
      globalExtraArgs: {
        proxy: 'http://127.0.0.1:7890',
        cookies: 'chrome',
        userAgent: 'YTDL-Flow/Test',
        concurrentFragments: 4,
        embedMetadata: true,
        embedSubs: true,
        subLangs: 'en,zh-Hans',
        sponsorblock: true,
        filenameTemplate: '%(title)s.%(ext)s',
        resolution: '1080',
        videoCodec: 'av1',
        audioCodec: 'aac',
        adminMode: false,
        playerClient: 'web',
        poToken: 'po-token',
        visitorData: 'visitor-data',
        writeThumbnail: true,
        writeInfoJson: true,
      },
      taskOverrideArgs: {
        proxy: 'http://127.0.0.1:7891',
        audioCodec: 'opus',
        writeThumbnail: false,
      },
    });

    expect(options).toEqual({
      downloadType: 'audio',
      downloadDir: 'C:/Downloads',
      extraArgs: {
        proxy: 'http://127.0.0.1:7891',
        cookies: 'chrome',
        userAgent: 'YTDL-Flow/Test',
        concurrentFragments: 4,
        embedMetadata: true,
        embedSubs: true,
        subLangs: 'en,zh-Hans',
        sponsorblock: true,
        filenameTemplate: '%(title)s.%(ext)s',
        resolution: '1080',
        videoCodec: 'av1',
        audioCodec: 'flac',
        adminMode: false,
        playerClient: 'web',
        poToken: 'po-token',
        visitorData: 'visitor-data',
        writeThumbnail: false,
        writeInfoJson: true,
      },
    });
  });

  it('delegates one typed current command as a late-bound options provider', async () => {
    const calls: Array<{
      sourceUrl: string;
      options?: StartOptions | StartOptionsProvider;
      identity?: { rowId?: string };
    }> = [];
    const executor = {
      async createTask(
        sourceUrl: string,
        options?: StartOptions | StartOptionsProvider,
        identity?: { rowId?: string },
      ): Promise<TaskPayload> {
        calls.push({ sourceUrl, options, identity });
        return {
          id: 'attempt-1',
          rowId: identity?.rowId,
          attemptId: 'attempt-1',
          sourceUrl,
          status: 'Queued',
          progress: 0,
        };
      },
      async retryTask(): Promise<TaskPayload | undefined> {
        return undefined;
      },
      async cancelTask() {
        return { outcome: { type: 'not-cancellable' as const } };
      },
    };
    let globalProxy = 'global';
    let downloadDir = 'C:/Downloads';
    const service = new CurrentDownloadService(
      executor,
      {
        getGlobalExtraArgs: () => ({ proxy: globalProxy, audioCodec: 'aac' }),
        getDownloadDir: () => downloadDir,
      },
      { getTaskByRowId: () => undefined },
    );

    const command: CurrentDownloadCommand = {
      sourceUrl: 'https://example.com/video',
      format: 'm4a',
      taskOverrideArgs: { proxy: 'task' },
      rowId: 'row-current',
    };
    const task = await service.createTask(command);

    expect(task).toMatchObject({ id: 'attempt-1', rowId: 'row-current' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sourceUrl).toBe('https://example.com/video');
    expect(calls[0]?.identity).toEqual({ rowId: 'row-current' });
    expect(typeof calls[0]?.options).toBe('function');

    command.format = 'mp3';
    command.taskOverrideArgs!.proxy = 'mutated-task';
    command.taskOverrideArgs = { proxy: 'replaced-task' };
    globalProxy = 'global-later';
    downloadDir = 'C:/Downloads-Later';

    const provider = calls[0]?.options as StartOptionsProvider;
    expect(provider()).toEqual({
      downloadType: 'audio',
      downloadDir: 'C:/Downloads-Later',
      extraArgs: { proxy: 'task', audioCodec: 'm4a' },
    });
  });

  it('keeps Pending non-cancellable in the current Vue product action projection', () => {
    expect(resolveCurrentTaskActions({ id: 'p', sourceUrl: 'u', status: 'Pending', progress: 0 })).toMatchObject({
      canCancel: false,
      canRetryDownload: false,
      canRemove: false,
    });
    expect(resolveCurrentTaskActions({ id: 'q', sourceUrl: 'u', status: 'Queued', progress: 0 }).canCancel).toBe(true);
    expect(resolveCurrentTaskActions({
      id: 'd',
      sourceUrl: 'u',
      status: 'Downloading',
      progress: 50,
      cancelRequested: true,
    }).canCancel).toBe(false);
    expect(resolveCurrentTaskActions({ id: 'c', sourceUrl: 'u', status: 'Completed', progress: 100 })).toMatchObject({
      canOpenFolder: true,
      canRemove: true,
    });
    expect(resolveCurrentTaskActions({ id: 'f', sourceUrl: 'u', status: 'Failed', progress: 10 }).canRetryDownload).toBe(true);
  });

  it('does not forward Pending cancellation but forwards an eligible live row by attempt id', async () => {
    const cancelTask = vi.fn(async () => ({ outcome: { type: 'cancel-requested' as const } }));
    const rows = new Map<string, TaskPayload>([
      ['row-pending', {
        id: 'attempt-pending',
        rowId: 'row-pending',
        attemptId: 'attempt-pending',
        sourceUrl: 'https://example.com/pending',
        status: 'Pending',
        progress: 0,
      }],
      ['row-live', {
        id: 'attempt-live',
        rowId: 'row-live',
        attemptId: 'attempt-live',
        sourceUrl: 'https://example.com/live',
        status: 'Downloading',
        progress: 40,
      }],
    ]);
    const executor = {
      async createTask(): Promise<TaskPayload> {
        throw new Error('not used');
      },
      async retryTask(): Promise<TaskPayload | undefined> {
        return undefined;
      },
      cancelTask,
    };
    const service = new CurrentDownloadService(
      executor,
      { getGlobalExtraArgs: () => ({}), getDownloadDir: () => undefined },
      { getTaskByRowId: (rowId) => rows.get(rowId) },
    );

    await expect(service.cancelTask('row-pending')).resolves.toEqual({
      outcome: { type: 'not-cancellable' },
    });
    expect(cancelTask).not.toHaveBeenCalled();

    await expect(service.cancelTask('row-live')).resolves.toEqual({
      outcome: { type: 'cancel-requested' },
    });
    expect(cancelTask).toHaveBeenCalledWith('attempt-live');
  });
});
