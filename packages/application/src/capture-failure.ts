import type { CaptureContextFailureCode } from '../../contracts/src';
import { CAPTURE_CONTEXT_FAILURE_CODES } from '../../contracts/src';

/**
 * Classify a native failure message into a stable capture-context code.
 *
 * This is the only place capture failure tokens are matched, so no caller has
 * to depend on human prose and an expired context can never be mistaken for a
 * generic download failure.
 */
export function classifyCaptureFailure(
  message: string | undefined,
): CaptureContextFailureCode | undefined {
  if (!message) return undefined;
  for (const code of Object.values(CAPTURE_CONTEXT_FAILURE_CODES)) {
    if (message.includes(code)) return code;
  }
  return undefined;
}
