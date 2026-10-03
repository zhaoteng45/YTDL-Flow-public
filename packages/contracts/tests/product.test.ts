import { describe, expect, it } from 'vitest';
import type {
  AnalyzedMedia,
  CreateDownloadCommand,
  DownloadSelection,
  TaskPayload,
} from '../src';

describe('product analyze/download contracts', () => {
  it('exposes only product-needed analyzed media fields', () => {
    const media: AnalyzedMedia = {
      sourceUrl: 'https://example.com/video',
      title: 'Example title',
      channel: 'Example channel',
      durationLabel: '12:34',
      thumbnailUrl: 'https://example.com/thumb.jpg',
    };

    expect(Object.keys(media).sort()).toEqual([
      'channel',
      'durationLabel',
      'sourceUrl',
      'thumbnailUrl',
      'title',
    ]);
    expect((media as unknown as Record<string, unknown>).entries).toBeUndefined();
    expect((media as unknown as Record<string, unknown>).extraArgs).toBeUndefined();
    expect((media as unknown as Record<string, unknown>).videoCodec).toBeUndefined();
  });

  it('keeps optional media fields optional', () => {
    const media: AnalyzedMedia = {
      sourceUrl: 'https://example.com/video',
      title: 'Example title',
    };

    expect(media.channel).toBeUndefined();
    expect(media.durationLabel).toBeUndefined();
    expect(media.thumbnailUrl).toBeUndefined();
  });

  it('closes the Stage-3 download selection to video-auto and audio-mp3', () => {
    const selections: DownloadSelection[] = ['video-auto', 'audio-mp3'];
    expect(selections).toEqual(['video-auto', 'audio-mp3']);

    // Compile-time contract: tsc must reject source-format enumeration.
    // @ts-expect-error Stage 3 does not enumerate source formats.
    const unsupported: DownloadSelection = 'video-1080p';
    void unsupported;
  });

  it('binds a create command to one analyzed source URL and one selection', () => {
    const command: CreateDownloadCommand = {
      sourceUrl: 'https://example.com/video',
      selection: 'audio-mp3',
    };

    expect(Object.keys(command).sort()).toEqual(['selection', 'sourceUrl']);
    expect((command as unknown as Record<string, unknown>).extraArgs).toBeUndefined();
    expect((command as unknown as Record<string, unknown>).formatId).toBeUndefined();
  });

  it('carries a trusted failure reason on the task read model', () => {
    const payload: TaskPayload = {
      id: 'task-failed',
      sourceUrl: 'https://example.com/video',
      status: 'Failed',
      progress: 50,
      failureReason: 'yt-dlp exited with code 1',
    };

    expect(payload.failureReason).toBe('yt-dlp exited with code 1');

    const running: TaskPayload = {
      id: 'task-running',
      sourceUrl: 'https://example.com/video',
      status: 'Downloading',
      progress: 10,
    };
    expect(running.failureReason).toBeUndefined();
  });
});
