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

  it('projects the frozen credential selection for UI without leaking source paths', () => {
    const current: CurrentTaskRow = {
      rowId: 'cookie-row',
      attemptId: 'cookie-attempt',
      sourceUrl: 'https://www.youtube.com/watch?v=fixture',
      status: 'analyzed',
      orderKey: 1,
      credential: { source: 'file', reason: 'backup-file', browserFailure: 'locked' },
      cancelRequested: false,
      progress: 0,
      logs: [],
      actions: {
        canCancel: false,
        canRemove: false,
        canOpenFolder: false,
        canStartDownload: true,
        canRetryDownload: false,
        canReanalyze: false,
      },
    };
    const presentation = toCurrentTaskPresentationRow(current);
    expect(presentation.credential).toEqual({
      source: 'file', reason: 'backup-file', browserFailure: 'locked',
    });
    expect(presentation.credential).not.toBe(current.credential);
    expect(JSON.stringify(presentation)).not.toMatch(/C:\\|cookies\.txt/i);
  });

  it('strips unexpected properties from credential selection and updates across reanalyze attempts', () => {
    const dirtyCredential = {
      source: 'anonymous',
      reason: 'backup-unavailable',
      browserFailure: 'decrypt_failed',
      fileFailure: 'expired',
      filePath: 'C:\\Users\\alice\\cookies.txt',
      cookieValue: 'SID=secret-cookie-token',
      rawError: 'DPAPI decrypt failed for Default profile',
    } as unknown as NonNullable<CurrentTaskRow['credential']>;

    const firstAttempt: CurrentTaskRow = {
      rowId: 'row-reanalyze',
      attemptId: 'attempt-1',
      sourceUrl: 'https://www.youtube.com/watch?v=fixture',
      status: 'error',
      failureKind: 'download',
      orderKey: 1,
      credential: dirtyCredential,
      cancelRequested: false,
      progress: 40,
      logs: [],
      actions: {
        canCancel: false,
        canRemove: true,
        canOpenFolder: false,
        canStartDownload: false,
        canRetryDownload: true,
        canReanalyze: true,
      },
    };

    const projectedFirst = toCurrentTaskPresentationRow(firstAttempt);
    expect(projectedFirst.credential).toEqual({
      source: 'anonymous',
      reason: 'backup-unavailable',
      browserFailure: 'decrypt_failed',
      fileFailure: 'expired',
    });
    expect(JSON.stringify(projectedFirst)).not.toMatch(
      /alice|cookies\.txt|secret-cookie-token|DPAPI|Default profile/i,
    );

    const analyzingNextAttempt: CurrentTaskRow = {
      ...firstAttempt,
      attemptId: 'attempt-2',
      status: 'analyzing',
      failureKind: undefined,
      credential: undefined,
      progress: 0,
    };
    expect(toCurrentTaskPresentationRow(analyzingNextAttempt).credential).toBeUndefined();

    const analyzedNextAttempt: CurrentTaskRow = {
      ...analyzingNextAttempt,
      status: 'analyzed',
      credential: { source: 'anonymous', reason: 'smart-anonymous', browserFailure: 'locked' },
    };
    expect(toCurrentTaskPresentationRow(analyzedNextAttempt)).toMatchObject({
      id: 'attempt-2',
      credential: { source: 'anonymous', reason: 'smart-anonymous', browserFailure: 'locked' },
    });

    const invalidReasonAttempt: CurrentTaskRow = {
      ...analyzedNextAttempt,
      credential: {
        source: 'anonymous',
        reason: 'C:\\Users\\alice\\cookies.txt' as unknown as CurrentTaskRow['credential'] extends Readonly<infer T> | undefined ? T extends { reason: infer R } ? R : never : never,
      },
    };
    expect(toCurrentTaskPresentationRow(invalidReasonAttempt).credential).toBeUndefined();

    const invalidFailureAttempt: CurrentTaskRow = {
      ...analyzedNextAttempt,
      credential: {
        source: 'anonymous',
        reason: 'smart-anonymous',
        browserFailure: 'DPAPI raw error C:\\Users\\alice' as unknown as NonNullable<CurrentTaskRow['credential']>['browserFailure'],
        fileFailure: 'ENOENT C:\\Users\\alice\\cookies.txt' as unknown as NonNullable<CurrentTaskRow['credential']>['fileFailure'],
      },
    };
    expect(toCurrentTaskPresentationRow(invalidFailureAttempt).credential).toEqual({
      source: 'anonymous',
      reason: 'smart-anonymous',
    });
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
