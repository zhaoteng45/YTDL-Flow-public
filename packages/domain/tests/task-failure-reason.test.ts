import { describe, expect, it } from 'vitest';

import { DownloadStatus, DownloadTask } from '../src';

describe('DownloadTask failure reason', () => {
  it('retains the trusted reason when transitioning to Failed', () => {
    const task = new DownloadTask({ id: 'task-failed', sourceUrl: 'https://example.com/v' });

    task.transitionTo(DownloadStatus.Queued);
    task.transitionTo(DownloadStatus.Downloading);
    task.transitionTo(DownloadStatus.Failed, 'yt-dlp exited with code 1');

    expect(task.getStatus()).toBe(DownloadStatus.Failed);
    expect(task.getFailureReason()).toBe('yt-dlp exited with code 1');
  });

  it('keeps a terminal Failed reason locked against late progress and duplicate results', () => {
    const task = new DownloadTask({ id: 'task-locked', sourceUrl: 'https://example.com/v' });
    task.transitionTo(DownloadStatus.Queued);
    task.transitionTo(DownloadStatus.Failed, 'first reason');

    task.transitionTo(DownloadStatus.Failed, 'second reason');
    task.applyProgress(80);
    task.applyExecutionProgress(DownloadStatus.Downloading, 80);

    expect(task.getStatus()).toBe(DownloadStatus.Failed);
    expect(task.getFailureReason()).toBe('first reason');
  });

  it('does not invent a reason for non-Failed terminals', () => {
    const completed = new DownloadTask({ id: 'task-ok', sourceUrl: 'https://example.com/v' });
    completed.transitionTo(DownloadStatus.Queued);
    completed.transitionTo(DownloadStatus.Completed);
    expect(completed.getFailureReason()).toBeUndefined();

    const cancelled = new DownloadTask({ id: 'task-cancel', sourceUrl: 'https://example.com/v' });
    cancelled.transitionTo(DownloadStatus.Queued);
    cancelled.transitionTo(DownloadStatus.Cancelled);
    expect(cancelled.getFailureReason()).toBeUndefined();
  });
});
