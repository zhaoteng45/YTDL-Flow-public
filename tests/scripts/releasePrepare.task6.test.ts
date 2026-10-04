import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const releaseScript = readFileSync(resolve('scripts/release.mjs'), 'utf8');
const releaseWorkflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8');
const ciWorkflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  packageManager?: string;
};
const releaseConfig = JSON.parse(execFileSync('bun', ['-e',
  "console.log(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))",
  '.github/workflows/release.yml',
], { encoding: 'utf8', timeout: 10000 }));
const ciConfig = JSON.parse(execFileSync('bun', ['-e',
  "console.log(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))",
  '.github/workflows/ci.yml',
], { encoding: 'utf8', timeout: 10000 }));

describe('release preparation contract for task 6', () => {
  it('uploads only the real installer after source, fresh-install and upgrade checks', () => {
    const job = ciConfig.jobs['windows-install-trust'];
    expect(job.needs).toEqual(['version-check', 'frontend-check', 'backend-check']);
    const steps = job.steps;
    const upload = steps.find((step: { name?: string }) => step.name === 'Upload validation installer');
    expect(upload.if).toBe("success() && github.event_name == 'push'");
    expect(upload.uses).toBe('actions/upload-artifact@v4');
    expect(upload.with['if-no-files-found']).toBe('error');
    expect(upload.with.name).toContain('github.sha');
    expect(steps.indexOf(upload)).toBeGreaterThan(steps.findIndex((step: { name?: string }) => step.name === 'Verify Synthetic Upgrade'));
    expect(ciConfig.jobs['desktop-packaging-smoke'].steps.some((step: { uses?: string }) => step.uses?.startsWith('actions/upload-artifact'))).toBe(false);
  });

  it('publishes tested tag builds automatically without signing or human inputs', () => {
    const inputs = releaseConfig.on.workflow_dispatch.inputs;
    expect(inputs.human_verified).toBeUndefined();
    const steps = releaseConfig.jobs['verify-installer'].steps;
    const publish = steps.find((step: { name?: string }) => step.name === 'Publish installer release');
    expect(publish.if).toBe("success() && (github.ref_type == 'tag' || inputs.publish_release == true)");
    expect(publish.run).toContain('bun scripts/publish-installer-release.mjs');
    expect(steps.indexOf(publish)).toBeGreaterThan(steps.findIndex((step: { name?: string }) => step.name === 'Prepare verified release files'));
    expect(releaseWorkflow).not.toContain('Check signing credentials');
    expect(releaseConfig.jobs['publish-draft']).toBeUndefined();
    expect(releaseConfig.concurrency.group).toBe('installer-release');
    expect(releaseConfig.concurrency['cancel-in-progress']).toBe(false);
    for (const name of ['Check source', 'Check Rust']) {
      const step = steps.find((item: { name?: string }) => item.name === name);
      expect(step.run).toContain('$PSNativeCommandUseErrorActionPreference = $true');
    }
  });

  it('keeps help non-destructive and validates git context explicitly', () => {
    expect(releaseScript).toContain("targetVersion === '--help'");
    expect(releaseScript).toContain('git rev-parse --is-inside-work-tree');
    expect(releaseScript).toContain('Not inside a git worktree; skipping local git commit/tag steps.');
  });

  it('runs git add, commit, and tag as distinct failure-reporting steps', () => {
    expect(releaseScript).toContain('git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml');
    expect(releaseScript).toContain('git commit -m "chore(release): v${targetVersion}"');
    expect(releaseScript).toContain('git tag v${targetVersion}');
    expect(releaseScript).toContain('Git step failed:');
    expect(releaseScript).not.toContain('Git operations skipped (not a git repo or error).');
  });

  it('threads target-specific MSI-only Tauri args through release and packaging smoke', () => {
    const build = releaseConfig.jobs['verify-installer'].steps.find((step: { name?: string }) => step.name === 'Build final installer');
    expect(build.run).toContain('./scripts/build-release-installer.ps1');
    expect(readFileSync(resolve('scripts/build-release-installer.ps1'), 'utf8')).toContain('bun run tauri:build --target x86_64-pc-windows-msvc --bundles msi');

    expect(ciWorkflow).toContain(
      'bun run tauri:build --target x86_64-pc-windows-msvc --bundles msi',
    );
  });

  it('keeps sidecar steps nested under workflow steps', () => {
    const preparation = releaseConfig.jobs['verify-installer'].steps.find((step: { name?: string }) => step.name === 'Prepare runtime tools');
    expect(preparation.run).toBe('bun scripts/prepare-release-sidecars.mjs --target x86_64-pc-windows-msvc');
    expect(ciWorkflow.match(/\r?\n      - name: Mock Sidecars\r?\n/g)).toHaveLength(2);
    expect(ciWorkflow).not.toMatch(/\r?\n- name: Mock Sidecars\r?\n/);
  });

  it('sets up the pinned Bun version in every CI job that directly runs Bun', () => {
    const bunVersion = packageJson.packageManager?.replace(/^bun@/, '');
    expect(bunVersion).toBeTruthy();

    const versionCheck = ciWorkflow.slice(
      ciWorkflow.indexOf('  version-check:'),
      ciWorkflow.indexOf('  frontend-check:'),
    );
    const backendCheck = ciWorkflow.slice(
      ciWorkflow.indexOf('  backend-check:'),
      ciWorkflow.indexOf('  desktop-packaging-smoke:'),
    );

    expect(versionCheck).toContain('uses: oven-sh/setup-bun@v2');
    expect(versionCheck).toContain(`bun-version: ${bunVersion}`);
    expect(backendCheck).toContain('uses: oven-sh/setup-bun@v2');
    expect(backendCheck).toContain(`bun-version: ${bunVersion}`);

    for (const workflow of [ciWorkflow, releaseWorkflow]) {
      const declared = [...workflow.matchAll(/bun-version:\s*([^\s]+)/g)].map((match) => match[1]);
      expect(declared.length).toBeGreaterThan(0);
      expect(new Set(declared)).toEqual(new Set([bunVersion]));
    }
  });

  it('provisions every ignored executable required by a clean Windows package', () => {
    const mockScript = readFileSync(resolve('scripts/mock-sidecars.mjs'), 'utf8');
    const sidecarScript = readFileSync(resolve('scripts/prepare-release-sidecars.mjs'), 'utf8');

    expect(mockScript).toContain(
      "const binaries = ['yt-dlp', 'ffmpeg', 'ffprobe', 'bun', 'rustypipe-botguard'];",
    );
    expect(sidecarScript).toContain('cargo install rustypipe-botguard');
    expect(sidecarScript).not.toContain('optional PO Token engine');
  });

  it('declares rustypipe-botguard preparation and verification in release sidecars script', () => {
    const sidecarScript = readFileSync(resolve('scripts/prepare-release-sidecars.mjs'), 'utf8');
    expect(sidecarScript).toContain('rustypipe-botguard');
    expect(sidecarScript).toContain('Verifying/Upgrading rustypipe-botguard runtime');
  });

  it('refreshes bundled FFmpeg and Bun on Windows instead of only verifying stale binaries', () => {
    const sidecarScript = readFileSync(resolve('scripts/prepare-release-sidecars.mjs'), 'utf8');

    expect(sidecarScript).toContain('if (isWin) {');
    expect(sidecarScript).toContain('Refreshing official FFmpeg release from Gyan.dev');
    expect(sidecarScript).toContain('Refreshing official Bun release archive');
    expect(sidecarScript).toContain('} else if (!fs.existsSync(ffmpegDest) || !fs.existsSync(ffprobeDest)) {');
    expect(sidecarScript).toContain('} else if (!fs.existsSync(bunPath)) {');
  });
});
