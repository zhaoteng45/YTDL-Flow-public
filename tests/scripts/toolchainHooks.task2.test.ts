import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const tauriConfig = JSON.parse(readFileSync(resolve('src-tauri/tauri.conf.json'), 'utf8')) as {
  build?: {
    beforeDevCommand?: string;
    beforeBuildCommand?: string;
  };
};
const buildScript = readFileSync(resolve('scripts/build.mjs'), 'utf8');
const tauriBuildScript = readFileSync(resolve('scripts/tauri-build.mjs'), 'utf8');

describe('toolchain hooks for task 2', () => {
  it('uses bun-driven local verification steps in scripts/build.mjs', () => {
    expect(buildScript).toContain("run('bun run cleanup')");
    expect(buildScript).toContain("run('bun run typecheck')");
    expect(buildScript).toContain("run('bun run lint')");
    expect(buildScript).toContain("run('bun run tauri:build')");

    expect(buildScript).not.toContain('pnpm');
    expect(buildScript).not.toContain('vite build');
    expect(buildScript).not.toContain('bun run build');
  });

  it('migrates tauri hooks to bun commands', () => {
    expect(tauriConfig.build?.beforeDevCommand).toBe('bun run dev');
    expect(tauriConfig.build?.beforeBuildCommand).toBe('bun run build:web');
  });

  it('keeps dev-port behind tauri:dev only', () => {
    expect(packageJson.scripts['tauri:dev']).toContain('bun run dev-port');
    expect(packageJson.scripts.dev).not.toContain('dev-port');

    const devPortUsers = Object.entries(packageJson.scripts)
      .filter(([, command]) => command.includes('dev-port'))
      .map(([name]) => name)
      .sort();

    expect(devPortUsers).toEqual(['dev-port', 'tauri:dev']);
  });

  it('normalizes numeric CI values and propagates the Bun runtime directory to child PATH', () => {
    expect(packageJson.scripts['tauri:build']).toBe('bun scripts/tauri-build.mjs');
    expect(tauriBuildScript).toContain("if (value === '1') return 'true'");
    expect(tauriBuildScript).toContain("if (value === '0') return 'false'");
    expect(tauriBuildScript).toContain('path.dirname(executablePath)');
    expect(tauriBuildScript).toContain('path.delimiter');
    expect(tauriBuildScript).toContain('prependRuntimeBinToPath(env)');
    expect(tauriBuildScript).toContain("'.EXE'");
    expect(tauriBuildScript).toContain("'.CMD'");
    expect(tauriBuildScript).toContain('ensureWindowsPathExt(env)');
    expect(tauriBuildScript).toContain("['x', 'tauri', 'build'");
  });
});
