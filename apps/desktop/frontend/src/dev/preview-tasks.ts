import type { TaskPayload } from '@ytdl-flow/contracts';

export const previewTasks: TaskPayload[] = [
  {
    id: 'preview-queued',
    sourceUrl: 'https://example.com/queued-video',
    status: 'Queued',
    progress: 0,
  },
  {
    id: 'preview-downloading',
    sourceUrl: 'https://example.com/downloading-video',
    status: 'Downloading',
    progress: 42,
  },
  {
    id: 'preview-processing',
    sourceUrl: 'https://example.com/processing-video',
    status: 'Processing',
    progress: 100,
  },
  {
    id: 'preview-completed',
    sourceUrl: 'https://example.com/completed-video',
    status: 'Completed',
    progress: 100,
  },
  {
    id: 'preview-failed',
    sourceUrl: 'https://example.com/failed-video',
    status: 'Failed',
    progress: 67,
  },
  {
    id: 'preview-cancelled',
    sourceUrl: 'https://example.com/cancelled-video',
    status: 'Cancelled',
    progress: 18,
  },
];
