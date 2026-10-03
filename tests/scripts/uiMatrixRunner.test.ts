import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CdpCallTimeoutError,
  navigateWithTransportRetry,
} from '../../scripts/ui-matrix-runner.mjs';

const source = readFileSync(resolve('scripts/ui-matrix-runner.mjs'), 'utf8');

describe('UI matrix CDP transport hardening', () => {
  it('bounds each CDP request independently from the outer matrix deadline', () => {
    const callBlock = source.slice(source.indexOf('const call ='), source.indexOf('const evaluate ='));
    expect(callBlock).toMatch(/setTimeout\(/);
    expect(callBlock).toMatch(/pending\.delete\(id\)/);
    expect(callBlock).toContain('new CdpCallTimeoutError(method, cdpCallTimeoutMs)');
  });

  it('rejects every pending CDP request when the debugger socket closes or errors', () => {
    expect(source).toContain('const rejectPending =');
    expect(source).toMatch(/ws\.addEventListener\('close',[\s\S]*?rejectPending/);
    expect(source).toMatch(/ws\.addEventListener\('error',[\s\S]*?rejectPending/);
  });

  it('uses a unique Edge profile per run so a stale locked profile cannot block the next audit', () => {
    expect(source).toContain("mkdtempSync(path.join(tmpdir(), 'ytdl-ui-matrix-'))");
    expect(source).toContain("ws.closeBrowser = () => call('Browser.close')");
    expect(source).not.toContain("path.join(outDir, 'edge-profile')");
  });

  it('excludes historical generated browser profiles from the Vite watcher', () => {
    const vite = readFileSync(resolve('vite.config.ts'), 'utf8');
    expect(vite).toContain('**/edge-profile-*/**');
  });

  it('allows audits to request a short viewport for modal clipping regressions', () => {
    expect(source).toMatch(/viewportWidth\s*=\s*1360/);
    expect(source).toMatch(/viewportHeight\s*=\s*1600/);
    expect(source).toContain('`--window-size=${viewportWidth},${viewportHeight}`');
    expect(source).toMatch(/width:\s*viewportWidth/);
    expect(source).toMatch(/height:\s*viewportHeight/);
  });

  it('preserves requested DPR and physical/scaling provenance in geometry evidence', () => {
    expect(source).toContain('deviceScaleFactor: auditCase.deviceScaleFactor ?? 1');
    expect(source).toContain('physicalResolution: auditCase.physicalResolution');
    expect(source).toContain('windowsScaling: auditCase.windowsScaling');
  });

  it('retries Page.navigate exactly once after its bounded CDP transport timeout', async () => {
    const timeout = new CdpCallTimeoutError('Page.navigate', 10_000);
    const call = vi
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ frameId: 'frame-2' });

    await expect(navigateWithTransportRetry(call, 'http://127.0.0.1:4173/logs')).resolves.toEqual({
      frameId: 'frame-2',
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenNthCalledWith(1, 'Page.navigate', {
      url: 'http://127.0.0.1:4173/logs',
    });
    expect(call).toHaveBeenNthCalledWith(2, 'Page.navigate', {
      url: 'http://127.0.0.1:4173/logs',
    });
  });

  it('does not retry product-independent CDP errors that are not Page.navigate timeouts', async () => {
    const protocolFailure = new Error('net::ERR_ABORTED');
    const call = vi.fn().mockRejectedValue(protocolFailure);

    await expect(navigateWithTransportRetry(call, 'http://127.0.0.1:4173/logs')).rejects.toBe(
      protocolFailure,
    );
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('does not retry a timeout belonging to a different CDP method', async () => {
    const otherTimeout = new CdpCallTimeoutError('Runtime.evaluate', 10_000);
    const call = vi.fn().mockRejectedValue(otherTimeout);

    await expect(navigateWithTransportRetry(call, 'http://127.0.0.1:4173/logs')).rejects.toBe(
      otherTimeout,
    );
    expect(call).toHaveBeenCalledTimes(1);
  });
});
