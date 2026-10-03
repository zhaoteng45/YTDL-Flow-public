import type { ErrorPayload } from '../../contracts/src';

/**
 * Converts unknown thrown values into the shared ErrorPayload contract.
 * Used by the product use cases so React never sees raw native/engine errors.
 */
export function toErrorPayload(error: unknown, code: string): ErrorPayload {
  if (error instanceof Error) {
    return { code, message: error.message || error.name };
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return { code, message: error };
  }
  return { code, message: '未知错误' };
}
