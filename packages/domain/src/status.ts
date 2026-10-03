export enum DownloadStatus {
  Created = 'Created',
  Queued = 'Queued',
  Pending = 'Pending',
  Downloading = 'Downloading',
  Processing = 'Processing',
  Completed = 'Completed',
  Failed = 'Failed',
  Cancelled = 'Cancelled',
}

const transitions: Record<DownloadStatus, DownloadStatus[]> = {
  [DownloadStatus.Created]: [DownloadStatus.Queued, DownloadStatus.Cancelled],
  [DownloadStatus.Queued]: [DownloadStatus.Pending, DownloadStatus.Downloading, DownloadStatus.Processing, DownloadStatus.Completed, DownloadStatus.Failed, DownloadStatus.Cancelled],
  [DownloadStatus.Pending]: [DownloadStatus.Downloading, DownloadStatus.Processing, DownloadStatus.Completed, DownloadStatus.Failed, DownloadStatus.Cancelled],
  [DownloadStatus.Downloading]: [DownloadStatus.Downloading, DownloadStatus.Processing, DownloadStatus.Completed, DownloadStatus.Failed, DownloadStatus.Cancelled],
  [DownloadStatus.Processing]: [DownloadStatus.Downloading, DownloadStatus.Processing, DownloadStatus.Completed, DownloadStatus.Failed, DownloadStatus.Cancelled],
  [DownloadStatus.Completed]: [],
  [DownloadStatus.Failed]: [],
  [DownloadStatus.Cancelled]: [],
};

export function canTransition(from: DownloadStatus, to: DownloadStatus): boolean {
  return transitions[from].includes(to);
}
