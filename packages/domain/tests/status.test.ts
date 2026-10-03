import { describe, expect, it } from 'vitest';
import { DownloadStatus, canTransition } from '../src';

describe('DownloadStatus', () => {
  it('allows valid transitions', () => {
    expect(canTransition(DownloadStatus.Created, DownloadStatus.Queued)).toBe(true);
    expect(canTransition(DownloadStatus.Queued, DownloadStatus.Downloading)).toBe(true);
    expect(canTransition(DownloadStatus.Queued, DownloadStatus.Processing)).toBe(true);
    expect(canTransition(DownloadStatus.Queued, DownloadStatus.Completed)).toBe(true);
    expect(canTransition(DownloadStatus.Queued, DownloadStatus.Failed)).toBe(true);
    expect(canTransition(DownloadStatus.Queued, DownloadStatus.Cancelled)).toBe(true);
    expect(canTransition(DownloadStatus.Downloading, DownloadStatus.Processing)).toBe(true);
    expect(canTransition(DownloadStatus.Downloading, DownloadStatus.Downloading)).toBe(true);
    expect(canTransition(DownloadStatus.Processing, DownloadStatus.Downloading)).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransition(DownloadStatus.Created, DownloadStatus.Completed)).toBe(false);
    expect(canTransition(DownloadStatus.Completed, DownloadStatus.Downloading)).toBe(false);
    expect(canTransition(DownloadStatus.Failed, DownloadStatus.Downloading)).toBe(false);
    expect(canTransition(DownloadStatus.Cancelled, DownloadStatus.Downloading)).toBe(false);
  });
});
