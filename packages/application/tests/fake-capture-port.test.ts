import { describe, expect, it } from 'vitest';

import { FakeCapturePort } from '../testing/fake-capture-port';

const summarySeed = {
  resourceId: 'resource-1',
  siteLabel: 'cdn.example.com',
  mediaKind: 'video' as const,
  mimeType: 'video/mp4',
  requiresAuthenticatedReplay: false,
};

describe('CapturePort contract (fake adapter)', () => {
  it('requires an explicit start and clears unclaimed resources on stop', async () => {
    const capture = new FakeCapturePort();

    expect(await capture.claim('resource-1')).toEqual({ type: 'captureInactive' });

    const session = await capture.start();
    expect(session.profileIsolated).toBe(true);
    capture.emitResource(summarySeed);
    expect(await capture.list()).toHaveLength(1);

    await capture.stop();
    expect(await capture.list()).toHaveLength(0);
  });

  it('claims consume the discovered resource exactly once', async () => {
    const capture = new FakeCapturePort();
    await capture.start();
    capture.emitResource(summarySeed);

    const claimed = await capture.claim('resource-1');
    expect(claimed.type).toBe('claimed');
    if (claimed.type !== 'claimed') throw new Error('expected a claimed outcome');
    expect(claimed.contextId).toBe('context-1');
    expect(claimed.resource.siteLabel).toBe('cdn.example.com');

    expect(await capture.claim('resource-1')).toEqual({ type: 'notFound' });
    expect(await capture.list()).toHaveLength(0);
    expect(capture.activeContextCount()).toBe(1);

    await capture.release(claimed.contextId);
    expect(capture.activeContextCount()).toBe(0);
  });

  it('classifies authenticated-replay resources instead of claiming them', async () => {
    const capture = new FakeCapturePort();
    await capture.start();
    capture.emitResource({ ...summarySeed, requiresAuthenticatedReplay: true });

    expect(await capture.claim('resource-1')).toEqual({ type: 'authenticatedReplayRequired' });
    expect(capture.activeContextCount()).toBe(0);
    expect(await capture.list()).toHaveLength(1);
  });

  it('publishes sanitized snapshots to subscribers and unsubscribes cleanly', async () => {
    const capture = new FakeCapturePort();
    const seen: number[] = [];
    const unsubscribe = capture.subscribe((resources) => {
      seen.push(resources.length);
    });

    await capture.start();
    capture.emitResource(summarySeed);
    capture.emitResource({ ...summarySeed, resourceId: 'resource-2' });
    unsubscribe();

    capture.emitResource({ ...summarySeed, resourceId: 'resource-3' });
    expect(seen).toEqual([0, 0, 1, 2]);
  });
});
