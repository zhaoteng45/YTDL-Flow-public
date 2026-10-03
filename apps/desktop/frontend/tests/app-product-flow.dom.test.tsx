// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App';
import { ProductFlowController } from '../src/features/product/product-flow-controller';
import type { AppRuntime } from '../src/runtime/create-app-runtime';
import { deferred, errorPayload, FakeProductApi, taskPayload } from './helpers/fake-product-api';

function createTestRuntime(api: FakeProductApi, pollIntervalMs = 1000): AppRuntime {
  return {
    controller: new ProductFlowController({ api, pollIntervalMs }),
    dispose: () => {},
  };
}

function analyzeExample() {
  const input = screen.getByLabelText('视频链接');
  fireEvent.change(input, { target: { value: 'https://example.com/video' } });
  fireEvent.click(screen.getByRole('button', { name: '解析' }));
  return input;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('React product flow', () => {
  it('analyzes a pasted URL and renders normalized metadata', async () => {
    const api = new FakeProductApi();
    render(<App runtime={createTestRuntime(api)} />);

    analyzeExample();

    await screen.findByText('Example title');
    expect(api.analyzeCalls).toEqual(['https://example.com/video']);
    expect(screen.getByText('作者：Example channel')).toBeDefined();
    expect(screen.getByText('时长：05:12')).toBeDefined();

    const download = screen.getByRole('button', { name: '开始下载' }) as HTMLButtonElement;
    expect(download.disabled).toBe(false);
  });

  it('uses honest fallbacks when optional metadata is missing', async () => {
    const api = new FakeProductApi();
    api.analyzeImpl = async (sourceUrl) => ({
      ok: true,
      media: { sourceUrl, title: 'Only a title' },
    });
    render(<App runtime={createTestRuntime(api)} />);

    analyzeExample();

    await screen.findByText('Only a title');
    expect(screen.getByText('作者：未知作者')).toBeDefined();
    expect(screen.getByText('时长：时长未知')).toBeDefined();
  });

  it('shows invalid input and analyze failures as product-visible errors', async () => {
    const api = new FakeProductApi();
    api.analyzeImpl = async () => ({
      ok: false,
      error: errorPayload({ code: 'playlist-not-supported', message: '当前版本仅支持单个视频链接' }),
    });
    render(<App runtime={createTestRuntime(api)} />);

    analyzeExample();

    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('当前版本仅支持单个视频链接');
    expect(screen.queryByTestId('analysis-card')).toBeNull();
  });

  it('maps the closed selection to the create command', async () => {
    const api = new FakeProductApi();
    render(<App runtime={createTestRuntime(api)} />);

    analyzeExample();
    await screen.findByText('Example title');

    fireEvent.click(screen.getByRole('button', { name: '音频 MP3' }));
    expect(screen.getByRole('button', { name: '音频 MP3' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '开始下载' }));

    await waitFor(() => {
      expect(api.createCalls).toEqual([
        { sourceUrl: 'https://example.com/video', selection: 'audio-mp3' },
      ]);
    });
  });

  it('prevents a duplicate submit while creation is pending', async () => {
    const api = new FakeProductApi();
    const create = deferred<{ ok: true; task: ReturnType<typeof taskPayload> }>();
    api.createImpl = () => create.promise;
    render(<App runtime={createTestRuntime(api)} />);

    analyzeExample();
    await screen.findByText('Example title');

    const download = screen.getByRole('button', { name: '开始下载' }) as HTMLButtonElement;
    fireEvent.click(download);
    fireEvent.click(download);
    fireEvent.click(download);

    expect(api.createCalls).toHaveLength(1);

    create.resolve({ ok: true, task: taskPayload() });
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '开始下载' }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    expect(api.createCalls).toHaveLength(1);
  });

  it('invalidates the analysis snapshot when the input changes', async () => {
    const api = new FakeProductApi();
    render(<App runtime={createTestRuntime(api)} />);

    const input = analyzeExample();
    await screen.findByText('Example title');

    fireEvent.change(input, { target: { value: 'https://example.com/other' } });

    expect(screen.queryByTestId('analysis-card')).toBeNull();
    expect((screen.getByRole('button', { name: '开始下载' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('updates task status and progress without a manual refresh', async () => {
    const api = new FakeProductApi();
    api.listTasksImpl = async () => [taskPayload({ status: 'Queued', progress: 0 })];
    render(<App runtime={createTestRuntime(api, 20)} />);

    analyzeExample();
    await screen.findByText('Example title');
    fireEvent.click(screen.getByRole('button', { name: '开始下载' }));

    await screen.findByText('排队中');

    api.listTasksImpl = async () => [
      taskPayload({ status: 'Processing', progress: 99 }),
      taskPayload({ id: 'task-2', status: 'Completed', progress: 100 }),
    ];

    await screen.findByText('处理中');
    expect(screen.getByText('99%')).toBeDefined();
    expect(screen.getByText('已完成')).toBeDefined();
  });

  it('renders the trusted failure reason for a failed task', async () => {
    const api = new FakeProductApi();
    api.listTasksImpl = async () => [
      taskPayload({
        status: 'Failed',
        progress: 42,
        failureReason: 'yt-dlp exited with code 1: HTTP Error 403',
      }),
    ];
    render(<App runtime={createTestRuntime(api, 20)} />);

    await screen.findByText('失败');
    expect(screen.getByText(/失败原因：yt-dlp exited with code 1: HTTP Error 403/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /取消/ })).toBeNull();
  });

  it('shows a cancel rejection without fabricating a Cancelled state', async () => {
    const api = new FakeProductApi();
    api.listTasksImpl = async () => [taskPayload({ status: 'Downloading', progress: 40 })];
    api.cancelImpl = async () => ({
      outcome: {
        type: 'cancel-rejected',
        error: errorPayload({ code: 'cancel-rejected', message: 'No active execution for task task-1' }),
      },
    });
    render(<App runtime={createTestRuntime(api, 20)} />);

    await screen.findByText('下载中');
    fireEvent.click(screen.getByRole('button', { name: /取消/ }));

    await screen.findByText(/取消失败：No active execution for task task-1/);
    expect(api.cancelCalls).toEqual(['task-1']);
    expect(screen.getByText('下载中')).toBeDefined();
    expect(screen.queryByText('已取消')).toBeNull();
  });

  it('stops polling after unmount', async () => {
    vi.useFakeTimers();
    const api = new FakeProductApi();
    api.listTasksImpl = async () => [taskPayload({ status: 'Downloading', progress: 10 })];
    const view = render(<App runtime={createTestRuntime(api, 100)} />);

    await vi.advanceTimersByTimeAsync(350);
    expect(api.listTasksCalls).toBeGreaterThan(0);

    view.unmount();
    const callsAfterUnmount = api.listTasksCalls;
    await vi.advanceTimersByTimeAsync(1000);

    expect(api.listTasksCalls).toBe(callsAfterUnmount);
  });
});
