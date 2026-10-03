import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getHostTargetTriple } from '../../scripts/lib/target-triple.mjs';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('setup-sidecars host resource contract', () => {
  it('only generates a target-suffixed yt-dlp sidecar', () => {
    const hostTriple = getHostTargetTriple();
    const ext = process.platform === 'win32' ? '.exe' : '';

    expect(hostTriple).toBeTruthy();

    const tempDir = mkdtempSync(join(os.tmpdir(), 'setup-sidecars-'));
    tempDirs.push(tempDir);

    const binDir = join(tempDir, 'src-tauri', 'bin');
    mkdirSync(binDir, { recursive: true });

    writeFileSync(join(binDir, `yt-dlp${ext}`), 'yt-dlp');
    writeFileSync(join(binDir, `ffmpeg${ext}`), 'ffmpeg');
    writeFileSync(join(binDir, `ffprobe${ext}`), 'ffprobe');

    execFileSync(process.execPath, [resolve('scripts/setup-sidecars.mjs'), '--target', hostTriple!], {
      cwd: tempDir,
      stdio: 'pipe',
      env: { ...process.env, CI: 'true' },
    });

    expect(readFileSync(join(binDir, `yt-dlp-${hostTriple}${ext}`), 'utf8')).toBe('yt-dlp');
    expect(() => readFileSync(join(binDir, `ffmpeg-${hostTriple}${ext}`), 'utf8')).toThrow();
    expect(() => readFileSync(join(binDir, `ffprobe-${hostTriple}${ext}`), 'utf8')).toThrow();
    expect(readFileSync(join(binDir, `ffmpeg${ext}`), 'utf8')).toBe('ffmpeg');
    expect(readFileSync(join(binDir, `ffprobe${ext}`), 'utf8')).toBe('ffprobe');
  }, 15000);
});
