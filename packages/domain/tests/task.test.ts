import { describe, expect, it } from 'vitest';
import { DownloadStatus, DownloadTask } from '../src';

describe('DownloadTask', () => {
  it('starts as Created and emits creation event', () => {
    const task = new DownloadTask({ id: 'task-1', sourceUrl: 'https://example.com' });

    expect(task.getStatus()).toBe(DownloadStatus.Created);
    expect(task.pullEvents()).toEqual([{ type: 'TaskCreated', taskId: 'task-1' }]);
  });

  it('updates progress and respects clamping and invalid value retention', () => {
    const task = new DownloadTask({ id: 'task-1', sourceUrl: 'https://example.com' });
    expect(task.getProgress()).toBe(0);

    task.applyProgress(45.5);
    expect(task.getProgress()).toBe(45.5);

    // clamping
    task.applyProgress(150);
    expect(task.getProgress()).toBe(100);

    task.applyProgress(-10);
    expect(task.getProgress()).toBe(0);

    // invalid progress preserves previous valid snapshot
    task.applyProgress(60);
    expect(task.getProgress()).toBe(60);

    task.applyProgress(Number.NaN);
    expect(task.getProgress()).toBe(60);

    task.applyProgress(Number.POSITIVE_INFINITY);
    expect(task.getProgress()).toBe(60);
  });

  it('locks terminal state and ignores later progress or transitions', () => {
    const task = new DownloadTask({ id: 'task-1', sourceUrl: 'https://example.com' });
    task.transitionTo(DownloadStatus.Queued);
    task.transitionTo(DownloadStatus.Downloading);
    task.applyProgress(50);
    expect(task.getProgress()).toBe(50);

    task.transitionTo(DownloadStatus.Completed);
    expect(task.getStatus()).toBe(DownloadStatus.Completed);
    expect(task.getProgress()).toBe(100); // normalized to 100 on completed

    // further progress ignored
    task.applyProgress(75);
    expect(task.getProgress()).toBe(100);

    // further transition ignored (terminal lock)
    task.transitionTo(DownloadStatus.Downloading);
    expect(task.getStatus()).toBe(DownloadStatus.Completed);
  });

  it('applies active phase and progress atomically', () => {
    const task = new DownloadTask({ id: 'task-atomic', sourceUrl: 'https://example.com' });
    task.transitionTo(DownloadStatus.Queued);

    expect(task.applyExecutionProgress(DownloadStatus.Downloading, 42)).toBe(true);
    expect(task.getStatus()).toBe(DownloadStatus.Downloading);
    expect(task.getProgress()).toBe(42);

    expect(task.applyExecutionProgress(DownloadStatus.Processing, Number.NaN)).toBe(false);
    expect(task.getStatus()).toBe(DownloadStatus.Downloading);
    expect(task.getProgress()).toBe(42);
  });

  it('tracks cancellation intent separately from trusted terminal state', () => {
    const task = new DownloadTask({ id: 'task-cancel-intent', sourceUrl: 'https://example.com' });
    task.transitionTo(DownloadStatus.Queued);
    task.transitionTo(DownloadStatus.Downloading);

    expect(task.isCancellationRequested()).toBe(false);

    task.requestCancellation();
    expect(task.isCancellationRequested()).toBe(true);
    expect(task.getStatus()).toBe(DownloadStatus.Downloading);

    task.clearCancellationRequest();
    expect(task.isCancellationRequested()).toBe(false);
    expect(task.getStatus()).toBe(DownloadStatus.Downloading);

    task.requestCancellation();
    task.transitionTo(DownloadStatus.Cancelled);
    expect(task.isCancellationRequested()).toBe(true);
    expect(task.getStatus()).toBe(DownloadStatus.Cancelled);
  });
});
