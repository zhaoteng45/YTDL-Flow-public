import { describe, expect, it, vi } from 'vitest';

import { CAPTURE_IMPORT_REJECTIONS, createCaptureImportFlow } from '../src/capture-import';
import { classifyCaptureFailure } from '../src/capture-failure';
import { FakeCapturePort } from '../testing/fake-capture-port';
const resource = {
  resourceId: 'resource-1',
  siteLabel: 'cdn.example.com',
  mediaKind: 'video' as const,
  mimeType: 'video/mp4',
  requiresAuthenticatedReplay: false,
};

function flowWith(analyzeCaptured = vi.fn(() => ({ rowId: 'row-1' }))) {
  const capture = new FakeCapturePort();
  const flow = createCaptureImportFlow({
    capture,
    analyzeCaptured,
  });
  return { flow, capture, analyzeCaptured };
}

describe('captured import flow', () => {
  it('imports a claimed resource as a normal task row', async () => {
    const { flow, capture, analyzeCaptured } = flowWith();
    await capture.start();
    capture.emitResource(resource);

    const result = await flow.importResource('resource-1');

    expect(result).toEqual({
      type: 'imported',
      rowId: 'row-1',
      contextId: 'context-1',
    });
    expect(analyzeCaptured).toHaveBeenCalledWith({
      captureContextId: 'context-1',
      siteLabel: 'cdn.example.com',
      mediaKind: 'video',
    });
    expect(capture.activeContextCount()).toBe(1);
  });

  it('releases the context when the task import fails', async () => {
    const analyzeCaptured = vi.fn(() => {
      throw new Error('task service refused the import');
    });
    const { flow, capture } = flowWith(analyzeCaptured);
    await capture.start();
    capture.emitResource(resource);

    const result = await flow.importResource('resource-1');

    expect(result.type).toBe('import-failed');
    expect(capture.activeContextCount()).toBe(0);
  });

  it('never creates a task when the claim is rejected', async () => {
    const { flow, capture, analyzeCaptured } = flowWith();
    await capture.start();
    capture.emitResource({ ...resource, requiresAuthenticatedReplay: true });

    const result = await flow.importResource('resource-1');

    expect(result).toEqual({
      type: 'rejected',
      outcome: { type: 'authenticatedReplayRequired' },
    });
    expect(analyzeCaptured).not.toHaveBeenCalled();
    expect(capture.activeContextCount()).toBe(0);
  });

  it('revokes the native context when a captured row is removed', async () => {
    const { flow, capture } = flowWith();
    await capture.start();
    capture.emitResource(resource);
    await flow.importResource('resource-1');
    expect(capture.activeContextCount()).toBe(1);

    await flow.revokeRow({ capture: { contextId: 'context-1', siteLabel: 'cdn.example.com', mediaKind: 'video' } });
    expect(capture.activeContextCount()).toBe(0);
  });

  it('ignores rows without a capture reference', async () => {
    const { flow, capture } = flowWith();
    await capture.start();

    await flow.revokeRow({});
    expect(capture.activeContextCount()).toBe(0);
  });

  it('exposes the claim rejection vocabulary for the UI copy', () => {
    expect(CAPTURE_IMPORT_REJECTIONS).toContain('authenticatedReplayRequired');
    expect(CAPTURE_IMPORT_REJECTIONS).toContain('forbiddenDestination');
    expect(CAPTURE_IMPORT_REJECTIONS).toContain('unsupportedExecutionKind');
  });
});

describe('capture failure classification', () => {
  it('recognises context failure codes without prose matching', () => {
    expect(classifyCaptureFailure('capture-context-expired: gone')).toBe('capture-context-expired');
    expect(classifyCaptureFailure('ERR capture-context-revoked')).toBe('capture-context-revoked');
    expect(
      classifyCaptureFailure('capture-context-not-found: missing'),
    ).toBe('capture-context-not-found');
    expect(
      classifyCaptureFailure('capture-context-row-mismatch: other row'),
    ).toBe('capture-context-row-mismatch');
  });

  it('does not classify unrelated failures', () => {
    expect(classifyCaptureFailure('下载停滞超过 180 秒，已请求终止')).toBeUndefined();
    expect(classifyCaptureFailure('')).toBeUndefined();
  });
});
