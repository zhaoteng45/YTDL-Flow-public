import { existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('cleanup temp cookies lifecycle contract', () => {
  it('removes stale ytdl_flow_cookies temporary files during cleanup', () => {
    const tempFile = join(os.tmpdir(), `ytdl_flow_cookies_${Date.now().toString(16)}.txt`);
    writeFileSync(tempFile, '# Netscape HTTP Cookie File\n');

    expect(existsSync(tempFile)).toBe(true);

    // 使用 Bun 执行清理脚本
    execFileSync('bun', [resolve('scripts/cleanup.mjs')], {
      stdio: 'pipe',
    });

    expect(existsSync(tempFile)).toBe(false);
  });
});
