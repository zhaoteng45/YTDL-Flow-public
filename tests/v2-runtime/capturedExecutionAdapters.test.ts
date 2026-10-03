import { describe, expect, it, vi } from 'vitest';

import { CurrentTauriMediaAnalyzer } from '../../src/v2-runtime/currentTauriMediaAnalyzer';
import { TauriDownloadEngine } from '../../src/v2-runtime/tauriDownloadEngine';
import { toCurrentTaskPresentationRow } from '../../src/application/taskPresentation';

function engineDeps() {
  const invoke = vi.fn(async () => undefined);
  const listen = vi.fn(async () => () => {});
  return { invoke, listen };
}

const nativeMedia = {
  title: 'Captured clip',
  thumbnail: '',
  duration: '00:10',
  channel: 'capture',
  url: 'cdn.example.com',
};

describe('captured analysis adapter', () => {
  it('sends the opaque context instead of a url', async () => {
    const invoke = vi.fn(async () => nativeMedia);
    const analyzer = new CurrentTauriMediaAnalyzer({ invoke, isNativeRuntime: () => true });

    const media = await analyzer.analyze({
      attemptId: 'analysis-1',
      captureContextId: 'context-1',
    });

    expect(invoke).toHaveBeenCalledWith('get_video_metadata', {
      captureContextId: 'context-1',
      id: 'analysis-1',
      extraArgs: {},
    });
    expect(media.url).toBe('cdn.example.com');
  });

  it('rejects a captured response that carries an executable url', async () => {
    const invoke = vi.fn(async () => ({
      ...nativeMedia,
      url: 'https://cdn.example.com/clip.mp4?sig=secret',
    }));
    const analyzer = new CurrentTauriMediaAnalyzer({ invoke, isNativeRuntime: () => true });

    await expect(
      analyzer.analyze({ attemptId: 'analysis-1', captureContextId: 'context-1' }),
    ).rejects.toThrow(/captured/);
  });

  it('requires exactly one analysis target', async () => {
    const invoke = vi.fn(async () => nativeMedia);
    const analyzer = new CurrentTauriMediaAnalyzer({ invoke, isNativeRuntime: () => true });

    await expect(analyzer.analyze({ attemptId: 'analysis-1' })).rejects.toThrow(/target/);
    await expect(
      analyzer.analyze({
        attemptId: 'analysis-1',
        sourceUrl: 'https://example.com/video',
        captureContextId: 'context-1',
      }),
    ).rejects.toThrow(/target/);
  });

  it('keeps the pasted-url analysis path unchanged', async () => {
    const invoke = vi.fn(async () => ({
      ...nativeMedia,
      url: 'https://example.com/video',
    }));
    const analyzer = new CurrentTauriMediaAnalyzer({ invoke, isNativeRuntime: () => true });

    await analyzer.analyze({ attemptId: 'analysis-1', sourceUrl: 'https://example.com/video' });

    expect(invoke).toHaveBeenCalledWith('get_video_metadata', {
      url: 'https://example.com/video',
      id: 'analysis-1',
      extraArgs: {},
    });
  });
});

describe('captured download engine', () => {
  it('sends the capture context instead of a url', async () => {
    const { invoke, listen } = engineDeps();
    const engine = new TauriDownloadEngine({ invoke, listen });

    await engine.start({
      taskId: 'attempt-1',
      captureContextId: 'context-1',
      downloadType: 'video',
      downloadDir: 'C:/downloads',
      extraArgs: { resolution: '1080' },
    });

    expect(invoke).toHaveBeenCalledWith('start_download', {
      id: 'attempt-1',
      captureContextId: 'context-1',
      downloadType: 'video',
      downloadDir: 'C:/downloads',
      extraArgs: { resolution: '1080' },
    });
    const args = invoke.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(args)).not.toContain('url');
  });

  it('keeps the pasted-url execution path unchanged', async () => {
    const { invoke, listen } = engineDeps();
    const engine = new TauriDownloadEngine({ invoke, listen });

    await engine.start({
      taskId: 'attempt-2',
      sourceUrl: 'https://example.com/video',
      downloadType: 'audio',
      extraArgs: { cookies: 'edge' },
    });

    expect(invoke).toHaveBeenCalledWith('start_download', {
      id: 'attempt-2',
      url: 'https://example.com/video',
      downloadType: 'audio',
      downloadDir: undefined,
      extraArgs: { cookies: 'edge' },
    });
    const args = invoke.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(args)).not.toContain('captureContextId');
  });

  it('requires exactly one execution target', async () => {
    const { invoke, listen } = engineDeps();
    const engine = new TauriDownloadEngine({ invoke, listen });

    await expect(
      engine.start({ taskId: 'attempt-3', downloadType: 'video' }),
    ).rejects.toThrow(/target/);
    await expect(
      engine.start({
        taskId: 'attempt-4',
        sourceUrl: 'https://example.com/video',
        captureContextId: 'context-1',
        downloadType: 'video',
      }),
    ).rejects.toThrow(/target/);
  });
});

describe('captured presentation row', () => {
  it('carries the capture reference and never an executable url', () => {
    const row = toCurrentTaskPresentationRow({
      rowId: 'row-1',
      attemptId: 'attempt-1',
      sourceUrl: 'capture:cdn.example.com',
      status: 'analyzed',
      orderKey: 1,
      capture: { contextId: 'context-1', siteLabel: 'cdn.example.com', mediaKind: 'video' },
      cancelRequested: false,
      progress: 0,
      logs: [],
      actions: {
        canCancel: false,
        canRemove: true,
        canOpenFolder: false,
        canStartDownload: true,
        canRetryDownload: false,
        canReanalyze: false,
      },
    });

    expect(row.capture).toEqual({
      contextId: 'context-1',
      siteLabel: 'cdn.example.com',
      mediaKind: 'video',
    });
    expect(row.url).toBe('capture:cdn.example.com');
  });
});
