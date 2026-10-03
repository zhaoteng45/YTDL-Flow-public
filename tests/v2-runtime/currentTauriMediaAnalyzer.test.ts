import { describe, expect, it, vi } from 'vitest';

import { CurrentTauriMediaAnalyzer } from '../../src/v2-runtime/currentTauriMediaAnalyzer';

describe('CurrentTauriMediaAnalyzer', () => {
  it('retains safe available formats from native metadata for per-task selection', async () => {
    const analyzer = new CurrentTauriMediaAnalyzer({ isNativeRuntime: () => true, async invoke() {
      return { title: 'Video', thumbnail: '', duration: '1:00', channel: 'Channel', url: 'https://example.com/video', availableFormats: [{ formatId: '137', width: 1920, height: 1080, vcodec: 'h264', acodec: 'none', protocol: 'https', usable: true }] };
    } });
    expect((await analyzer.analyze({ sourceUrl: 'https://example.com/video', attemptId: 'formats' })).availableFormats).toEqual([{ formatId: '137', width: 1920, height: 1080, vcodec: 'h264', acodec: 'none', protocol: 'https', usable: true }]);
  });
  it.each([
    { playerClient: 'smart', maxHeight: 1080, authMode: 'anonymous', potMode: 'unknown', reason: 'invalid winner' },
    { playerClient: 'web', maxHeight: 1080, authMode: 'invalid', potMode: 'unknown', reason: 'invalid identity' },
    { playerClient: 'web', maxHeight: 1080, authMode: ['cookies'], potMode: 'unknown', reason: 'invalid identity type' },
    { playerClient: 'web', maxHeight: Infinity, authMode: 'cookies', potMode: 'unknown', reason: 'invalid capability' },
  ])('rejects malformed native SMART decisions before a download can start', async (smartDecision) => {
    const analyzer = new CurrentTauriMediaAnalyzer({ isNativeRuntime: () => true, async invoke() {
      return { title: 'Video', thumbnail: '', duration: '1:00', channel: 'Channel', url: 'https://example.com/video', smartDecision };
    } });
    await expect(analyzer.analyze({ sourceUrl: 'https://example.com/video', attemptId: 'invalid' })).rejects.toThrow('Invalid native metadata field: smartDecision');
  });
  it('forwards current typed analysis args and maps single media', async () => {
    const invoke = vi.fn(async () => ({
      title: 'Example',
      thumbnail: 'https://example.com/thumb.jpg',
      duration: '1:00',
      channel: 'Channel',
      url: 'https://example.com/video',
      resolution: '1080p',
      width: 1920,
      height: 1080,
      videoCodec: 'av1',
      audioCodec: 'opus',
      filesize: '100 MiB',
      filename: 'example.webm',
    }));
    const analyzer = new CurrentTauriMediaAnalyzer({
      invoke,
      isNativeRuntime: () => true,
    });

    const result = await analyzer.analyze({
      sourceUrl: 'https://example.com/video',
      attemptId: 'analysis-1',
      extraArgs: {
        cookies: 'chrome',
        proxy: 'http://127.0.0.1:7890',
        writeInfoJson: true,
      },
    });

    expect(invoke).toHaveBeenCalledWith('get_video_metadata', {
      url: 'https://example.com/video',
      id: 'analysis-1',
      extraArgs: {
        cookies: 'chrome',
        proxy: 'http://127.0.0.1:7890',
        writeInfoJson: true,
      },
    });
    expect(result).toEqual({
      title: 'Example',
      thumbnail: 'https://example.com/thumb.jpg',
      duration: '1:00',
      channel: 'Channel',
      url: 'https://example.com/video',
      resolution: '1080p',
      width: 1920,
      height: 1080,
      videoCodec: 'av1',
      audioCodec: 'opus',
      filesize: '100 MiB',
      filename: 'example.webm',
    });
  });

  it('rejects playlist metadata instead of widening the current task model', async () => {
    const analyzer = new CurrentTauriMediaAnalyzer({
      invoke: vi.fn(async () => ({
        title: 'Playlist',
        thumbnail: 'https://example.com/list.jpg',
        duration: '',
        channel: 'Channel',
        url: 'https://example.com/list',
        entries: [
          {
            id: 'one',
            title: 'One',
            url: 'https://example.com/1',
          },
        ],
      })),
      isNativeRuntime: () => true,
    });

    await expect(analyzer.analyze({
      sourceUrl: 'https://example.com/list',
      attemptId: 'analysis-playlist',
      extraArgs: {},
    })).rejects.toThrow(/playlist.*not supported|播放列表/i);
  });
});
