import { describe, expect, it } from 'vitest';

import { validateSingleSourceUrl } from '../src/source-url';

describe('validateSingleSourceUrl', () => {
  it('accepts exactly one trimmed http(s) URL and keeps the typed value', () => {
    expect(validateSingleSourceUrl('  https://example.com/video?a=1  ')).toEqual({
      ok: true,
      sourceUrl: 'https://example.com/video?a=1',
    });
    expect(validateSingleSourceUrl('http://127.0.0.1:8080/media.mp4')).toEqual({
      ok: true,
      sourceUrl: 'http://127.0.0.1:8080/media.mp4',
    });
  });

  it('rejects empty, multi-line, multi-URL and whitespace-containing input', () => {
    for (const raw of [
      '',
      '   ',
      'https://a.example/v\nhttps://b.example/v',
      'https://a.example/v https://b.example/v',
      'https://a.example/v\t x',
    ]) {
      const result = validateSingleSourceUrl(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid-source-url');
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('rejects non-http(s) schemes and unparseable input', () => {
    for (const raw of ['not a url', 'ftp://example.com/file', 'file:///C:/media.mp4', 'example.com/video']) {
      const result = validateSingleSourceUrl(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid-source-url');
      }
    }
  });
});
