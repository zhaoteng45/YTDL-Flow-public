import { describe, expect, it } from 'vitest';
import { createReleaseBuildConfig } from '../../scripts/lib/release-build-config.mjs';

describe('release-only build configuration', () => {
  it('adds generated licenses without changing the normal development configuration', () => {
    const base = { bundle: { resources: ['plugins/**/*', 'bin/ffmpeg.exe'] } };
    const overlay = createReleaseBuildConfig(base, { version: '3.1.0' });
    expect(overlay.bundle.resources).toEqual(['plugins/**/*', 'bin/ffmpeg.exe', 'licenses/**/*']);
    expect(overlay.version).toBe('3.1.0');
    expect(overlay.bundle.createUpdaterArtifacts).toBe(false);
    expect(base.bundle.resources).toEqual(['plugins/**/*', 'bin/ffmpeg.exe']);
  });
});
