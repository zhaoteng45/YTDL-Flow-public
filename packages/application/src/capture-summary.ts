import type {
  CaptureClaimOutcome,
  CapturedMediaKind,
  CapturedResourceSummary,
  CaptureSessionEndReason,
  CaptureSessionInfo,
  CaptureSessionStatus,
} from '../../contracts/src';
import { CAPTURED_MEDIA_KINDS } from '../../contracts/src';

export type {
  CaptureClaimOutcome,
  CapturedMediaKind,
  CapturedResourceSummary,
  CaptureSessionEndReason,
  CaptureSessionInfo,
  CaptureSessionStatus,
};

const SESSION_END_REASONS: readonly CaptureSessionEndReason[] = ['stopped', 'browser-closed'];
/**
 * Frontend-safe parsing of native Resource Capture payloads.
 *
 * The native module must already have sanitized every field; this guard is the
 * defensive boundary that fails closed if a raw URL, query string, userinfo,
 * Cookie/Authorization material or an unexpected field ever crosses IPC.
 */

const SUMMARY_FIELDS = new Set([
  'captureId',
  'resourceId',
  'resourceNumber',
  'siteLabel',
  'mediaKind',
  'mimeType',
  'sizeBytes',
  'filenameHint',
  'resolutionHint',
  'requiresAuthenticatedReplay',
]);

const OPTIONAL_SUMMARY_FIELDS = new Set(['sizeBytes', 'filenameHint', 'resolutionHint']);

const CLAIM_TYPES = new Set([
  'claimed',
  'notFound',
  'captureInactive',
  'unsupportedScheme',
  'forbiddenDestination',
  'authenticatedReplayRequired',
  'unsupportedExecutionKind',
  'limitReached',
]);

const MIME_PATTERN = /^[a-z0-9!#$&^_.+*-]+\/[a-z0-9!#$&^_.+*-]+$/;
const MAX_LABEL_LENGTH = 120;

function fail(field: string, reason: string): never {
  throw new Error(`Invalid captured resource payload (${field}): ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireSafeLabel(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(field, 'expected a non-empty string');
  }
  if (value.length > MAX_LABEL_LENGTH) {
    fail(field, 'exceeds the display label limit');
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    fail(field, 'contains control characters');
  }
  // '/' '?' '#' '@' ':' '=' and '\\' are enough to reconstruct a URL or a
  // header-style secret; a display label never needs them.
  if (/[/?#@=:\\]/.test(value)) {
    fail(field, 'contains URL-shaped or secret-shaped characters');
  }
  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    fail(field, 'expected a positive integer');
  }
  return value;
}

function requireOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requirePositiveInteger(value, field);
}

function requireMediaKind(value: unknown): CapturedMediaKind {
  if (typeof value !== 'string' || !CAPTURED_MEDIA_KINDS.includes(value as CapturedMediaKind)) {
    fail('mediaKind', `unsupported media kind '${String(value)}'`);
  }
  return value as CapturedMediaKind;
}

function requireMimeType(value: unknown): string {
  if (typeof value !== 'string' || !MIME_PATTERN.test(value)) {
    fail('mimeType', 'expected a plain type/subtype token');
  }
  return value;
}

function assertNoUnexpectedFields(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      fail(field, `unexpected field '${key}'`);
    }
  }
}

export function parseCapturedResourceSummary(payload: unknown): CapturedResourceSummary {
  if (!isRecord(payload)) {
    fail('summary', 'expected an object');
  }
  assertNoUnexpectedFields(payload, SUMMARY_FIELDS, 'summary');
  for (const required of SUMMARY_FIELDS) {
    if (!OPTIONAL_SUMMARY_FIELDS.has(required) && payload[required] === undefined) {
      fail(required, 'missing required field');
    }
  }

  const requiresAuthenticatedReplay = payload.requiresAuthenticatedReplay;
  if (typeof requiresAuthenticatedReplay !== 'boolean') {
    fail('requiresAuthenticatedReplay', 'expected a boolean');
  }

  const summary: CapturedResourceSummary = {
    captureId: requireSafeLabel(payload.captureId, 'captureId'),
    resourceId: requireSafeLabel(payload.resourceId, 'resourceId'),
    resourceNumber: requirePositiveInteger(payload.resourceNumber, 'resourceNumber'),
    siteLabel: requireSafeLabel(payload.siteLabel, 'siteLabel'),
    mediaKind: requireMediaKind(payload.mediaKind),
    mimeType: requireMimeType(payload.mimeType),
    requiresAuthenticatedReplay,
  };

  const sizeBytes = requireOptionalPositiveInteger(payload.sizeBytes, 'sizeBytes');
  const filenameHint =
    payload.filenameHint === undefined || payload.filenameHint === null
      ? undefined
      : requireSafeLabel(payload.filenameHint, 'filenameHint');
  const resolutionHint =
    payload.resolutionHint === undefined || payload.resolutionHint === null
      ? undefined
      : requireSafeLabel(payload.resolutionHint, 'resolutionHint');

  return {
    ...summary,
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    ...(filenameHint === undefined ? {} : { filenameHint }),
    ...(resolutionHint === undefined ? {} : { resolutionHint }),
  };
}

export function parseCapturedResourceSummaries(payload: unknown): CapturedResourceSummary[] {
  if (!Array.isArray(payload)) {
    fail('summaries', 'expected an array of resource summaries');
  }
  return payload.map((entry) => parseCapturedResourceSummary(entry));
}

export function parseCaptureSessionInfo(payload: unknown): CaptureSessionInfo {
  if (!isRecord(payload)) {
    fail('session', 'expected an object');
  }
  assertNoUnexpectedFields(
    payload,
    new Set(['captureId', 'browserName', 'profileIsolated']),
    'session',
  );

  const { captureId, browserName, profileIsolated } = payload;
  if (typeof captureId !== 'string' || captureId.length === 0) {
    fail('captureId', 'expected a non-empty identifier');
  }
  if (typeof browserName !== 'string' || browserName.length === 0) {
    fail('browserName', 'expected a non-empty identifier');
  }
  if (typeof profileIsolated !== 'boolean') {
    fail('profileIsolated', 'expected a boolean');
  }

  return {
    captureId: requireSafeLabel(captureId, 'captureId'),
    browserName: requireSafeLabel(browserName, 'browserName'),
    profileIsolated,
  };
}

export function parseCaptureSessionStatus(payload: unknown): CaptureSessionStatus {
  if (!isRecord(payload)) {
    fail('sessionStatus', 'expected an object');
  }
  const { active, captureId, browserName, reason } = payload;
  if (typeof active !== 'boolean') {
    fail('active', 'expected a boolean');
  }
  if (captureId !== undefined && captureId !== null && typeof captureId !== 'string') {
    fail('captureId', 'expected a string');
  }
  if (browserName !== undefined && browserName !== null && typeof browserName !== 'string') {
    fail('browserName', 'expected a string');
  }
  if (reason !== undefined && reason !== null && !SESSION_END_REASONS.includes(reason as CaptureSessionEndReason)) {
    fail('reason', `unsupported session end reason '${String(reason)}'`);
  }

  return {
    active,
    ...(typeof captureId === 'string' ? { captureId } : {}),
    ...(typeof browserName === 'string' ? { browserName } : {}),
    ...(SESSION_END_REASONS.includes(reason as CaptureSessionEndReason)
      ? { reason: reason as CaptureSessionEndReason }
      : {}),
  };
}

export function parseCaptureClaimOutcome(payload: unknown): CaptureClaimOutcome {
  if (!isRecord(payload)) {
    fail('claimOutcome', 'expected an object');
  }
  const type = payload.type;
  if (typeof type !== 'string' || !CLAIM_TYPES.has(type)) {
    fail('type', `unsupported claim outcome type '${String(type)}'`);
  }

  switch (type) {
    case 'claimed': {
      assertNoUnexpectedFields(payload, new Set(['type', 'contextId', 'resource']), 'claimOutcome');
      return {
        type: 'claimed',
        contextId: requireSafeLabel(payload.contextId, 'contextId'),
        resource: parseCapturedResourceSummary(payload.resource),
      };
    }
    case 'forbiddenDestination': {
      assertNoUnexpectedFields(payload, new Set(['type', 'reason']), 'claimOutcome');
      return {
        type: 'forbiddenDestination',
        reason: requireSafeLabel(payload.reason, 'reason'),
      };
    }
    case 'notFound':
    case 'captureInactive':
    case 'unsupportedScheme':
    case 'authenticatedReplayRequired':
    case 'unsupportedExecutionKind':
    case 'limitReached': {
      assertNoUnexpectedFields(payload, new Set(['type']), 'claimOutcome');
      return { type };
    }
    default:
      return fail('type', `unsupported claim outcome type '${String(type)}'`);
  }
}
