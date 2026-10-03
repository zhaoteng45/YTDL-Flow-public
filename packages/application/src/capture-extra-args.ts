import type { CurrentExtraArgs } from '../../contracts/src';

/**
 * ExtraArgs fields that carry network identity. They are never inherited by a
 * captured task: capture identity is a closed set, so absence means absence.
 * The native execution layer enforces the same policy again.
 */
export const CAPTURE_FORBIDDEN_EXTRA_ARGS = [
  'cookies',
  'proxy',
  'poToken',
  'visitorData',
  'playerClient',
  'userAgent',
] as const;

export type CaptureForbiddenExtraArg = (typeof CAPTURE_FORBIDDEN_EXTRA_ARGS)[number];

/** Return a copy without any network-identity field. */
export function stripCaptureForbiddenExtraArgs(
  args: Partial<CurrentExtraArgs> | undefined,
): Partial<CurrentExtraArgs> {
  if (!args) return {};
  const stripped: Partial<CurrentExtraArgs> = { ...args };
  for (const field of CAPTURE_FORBIDDEN_EXTRA_ARGS) {
    delete stripped[field];
  }
  return stripped;
}
