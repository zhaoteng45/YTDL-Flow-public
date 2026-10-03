import { describe, expect, it } from 'vitest';

import type { CancelCommandResult } from '../../packages/application/src';
import {
  createCurrentTaskPresentationActions,
  type CurrentTaskPort,
} from '../../src/application/taskPresentationActions';

interface RecordedCall {
  method: string;
  args: unknown[];
}

function createRecorder() {
  const calls: RecordedCall[] = [];
  const record = <T>(method: string, result: T) => (...args: unknown[]): T => {
    calls.push({ method, args });
    return result;
  };
  return { calls, record };
}

function createCurrentPort() {
  const { calls, record } = createRecorder();
  const cancelled: CancelCommandResult = { outcome: { type: 'cancelled' } };
  const port: CurrentTaskPort = {
    analyzeMany: record('analyzeMany', []),
    start: record('start', Promise.resolve(undefined)),
    cancel: record('cancel', Promise.resolve(cancelled)),
    remove: record('remove', true),
    retry: record('retry', Promise.resolve(undefined)),
    reanalyze: record('reanalyze', { result: Promise.resolve(undefined) }),
  };
  return { port, calls };
}

describe('current task presentation actions facade', () => {
  it('delegates the row-scoped lifecycle surface one-to-one to the current port', async () => {
    const { port, calls } = createCurrentPort();
    const actions = createCurrentTaskPresentationActions(port);

    actions.analyzeUrls(['https://example.com/one', 'https://example.com/two']);
    await actions.startDownload('row-1', 'flac');
    await actions.cancel('row-1');
    actions.remove('row-2');
    await actions.retryDownload('row-3');
    await actions.reanalyze('row-4');

    expect(calls).toEqual([
      { method: 'analyzeMany', args: [['https://example.com/one', 'https://example.com/two']] },
      { method: 'start', args: ['row-1', 'flac'] },
      { method: 'cancel', args: ['row-1'] },
      { method: 'remove', args: ['row-2'] },
      { method: 'retry', args: ['row-3'] },
      { method: 'reanalyze', args: ['row-4'] },
    ]);
  });

  it('returns settlement promises for asynchronous lifecycle commands while keeping sync commands sync', async () => {
    const calls: string[] = [];
    const cancelResult: CancelCommandResult = { outcome: { type: 'cancel-requested' } };
    const port = {
      analyzeMany: (urls: readonly string[]) => {
        calls.push(`analyzeMany:${urls.length}`);
        return [];
      },
      start: () => {
        calls.push('start');
        return Promise.resolve();
      },
      cancel: () => {
        calls.push('cancel');
        return Promise.resolve(cancelResult);
      },
      remove: () => {
        calls.push('remove');
        return true;
      },
      retry: () => {
        calls.push('retry');
        return Promise.resolve();
      },
      reanalyze: () => {
        calls.push('reanalyze');
        return { result: Promise.resolve() };
      },
    } satisfies CurrentTaskPort;

    const actions = createCurrentTaskPresentationActions(port);

    expect(actions.analyzeUrls(['https://example.com/a', 'https://example.com/b'])).toBeUndefined();
    const start = actions.startDownload('row-1', 'video');
    const cancel = actions.cancel('row-1');
    expect(actions.remove('row-2')).toBeUndefined();
    const retry = actions.retryDownload('row-3');
    const reanalyze = actions.reanalyze('row-4');

    expect(start).toBeInstanceOf(Promise);
    expect(cancel).toBeInstanceOf(Promise);
    expect(retry).toBeInstanceOf(Promise);
    expect(reanalyze).toBeInstanceOf(Promise);
    await expect(start).resolves.toBeUndefined();
    await expect(cancel).resolves.toEqual(cancelResult);
    await expect(retry).resolves.toBeUndefined();
    await expect(reanalyze).resolves.toBeUndefined();

    expect(calls).toEqual(['analyzeMany:2', 'start', 'cancel', 'remove', 'retry', 'reanalyze']);
  });

  it('propagates async lifecycle failures instead of creating unhandled fire-and-forget rejections', async () => {
    const startFailure = Promise.reject(new Error('start failed'));
    const cancelFailure = Promise.reject(new Error('cancel failed'));
    const retryFailure = Promise.reject(new Error('retry failed'));
    const reanalyzeFailure = Promise.reject(new Error('reanalyze failed'));
    void startFailure.catch(() => undefined);
    void cancelFailure.catch(() => undefined);
    void retryFailure.catch(() => undefined);
    void reanalyzeFailure.catch(() => undefined);

    const port = {
      analyzeMany: () => [],
      start: () => startFailure,
      cancel: () => cancelFailure,
      remove: () => true,
      retry: () => retryFailure,
      reanalyze: () => ({ result: reanalyzeFailure }),
    } satisfies CurrentTaskPort;
    const actions = createCurrentTaskPresentationActions(port);

    await expect(actions.startDownload('row-start', 'video')).rejects.toThrow('start failed');
    await expect(actions.cancel('row-cancel')).rejects.toThrow('cancel failed');
    await expect(actions.retryDownload('row-retry')).rejects.toThrow('retry failed');
    await expect(actions.reanalyze('row-reanalyze')).rejects.toThrow('reanalyze failed');
  });
});
