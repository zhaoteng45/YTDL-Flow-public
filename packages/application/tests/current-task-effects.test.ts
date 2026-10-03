import { describe, expect, it } from 'vitest';

import type { CurrentTaskRow } from '../../contracts/src';
import {
  CurrentTaskEffectsCoordinator,
  projectCurrentTaskbar,
  type CurrentTaskbarProjection,
} from '../src';

const noneActions = {
  canCancel: false,
  canRemove: false,
  canOpenFolder: false,
  canStartDownload: false,
  canRetryDownload: false,
  canReanalyze: false,
};

const row = (overrides: Partial<CurrentTaskRow>): CurrentTaskRow => ({
  rowId: 'row-1',
  attemptId: 'attempt-1',
  sourceUrl: 'https://example.com/video',
  status: 'analyzed',
  orderKey: 1,
  cancelRequested: false,
  progress: 0,
  logs: [],
  actions: noneActions,
  ...overrides,
});

describe('current task presentation/effects', () => {
  it('projects taskbar state with legacy precedence and clamped average progress', () => {
    expect(projectCurrentTaskbar([])).toEqual({ progress: 0, status: 'none' });
    expect(projectCurrentTaskbar([
      row({ rowId: 'a', attemptId: 'a', status: 'analyzing' }),
    ])).toEqual({ progress: 0, status: 'indeterminate' });
    expect(projectCurrentTaskbar([
      row({ rowId: 'a', attemptId: 'a', status: 'processing' }),
      row({ rowId: 'b', attemptId: 'b', status: 'error', failureKind: 'download' }),
    ])).toEqual({ progress: 0, status: 'indeterminate' });
    expect(projectCurrentTaskbar([
      row({ rowId: 'a', attemptId: 'a', status: 'downloading', progress: 25 }),
      row({ rowId: 'b', attemptId: 'b', status: 'downloading', progress: 176 }),
      row({ rowId: 'c', attemptId: 'c', status: 'error', failureKind: 'download' }),
    ])).toEqual({ progress: 100, status: 'normal' });
    expect(projectCurrentTaskbar([
      row({ status: 'error', failureKind: 'download' }),
    ])).toEqual({ progress: 100, status: 'error' });
    expect(projectCurrentTaskbar([
      row({ status: 'error', failureKind: 'cancelled' }),
      row({ rowId: 'q', attemptId: 'q', status: 'queued' }),
      row({ rowId: 'p', attemptId: 'p', status: 'pending' }),
    ])).toEqual({ progress: 0, status: 'none' });
  });

  it('emits completion audio once per attempt', async () => {
    const sounds: string[] = [];
    const taskbar: CurrentTaskbarProjection[] = [];
    const effects = new CurrentTaskEffectsCoordinator({
      playSuccess: () => { sounds.push('success'); },
      playError: () => { sounds.push('error'); },
      setTaskbar: (projection) => { taskbar.push(projection); },
    });

    const completed = row({
      status: 'completed',
      progress: 100,
      finalPath: 'C:/Downloads/final.mp4',
      selectedFormat: 'video',
    });

    await effects.sync([completed]);
    await effects.sync([completed]);

    expect(sounds).toEqual(['success']);
    expect(taskbar).toEqual([{ progress: 0, status: 'none' }]);
  });

  it('isolates taskbar failure from terminal audio obligations', async () => {
    const sounds: string[] = [];
    let taskbarFailures = 1;
    const effects = new CurrentTaskEffectsCoordinator({
      playSuccess: () => { sounds.push('success'); },
      playError: () => { sounds.push('error'); },
      setTaskbar: () => {
        if (taskbarFailures-- > 0) throw new Error('taskbar unavailable');
      },
    });

    const completed = row({
      status: 'completed',
      progress: 100,
      finalPath: 'C:/Downloads/final.mp4',
      selectedFormat: 'video',
    });

    await expect(effects.sync([completed])).rejects.toThrow('taskbar unavailable');
    expect(sounds).toEqual(['success']);

    await expect(effects.sync([completed])).resolves.toBeUndefined();
    expect(sounds).toEqual(['success']);
  });

  it('plays error audio once for non-cancelled terminal errors and never for cancellation', async () => {
    const sounds: string[] = [];
    const effects = new CurrentTaskEffectsCoordinator({
      playSuccess: () => { sounds.push('success'); },
      playError: () => { sounds.push('error'); },
      setTaskbar: async () => {},
    });

    const analysisFailure = row({
      attemptId: 'analysis-fail',
      status: 'error',
      failureKind: 'analysis',
    });
    const downloadFailure = row({
      rowId: 'row-2',
      attemptId: 'download-fail',
      status: 'error',
      failureKind: 'download',
    });
    const cancelled = row({
      rowId: 'row-3',
      attemptId: 'cancelled',
      status: 'error',
      failureKind: 'cancelled',
    });

    await effects.sync([analysisFailure, downloadFailure, cancelled]);
    await effects.sync([analysisFailure, downloadFailure, cancelled]);

    expect(sounds).toEqual(['error', 'error']);
  });
});
