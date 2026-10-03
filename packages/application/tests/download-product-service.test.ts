import { describe, expect, it } from 'vitest';

import type {
  AnalyzedMedia,
  DownloadStartRequest,
  TaskPayload,
} from '../../contracts/src';
import type { CancelCommandResult } from '../src/download-service';
import type { DownloadTaskCreator } from '../src/download-product-service';
import { DownloadProductService } from '../src/download-product-service';
import { MediaAnalysisError, type MediaAnalyzer } from '../src/media-analyzer';

class FakeAnalyzer implements MediaAnalyzer {
  public readonly calls: string[] = [];
  public behavior: 'succeed' | 'native-failed' | 'playlist' | 'thrown' = 'succeed';
  public media: AnalyzedMedia = {
    sourceUrl: 'https://example.com/video',
    title: 'Example title',
    channel: 'Example channel',
    durationLabel: '12:34',
  };

  async analyze(sourceUrl: string): Promise<AnalyzedMedia> {
    this.calls.push(sourceUrl);
    if (this.behavior === 'native-failed') {
      throw new MediaAnalysisError('metadata-command-failed', '原生元数据命令失败');
    }
    if (this.behavior === 'playlist') {
      throw new MediaAnalysisError('playlist-not-supported', '当前版本仅支持单个视频链接');
    }
    if (this.behavior === 'thrown') {
      throw new Error('unexpected transport failure');
    }
    return { ...this.media, sourceUrl };
  }
}

class RecordingDownloads implements DownloadTaskCreator {
  public readonly created: Array<{
    sourceUrl: string;
    options?: Partial<Omit<DownloadStartRequest, 'taskId' | 'sourceUrl'>>;
  }> = [];
  public cancelCalls: string[] = [];
  public cancelResult: CancelCommandResult = { outcome: { type: 'cancel-requested' } };
  public createError: Error | null = null;

  async createTask(
    sourceUrl: string,
    options?: Partial<Omit<DownloadStartRequest, 'taskId' | 'sourceUrl'>>,
  ): Promise<TaskPayload> {
    if (this.createError) {
      throw this.createError;
    }
    this.created.push({ sourceUrl, options });
    return {
      id: `task-${this.created.length}`,
      sourceUrl,
      status: 'Queued',
      progress: 0,
    };
  }

  async cancelTask(taskId: string): Promise<CancelCommandResult> {
    this.cancelCalls.push(taskId);
    return this.cancelResult;
  }
}

function createService() {
  const analyzer = new FakeAnalyzer();
  const downloads = new RecordingDownloads();
  const service = new DownloadProductService({ analyzer, downloads });
  return { analyzer, downloads, service };
}

describe('DownloadProductService.analyze', () => {
  it('rejects invalid input before touching the native analyzer', async () => {
    const { analyzer, service } = createService();

    const result = await service.analyze('not a url');

    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid-source-url', message: expect.any(String) },
    });
    expect(analyzer.calls).toEqual([]);
  });

  it('normalizes a successful analyze result for the product UI', async () => {
    const { analyzer, service } = createService();
    analyzer.media = {
      sourceUrl: 'ignored',
      title: 'Example title',
      channel: 'Example channel',
      durationLabel: '12:34',
    };

    const result = await service.analyze('https://example.com/video');

    expect(result).toEqual({
      ok: true,
      media: {
        sourceUrl: 'https://example.com/video',
        title: 'Example title',
        channel: 'Example channel',
        durationLabel: '12:34',
      },
    });
  });

  it('maps playlist rejection to a product-visible error without creating a task', async () => {
    const { analyzer, downloads, service } = createService();
    analyzer.behavior = 'playlist';

    const result = await service.analyze('https://example.com/playlist');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('playlist-not-supported');
      expect(result.error.message).toContain('单个视频');
    }
    expect(downloads.created).toEqual([]);
  });

  it('maps native command failure and unexpected errors to ErrorPayload', async () => {
    const { analyzer, service } = createService();

    analyzer.behavior = 'native-failed';
    const nativeFailure = await service.analyze('https://example.com/video');
    expect(nativeFailure.ok).toBe(false);
    if (!nativeFailure.ok) {
      expect(nativeFailure.error.code).toBe('metadata-command-failed');
    }

    analyzer.behavior = 'thrown';
    const unexpected = await service.analyze('https://example.com/video');
    expect(unexpected.ok).toBe(false);
    if (!unexpected.ok) {
      expect(unexpected.error.code).toBe('analyze-failed');
      expect(unexpected.error.message).toBe('unexpected transport failure');
    }
  });
});

describe('DownloadProductService.createDownload', () => {
  it('maps video-auto to the existing video execution request', async () => {
    const { downloads, service } = createService();

    const result = await service.createDownload({
      sourceUrl: 'https://example.com/video',
      selection: 'video-auto',
    });

    expect(result).toEqual({
      ok: true,
      task: {
        id: 'task-1',
        sourceUrl: 'https://example.com/video',
        status: 'Queued',
        progress: 0,
      },
    });
    expect(downloads.created).toEqual([
      {
        sourceUrl: 'https://example.com/video',
        options: { downloadType: 'video' },
      },
    ]);
  });

  it('maps audio-mp3 to the existing audio execution with internally generated codec options', async () => {
    const { downloads, service } = createService();

    await service.createDownload({
      sourceUrl: 'https://example.com/video',
      selection: 'audio-mp3',
    });

    expect(downloads.created).toEqual([
      {
        sourceUrl: 'https://example.com/video',
        options: { downloadType: 'audio', extraArgs: { audioCodec: 'mp3' } },
      },
    ]);
  });

  it('rejects an unknown selection without creating a task', async () => {
    const { downloads, service } = createService();

    const result = await service.createDownload({
      sourceUrl: 'https://example.com/video',
      selection: 'video-1080p' as never,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-selection');
    }
    expect(downloads.created).toEqual([]);
  });

  it('rejects an invalid source URL without creating a task', async () => {
    const { downloads, service } = createService();

    const result = await service.createDownload({
      sourceUrl: 'invalid://whatever',
      selection: 'video-auto',
    });

    expect(result.ok).toBe(false);
    expect(downloads.created).toEqual([]);
  });

  it('maps an execution layer rejection to ErrorPayload', async () => {
    const { downloads, service } = createService();
    downloads.createError = new Error('start_download rejected');

    const result = await service.createDownload({
      sourceUrl: 'https://example.com/video',
      selection: 'video-auto',
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'create-task-failed', message: 'start_download rejected' },
    });
  });
});

describe('DownloadProductService.cancel', () => {
  it('delegates cancellation and returns the observable command result', async () => {
    const { downloads, service } = createService();
    downloads.cancelResult = {
      outcome: { type: 'cancel-rejected', error: { code: 'cancel-rejected', message: 'No active execution' } },
    };

    const result = await service.cancel('task-9');

    expect(downloads.cancelCalls).toEqual(['task-9']);
    expect(result.outcome).toEqual({
      type: 'cancel-rejected',
      error: { code: 'cancel-rejected', message: 'No active execution' },
    });
  });
});
