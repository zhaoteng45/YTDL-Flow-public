import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CdpCallTimeoutError,
  navigateWithTransportRetry,
  validateMatrixReport,
  combineMatrixReports,
  runMatrixCaptures,
  withMatrixReport,
} from '../../scripts/ui-matrix-runner.mjs';

const source = readFileSync(resolve('scripts/ui-matrix-runner.mjs'), 'utf8');

describe('UI report lifecycle', () => {
  it('replaces an old PASS before running and publishes FAIL when a screenshot fails', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'ui-report-'));
    const file = resolve(dir, 'result.json');
    writeFileSync(file, JSON.stringify({ verdict: 'PASS', runId: 'old' }));
    try {
      await expect(withMatrixReport(file, async () => {
        expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ verdict: 'RUNNING', done: false });
        throw new Error('UI screenshot failed (material.png): disk full');
      })).rejects.toThrow('disk full');
      const result = JSON.parse(readFileSync(file, 'utf8'));
      expect(result).toMatchObject({ verdict: 'FAIL', done: true, error: 'UI screenshot failed (material.png): disk full' });
      expect(result.runId).not.toBe('old');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('waits for the run to finish and keeps failed assertions as FAIL', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'ui-report-'));
    try {
      const result = await withMatrixReport(resolve(dir, 'result.json'), async () => ({ failures: [{check:'overflow'}], checkCount: 1, passedChecks: 0 }));
      expect(result).toMatchObject({ verdict: 'FAIL', done: true, passedChecks: 0 });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('one matrix with separate screenshots', () => {
  const report = { done: true, caseCount: 18, checkCount: 100, passedChecks: 100, failures: [] };
  const cases = ['material', 'fluent', 'cobalt-butter'].map(name => ({ name }));
  it('runs the matrix once while preparing and recording each screenshot', async () => {
    const runMatrix = vi.fn().mockResolvedValue(report);
    const prepareCapture = vi.fn().mockResolvedValue(undefined);
    const capture = vi.fn().mockImplementation(async item => ({ name: item.name }));
    const result = await runMatrixCaptures({ cases, runMatrix, prepareCapture, capture });
    expect(runMatrix).toHaveBeenCalledTimes(1);
    expect(prepareCapture.mock.calls.map(([item]) => item.name)).toEqual(cases.map(item => item.name));
    expect(result).toEqual({ ...report, screenshotCount: 3, screenshots: cases });
  });
  it('preserves matrix failures instead of multiplying them by screenshot count', async () => {
    const failure = { check: 'overflow' };
    const result = await runMatrixCaptures({ cases, runMatrix: async () => ({ ...report, passedChecks: 99, failures: [failure] }), prepareCapture: async () => {}, capture: async item => item });
    expect(result.failures).toEqual([failure]);
    expect(result.passedChecks).toBe(99);
  });
  it('identifies failed screenshots and rejects instead of reporting success', async () => {
    await expect(runMatrixCaptures({ cases, runMatrix: async () => report, prepareCapture: async () => {}, capture: async () => { throw new Error('disk full'); } })).rejects.toThrow(/material.*disk full/);
  });
});

describe('UI matrix report contract', () => {
  const report = () => ({ done: true, caseCount: 30, checkCount: 3174, passedChecks: 3174, failures: [] });
  it('keeps case counts distinct from check counts', () => {
    expect(validateMatrixReport(report())).toEqual(report());
    expect(combineMatrixReports([report(), { ...report(), caseCount: 18, checkCount: 1524, passedChecks: 1524 }]))
      .toMatchObject({ caseCount: 48, checkCount: 4698, passedChecks: 4698, failures: [] });
  });
  it('rejects ambiguous legacy totals instead of guessing', () => {
    expect(() => validateMatrixReport({ done: true, passed: 3174, total: 30, failures: [] })).toThrow(/report/);
  });
  it('preserves failed checks and rejects inconsistent success claims', () => {
    const failure = { check: 'filename overflows' };
    const failed = { ...report(), passedChecks: 3173, failures: [failure] };
    expect(combineMatrixReports([failed])).toMatchObject({ passedChecks: 3173, failures: [failure] });
    expect(() => validateMatrixReport({ ...failed, passedChecks: 3174 })).toThrow(/report/);
    expect(() => validateMatrixReport({ ...report(), caseCount: 0 })).toThrow(/report/);
    expect(() => validateMatrixReport({ ...report(), done: false })).toThrow(/report/);
  });
  it('wires existing browser checks into Windows CI with failure artifacts', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(workflow).toContain('uses: ./.github/workflows/browser-layout.yml');
    const shared = readFileSync('.github/workflows/browser-layout.yml', 'utf8');
    const job = shared.split('  ui-layout-check:')[1]?.split(/^  [a-z][a-z-]+:/m)[0] ?? '';
    expect(job.includes('runs-on: windows-latest')).toBe(true);
    for (const command of ['bun run test:ui-input', 'bun run test:ui-settings', 'bun run test:ui-download-list', 'bun run test:ui-geometry -- --layout-review']) {
      expect(job.includes(command), command).toBe(true);
    }
    expect(job.includes('if: always()')).toBe(true);
    expect(job.includes('actions/upload-artifact@v4')).toBe(true);
    expect(job.includes('include-hidden-files: true')).toBe(true);
    expect(job.includes('if-no-files-found: error')).toBe(true);
  });
  it('includes browser harness typing and source-only content checks in CI', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const config = JSON.parse(readFileSync('tsconfig.ui.json', 'utf8'));
    expect(workflow).toContain('run: bun run typecheck:ui');
    expect(workflow).toContain('run: bun run check:repository');
    expect(config.include).toContain('tests/ui/**/*.ts');
  });
});

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
