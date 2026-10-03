import { describe, expect, it } from 'vitest';

import type { CurrentTaskRow } from '../../packages/contracts/src';
import { resolveCurrentDownloadFormat } from '../../packages/application/src';
import type { DownloadFormat } from '../../src/types';
import {
  isAudioFormat as isPresentationAudioFormat,
  toCurrentTaskPresentationRow,
} from '../../src/application/taskPresentation';

describe('task presentation adapter', () => {
  it('normalizes CurrentTaskRow without leaking candidate naming differences into Vue', () => {
    const current: CurrentTaskRow = {
      rowId: 'row-2',
      attemptId: 'attempt-2',
      sourceUrl: 'https://example.com/current',
      status: 'completed',
      orderKey: 42,
      metadata: {
        title: 'Current title',
        thumbnail: 'thumb.jpg',
        duration: '2:00',
        channel: 'Example',
        url: 'https://example.com/current',
        filename: 'analysis-preview.webm',
        filesize: '294.83 MB',
      },
      selectedFormat: 'mkv',
      cancelRequested: false,
      progress: 100,
      speed: '4 MiB/s',
      finalPath: 'C:/Downloads/final.mkv',
      logs: ['complete'],
      debugCommand: 'yt-dlp current',
      actions: {
        canCancel: false,
        canRemove: true,
        canOpenFolder: true,
        canStartDownload: false,
        canRetryDownload: false,
        canReanalyze: false,
      },
    };

    const row = toCurrentTaskPresentationRow(current);

    expect(row).toEqual({
      id: 'attempt-2',
      rowId: 'row-2',
      url: 'https://example.com/current',
      status: 'completed',
      metadata: {
        title: 'Current title',
        thumbnail: 'thumb.jpg',
        duration: '2:00',
        channel: 'Example',
        url: 'https://example.com/current',
        filename: 'final.mkv',
      },
      progress: 100,
      speed: '4 MiB/s',
      logs: ['complete'],
      title: 'Current title',
      debugCommand: 'yt-dlp current',
      selectedFormat: 'mkv',
      path: 'C:/Downloads/final.mkv',
      failureKind: undefined,
      cancelRequested: false,
      orderKey: 42,
      queuedAt: undefined,
      updatedAt: undefined,
      lastTerminalAt: undefined,
      actions: current.actions,
    });

    // The UI contract must not share mutable state with the service-owned row.
    expect(row.logs).not.toBe(current.logs);
    expect(row.metadata).not.toBe(current.metadata);
    expect(row.metadata?.filename).toBe('final.mkv');
    expect(row.metadata?.filesize).toBeUndefined();
  });

  it('matches the current download engine audio vocabulary', () => {
    const formats: Array<DownloadFormat | undefined> = [
      'audio',
      'mp3',
      'flac',
      'm4a',
      'opus',
      'video',
      'mkv',
      undefined,
    ];

    for (const format of formats) {
      expect(isPresentationAudioFormat(format)).toBe(
        resolveCurrentDownloadFormat(format).downloadType === 'audio',
      );
    }
  });
});
