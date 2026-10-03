import type { ErrorPayload, TaskPayload } from '@ytdl-flow/contracts';

import type { ProductApplicationApi } from '../../src/api/product-application-api';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export function taskPayload(overrides: Partial<TaskPayload> = {}): TaskPayload {
  return {
    id: 'task-1',
    sourceUrl: 'https://example.com/video',
    status: 'Queued',
    progress: 0,
    ...overrides,
  };
}

export function errorPayload(overrides: Partial<ErrorPayload> = {}): ErrorPayload {
  return { code: 'test-error', message: 'test error', ...overrides };
}

export class FakeProductApi implements ProductApplicationApi {
  public readonly analyzeCalls: string[] = [];
  public readonly createCalls: Array<{ sourceUrl: string; selection: string }> = [];
  public readonly cancelCalls: string[] = [];
  public listTasksCalls = 0;

  public analyzeImpl: (sourceUrl: string) => Promise<unknown> = async (sourceUrl) => ({
    ok: true,
    media: { sourceUrl, title: 'Example title', channel: 'Example channel', durationLabel: '05:12' },
  });
  public createImpl: () => Promise<unknown> = async () => ({ ok: true, task: taskPayload() });
  public cancelImpl: () => Promise<unknown> = async () => ({
    outcome: { type: 'cancel-requested' },
  });
  public listTasksImpl: () => Promise<TaskPayload[]> = async () => [];

  async analyze(sourceUrl: string) {
    this.analyzeCalls.push(sourceUrl);
    return (await this.analyzeImpl(sourceUrl)) as never;
  }

  async createDownload(command: { sourceUrl: string; selection: string }) {
    this.createCalls.push(command);
    return (await this.createImpl()) as never;
  }

  async cancelTask(taskId: string) {
    this.cancelCalls.push(taskId);
    return (await this.cancelImpl()) as never;
  }

  async listTasks() {
    this.listTasksCalls += 1;
    return this.listTasksImpl();
  }
}
