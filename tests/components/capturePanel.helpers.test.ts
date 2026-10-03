import { describe, expect, it } from 'vitest';

import {
  buildCaptureCandidateViewModels,
  captureClaimRejectionKey,
  captureFailureMessageKey,
  formatCaptureSize,
} from '../../src/components/capturePanel.helpers';

const summary = {
  captureId: 'capture-1',
  resourceId: 'resource-1',
  resourceNumber: 3,
  siteLabel: 'cdn.example.com',
  mediaKind: 'hls' as const,
  mimeType: 'application/vnd.apple.mpegurl',
  sizeBytes: 4_194_304,
  filenameHint: 'master.m3u8',
  resolutionHint: '1080p',
  requiresAuthenticatedReplay: false,
};

describe('capture panel view models', () => {
  it('renders only sanitized fields plus a generated number', () => {
    const [candidate] = buildCaptureCandidateViewModels([summary]);

    expect(candidate.number).toBe('#3');
    expect(candidate.siteLabel).toBe('cdn.example.com');
    expect(candidate.mediaLabel).toBe('HLS');
    expect(candidate.mimeType).toBe('application/vnd.apple.mpegurl');
    expect(candidate.sizeLabel).toBe('4.00 MB');
    expect(candidate.detailLabel).toBe('master.m3u8 · 1080p');
    expect(candidate.requiresAuthenticatedReplay).toBe(false);

    // Only the generated `#N` display prefix contains a symbol; every other
    // field must be free of URL-shaped characters.
    expect(candidate.number).toMatch(/^#\d+$/);
    for (const [key, value] of Object.entries(candidate)) {
      if (typeof value === 'string' && key !== 'number') {
        expect(value).not.toMatch(/:\/\/|\?|#|@|=/);
      }
    }
  });

  it('marks authenticated-replay candidates instead of hiding them', () => {
    const [candidate] = buildCaptureCandidateViewModels([
      { ...summary, requiresAuthenticatedReplay: true },
    ]);
    expect(candidate.requiresAuthenticatedReplay).toBe(true);
    expect(candidate.actionLabelKey).toBe('capture.unsupported_auth');
  });

  it('marks manifest and stream kinds as not executable in Phase 1', () => {
    const candidates = buildCaptureCandidateViewModels([
      summary, // hls
      { ...summary, resourceId: 'resource-2', mediaKind: 'dash' as const },
      { ...summary, resourceId: 'resource-3', mediaKind: 'stream' as const },
      { ...summary, resourceId: 'resource-4', mediaKind: 'video' as const },
      { ...summary, resourceId: 'resource-5', mediaKind: 'audio' as const },
    ]);

    for (const candidate of candidates.slice(0, 3)) {
      expect(candidate.phase1Executable).toBe(false);
      expect(candidate.actionLabelKey).toBe('capture.unsupported_kind');
    }
    for (const candidate of candidates.slice(3)) {
      expect(candidate.phase1Executable).toBe(true);
      expect(candidate.actionLabelKey).toBe('capture.import');
    }
  });

  it('omits optional details gracefully', () => {
    const [candidate] = buildCaptureCandidateViewModels([
      {
        ...summary,
        mediaKind: 'video' as const,
        sizeBytes: undefined,
        filenameHint: undefined,
        resolutionHint: undefined,
      },
    ]);

    expect(candidate.sizeLabel).toBeUndefined();
    expect(candidate.detailLabel).toBeUndefined();
    expect(candidate.actionLabelKey).toBe('capture.import');
  });

  it('formats sizes without leaking precision', () => {
    expect(formatCaptureSize(512)).toBe('512 B');
    expect(formatCaptureSize(2048)).toBe('2.00 KB');
    expect(formatCaptureSize(4_194_304)).toBe('4.00 MB');
    expect(formatCaptureSize(2_147_483_648)).toBe('2.00 GB');
    expect(formatCaptureSize(undefined)).toBeUndefined();
  });
});

describe('capture message keys', () => {
  it('maps typed claim rejections to copy keys', () => {
    expect(captureClaimRejectionKey({ type: 'authenticatedReplayRequired' })).toBe(
      'capture.rejected.auth_required',
    );
    expect(captureClaimRejectionKey({ type: 'forbiddenDestination', reason: 'loopback' })).toBe(
      'capture.rejected.forbidden_destination',
    );
    expect(captureClaimRejectionKey({ type: 'captureInactive' })).toBe(
      'capture.rejected.inactive',
    );
    expect(captureClaimRejectionKey({ type: 'notFound' })).toBe('capture.rejected.not_found');
    expect(captureClaimRejectionKey({ type: 'limitReached' })).toBe(
      'capture.rejected.limit_reached',
    );
    expect(captureClaimRejectionKey({ type: 'unsupportedScheme' })).toBe(
      'capture.rejected.unsupported_scheme',
    );
    expect(captureClaimRejectionKey({ type: 'unsupportedExecutionKind' } as never)).toBe(
      'capture.rejected.unsupported_kind',
    );
  });

  it('maps capture failure codes to explicit copy instead of a generic failure', () => {
    expect(captureFailureMessageKey('capture-context-expired')).toBe('capture.failure.expired');
    expect(captureFailureMessageKey('capture-context-revoked')).toBe('capture.failure.revoked');
    expect(captureFailureMessageKey('capture-context-not-found')).toBe('capture.failure.not_found');
    expect(captureFailureMessageKey('capture-context-row-mismatch')).toBe(
      'capture.failure.row_mismatch',
    );
    expect(captureFailureMessageKey(undefined)).toBeUndefined();
    expect(captureFailureMessageKey('pending-start-timeout')).toBe('capture.failure.start_timeout');
  });
});
