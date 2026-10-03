import { describe, expect, it, vi } from 'vitest';

import type { AnalyzedMedia } from '../../packages/contracts/src';
import { MediaAnalysisError, type MediaAnalyzer } from '../../packages/application/src/media-analyzer';
import { TauriMediaAnalyzer } from '../../src/v2-runtime/tauriMediaAnalyzer';

interface HarnessOptions {
  native?: boolean;
  response?: unknown;
  reject?: Error;
}

function createHarness(options: HarnessOptions = {}) {
  const invoke = vi.fn(async () => {
    if (options.reject) {
      throw options.reject;
    }
    return options.response;
  });

  const analyzer: MediaAnalyzer = new TauriMediaAnalyzer({
    invoke,
    isNativeRuntime: () => options.native ?? true,
    createRequestId: () => 'analyze-test-1',
  });

  return { analyzer, invoke };
}

const nativeMetadata = {
  title: 'Example video',
  thumbnail: 'https://example.com/thumb.jpg',
  duration: '05:12',
  channel: 'Example channel',
  url: 'https://example.com/video',
  resolution: '1920x1080',
  width: 1920,
  height: 1080,
  videoCodec: 'h264',
  audioCodec: 'aac',
  filesize: '12.3 MB',
  filename: 'Example video.mp4',
};

async function expectAnalysisError(promise: Promise<AnalyzedMedia>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(MediaAnalysisError);
  await promise.catch((error: unknown) => {
    expect((error as MediaAnalysisError).code).toBe(code);
  });
}

describe('TauriMediaAnalyzer', () => {
  it('requires the native Tauri runtime before invoking anything', async () => {
    const { analyzer, invoke } = createHarness({ native: false });

    await expectAnalysisError(analyzer.analyze('https://example.com/video'), 'native-runtime-unavailable');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('calls the existing native metadata command and normalizes the response', async () => {
    const { analyzer, invoke } = createHarness({ response: nativeMetadata });

    const media = await analyzer.analyze('https://example.com/video');

    expect(invoke).toHaveBeenCalledWith('get_video_metadata', {
      url: 'https://example.com/video',
      extraArgs: null,
      id: 'analyze-test-1',
    });
    expect(media).toEqual({
      sourceUrl: 'https://example.com/video',
      title: 'Example video',
      channel: 'Example channel',
      durationLabel: '05:12',
      thumbnailUrl: 'https://example.com/thumb.jpg',
    });
  });

  it('does not expose the native/legacy DTO surface to the product model', async () => {
    const { analyzer } = createHarness({ response: nativeMetadata });

    const media = await analyzer.analyze('https://example.com/video');

    expect(Object.keys(media).sort()).toEqual([
      'channel',
      'durationLabel',
      'sourceUrl',
      'thumbnailUrl',
      'title',
    ]);
    const raw = media as unknown as Record<string, unknown>;
    for (const legacyField of [
      'entries',
      'resolution',
      'width',
      'height',
      'videoCodec',
      'audioCodec',
      'filesize',
      'filename',
      'extraArgs',
    ]) {
      expect(raw[legacyField]).toBeUndefined();
    }
  });

  it('maps native unknown sentinels to honest missing optional fields', async () => {
    const { analyzer } = createHarness({
      response: {
        title: 'Example video',
        thumbnail: '',
        duration: 'Unknown',
        channel: 'Unknown Channel',
        url: 'https://example.com/video',
      },
    });

    const media = await analyzer.analyze('https://example.com/video');

    expect(media).toEqual({
      sourceUrl: 'https://example.com/video',
      title: 'Example video',
    });
    expect(Object.keys(media).sort()).toEqual(['sourceUrl', 'title']);
  });

  it('rejects malformed native responses', async () => {
    for (const response of [
      null,
      'video',
      {},
      { title: '', url: 'https://example.com/video' },
      { title: 42, url: 'https://example.com/video' },
      { title: 'Example', url: 7 },
      { title: 'Example', url: 'https://example.com/video', channel: 7 },
      { title: 'Example', url: 'https://example.com/video', duration: 7 },
      { title: 'Example', url: 'https://example.com/video', thumbnail: 7 },
    ]) {
      const { analyzer } = createHarness({ response });
      await expectAnalysisError(analyzer.analyze('https://example.com/video'), 'invalid-native-response');
    }
  });

  it('rejects playlist results, including an empty entries array', async () => {
    for (const entries of [[], [{ id: 'a', title: 'A', url: 'https://example.com/a' }]]) {
      const { analyzer } = createHarness({
        response: { ...nativeMetadata, entries },
      });

      await expectAnalysisError(analyzer.analyze('https://example.com/video'), 'playlist-not-supported');
    }
  });

  it('rejects a native response whose URL does not match the requested source', async () => {
    const { analyzer } = createHarness({
      response: { ...nativeMetadata, url: 'https://example.com/other' },
    });

    await expectAnalysisError(analyzer.analyze('https://example.com/video'), 'invalid-native-response');
  });

  it('maps native command rejection to a product-visible analysis error', async () => {
    const { analyzer } = createHarness({ reject: new Error('yt-dlp exited with code 1') });

    await expectAnalysisError(analyzer.analyze('https://example.com/video'), 'metadata-command-failed');
    await analyzer.analyze('https://example.com/video').catch((error: unknown) => {
      expect((error as Error).message).toContain('yt-dlp exited with code 1');
    });
  });

  it('redacts sensitive material from native analysis failures', async () => {
    const sensitiveValue = ['analysis', 'sensitive'].join('-');
    const queryKey = ['to', 'ken'].join('');
    const { analyzer } = createHarness({
      reject: new Error(
        ['metadata failed for https://example.com/watch?v=ok&', queryKey, '=', sensitiveValue].join(''),
      ),
    });

    await analyzer.analyze('https://example.com/video').catch((error: unknown) => {
      const message = (error as Error).message;
      expect(message).toContain(`${queryKey}=<REDACTED>`);
      expect(message).not.toContain(sensitiveValue);
    });
  });
});
