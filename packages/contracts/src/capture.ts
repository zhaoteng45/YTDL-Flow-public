/**
 * Resource Capture Phase 1 contracts (ADR-0003 Opaque Capture Context).
 *
 * Everything that crosses the IPC boundary from the native capture module is
 * sanitized: no raw URL, query, fragment, userinfo, Cookie, Authorization,
 * Referer or arbitrary request headers. The raw executable URL stays in native
 * memory and is resolved there for analysis and yt-dlp execution.
 */

export type CapturedMediaKind = 'video' | 'audio' | 'hls' | 'dash' | 'stream';

export const CAPTURED_MEDIA_KINDS: readonly CapturedMediaKind[] = [
  'video',
  'audio',
  'hls',
  'dash',
  'stream',
];

/**
 * Frontend-safe discovery entry. `siteLabel` and `filenameHint` are display
 * labels only; they are never accepted by analysis/download code as an
 * executable address.
 */
export interface CapturedResourceSummary {
  readonly captureId: string;
  readonly resourceId: string;
  readonly resourceNumber: number;
  readonly siteLabel: string;
  readonly mediaKind: CapturedMediaKind;
  readonly mimeType: string;
  readonly sizeBytes?: number;
  readonly filenameHint?: string;
  readonly resolutionHint?: string;
  readonly requiresAuthenticatedReplay: boolean;
}

export interface CaptureSessionInfo {
  readonly captureId: string;
  readonly browserName: string;
  readonly profileIsolated: boolean;
}

export type CaptureSessionEndReason = 'stopped' | 'browser-closed';

/** `capture-session` event payload: is a capture browser currently running? */
export interface CaptureSessionStatus {
  readonly active: boolean;
  readonly captureId?: string;
  readonly browserName?: string;
  readonly reason?: CaptureSessionEndReason;
}

export type CaptureClaimOutcome =
  | {
      readonly type: 'claimed';
      readonly contextId: string;
      readonly resource: CapturedResourceSummary;
    }
  | { readonly type: 'notFound' }
  | { readonly type: 'captureInactive' }
  | { readonly type: 'unsupportedScheme' }
  | { readonly type: 'forbiddenDestination'; readonly reason: string }
  | { readonly type: 'authenticatedReplayRequired' }
  | { readonly type: 'unsupportedExecutionKind' }
  | { readonly type: 'limitReached' };

/**
 * Stable machine-readable failure tokens shared with native code. UI copy is
 * chosen from these codes, never from matching human error strings.
 */
export const CAPTURE_CONTEXT_FAILURE_CODES = {
  expired: 'capture-context-expired',
  revoked: 'capture-context-revoked',
  notFound: 'capture-context-not-found',
  rowMismatch: 'capture-context-row-mismatch',
} as const;

export type CaptureContextFailureCode =
  (typeof CAPTURE_CONTEXT_FAILURE_CODES)[keyof typeof CAPTURE_CONTEXT_FAILURE_CODES];

const CAPTURE_CONTEXT_FAILURE_CODE_SET: ReadonlySet<string> = new Set(
  Object.values(CAPTURE_CONTEXT_FAILURE_CODES),
);

/** Narrow an opaque domain value to the capture-context failure vocabulary. */
export function isCaptureContextFailureCode(
  value: unknown,
): value is CaptureContextFailureCode {
  return typeof value === 'string' && CAPTURE_CONTEXT_FAILURE_CODE_SET.has(value);
}

/** Phase 1 capture bounds, mirrored from native `CaptureLimits`. */
export const CAPTURE_LIMITS = {
  maxResourcesPerSession: 200,
  maxContexts: 32,
  maxUrlBytes: 4096,
  contextTtlMs: 30 * 60 * 1000,
} as const;
