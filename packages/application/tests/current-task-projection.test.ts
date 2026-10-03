import { describe, expect, it } from 'vitest';

import type { CurrentTaskActions } from '../../contracts/src';
import { resolveCurrentTaskActions } from '../src/current-task-projection';

const none: CurrentTaskActions = {
  canCancel: false,
  canRemove: false,
  canOpenFolder: false,
  canStartDownload: false,
  canRetryDownload: false,
  canReanalyze: false,
};

describe('current Vue task action projection', () => {
  it.each([
    ['analyzing', { status: 'analyzing' as const }, none],
    ['analyzed', { status: 'analyzed' as const }, {
      ...none,
      canCancel: true,
      canStartDownload: true,
    }],
    ['queued', { status: 'queued' as const }, {
      ...none,
      canCancel: true,
    }],
    ['pending', { status: 'pending' as const }, none],
    ['downloading', {
      status: 'downloading' as const,
      hasExecution: true,
      hasDownloadIntent: true,
    }, {
      ...none,
      canCancel: true,
    }],
    ['downloading cancel requested', {
      status: 'downloading' as const,
      cancelRequested: true,
      hasExecution: true,
      hasDownloadIntent: true,
    }, none],
    ['processing', {
      status: 'processing' as const,
      hasExecution: true,
      hasDownloadIntent: true,
    }, {
      ...none,
      canCancel: true,
    }],
    ['completed', {
      status: 'completed' as const,
      hasExecution: true,
      hasDownloadIntent: true,
    }, {
      ...none,
      canRemove: true,
      canOpenFolder: true,
    }],
    ['analysis failure', {
      status: 'error' as const,
      failureKind: 'analysis' as const,
    }, {
      ...none,
      canRemove: true,
      canReanalyze: true,
    }],
    ['download failure', {
      status: 'error' as const,
      failureKind: 'download' as const,
      hasExecution: true,
      hasDownloadIntent: true,
    }, {
      ...none,
      canRemove: true,
      canRetryDownload: true,
    }],
    ['cancelled analysis-side row', {
      status: 'error' as const,
      failureKind: 'cancelled' as const,
      hasExecution: false,
      hasDownloadIntent: false,
    }, {
      ...none,
      canRemove: true,
      canReanalyze: true,
    }],
    ['cancelled execution row', {
      status: 'error' as const,
      failureKind: 'cancelled' as const,
      hasExecution: true,
      hasDownloadIntent: true,
    }, {
      ...none,
      canRemove: true,
      canRetryDownload: true,
    }],
    ['unknown analysis-side row', {
      status: 'error' as const,
      failureKind: 'unknown' as const,
      hasExecution: false,
      hasDownloadIntent: false,
    }, {
      ...none,
      canRemove: true,
      canReanalyze: true,
    }],
    ['unknown execution row', {
      status: 'error' as const,
      failureKind: 'unknown' as const,
      hasExecution: true,
      hasDownloadIntent: true,
    }, {
      ...none,
      canRemove: true,
      canRetryDownload: true,
    }],
  ])('%s', (_name, input, expected) => {
    expect(resolveCurrentTaskActions(input)).toEqual(expected);
  });
});
