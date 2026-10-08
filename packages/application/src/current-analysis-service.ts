import type {
  CurrentAnalysisMedia,
  CurrentAnalysisRequest,
  CurrentExtraArgs,
  CurrentCredentialSelection,
  ErrorPayload,
} from '../../contracts/src';
import { toErrorPayload } from './error-payload';

export interface CurrentMediaAnalyzer {
  analyze(request: CurrentAnalysisRequest): Promise<CurrentAnalysisMedia>;
}

export interface CurrentAnalysisInputs {
  extraArgs: CurrentExtraArgs;
  credential?: CurrentCredentialSelection;
}

export type PrepareCurrentAnalysis = (
  sourceUrl: string,
  isCurrent: () => boolean,
) => Promise<CurrentAnalysisInputs>;

export type CurrentAnalysisOutcome =
  | {
      status: 'analyzed';
      rowId: string;
      attemptId: string;
      media: CurrentAnalysisMedia;
      extraArgs: CurrentExtraArgs;
      credential?: CurrentCredentialSelection;
    }
  | {
      status: 'failed';
      rowId: string;
      attemptId: string;
      failureKind: 'analysis';
      error: ErrorPayload;
      credential?: CurrentCredentialSelection;
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
    private readonly prepareAnalysis?: PrepareCurrentAnalysis,
  ) {}

  startAnalysis(rowId: string, sourceUrl: string): CurrentAnalysisHandle {
    return this.begin(rowId, { sourceUrl }, (isCurrent) => this.prepareAnalysis
      ? this.prepareAnalysis(sourceUrl, isCurrent)
      : { extraArgs: this.getExtraArgs(sourceUrl) });
  }

  /**
   * Captured analysis. The sanitized capture label is never used as an
   * execution fallback, and no global extra args are inherited: capture
   * identity is a closed set.
   */
  startCapturedAnalysis(rowId: string, captureContextId: string): CurrentAnalysisHandle {
    return this.begin(rowId, { captureContextId }, () => ({ extraArgs: {} }));
  }

  private begin(
    rowId: string,
    target: { sourceUrl?: string; captureContextId?: string },
    resolveInputs: (isCurrent: () => boolean) => CurrentAnalysisInputs | Promise<CurrentAnalysisInputs>,
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

    let dispatched: Promise<CurrentAnalysisMedia | undefined>;
    let requestExtraArgs: CurrentExtraArgs = {};
    let credential: CurrentCredentialSelection | undefined;
    const dispatch = (inputs: CurrentAnalysisInputs): Promise<CurrentAnalysisMedia | undefined> => {
      requestExtraArgs = { ...inputs.extraArgs };
      credential = inputs.credential ? { ...inputs.credential } : undefined;
      // Cancellation can settle the handle during a credential check. Never
      // dispatch a native analysis after that attempt has been invalidated.
      if (!this.isCurrent(rowId, attemptId)) return Promise.resolve(undefined);
      return Promise.resolve(this.analyzer.analyze({ attemptId, extraArgs: { ...requestExtraArgs }, ...target }));
    };
    try {
      const inputs = resolveInputs(() => this.isCurrent(rowId, attemptId));
      dispatched = inputs instanceof Promise ? inputs.then(dispatch) : dispatch(inputs);
    } catch (error) {
      dispatched = Promise.reject(error);
    }

    const completion = dispatched.then<CurrentAnalysisOutcome, CurrentAnalysisOutcome>(
      (media) => {
        if (!media || !this.isCurrent(rowId, attemptId)) {
          return { status: 'stale', rowId, attemptId };
        }
        return { status: 'analyzed', rowId, attemptId, media, extraArgs: { ...requestExtraArgs }, ...(credential ? { credential: { ...credential } } : {}) };
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
          ...(credential ? { credential: { ...credential } } : {}),
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
