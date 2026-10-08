import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const buildSource = () => readFileSync(resolve('scripts/build.mjs'), 'utf8');
const cleanupSource = () => readFileSync(resolve('scripts/cleanup.mjs'), 'utf8');

describe('safe build and cleanup boundaries', () => {
  it('never invokes system cleanup during an ordinary production build', () => {
    expect(buildSource()).not.toMatch(/bun\s+run\s+cleanup|scripts\/cleanup\.mjs/);
  });

  it('has no broad file deletion or process-kill operation in its maintenance entrypoint', () => {
    expect(cleanupSource()).not.toMatch(/(?:unlinkSync|rmSync|rm\s+-rf|Stop-Process|pkill)/i);
  });

  it('preserves a fresh generated cookie fixture when the maintenance CLI runs', () => {
    const fileName = `ytdl_flow_cookies_${process.pid}_${Date.now()}_0.txt`;
    const path = join(os.tmpdir(), fileName);
    writeFileSync(path, '# fixture only; no account material');
    try {
      const output = execFileSync('bun', [resolve('scripts/cleanup.mjs')], {
        encoding: 'utf8',
        timeout: 10_000,
        stdio: 'pipe',
      });
      expect(output).toContain('No cleanup performed');
      expect(existsSync(path)).toBe(true);
    } finally {
      // Remove only the fixture created by this test, never scan user temp files.
      unlinkSync(path);
    }
  });
});
