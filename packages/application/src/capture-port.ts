import type {
  CaptureClaimOutcome,
  CapturedResourceSummary,
  CaptureSessionInfo,
  CaptureSessionStatus,
} from '../../contracts/src';

/**
 * Highest-level Resource Capture seam.
 *
 * Capture discovers resources and hands out opaque context handles. It never
 * creates, schedules, retries, cancels or completes a task: CurrentTaskService
 * remains the only task lifecycle owner and DownloadService remains the only
 * one-slot execution owner.
 */
export interface CapturePort {
  /** Explicitly start an isolated capture session. Never runs in the background. */
  start(openUrl?: string): Promise<CaptureSessionInfo>;
  /** Stop discovery, tear down the isolated browser and clear unclaimed resources. */
  stop(): Promise<void>;
  /** Sanitized discovery list; contains no raw URL and no credentials. */
  list(): Promise<CapturedResourceSummary[]>;
  /** Promote one discovered resource to an opaque capture context. */
  claim(resourceId: string): Promise<CaptureClaimOutcome>;
  /** Release a claimed context (claim/import failure, removal). */
  release(contextId: string): Promise<void>;
  /** Revoke a claimed context (task removal, terminal settlement). */
  revoke(contextId: string): Promise<void>;
  /** App-session teardown: release all claimed contexts and native capture material. */
  dispose(): Promise<void>;
  /** Subscribe to sanitized discovery updates. Returns an unsubscribe function. */
  subscribe(listener: (resources: readonly CapturedResourceSummary[]) => void): () => void;
  /** Subscribe to capture session start/stop status. */
  subscribeSession(listener: (status: CaptureSessionStatus) => void): () => void;
}
