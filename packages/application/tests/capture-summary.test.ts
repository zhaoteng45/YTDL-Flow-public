import { describe, expect, it } from 'vitest';

import type {
  CaptureClaimOutcome,
  CapturedResourceSummary,
} from '../src/capture-summary';
import {
  parseCaptureClaimOutcome,
  parseCapturedResourceSummary,
  parseCapturedResourceSummaries,
  parseCaptureSessionInfo,
} from '../src/capture-summary';

const validSummary: CapturedResourceSummary = {
  captureId: 'capture-1',
  resourceId: 'resource-1',
  resourceNumber: 3,
  siteLabel: 'cdn.example.com',
  mediaKind: 'hls',
  mimeType: 'application/vnd.apple.mpegurl',
  sizeBytes: 4_194_304,
  filenameHint: 'master.m3u8',
  resolutionHint: '1080p',
  requiresAuthenticatedReplay: false,
};

describe('captured resource summary guard', () => {
  it('accepts a sanitized native summary', () => {
    const parsed = parseCapturedResourceSummaries([validSummary]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].siteLabel).toBe('cdn.example.com');
    expect(parsed[0].resolutionHint).toBe('1080p');
  });

  it('accepts a summary without optional fields', () => {
    const minimal: CapturedResourceSummary = {
      captureId: 'capture-1',
      resourceId: 'resource-2',
      resourceNumber: 1,
      siteLabel: 'example.com',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      requiresAuthenticatedReplay: true,
    };
    expect(parseCapturedResourceSummary(minimal).requiresAuthenticatedReplay).toBe(true);
  });

  it('rejects a raw url or query smuggled into any field', () => {
    const leaked = {
      ...validSummary,
      siteLabel: 'cdn.example.com/media/master.m3u8?token=abc',
    };
    expect(() => parseCapturedResourceSummaries([leaked])).toThrow(/siteLabel/);

    const leakedHint = {
      ...validSummary,
      filenameHint: 'https://cdn.example.com/master.m3u8',
    };
    expect(() => parseCapturedResourceSummaries([leakedHint])).toThrow(/filenameHint/);
  });

  it('rejects secret-bearing field values', () => {
    for (const field of ['siteLabel', 'filenameHint', 'mimeType'] as const) {
      const leaked = { ...validSummary, [field]: 'cookie=sessionid' };
      expect(() => parseCapturedResourceSummaries([leaked])).toThrow(new RegExp(field));
    }
  });

  it('rejects non-allowlisted native fields that could carry raw context', () => {
    const extra = { ...validSummary, rawUrl: 'https://cdn.example.com/master.m3u8?sig=abc' };
    expect(() => parseCapturedResourceSummaries([extra])).toThrow(/unexpected field/i);

    const headers = { ...validSummary, headers: { Authorization: 'Bearer secret' } };
    expect(() => parseCapturedResourceSummaries([headers])).toThrow(/unexpected field/i);
  });

  it('rejects wrong shapes', () => {
    expect(() => parseCapturedResourceSummaries('nope')).toThrow(/array/i);
    expect(() => parseCapturedResourceSummaries([{ ...validSummary, resourceNumber: 0 }])).toThrow(
      /resourceNumber/,
    );
    expect(() => parseCapturedResourceSummaries([{ ...validSummary, mediaKind: 'exe' }])).toThrow(
      /mediaKind/,
    );
    expect(() => parseCapturedResourceSummaries([{ ...validSummary, sizeBytes: -1 }])).toThrow(
      /sizeBytes/,
    );
    expect(() =>
      parseCapturedResourceSummaries([{ ...validSummary, requiresAuthenticatedReplay: 'yes' }]),
    ).toThrow(/requiresAuthenticatedReplay/);
  });

  it('rejects a raw url smuggled into a claim outcome', () => {
    const outcome = {
      type: 'claimed',
      contextId: 'context-1',
      resource: { ...validSummary, siteLabel: 'https://cdn.example.com/master.m3u8?sig=abc' },
    };
    expect(() => parseCaptureClaimOutcome(outcome)).toThrow(/siteLabel/);
  });

  it('parses every typed claim outcome without string matching', () => {
    const outcomes: CaptureClaimOutcome[] = [
      { type: 'claimed', contextId: 'context-1', resource: validSummary },
      { type: 'notFound' },
      { type: 'captureInactive' },
      { type: 'unsupportedScheme' },
      { type: 'forbiddenDestination', reason: 'loopback' },
      { type: 'authenticatedReplayRequired' },
      { type: 'limitReached' },
    ];

    for (const outcome of outcomes) {
      expect(parseCaptureClaimOutcome(outcome)).toEqual(outcome);
    }

    expect(() => parseCaptureClaimOutcome({ type: 'mystery' })).toThrow(/type/);
    expect(() =>
      parseCaptureClaimOutcome({ type: 'forbiddenDestination', reason: 'https://x.test/?sig=1' }),
    ).toThrow(/reason/);
  });

  it('fails closed when any list entry is unsafe', () => {
    expect(() =>
      parseCapturedResourceSummaries([
        validSummary,
        { ...validSummary, filenameHint: 'clip.mp4?token=abc' },
      ]),
    ).toThrow(/filenameHint/);
  });

  it('parses a native capture session descriptor', () => {
    const session = parseCaptureSessionInfo({
      captureId: 'capture-1',
      browserName: 'msedge',
      profileIsolated: true,
    });
    expect(session).toEqual({
      captureId: 'capture-1',
      browserName: 'msedge',
      profileIsolated: true,
    });

    expect(() => parseCaptureSessionInfo(null)).toThrow(/session/);
    expect(() =>
      parseCaptureSessionInfo({ captureId: 'capture-1', browserName: 'msedge' }),
    ).toThrow(/profileIsolated/);
    expect(() =>
      parseCaptureSessionInfo({
        captureId: 'https://cdn.example.com/?token=1',
        browserName: 'msedge',
        profileIsolated: true,
      }),
    ).toThrow(/captureId/);
  });
});
