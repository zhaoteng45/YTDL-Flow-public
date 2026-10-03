import type {
  CaptureClaimOutcome,
  CurrentCapturedTaskRef,
} from '../../contracts/src';
import type { CapturedAnalysisInput } from './current-task-service';
import type { CapturePort } from './capture-port';
import { classifyCaptureFailure } from './capture-failure';

export { classifyCaptureFailure };

/**
 * Claim outcomes that stop an import before a task row exists. Kept as data so
 * the UI chooses copy from the outcome type instead of matching prose.
 */
export const CAPTURE_IMPORT_REJECTIONS = [
  'notFound',
  'captureInactive',
  'unsupportedScheme',
  'forbiddenDestination',
  'authenticatedReplayRequired',
  'unsupportedExecutionKind',
  'limitReached',
] as const satisfies readonly CaptureClaimOutcome['type'][];

export type CaptureImportResult =
  | { readonly type: 'imported'; readonly rowId: string; readonly contextId: string }
  | { readonly type: 'rejected'; readonly outcome: CaptureClaimOutcome }
  | {
      readonly type: 'import-failed';
      readonly contextId: string;
      readonly error: Error;
    };

export interface CaptureImportFlow {
  /** Claim a discovered resource and import it as a normal task row. */
  importResource(resourceId: string): Promise<CaptureImportResult>;
  /** Release the native context of a removed/disposed captured row. */
  revokeRow(row: { capture?: CurrentCapturedTaskRef }): Promise<void>;
}

export interface CaptureImportDependencies {
  capture: Pick<CapturePort, 'claim' | 'release' | 'revoke'>;
  analyzeCaptured(input: CapturedAnalysisInput): { rowId: string };
}

/**
 * Highest-level captured-input orchestration.
 *
 * It owns no task state: it claims a resource, hands the opaque context to
 * CurrentTaskService, and releases native capture material when that handoff
 * cannot complete. Task lifecycle stays with CurrentTaskService.
 */
export function createCaptureImportFlow(
  dependencies: CaptureImportDependencies,
): CaptureImportFlow {
  return {
    async importResource(resourceId: string): Promise<CaptureImportResult> {
      const outcome = await dependencies.capture.claim(resourceId);
      if (outcome.type !== 'claimed') {
        return { type: 'rejected', outcome };
      }

      try {
        const handle = dependencies.analyzeCaptured({
          captureContextId: outcome.contextId,
          siteLabel: outcome.resource.siteLabel,
          mediaKind: outcome.resource.mediaKind,
        });
        return { type: 'imported', rowId: handle.rowId, contextId: outcome.contextId };
      } catch (error) {
        // Claim/import failure releases immediately; nothing may linger.
        await dependencies.capture.release(outcome.contextId);
        return {
          type: 'import-failed',
          contextId: outcome.contextId,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },

    async revokeRow(row: { capture?: CurrentCapturedTaskRef }): Promise<void> {
      if (!row.capture) return;
      await dependencies.capture.revoke(row.capture.contextId);
    },
  };
}
