import type {
  AnalyzedMedia,
  DownloadSelection,
  ErrorPayload,
  TaskPayload,
} from '@ytdl-flow/contracts';

import type { ProductApplicationApi } from '../../api/product-application-api';

export interface ProductFlowState {
  input: string;
  analysis: AnalyzedMedia | null;
  analyzing: boolean;
  analyzeError: ErrorPayload | null;
  submitting: boolean;
  submitError: ErrorPayload | null;
  tasks: TaskPayload[];
  cancelPending: Readonly<Record<string, boolean>>;
  cancelErrors: Readonly<Record<string, ErrorPayload>>;
}

export interface ProductFlowTimers {
  setTimeout(handler: () => void, timeoutMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ProductFlowControllerOptions {
  api: ProductApplicationApi;
  /** Minimal serial listTasks polling; one read in flight at a time. */
  pollIntervalMs?: number;
  timers?: ProductFlowTimers;
}

const INVALID_INPUT_ERROR: ErrorPayload = {
  code: 'invalid-source-url',
  message: '请输入单个有效的 http(s) 链接',
};

const defaultTimers: ProductFlowTimers = {
  setTimeout(handler, timeoutMs) {
    return globalThis.setTimeout(handler, timeoutMs);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

const CANCELLABLE_STATUSES = new Set<TaskPayload['status']>([
  'Created',
  'Queued',
  'Downloading',
  'Processing',
]);

/**
 * Presentation coordination for the React product flow.
 *
 * React owns the current input and the immutable analysis snapshot; this
 * controller keeps that state, sequences async analyze responses so stale
 * results cannot be used, guards duplicate submits and exposes cancel
 * rejections without fabricating a Cancelled task state.
 */
export class ProductFlowController {
  private readonly api: ProductApplicationApi;
  private readonly pollIntervalMs: number;
  private readonly timers: ProductFlowTimers;
  private readonly listeners = new Set<() => void>();

  private state: ProductFlowState = {
    input: '',
    analysis: null,
    analyzing: false,
    analyzeError: null,
    submitting: false,
    submitError: null,
    tasks: [],
    cancelPending: {},
    cancelErrors: {},
  };

  private analyzeSequence = 0;
  private started = false;
  private pollHandle: unknown = null;
  private readInFlight: Promise<void> | null = null;
  private readQueued = false;

  constructor(options: ProductFlowControllerOptions) {
    this.api = options.api;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.timers = options.timers ?? defaultTimers;
  }

  getState(): ProductFlowState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    void this.refreshTasks();
    this.scheduleNextPoll();
  }

  stop(): void {
    this.started = false;
    if (this.pollHandle !== null) {
      this.timers.clearTimeout(this.pollHandle);
      this.pollHandle = null;
    }
  }

  setInput(value: string): void {
    const trimmed = value.trim();
    const analysisStillMatches = this.state.analysis?.sourceUrl === trimmed;

    this.patch({
      input: value,
      ...(analysisStillMatches
        ? {}
        : { analysis: null, analyzeError: null, submitError: null }),
    });

    if (!analysisStillMatches) {
      // Invalidate any in-flight analyze response for the previous input.
      this.analyzeSequence += 1;
      this.patch({ analyzing: false });
    }
  }

  canCreateDownload(): boolean {
    const { analysis, input, analyzing, submitting } = this.state;
    return (
      analysis !== null &&
      analysis.sourceUrl === input.trim() &&
      !analyzing &&
      !submitting
    );
  }

  async analyze(): Promise<void> {
    const requestedUrl = this.state.input.trim();
    if (requestedUrl.length === 0) {
      this.patch({ analysis: null, analyzeError: INVALID_INPUT_ERROR });
      return;
    }

    if (this.state.analyzing) {
      return;
    }

    const sequence = ++this.analyzeSequence;
    this.patch({ analyzing: true, analyzeError: null, analysis: null });

    const result = await this.api.analyze(requestedUrl);

    if (sequence !== this.analyzeSequence || this.state.input.trim() !== requestedUrl) {
      // Stale response: never replace a newer input/result snapshot.
      return;
    }

    if (result.ok) {
      this.patch({ analyzing: false, analyzeError: null, analysis: result.media });
    } else {
      this.patch({ analyzing: false, analyzeError: result.error, analysis: null });
    }
  }

  async createDownload(selection: DownloadSelection): Promise<void> {
    if (!this.canCreateDownload()) {
      return;
    }

    const snapshot = this.state.analysis;
    if (!snapshot) {
      return;
    }

    this.patch({ submitting: true, submitError: null });

    const result = await this.api.createDownload({
      sourceUrl: snapshot.sourceUrl,
      selection,
    });

    if (result.ok) {
      this.patch({ submitting: false, submitError: null });
    } else {
      this.patch({ submitting: false, submitError: result.error });
    }

    await this.refreshTasks();
  }

  async cancelTask(taskId: string): Promise<void> {
    if (this.state.cancelPending[taskId]) {
      return;
    }

    this.patch({ cancelPending: { ...this.state.cancelPending, [taskId]: true } });

    const result = await this.api.cancelTask(taskId);

    if (result.outcome.type === 'cancel-rejected') {
      this.setCancelError(taskId, result.outcome.error);
    } else {
      this.clearCancelError(taskId);
    }

    this.patch({
      cancelPending: omitKey(this.state.cancelPending, taskId),
    });

    if (result.settlement) {
      void result.settlement.then((outcome) => {
        if (outcome.type === 'cancel-rejected') {
          this.setCancelError(taskId, outcome.error);
        } else if (outcome.type === 'cancelled') {
          this.clearCancelError(taskId);
        }
      });
    }

    await this.refreshTasks();
  }

  refreshTasks(): Promise<void> {
    if (this.readInFlight) {
      // Coalesce into the current read cycle: the queued iteration starts after
      // the in-flight request settles, so commands still get a fresh snapshot
      // while at most one listTasks request is ever in flight.
      this.readQueued = true;
      return this.readInFlight;
    }

    const read = (async () => {
      do {
        this.readQueued = false;
        try {
          const tasks = await this.api.listTasks();
          this.applyTasks(tasks);
        } catch {
          // A failed read keeps the last known snapshot; the poll loop retries.
        }
      } while (this.readQueued);
      this.readInFlight = null;
    })();

    this.readInFlight = read;
    return read;
  }

  private scheduleNextPoll(): void {
    if (!this.started) {
      return;
    }
    this.pollHandle = this.timers.setTimeout(() => {
      this.pollHandle = null;
      if (!this.started) {
        return;
      }
      void this.refreshTasks();
      this.scheduleNextPoll();
    }, this.pollIntervalMs);
  }

  private applyTasks(tasks: TaskPayload[]): void {
    const nextCancelPending = { ...this.state.cancelPending };
    const nextCancelErrors = { ...this.state.cancelErrors };

    for (const taskId of Object.keys(nextCancelErrors)) {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task || !CANCELLABLE_STATUSES.has(task.status)) {
        delete nextCancelErrors[taskId];
      }
    }
    for (const taskId of Object.keys(nextCancelPending)) {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        delete nextCancelPending[taskId];
      }
    }

    this.patch({ tasks, cancelPending: nextCancelPending, cancelErrors: nextCancelErrors });
  }

  private setCancelError(taskId: string, error: ErrorPayload): void {
    this.patch({ cancelErrors: { ...this.state.cancelErrors, [taskId]: error } });
  }

  private clearCancelError(taskId: string): void {
    if (!this.state.cancelErrors[taskId]) {
      return;
    }
    this.patch({ cancelErrors: omitKey(this.state.cancelErrors, taskId) });
  }

  private patch(patch: Partial<ProductFlowState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function omitKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}
