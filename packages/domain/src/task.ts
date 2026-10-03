import { canTransition, DownloadStatus } from './status';
import type { DomainEvent } from './events';

export interface DownloadTaskProps {
  /** Compatibility alias for attemptId while the T010 POC remains in-tree. */
  id?: string;
  rowId?: string;
  attemptId?: string;
  /** Display label for captured tasks; never an executable address there. */
  sourceUrl: string;
  /** Opaque native capture context; absent for pasted URLs. */
  captureContextId?: string;
}

export class DownloadTask {
  /** Compatibility alias for attemptId while the T010 POC remains in-tree. */
  readonly id: string;
  readonly rowId: string;
  readonly attemptId: string;
  readonly sourceUrl: string;
  readonly captureContextId?: string;
  private status: DownloadStatus;
  private progress: number;
  private speed?: string;
  private failureReason?: string;
  private failureCode?: 'pending-start-timeout';
  /**
   * Opaque classification token owned by the application layer (for example a
   * capture-context failure code). The domain only stores it.
   */
  private captureFailureCode?: string;
  private finalPath?: string;
  private cancelRequested = false;
  private readonly events: DomainEvent[];

  constructor(props: DownloadTaskProps) {
    const attemptId = props.attemptId ?? props.id;
    if (!attemptId) {
      throw new Error('DownloadTask requires an attemptId');
    }

    this.id = attemptId;
    this.attemptId = attemptId;
    this.rowId = props.rowId ?? attemptId;
    this.sourceUrl = props.sourceUrl;
    this.captureContextId = props.captureContextId;
    this.status = DownloadStatus.Created;
    this.progress = 0;
    this.events = [{ type: 'TaskCreated', taskId: attemptId }];
  }

  getStatus(): DownloadStatus {
    return this.status;
  }

  getProgress(): number {
    return this.progress;
  }

  getSpeed(): string | undefined {
    return this.speed || undefined;
  }

  getFailureReason(): string | undefined {
    return this.failureReason;
  }

  getFailureCode(): 'pending-start-timeout' | undefined {
    return this.failureCode;
  }

  getCaptureFailureCode(): string | undefined {
    return this.captureFailureCode;
  }

  setCaptureFailureCode(code: string): void {
    this.captureFailureCode = code;
  }

  failPendingStart(reason: string): void {
    if (this.status !== DownloadStatus.Pending) return;
    this.transitionTo(DownloadStatus.Failed, reason);
    this.failureCode = 'pending-start-timeout';
  }

  getFinalPath(): string | undefined {
    return this.finalPath;
  }

  isCancellationRequested(): boolean {
    return this.cancelRequested;
  }

  requestCancellation(): void {
    if (!this.isTerminal()) {
      this.cancelRequested = true;
    }
  }

  clearCancellationRequest(): void {
    if (!this.isTerminal()) {
      this.cancelRequested = false;
    }
  }

  complete(finalPath?: string): void {
    if (this.isTerminal()) return;
    if (!canTransition(this.status, DownloadStatus.Completed)) {
      throw new Error(`Invalid transition: ${this.status} -> ${DownloadStatus.Completed}`);
    }
    this.status = DownloadStatus.Completed;
    this.progress = 100;
    this.finalPath = finalPath;
  }

  isTerminal(): boolean {
    return (
      this.status === DownloadStatus.Completed ||
      this.status === DownloadStatus.Failed ||
      this.status === DownloadStatus.Cancelled
    );
  }

  applyProgress(progress: number): boolean {
    if (this.isTerminal()) {
      return false;
    }

    if (typeof progress !== 'number' || !Number.isFinite(progress)) {
      return false;
    }

    this.progress = Math.min(100, Math.max(0, progress));
    return true;
  }

  applyExecutionProgress(
    next: DownloadStatus.Downloading | DownloadStatus.Processing,
    progress: number,
    speed?: string,
  ): boolean {
    if (this.isTerminal()) {
      return false;
    }

    if (typeof progress !== 'number' || !Number.isFinite(progress)) {
      return false;
    }

    if (this.status !== next && !canTransition(this.status, next)) {
      throw new Error(`Invalid transition: ${this.status} -> ${next}`);
    }

    this.status = next;
    this.progress = Math.min(100, Math.max(0, progress));
    if (speed !== undefined) this.speed = speed;
    return true;
  }

  transitionTo(next: DownloadStatus, failureReason?: string): void {
    if (this.isTerminal()) {
      // Terminal lock: terminal -> anything = no state mutation
      return;
    }

    if (!canTransition(this.status, next)) {
      throw new Error(`Invalid transition: ${this.status} -> ${next}`);
    }

    this.status = next;
    if (next === DownloadStatus.Completed) {
      this.progress = 100;
    }
    if (next === DownloadStatus.Failed) {
      this.failureReason = failureReason;
    }
  }

  pullEvents(): DomainEvent[] {
    const result = [...this.events];
    this.events.length = 0;
    return result;
  }
}
