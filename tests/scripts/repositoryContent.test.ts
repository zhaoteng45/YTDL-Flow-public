import { describe, expect, it } from 'vitest';
import { localOnlyReason } from '../../scripts/check-repository-content.mjs';

describe('public repository content', () => {
  it('rejects local agent state and build outputs while retaining source assets and licenses', () => {
    for (const file of ['.agents/skills/a.md', '.codex/config.toml', '.scratch/result.json', 'src-tauri/target/a', 'installer.msi', 'tools.zip']) expect(localOnlyReason(file)).not.toBeNull();
    for (const file of ['src/App.vue', 'tests/ui/check.ts', '.github/workflows/ci.yml', 'src-tauri/icons/icon.ico', 'third-party/GPL-3.0.txt', 'bun.lock']) expect(localOnlyReason(file)).toBeNull();
    expect(localOnlyReason('asset.bin', 50 * 1024 * 1024)).toBeNull();
    expect(localOnlyReason('asset.bin', 50 * 1024 * 1024 + 1)).not.toBeNull();
  });
});
