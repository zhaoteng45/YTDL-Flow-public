import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { localOnlyReason } from '../../scripts/check-repository-content.mjs';

describe('public repository content', () => {
  it('keeps public documentation minimal and rejects internal planning records', () => {
    for (const file of ['CONTEXT.md', 'DESIGN.md', 'DESIGN_LANGUAGE_GUIDE.md', 'PRODUCT.md',
      'docs/matt/specs/example.md', 'docs/adr/example.md', 'docs/architecture/MIGRATION_HISTORY.md',
      'docs/reference/settings-ui-checks.md', 'docs/RELEASE_TEMPLATE.md', '.cargo/config.toml',
      'tests/ui/credentials-layout.prototype.html']) expect(localOnlyReason(file)).not.toBeNull();
    for (const file of ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md',
      'THIRD_PARTY_NOTICES.md', 'docs/release-ci.md', 'docs/RELEASE_INSTALLER_NOTES.md',
      'docs/reference/runtime-redistribution-audit-20261004.md']) expect(localOnlyReason(file)).toBeNull();
  });
  it('checks staged blobs even when working files are smaller or missing', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ytdl-index-check-'));
    const script = path.resolve('scripts/check-repository-content.mjs');
    const file = path.join(cwd, 'asset.txt');
    try {
      execFileSync('git', ['init', '--quiet', cwd]);
      writeFileSync(file, Buffer.alloc(50 * 1024 * 1024 + 1, 97));
      execFileSync('git', ['add', 'asset.txt'], { cwd });
      writeFileSync(file, 'small working copy');
      const oversized = spawnSync('bun', [script], { cwd, encoding: 'utf8' });
      expect(oversized.status).toBe(1);
      expect(oversized.stderr).toContain('asset.txt: file exceeds 50 MiB');

      execFileSync('git', ['add', 'asset.txt'], { cwd });
      unlinkSync(file);
      const missing = spawnSync('bun', [script], { cwd, encoding: 'utf8' });
      expect(missing.status).toBe(0);
      expect(missing.stdout).toContain('Repository content PASS (1');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  it('rejects local agent state and build outputs while retaining source assets and licenses', () => {
    for (const file of ['.agents/skills/a.md', '.codex/config.toml', '.scratch/result.json', 'src-tauri/target/a', 'installer.msi', 'tools.zip']) expect(localOnlyReason(file)).not.toBeNull();
    for (const file of ['src/App.vue', 'tests/ui/check.ts', '.github/workflows/ci.yml', 'src-tauri/icons/icon.ico', 'third-party/GPL-3.0.txt', 'bun.lock']) expect(localOnlyReason(file)).toBeNull();
    expect(localOnlyReason('asset.bin', 50 * 1024 * 1024)).toBeNull();
    expect(localOnlyReason('asset.bin', 50 * 1024 * 1024 + 1)).not.toBeNull();
  });
});
