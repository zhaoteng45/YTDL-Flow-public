import { describe, expect, it } from 'vitest';

import type {
  CurrentAnalysisMedia,
  CurrentAnalysisRequest,
} from '../src';

describe('current Vue analysis contracts', () => {
  it('represents one analyzed media item with current request args', () => {
    const media: CurrentAnalysisMedia = {
      title: 'Single video',
      thumbnail: 'https://example.com/video.jpg',
      duration: '1:00',
      channel: 'Example',
      url: 'https://example.com/video',
      resolution: '1080p',
      width: 1920,
      height: 1080,
      videoCodec: 'av1',
      audioCodec: 'opus',
      filesize: '123 MiB',
      filename: 'video.mp4',
    };
    const request: CurrentAnalysisRequest = {
      sourceUrl: media.url,
      attemptId: 'analysis-attempt-1',
      extraArgs: {
        cookies: 'chrome',
        proxy: 'http://127.0.0.1:7890',
      },
    };

    expect(media.url).toBe('https://example.com/video');
    expect((media as unknown as Record<string, unknown>).entries).toBeUndefined();
    expect(request.attemptId).toBe('analysis-attempt-1');
    expect(request.extraArgs?.cookies).toBe('chrome');
  });
});
