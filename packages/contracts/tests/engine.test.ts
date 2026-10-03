import { describe, expect, it } from 'vitest';
import type { DownloadStartRequest, EngineUpdate } from '../src';

describe('engine contract types', () => {
  it('instantiates valid DownloadStartRequest', () => {
    const req: DownloadStartRequest = {
      taskId: 'task-1',
      sourceUrl: 'https://example.com/video',
      downloadType: 'video',
      downloadDir: '/downloads',
      extraArgs: { proxy: 'http://127.0.0.1:7890' },
    };

    expect(req.taskId).toBe('task-1');
  });

  it('distinguishes progress and result in EngineUpdate union', () => {
    const progressUpdate: EngineUpdate = {
      type: 'progress',
      taskId: 'task-1',
      phase: 'Downloading',
      progress: 55.4,
    };

    const resultUpdate: EngineUpdate = {
      type: 'result',
      taskId: 'task-1',
      outcome: 'Completed',
    };

    expect(progressUpdate.type).toBe('progress');
    expect(resultUpdate.type).toBe('result');
  });

  it('requires a download type for executable start requests', () => {
    // @ts-expect-error downloadType is required by the execution contract.
    const req: DownloadStartRequest = {
      taskId: 'task-missing-type',
      sourceUrl: 'https://example.com/video',
    };

    expect(req.taskId).toBe('task-missing-type');
  });
});
