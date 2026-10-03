import { describe, expect, it } from 'vitest';

import { parseUrlInput } from '../../src/application/urlInput';

describe('multi-URL input seam', () => {
  it('returns ordered unique valid URLs, keeps invalid entries observable, and does not impose a 50-link cap', () => {
    const many = Array.from({ length: 55 }, (_, index) => `https://example.com/video-${index + 1}`);
    const input = [
      '  https://example.com/first  ',
      'not-a-url',
      'https://example.com/first',
      ...many,
      'ftp://example.com/not-supported',
    ].join(' \t ');

    expect(parseUrlInput(input)).toEqual({
      urls: [
        'https://example.com/first',
        ...many,
      ],
      invalidEntries: [
        'not-a-url',
        'ftp://example.com/not-supported',
      ],
    });
  });

  it('uses exact trimmed strings for deduplication without URL normalization', () => {
    expect(parseUrlInput([
      'https://example.com/video',
      'https://example.com/video/',
      'https://example.com/video',
    ].join('\u2003'))).toEqual({
      urls: [
        'https://example.com/video',
        'https://example.com/video/',
      ],
      invalidEntries: [],
    });
  });
});
