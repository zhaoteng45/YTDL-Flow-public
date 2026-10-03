import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CurrentTaskService } from '../../packages/application/src';
import {
  createCurrentTaskPresentationActions,
  type CurrentTaskPort,
} from '../../src/application/taskPresentationActions';

const presentationActionsSource = readFileSync(
  resolve('src/application/taskPresentationActions.ts'),
  'utf8',
);

describe('task command surface', () => {
  it('exposes exactly the row-scoped lifecycle commands through the current facade', () => {
    const port: CurrentTaskPort = {
      analyzeMany: () => {},
      start: () => {},
      cancel: () => {},
      remove: () => {},
      retry: () => {},
      reanalyze: () => {},
    };

    expect(Object.keys(createCurrentTaskPresentationActions(port)).sort()).toEqual([
      'analyzeUrls',
      'cancel',
      'reanalyze',
      'remove',
      'retryDownload',
      'startDownload',
    ]);
  });

  it('retains only the current adapter factory, not legacy/candidate compatibility shims', () => {
    expect(presentationActionsSource).toMatch(/createCurrentTaskPresentationActions/);
    expect(presentationActionsSource).not.toMatch(/createLegacyTaskPresentationActions|LegacyTaskPort/);
    expect(presentationActionsSource).not.toMatch(/createCandidateTaskPresentationActions|CandidateTaskPort/);
  });

  it('keeps CurrentTaskService row-scoped and free of retired queue-wide wrappers', () => {
    const prototype = CurrentTaskService.prototype as unknown as Record<string, unknown>;
    for (const method of ['analyzeMany', 'start', 'cancel', 'remove', 'retry', 'reanalyze']) {
      expect(typeof prototype[method]).toBe('function');
    }

    for (const method of [
      'startMany',
      'retryFailedDownloads',
      'cancelQueued',
      'removeMany',
      'clearCompleted',
    ]) {
      expect(method in CurrentTaskService.prototype).toBe(false);
    }
  });
});
