import { describe, expect, it } from 'vitest';

import { StaticProductApplicationAdapter } from '../src/api/static-product-application-adapter';
import { createNativeAppRuntime, createPreviewAppRuntime } from '../src/runtime/create-app-runtime';
import { FakeProductApi, taskPayload } from './helpers/fake-product-api';
import { createRealProductChain } from './helpers/real-product-adapter';

describe('ApplicationProductApplicationAdapter', () => {
  it('reads TaskPayloads through the real TaskQueryService seam', async () => {
    const { api, seedTask } = createRealProductChain();
    seedTask(taskPayload({ id: 'task-real', status: 'Downloading', progress: 42 }));

    const tasks = await api.listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 'task-real',
      sourceUrl: 'https://example.com/video',
      status: 'Downloading',
      progress: 42,
    });
  });

  it('composes the Application product use cases with the read seam', async () => {
    const { api, engine } = createRealProductChain();

    const analyze = await api.analyze('https://example.com/video');
    expect(analyze.ok).toBe(true);

    const created = await api.createDownload({
      sourceUrl: 'https://example.com/video',
      selection: 'audio-mp3',
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.task.id).toBe('task-adapter');
    }

    await expect(api.cancelTask('task-adapter')).resolves.toEqual({
      outcome: { type: 'cancel-requested' },
    });

    expect(engine.started[0]).toMatchObject({
      taskId: 'task-adapter',
      downloadType: 'audio',
      extraArgs: { audioCodec: 'mp3' },
    });
  });
});

describe('StaticProductApplicationAdapter', () => {
  it('exposes fixtures without fabricating successful commands', async () => {
    const api = new StaticProductApplicationAdapter([taskPayload({ id: 'task-static' })]);

    await expect(api.listTasks()).resolves.toEqual([
      {
        id: 'task-static',
        sourceUrl: 'https://example.com/video',
        status: 'Queued',
        progress: 0,
      },
    ]);

    const analyze = await api.analyze('https://example.com/video');
    expect(analyze.ok).toBe(false);
    if (!analyze.ok) {
      expect(analyze.error.code).toBe('preview-mode');
    }

    const created = await api.createDownload({
      sourceUrl: 'https://example.com/video',
      selection: 'video-auto',
    });
    expect(created.ok).toBe(false);

    const cancelled = await api.cancelTask('task-static');
    expect(cancelled.outcome.type).toBe('cancel-rejected');
  });
});

describe('app runtime composition', () => {
  it('creates the native runtime with a controller and no legacy bootstrap', () => {
    const runtime = createNativeAppRuntime();

    expect(runtime.controller.getState()).toMatchObject({
      input: '',
      analysis: null,
      tasks: [],
    });

    runtime.dispose();
  });

  it('creates a preview runtime over fixtures', async () => {
    const runtime = createPreviewAppRuntime([taskPayload({ id: 'task-preview' })]);

    await runtime.controller.refreshTasks();

    expect(runtime.controller.getState().tasks.map((task) => task.id)).toEqual(['task-preview']);
    expect(runtime.controller.getState().analysis).toBeNull();

    runtime.dispose();
  });

  it('exposes the controller state through the same seam as the fake api', async () => {
    const api = new FakeProductApi();
    api.listTasksImpl = async () => [taskPayload({ id: 'task-live' })];

    const { ProductFlowController } = await import('../src/features/product/product-flow-controller');
    const controller = new ProductFlowController({ api });
    await controller.refreshTasks();

    expect(controller.getState().tasks.map((task) => task.id)).toEqual(['task-live']);
  });
});
