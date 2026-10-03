import type {
  CaptureClaimOutcome,
  CapturedResourceSummary,
  CurrentTaskFailureCode,
} from '../../packages/contracts/src';

export interface CaptureCandidateViewModel {
  readonly resourceId: string;
  /** Generated resource number, e.g. `#3`. */
  readonly number: string;
  readonly siteLabel: string;
  readonly mediaLabel: string;
  readonly mimeType: string;
  readonly sizeLabel?: string;
  readonly detailLabel?: string;
  readonly requiresAuthenticatedReplay: boolean;
  readonly phase1Executable: boolean;
  /** i18n key for the row action button. */
  readonly actionLabelKey: string;
}

const MEDIA_LABELS: Record<CapturedResourceSummary['mediaKind'], string> = {
  video: 'Video',
  audio: 'Audio',
  hls: 'HLS',
  dash: 'DASH',
  stream: 'Stream',
};

export function formatCaptureSize(sizeBytes: number | undefined): string | undefined {
  if (sizeBytes === undefined || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return undefined;
  const units: Array<[number, string]> = [
    [1024 * 1024 * 1024, 'GB'],
    [1024 * 1024, 'MB'],
    [1024, 'KB'],
  ];
  for (const [scale, unit] of units) {
    if (sizeBytes >= scale) {
      return `${(sizeBytes / scale).toFixed(2)} ${unit}`;
    }
  }
  return `${sizeBytes} B`;
}

/**
 * Pure view model for the capture candidate list. Only sanitized fields are
 * rendered; a raw URL can never reach this surface.
 */
export function buildCaptureCandidateViewModels(
  summaries: readonly CapturedResourceSummary[],
): CaptureCandidateViewModel[] {
  return summaries.map((summary) => {
    const details = [summary.filenameHint, summary.resolutionHint].filter(
      (value): value is string => Boolean(value),
    );

    return {
      resourceId: summary.resourceId,
      number: `#${summary.resourceNumber}`,
      siteLabel: summary.siteLabel,
      mediaLabel: MEDIA_LABELS[summary.mediaKind] ?? summary.mediaKind,
      mimeType: summary.mimeType,
      ...(formatCaptureSize(summary.sizeBytes)
        ? { sizeLabel: formatCaptureSize(summary.sizeBytes) as string }
        : {}),
      ...(details.length > 0 ? { detailLabel: details.join(' · ') } : {}),
      requiresAuthenticatedReplay: summary.requiresAuthenticatedReplay,
      phase1Executable: summary.mediaKind === 'video' || summary.mediaKind === 'audio',
      actionLabelKey: summary.requiresAuthenticatedReplay
        ? 'capture.unsupported_auth'
        : summary.mediaKind === 'video' || summary.mediaKind === 'audio'
          ? 'capture.import'
          : 'capture.unsupported_kind',
    };
  });
}

/** Typed claim rejection → i18n key. Never matches prose. */
export function captureClaimRejectionKey(outcome: CaptureClaimOutcome): string | undefined {
  switch (outcome.type) {
    case 'claimed':
      return undefined;
    case 'notFound':
      return 'capture.rejected.not_found';
    case 'captureInactive':
      return 'capture.rejected.inactive';
    case 'unsupportedScheme':
      return 'capture.rejected.unsupported_scheme';
    case 'forbiddenDestination':
      return 'capture.rejected.forbidden_destination';
    case 'authenticatedReplayRequired':
      return 'capture.rejected.auth_required';
    case 'unsupportedExecutionKind':
      return 'capture.rejected.unsupported_kind';
    case 'limitReached':
      return 'capture.rejected.limit_reached';
  }
}

/** Structured failure code → explicit copy key (no vague "download failed"). */
export function captureFailureMessageKey(
  failureCode: CurrentTaskFailureCode | undefined,
): string | undefined {
  switch (failureCode) {
    case undefined:
      return undefined;
    case 'capture-context-expired':
      return 'capture.failure.expired';
    case 'capture-context-revoked':
      return 'capture.failure.revoked';
    case 'capture-context-not-found':
      return 'capture.failure.not_found';
    case 'capture-context-row-mismatch':
      return 'capture.failure.row_mismatch';
    case 'pending-start-timeout':
      return 'capture.failure.start_timeout';
  }
}
