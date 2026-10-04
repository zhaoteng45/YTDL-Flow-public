import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'win32')('Windows tool health script', () => {
  const source = readFileSync('src-tauri/src/commands.rs', 'utf8');
  const script = source.match(/(?:let script|const OWNED_TOOL_PROCESS_SCRIPT[^=]*) = r#"(\$[^\n]*)"#;/)?.[1];
  it('reports a synthetic media process including its spaced path', () => {
    expect(Boolean(script)).toBe(true);
    const fixture = "function Get-CimInstance { [pscustomobject]@{Name='ffmpeg.exe';ProcessId=42;ExecutablePath='C:\\Synthetic Folder\\ffmpeg.exe'} }; ";
    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', fixture + script], { encoding: 'utf8', timeout: 10000 });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe('');
    expect(result.stdout.trim()).toBe('42|C:\\Synthetic Folder\\ffmpeg.exe');
  });
  it('propagates inspection failures instead of returning an empty healthy result', () => {
    const fixture = "function Get-CimInstance { Write-Error 'synthetic inspection failure' }; ";
    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', fixture + script], { encoding: 'utf8', timeout: 10000 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('synthetic inspection failure');
  });
});
