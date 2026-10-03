import { describe, expect, it } from 'vitest';

import type {
  CurrentDownloadCommand,
  CurrentDownloadFormat,
  CurrentExtraArgs,
} from '../src';

describe('current Vue download candidate contracts', () => {
  it('keeps current formats and full ExtraArgs typed without snapshotting global runtime config into the command', () => {
    const formats: CurrentDownloadFormat[] = ['video', 'audio', 'mkv', 'mp3', 'flac', 'm4a', 'opus'];
    const globalExtraArgs: CurrentExtraArgs = {
      proxy: 'http://127.0.0.1:7890',
      cookies: 'chrome',
      userAgent: 'YTDL-Flow/Test',
      concurrentFragments: 4,
      embedMetadata: true,
      embedSubs: true,
      subLangs: 'en,zh-Hans',
      sponsorblock: true,
      filenameTemplate: '%(title)s.%(ext)s',
      resolution: '1080',
      videoCodec: 'av1',
      audioCodec: 'aac',
      adminMode: false,
      playerClient: 'web',
      poToken: 'po-token',
      visitorData: 'visitor-data',
      writeThumbnail: true,
      writeInfoJson: true,
    };
    const command: CurrentDownloadCommand = {
      sourceUrl: 'https://example.com/video',
      format: 'flac',
      taskOverrideArgs: {
        proxy: 'http://127.0.0.1:7891',
        writeThumbnail: false,
      },
      rowId: 'row-current',
    };

    expect(formats).toEqual(['video', 'audio', 'mkv', 'mp3', 'flac', 'm4a', 'opus']);
    expect(Object.keys(globalExtraArgs).sort()).toEqual([
      'adminMode',
      'audioCodec',
      'concurrentFragments',
      'cookies',
      'embedMetadata',
      'embedSubs',
      'filenameTemplate',
      'playerClient',
      'poToken',
      'proxy',
      'resolution',
      'sponsorblock',
      'subLangs',
      'userAgent',
      'videoCodec',
      'visitorData',
      'writeInfoJson',
      'writeThumbnail',
    ]);
    expect(command.taskOverrideArgs).toEqual({
      proxy: 'http://127.0.0.1:7891',
      writeThumbnail: false,
    });
    expect((command as unknown as Record<string, unknown>).globalExtraArgs).toBeUndefined();
    expect((command as unknown as Record<string, unknown>).downloadDir).toBeUndefined();
  });
});
