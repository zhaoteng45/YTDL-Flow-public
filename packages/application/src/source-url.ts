import type { ErrorPayload } from '../../contracts/src';

export type SourceUrlValidation =
  | { ok: true; sourceUrl: string }
  | { ok: false; error: ErrorPayload };

const INVALID_SOURCE_URL_MESSAGE = '请输入单个有效的 http(s) 链接';

/**
 * Each analysis dispatch accepts exactly one HTTP(S) URL. A higher layer may
 * enqueue multiple independent videos by dispatching them separately. Playlist
 * results are rejected by the metadata adapter because only the native response
 * can prove a playlist really is one.
 */
export function validateSingleSourceUrl(raw: string): SourceUrlValidation {
  const sourceUrl = raw.trim();

  if (sourceUrl.length === 0 || /\s/.test(sourceUrl)) {
    return { ok: false, error: invalidSourceUrlError() };
  }

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return { ok: false, error: invalidSourceUrlError() };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: invalidSourceUrlError() };
  }
  if (parsed.hostname.length === 0) {
    return { ok: false, error: invalidSourceUrlError() };
  }

  return { ok: true, sourceUrl };
}

function invalidSourceUrlError(): ErrorPayload {
  return { code: 'invalid-source-url', message: INVALID_SOURCE_URL_MESSAGE };
}
