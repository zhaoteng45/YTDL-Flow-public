import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('node:fs');
  vi.doUnmock('node:child_process');
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('installer upload and publication protocol', () => {
  it.each(['create', 'resume'])('publishes a verified draft through the %s path even when tag lookup returns 404', async mode => {
    vi.resetModules();
    const version = '3.1.4';
    const commit = 'a'.repeat(40);
    const installer = `YTDL-Flow_${version}_x64_zh-CN.msi`;
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const installerHash = hash(Buffer.from(installer));
    const report = { status: 'passed', msiSha256: installerHash, nativeSmoke: 'passed', licenses: 'passed', upgrade: 'passed' };
    const evidence = {
      version, sourceCommit: commit, installerSha256: installerHash, distributionMode: 'manual-install',
      install: report, fresh: report,
      native: ['fresh', 'upgrade'].map(phase => ({ phase, status: 'passed', msiSha256: installerHash, productVersion: version })),
      signature: { status: 'unsigned', msiSha256: installerHash, updaterVerified: false, authenticodeVerified: false },
      licenses: { version, sourceCommit: commit, runtimeReviewComplete: false },
    };
    const names = [installer, 'THIRD_PARTY_NOTICES.md', 'toolchain-manifest.json', 'runtime-source-review.json', 'runtime-redistribution-audit-20261004.md', 'release-evidence.json', 'SHA256SUMS.txt'];
    const bytes = (name: string) => Buffer.from(name === 'release-evidence.json' ? JSON.stringify(evidence) : name);
    type Release = { draft: boolean; tag_name: string; target_commitish: string; assets: { name: string; digest: string }[] };
    const draft = (): Release => ({ draft: true, tag_name: `v${version}`, target_commitish: commit, assets: [] });
    let release: Release | null = mode === 'resume' ? draft() : null;
    const exec = vi.fn((file: string, args: string[]) => {
      if (file === 'git') return args[0] === 'rev-parse' ? commit : `${commit}\trefs/tags/v${version}\n`;
      if (args[0] === 'api') {
        if (args.some(arg => arg.includes('/releases/tags/'))) throw Object.assign(new Error('HTTP 404'), { stderr: 'HTTP 404' });
        expect(args).toContain('--paginate');
        expect(args).toContain('--slurp');
        return JSON.stringify([release ? [release] : []]);
      }
      if (args[1] === 'create') {
        if (release) throw new Error('Release already exists');
        release = draft();
      } else if (args[1] === 'upload') {
        if (!release?.draft) throw new Error('Cannot replace public assets');
        release.assets = names.map(name => ({ name, digest: `sha256:${hash(bytes(name))}` }));
      } else if (args[1] === 'edit') {
        if (!release) throw new Error('Missing release');
        release.draft = false;
      }
      return '';
    });
    vi.doMock('node:child_process', () => ({ execFileSync: exec }));
    vi.doMock('node:fs', () => ({ default: {
      readdirSync: () => names,
      readFileSync: (file: string, encoding?: string) => encoding ? bytes(basename(file)).toString() : bytes(basename(file)),
    } }));
    vi.stubEnv('RUNNER_TEMP', 'mock-runner');
    vi.stubEnv('GITHUB_REPOSITORY', 'zhaoteng45/YTDL-Flow-public');
    vi.stubEnv('GITHUB_REF_TYPE', 'tag');
    vi.stubEnv('GITHUB_REF_NAME', `v${version}`);
    await expect(import('../../scripts/publish-installer-release.mjs')).resolves.toBeDefined();
    expect(release?.draft).toBe(false);
    expect(exec.mock.calls.filter(([file, args]) => file === 'gh' && args[1] === 'create')).toHaveLength(mode === 'create' ? 1 : 0);
  });
});
