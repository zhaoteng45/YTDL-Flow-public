import { describe, expect, it, vi } from 'vitest';

import { TauriCaptureAdapter } from '../../src/v2-runtime/capture/tauriCaptureAdapter';

const sanitizedSummary = {
  captureId: 'capture-1',
  resourceId: 'resource-1',
  resourceNumber: 1,
  siteLabel: 'cdn.example.com',
  mediaKind: 'video' as const,
  mimeType: 'video/mp4',
  sizeBytes: 1024,
  filenameHint: 'clip.mp4',
  requiresAuthenticatedReplay: false,
};

function adapterWith(handlers: Record<string, (args?: Record<string, unknown>) => unknown>) {
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    const handler = handlers[command];
    if (!handler) throw new Error(`unexpected command ${command}`);
    return handler(args);
  });
  let listener: ((payload: unknown) => void) | null = null;
  const unlisten = vi.fn();
  const listen = vi.fn(async (_event: string, handler: (payload: unknown) => void) => {
    listener = handler;
    return unlisten;
  });

  const adapter = new TauriCaptureAdapter({
    invoke,
    listen,
    isNativeRuntime: () => true,
  });

  return {
    adapter,
    invoke,
    listen,
    unlisten,
    emit(payload: unknown) {
      listener?.(payload);
    },
  };
}

describe('TauriCaptureAdapter', () => {
  it('starts a session through the native command and validates the response', async () => {
    const { adapter, invoke } = adapterWith({
      capture_start: () => ({
        captureId: 'capture-1',
        browserName: 'msedge',
        profileIsolated: true,
      }),
    });

    const session = await adapter.start('https://example.com/watch');
    expect(invoke).toHaveBeenCalledWith('capture_start', {
      openUrl: 'https://example.com/watch',
    });
    expect(session.profileIsolated).toBe(true);
  });

  it('rejects native payloads that carry raw or secret material', async () => {
    const { adapter } = adapterWith({
      capture_list: () => [{ ...sanitizedSummary, rawUrl: 'https://cdn.example.com/a.mp4?sig=1' }],
    });

    await expect(adapter.list()).rejects.toThrow(/unexpected field/);

    const leaked = adapterWith({
      capture_list: () => [{ ...sanitizedSummary, siteLabel: 'https://cdn.example.com/a.mp4?sig=1' }],
    }).adapter;
    await expect(leaked.list()).rejects.toThrow(/siteLabel/);
  });

  it('maps typed claim outcomes and never string-matches errors', async () => {
    const { adapter, invoke } = adapterWith({
      capture_claim: (args) =>
        args?.resourceId === 'resource-1'
          ? { type: 'claimed', contextId: 'context-1', resource: sanitizedSummary }
          : { type: 'authenticatedReplayRequired' },
    });

    expect(await adapter.claim('resource-1')).toEqual({
      type: 'claimed',
      contextId: 'context-1',
      resource: sanitizedSummary,
    });
    expect(await adapter.claim('resource-2')).toEqual({ type: 'authenticatedReplayRequired' });
    expect(invoke).toHaveBeenCalledWith('capture_claim', { resourceId: 'resource-2' });
  });

  it('releases and revokes claimed contexts through distinct commands', async () => {
    const { adapter, invoke } = adapterWith({
      capture_release: () => true,
      capture_revoke: () => true,
    });

    await adapter.release('context-1');
    await adapter.revoke('context-2');

    expect(invoke).toHaveBeenCalledWith('capture_release', { contextId: 'context-1' });
    expect(invoke).toHaveBeenCalledWith('capture_revoke', { contextId: 'context-2' });
  });

  it('disposes all native capture contexts through an explicit app-session command', async () => {
    const { adapter, invoke } = adapterWith({
      capture_dispose: () => 2,
    });

    await adapter.dispose();

    expect(invoke).toHaveBeenCalledWith('capture_dispose');
  });

  it('publishes sanitized discovery updates and unsubscribes cleanly', async () => {
    const { adapter, emit, listen, unlisten } = adapterWith({
      capture_list: () => [],
    });

    const seen: number[] = [];
    const unsubscribe = adapter.subscribe((resources) => seen.push(resources.length));

    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith('capture-resources', expect.any(Function));
    });

    emit([sanitizedSummary]);
    expect(seen).toEqual([0, 1]);

    unsubscribe();
    expect(unlisten).toHaveBeenCalled();
  });

  it('fails closed when a capture update leaks a raw URL', async () => {
    const { adapter, emit } = adapterWith({ capture_list: () => [] });
    const seen: number[] = [];
    adapter.subscribe((resources) => seen.push(resources.length));

    await vi.waitFor(() => expect(seen.length).toBe(1));
    emit([{ ...sanitizedSummary, filenameHint: 'clip.mp4?sig=secret' }]);
    expect(seen.length).toBe(1);
  });

  it('refuses to run without the native runtime', async () => {
    const adapter = new TauriCaptureAdapter({
      invoke: async () => ({}),
      listen: async () => () => {},
      isNativeRuntime: () => false,
    });

    await expect(adapter.start()).rejects.toThrow(/native runtime/);
    await expect(adapter.list()).rejects.toThrow(/native runtime/);
  });
});
