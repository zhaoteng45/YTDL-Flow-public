import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { DownloadsPage } from '../src/pages/DownloadsPage';
import type { TaskViewModel } from '../src/features/downloads/task-view-model';
import { toTaskViewModel } from '../src/features/downloads/task-view-model';

describe('TaskViewModel', () => {
  test('translates status labels and clamps progress for presentation', () => {
    expect(
      toTaskViewModel({
        id: 'task-overflow',
        sourceUrl: 'https://example.com/video',
        status: 'Downloading',
        progress: 142.4,
      }),
    ).toEqual({
      id: 'task-overflow',
      sourceUrl: 'https://example.com/video',
      status: 'Downloading',
      statusLabel: '下载中',
      progress: 100,
      progressLabel: '100%',
      canCancel: true,
      cancelPending: false,
    });
  });

  test('exposes the trusted failure reason and marks terminal tasks as not cancellable', () => {
    expect(
      toTaskViewModel({
        id: 'task-failed',
        sourceUrl: 'https://example.com/video',
        status: 'Failed',
        progress: 42,
        failureReason: 'yt-dlp exited with code 1',
      }),
    ).toEqual({
      id: 'task-failed',
      sourceUrl: 'https://example.com/video',
      status: 'Failed',
      statusLabel: '失败',
      progress: 42,
      progressLabel: '42%',
      failureReason: 'yt-dlp exited with code 1',
      canCancel: false,
      cancelPending: false,
    });
  });

  test('carries cancel pending and cancel rejection presentation state', () => {
    const viewModel = toTaskViewModel(
      {
        id: 'task-cancel',
        sourceUrl: 'https://example.com/video',
        status: 'Downloading',
        progress: 10,
      },
      {
        cancelPending: true,
        cancelError: { code: 'cancel-rejected', message: 'No active execution' },
      },
    );

    expect(viewModel.cancelPending).toBe(true);
    expect(viewModel.cancelErrorMessage).toBe('No active execution');
    expect(viewModel.canCancel).toBe(true);
  });
});

describe('DownloadsPage', () => {
  test('renders a presentation-only TaskViewModel with semantic progress', () => {
    const tasks: TaskViewModel[] = [
      {
        id: 'task-001',
        sourceUrl: 'https://example.com/video',
        status: 'Downloading',
        statusLabel: '下载中',
        progress: 42,
        progressLabel: '42%',
        canCancel: true,
        cancelPending: false,
      },
    ];

    const html = renderToStaticMarkup(<DownloadsPage tasks={tasks} onCancel={() => {}} />);

    expect(html).toContain('下载中');
    expect(html).toContain('42%');
    expect(html).toContain('https://example.com/video');
    expect(html).toContain('<progress');
    expect(html).toContain('value="42"');
    expect(html).toContain('取消');
    expect(html).not.toContain('style=');
  });

  test('renders a clear empty state', () => {
    const html = renderToStaticMarkup(<DownloadsPage tasks={[]} onCancel={() => {}} />);

    expect(html).toContain('还没有下载任务');
    expect(html).toContain('粘贴链接并开始下载后');
    expect(html).toContain('0 个任务');
  });

  test('renders failure reason and cancel rejection without a cancel action', () => {
    const html = renderToStaticMarkup(
      <DownloadsPage
        tasks={[
          {
            id: 'task-002',
            sourceUrl: 'https://example.com/failed',
            status: 'Failed',
            statusLabel: '失败',
            progress: 50,
            progressLabel: '50%',
            failureReason: 'HTTP Error 403',
            canCancel: false,
            cancelPending: false,
          },
          {
            id: 'task-003',
            sourceUrl: 'https://example.com/active',
            status: 'Downloading',
            statusLabel: '下载中',
            progress: 10,
            progressLabel: '10%',
            canCancel: true,
            cancelPending: false,
            cancelErrorMessage: 'No active execution',
          },
        ]}
        onCancel={() => {}}
      />,
    );

    expect(html).toContain('失败原因：HTTP Error 403');
    expect(html).toContain('取消失败：No active execution');
    expect(html).toContain('data-status="Failed"');
  });
});
