import type {
  CurrentAnalysisMedia,
  CurrentAnalysisRequest,
  CurrentExtraArgs,
  ErrorPayload,
} from '../../contracts/src';
import { toErrorPayload } from './error-payload';

export interface CurrentMediaAnalyzer {
  analyze(request: CurrentAnalysisRequest): Promise<CurrentAnalysisMedia>;
}

export type CurrentAnalysisOutcome =
  | {
      status: 'analyzed';
      rowId: string;
      attemptId: string;
      media: CurrentAnalysisMedia;
      extraArgs: CurrentExtraArgs;
    }
  | {
      status: 'failed';
      rowId: string;
      attemptId: string;
      failureKind: 'analysis';
      error: ErrorPayload;
    }
  | {
      status: 'stale';
      rowId: string;
      attemptId: string;
    };

export interface CurrentAnalysisHandle {
  rowId: string;
  attemptId: string;
  extraArgs: CurrentExtraArgs;
  result: Promise<CurrentAnalysisOutcome>;
}

export class CurrentAnalysisService {
  private readonly currentAttemptByRow = new Map<string, string>();
  private readonly invalidateByRow = new Map<string, () => void>();
  private isDisposed = false;

  constructor(
    private readonly analyzer: CurrentMediaAnalyzer,
    private readonly createAttemptId: () => string = () => crypto.randomUUID(),
    private readonly getExtraArgs: (sourceUrl: string) => CurrentExtraArgs = () => ({}),
  ) {}

  startAnalysis(rowId: string, sourceUrl: string): CurrentAnalysisHandle {
    return this.begin(rowId, { sourceUrl }, () => this.getExtraArgs(sourceUrl));
  }

  /**
   * Captured analysis. The sanitized capture label is never used as an
   * execution fallback, and no global extra args are inherited: capture
   * identity is a closed set.
   */
  startCapturedAnalysis(rowId: string, captureContextId: string): CurrentAnalysisHandle {
    return this.begin(rowId, { captureContextId }, () => ({}));
  }

  private begin(
    rowId: string,
    target: { sourceUrl?: string; captureContextId?: string },
    resolveExtraArgs: () => CurrentExtraArgs,
  ): CurrentAnalysisHandle {
    if (this.isDisposed) {
      throw new Error('CurrentAnalysisService is disposed');
    }

    const attemptId = this.createAttemptId();
    this.forget(rowId);
    this.currentAttemptByRow.set(rowId, attemptId);
    const invalidated = new Promise<CurrentAnalysisOutcome>((resolve) => {
      this.invalidateByRow.set(rowId, () => resolve({ status: 'stale', rowId, attemptId }));
    });

    let dispatched: Promise<CurrentAnalysisMedia>;
    let requestExtraArgs: CurrentExtraArgs = {};
    try {
      requestExtraArgs = { ...resolveExtraArgs() };
      const request: CurrentAnalysisRequest = {
        attemptId,
        extraArgs: requestExtraArgs,
        ...target,
      };
      dispatched = Promise.resolve(this.analyzer.analyze(request));
    } catch (error) {
      dispatched = Promise.reject(error);
    }

    const completion = dispatched.then<CurrentAnalysisOutcome, CurrentAnalysisOutcome>(
      (media) => {
        if (!this.isCurrent(rowId, attemptId)) {
          return { status: 'stale', rowId, attemptId };
        }
        return { status: 'analyzed', rowId, attemptId, media, extraArgs: { ...requestExtraArgs } };
      },
      (error: unknown) => {
        if (!this.isCurrent(rowId, attemptId)) {
          return { status: 'stale', rowId, attemptId };
        }
        return {
          status: 'failed',
          rowId,
          attemptId,
          failureKind: 'analysis',
          error: toErrorPayload(error, 'analysis-failed'),
        };
      },
    );

    const result = Promise.race([completion, invalidated]).then((outcome) => {
      if (this.isCurrent(rowId, attemptId)) this.invalidateByRow.delete(rowId);
      return outcome;
    });
    return { rowId, attemptId, extraArgs: { ...requestExtraArgs }, result };
  }

  reanalyze(rowId: string, sourceUrl: string): CurrentAnalysisHandle {
    return this.startAnalysis(rowId, sourceUrl);
  }

  forget(rowId: string): void {
    this.invalidateByRow.get(rowId)?.();
    this.invalidateByRow.delete(rowId);
    this.currentAttemptByRow.delete(rowId);
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (const invalidate of this.invalidateByRow.values()) invalidate();
    this.invalidateByRow.clear();
    this.currentAttemptByRow.clear();
  }

  getCurrentAttemptId(rowId: string): string | undefined {
    return this.currentAttemptByRow.get(rowId);
  }

  private isCurrent(rowId: string, attemptId: string): boolean {
    return !this.isDisposed && this.currentAttemptByRow.get(rowId) === attemptId;
  }
}
