import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveCurrentTaskActions } from '../../packages/application/src/current-task-projection';
import type { CurrentFailureKind, CurrentTaskRow } from '../../packages/contracts/src';
import {
  toCurrentTaskPresentationRow,
  type TaskPresentationRow,
} from '../../src/application/taskPresentation';
import {
  getDownloadListStatusText,
  parseDownloadErrorMessage,
  shouldShowNumericProgress,
  getTaskActions,
  classifyTaskFailure,
  getAudioBadgeText,
  getCredentialFailureKeys,
  getCredentialReasonKey,
  getCredentialSourceKey,
  getPrimaryTaskAction,
  getRowOverflowActions,
  isAudioFormat,
} from '../../src/components/downloadList.helpers';

const helpersSource = readFileSync(resolve('src/components/downloadList.helpers.ts'), 'utf8');

/**
 * Builds the same row shape the UI receives in production:
 * a CurrentTaskRow projected through the presentation adapter, with the
 * service-owned action projection attached.
 */
function makeRow(overrides: Partial<CurrentTaskRow> = {}): TaskPresentationRow {
  const status = overrides.status ?? 'queued';
  const failureKind = overrides.failureKind;
  const row: CurrentTaskRow = {
    rowId: overrides.rowId ?? `row-${Math.random().toString(36).slice(2, 9)}`,
    attemptId: overrides.attemptId ?? `attempt-${Math.random().toString(36).slice(2, 9)}`,
    sourceUrl: overrides.sourceUrl ?? 'https://example.com/video',
    status,
    orderKey: overrides.orderKey ?? 0,
    progress: overrides.progress ?? 0,
    logs: [],
    cancelRequested: false,
    actions: resolveCurrentTaskActions({ status, failureKind }),
    ...overrides,
  };
  return toCurrentTaskPresentationRow(row);
}

describe('actual credential source label', () => {
  it('distinguishes browser, preferred file, authorized backup and anonymous without exposing a path', () => {
    expect(getCredentialSourceKey({ source: 'browser', reason: 'browser-ok' })).toBe('download_list.credential_source.browser');
    expect(getCredentialSourceKey({ source: 'file', reason: 'file-ok' })).toBe('download_list.credential_source.file');
    expect(getCredentialSourceKey({ source: 'file', reason: 'backup-file', browserFailure: 'locked' })).toBe('download_list.credential_source.backup');
    expect(getCredentialSourceKey({ source: 'anonymous', reason: 'backup-unavailable' })).toBe('download_list.credential_source.anonymous');
    expect(getCredentialSourceKey({ source: 'anonymous', reason: 'smart-anonymous', browserFailure: 'locked' })).toBe('download_list.credential_source.anonymous');
    expect(getCredentialSourceKey({ source: 'anonymous', reason: 'backup-file' as unknown as 'smart-anonymous' })).toBeUndefined();
    expect(getCredentialSourceKey({ source: 'browser', reason: 'C:/Users/alice/cookies.txt' as unknown as 'browser-ok' })).toBeUndefined();
    expect(getCredentialSourceKey(undefined)).toBeUndefined();
  });

  it('defines matching zh-CN and en-US i18n copy for credential source labels', () => {
    const zh = JSON.parse(readFileSync(resolve('src/locales/zh-CN.json'), 'utf8')) as {
      download_list?: { credential_source?: Record<string, string> };
    };
    const en = JSON.parse(readFileSync(resolve('src/locales/en-US.json'), 'utf8')) as {
      download_list?: { credential_source?: Record<string, string> };
    };

    expect(zh.download_list?.credential_source).toEqual({
      label: '实际凭证来源',
      browser: '浏览器',
      file: 'Cookies 文件',
      backup: '备用 Cookies 文件',
      anonymous: '匿名',
    });
    expect(en.download_list?.credential_source).toEqual({
      label: 'Actual credential source',
      browser: 'Browser',
      file: 'Cookies file',
      backup: 'Backup Cookies file',
      anonymous: 'Anonymous',
    });
  });

  it('maps frozen credential reasons and browser/file failure enums to safe i18n keys while rejecting unknown inputs', () => {
    expect(getCredentialReasonKey({ source: 'browser', reason: 'browser-ok' })).toBe(
      'download_list.credential_reason.browser-ok',
    );
    expect(getCredentialReasonKey({ source: 'file', reason: 'file-ok' })).toBe(
      'download_list.credential_reason.file-ok',
    );
    expect(
      getCredentialReasonKey({ source: 'file', reason: 'backup-file', browserFailure: 'locked' }),
    ).toBe('download_list.credential_reason.backup-file');
    expect(
      getCredentialReasonKey({ source: 'anonymous', reason: 'unconfigured' }),
    ).toBe('download_list.credential_reason.unconfigured');
    expect(
      getCredentialReasonKey({
        source: 'anonymous',
        reason: 'backup-not-authorized',
        browserFailure: 'decrypt_failed',
      }),
    ).toBe('download_list.credential_reason.backup-not-authorized');
    expect(
      getCredentialReasonKey({
        source: 'anonymous',
        reason: 'backup-unavailable',
        browserFailure: 'permission_denied',
        fileFailure: 'expired',
      }),
    ).toBe('download_list.credential_reason.backup-unavailable');
    expect(
      getCredentialReasonKey({
        source: 'anonymous',
        reason: 'preferred-file-unavailable',
        fileFailure: 'mismatch',
      }),
    ).toBe('download_list.credential_reason.preferred-file-unavailable');
    expect(
      getCredentialReasonKey({
        source: 'anonymous',
        reason: 'smart-anonymous',
        browserFailure: 'locked',
      }),
    ).toBe('download_list.credential_reason.smart-anonymous');

    expect(
      getCredentialFailureKeys({
        source: 'anonymous',
        reason: 'backup-unavailable',
        browserFailure: 'decrypt_failed',
        fileFailure: 'expired',
      }),
    ).toEqual(['settings.browser.decrypt_failed', 'input.cookie_state.expired']);

    expect(
      getCredentialReasonKey({
        source: 'anonymous',
        reason: 'C:/Users/private/cookies.txt' as unknown as 'unconfigured',
      }),
    ).toBeUndefined();
    expect(
      getCredentialFailureKeys({
        source: 'anonymous',
        reason: 'backup-unavailable',
        browserFailure: 'C:/Users/private/Login Data' as unknown as 'locked',
        fileFailure: 'Error: EACCES C:/Users/private/cookies.txt' as unknown as 'unreadable',
      }),
    ).toEqual([]);
    expect(getCredentialReasonKey(undefined)).toBeUndefined();
    expect(getCredentialFailureKeys(undefined)).toEqual([]);
  });

  it('defines matching zh-CN and en-US i18n copy for frozen credential reasons', () => {
    const zh = JSON.parse(readFileSync(resolve('src/locales/zh-CN.json'), 'utf8')) as {
      download_list?: { credential_reason?: Record<string, string> };
    };
    const en = JSON.parse(readFileSync(resolve('src/locales/en-US.json'), 'utf8')) as {
      download_list?: { credential_reason?: Record<string, string> };
    };

    const expectedKeys = [
      'label',
      'browser-ok',
      'browser-unavailable',
      'file-ok',
      'backup-file',
      'unconfigured',
      'backup-not-authorized',
      'backup-unavailable',
      'preferred-file-unavailable',
      'smart-anonymous',
    ];
    expect(Object.keys(zh.download_list?.credential_reason ?? {}).sort()).toEqual(
      [...expectedKeys].sort(),
    );
    expect(Object.keys(en.download_list?.credential_reason ?? {}).sort()).toEqual(
      [...expectedKeys].sort(),
    );
  });
});

describe('getDownloadListStatusText', () => {
  it.each([
    ['cancelled', 'Connection reset', 'cancelled'],
    ['analysis', 'invalid URL', 'parse_failed'],
    ['download', 'disk full', 'download_failed'],
    ['download', 'Unable to download: Connection timed out', 'network_failed'],
    ['unknown', 'unexpected result', 'unknown_error'],
    [undefined, undefined, 'unknown_error'],
  ] as const)('labels %s failures without changing the domain kind', (kind, message, label) => {
    expect(getDownloadListStatusText('error', (key) => key, kind, message))
      .toBe(`download_list.status.${label}`);
  });
  it('keeps analyzed distinct from pending', () => {
    const t = (key: string) => {
      if (key === 'download_list.status.analyzed') return 'Ready to download';
      if (key === 'download_list.status.pending') return 'Pending';
      return key;
    };

    expect(getDownloadListStatusText('analyzed', t)).toBe('Ready to download');
    expect(getDownloadListStatusText('pending', t)).toBe('Pending');
  });

  it('falls back to the ready-to-download label when the analyzed key is missing', () => {
    expect(getDownloadListStatusText('analyzed', (key) => key)).toBe('Ready to download');
  });
});

describe('parseDownloadErrorMessage', () => {
  it('splits actionable error text into title and hint', () => {
    expect(parseDownloadErrorMessage('Cookies invalid - Please refresh browser cookies')).toEqual({
      title: 'Cookies invalid',
      hint: 'Please refresh browser cookies',
    });
  });

  it('normalizes low-level filesystem and permission errors to user-friendly copy and normalized Windows paths', () => {
    const raw = "External command error: yt-dlp exited with code 1: ERROR: unable to open for writing: [Errno 13] Permission denied: 'C:\\\\Users\\\\zhao\\\\Downloads'";
    // Supports localized options from caller
    expect(parseDownloadErrorMessage(raw, {
      filesystemTitle: 'File Operation Failed',
      filesystemAction: 'Check download directory permissions or disk space',
    })).toEqual({
      title: 'File Operation Failed',
      hint: 'Check download directory permissions or disk space (C:\\Users\\zhao\\Downloads)',
    });

    // Default fallback when options are not provided
    expect(parseDownloadErrorMessage(raw)).toEqual({
      title: '无法写入下载文件',
      hint: '请检查下载目录权限或磁盘空间 (C:\\Users\\zhao\\Downloads)',
    });
  });

  it('falls back to unknown error text when empty', () => {
    expect(parseDownloadErrorMessage(undefined, 'Unknown Error')).toEqual({
      title: 'Unknown Error',
      hint: '',
    });
  });
});

describe('shouldShowNumericProgress', () => {
  it('shows numeric progress only for downloading tasks', () => {
    expect(shouldShowNumericProgress('downloading')).toBe(true);
    expect(shouldShowNumericProgress('processing')).toBe(false);
    expect(shouldShowNumericProgress('analyzing')).toBe(false);
    expect(shouldShowNumericProgress('analyzed')).toBe(false);
  });
});

describe('classifyTaskFailure', () => {
  it('returns undefined for non-error rows', () => {
    expect(classifyTaskFailure(makeRow({ status: 'completed' }))).toBeUndefined();
    expect(classifyTaskFailure(makeRow({ status: 'downloading' }))).toBeUndefined();
    expect(classifyTaskFailure(makeRow({ status: 'queued' }))).toBeUndefined();
  });

  it.each<CurrentFailureKind>(['analysis', 'download', 'cancelled', 'unknown'])(
    'passes through the %s classification projected onto the current row',
    (failureKind) => {
      expect(classifyTaskFailure(makeRow({ status: 'error', failureKind }))).toBe(failureKind);
    },
  );
});

describe('getTaskActions', () => {
  it('returns the action projection prepared by the current task service', () => {
    const row = makeRow({ status: 'analyzed' });

    expect(getTaskActions(row)).toBe(row.actions);
    expect(getTaskActions(row)).toMatchObject({
      canCancel: true,
      canStartDownload: true,
    });
  });

  it('reflects the current row affordances for waiting and active phases', () => {
    expect(getTaskActions(makeRow({ status: 'queued' }))).toMatchObject({ canCancel: true, canStartDownload: false });
    expect(getTaskActions(makeRow({ status: 'analyzing' }))).toMatchObject({ canCancel: false });
    expect(getTaskActions(makeRow({ status: 'pending' }))).toMatchObject({ canCancel: false });
    expect(getTaskActions(makeRow({ status: 'downloading' }))).toMatchObject({ canCancel: true });
    expect(getTaskActions(makeRow({ status: 'processing' }))).toMatchObject({ canCancel: true });
  });

  it('reflects the current row affordances for terminal phases', () => {
    expect(getTaskActions(makeRow({ status: 'completed', finalPath: '/some/path' }))).toMatchObject({
      canOpenFolder: true,
      canRemove: true,
    });
    expect(getTaskActions(makeRow({ status: 'error', failureKind: 'analysis' }))).toMatchObject({
      canReanalyze: true,
      canRetryDownload: false,
    });
    expect(getTaskActions(makeRow({ status: 'error', failureKind: 'cancelled' }))).toMatchObject({
      canReanalyze: true,
      canRetryDownload: false,
    });
    expect(getTaskActions(makeRow({ status: 'error', failureKind: 'unknown' }))).toMatchObject({
      canRetryDownload: false,
      canReanalyze: true,
      canRemove: true,
    });

    const downloadFailure = makeRow({
      status: 'error',
      failureKind: 'download',
      actions: resolveCurrentTaskActions({
        status: 'error',
        failureKind: 'download',
        hasExecution: true,
        hasDownloadIntent: true,
      }),
    });
    expect(getTaskActions(downloadFailure)).toMatchObject({
      canRetryDownload: true,
      canReanalyze: false,
    });
  });
});

describe('task presentation actions', () => {
  it('derives the primary row action from service-owned affordances', () => {
    expect(getPrimaryTaskAction(makeRow({ status: 'analyzed' }))).toBe('download');
    expect(getPrimaryTaskAction(makeRow({ status: 'queued' }))).toBe('cancel');
    expect(getPrimaryTaskAction(makeRow({ status: 'downloading' }))).toBe('cancel');
    expect(getPrimaryTaskAction(makeRow({ status: 'completed', finalPath: 'C:/Downloads/video.mp4' }))).toBe('open-folder');
    expect(getPrimaryTaskAction(makeRow({ status: 'error', failureKind: 'analysis' }))).toBe('reanalyze');

    const downloadFailure = makeRow({
      status: 'error',
      failureKind: 'download',
      actions: resolveCurrentTaskActions({
        status: 'error',
        failureKind: 'download',
        hasExecution: true,
        hasDownloadIntent: true,
      }),
    });
    expect(getPrimaryTaskAction(downloadFailure)).toBe('retry-download');
  });

  it('derives one overflow list so an empty menu cannot be rendered', () => {
    expect(getRowOverflowActions(makeRow({ status: 'analyzed' }))).toEqual([]);
    expect(getRowOverflowActions(makeRow({ status: 'queued' }))).toEqual([]);

    const completed = makeRow({
      status: 'completed',
      finalPath: 'C:/Downloads/video.mp4',
    });
    expect(getRowOverflowActions(completed)).toEqual(['open-file', 'remove']);

    const analysisFailure = makeRow({
      status: 'error',
      failureKind: 'analysis',
    });
    expect(getRowOverflowActions(analysisFailure)).toEqual(['remove']);

    const downloadFailure = makeRow({
      status: 'error',
      failureKind: 'download',
      actions: resolveCurrentTaskActions({
        status: 'error',
        failureKind: 'download',
        hasExecution: true,
        hasDownloadIntent: true,
      }),
    });
    expect(getRowOverflowActions(downloadFailure)).toEqual(['remove']);
  });
});

describe('audio format helpers', () => {
  it('correctly identifies audio formats', () => {
    expect(isAudioFormat('mp3')).toBe(true);
    expect(isAudioFormat('flac')).toBe(true);
    expect(isAudioFormat('m4a')).toBe(true);
    expect(isAudioFormat('opus')).toBe(true);
    expect(isAudioFormat('audio')).toBe(true);
    expect(isAudioFormat('video')).toBe(false);
    expect(isAudioFormat('mkv')).toBe(false);
    expect(isAudioFormat(undefined)).toBe(false);
  });

  it('provides readable badge text for audio formats', () => {
    expect(getAudioBadgeText('flac')).toBe('FLAC');
    expect(getAudioBadgeText('opus')).toBe('Opus');
    expect(getAudioBadgeText('m4a')).toBe('M4A (AAC)');
    expect(getAudioBadgeText('mp3')).toBe('MP3');
    expect(getAudioBadgeText('audio')).toBe('');
    expect(getAudioBadgeText(undefined)).toBe('');
  });

  it('keeps audio classification in the presentation seam without taskQueue re-exports', () => {
    expect(helpersSource).not.toMatch(/queue\/taskQueue/);
    expect(helpersSource).not.toMatch(/resolveDownloadFormat/);
    expect(helpersSource).toMatch(/from '\.\.\/application\/taskPresentation'/);
  });
});
