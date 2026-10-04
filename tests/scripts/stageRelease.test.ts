import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareVerifiedRelease } from '../../scripts/prepare-verified-release.mjs';
import { fileSha256, writeLicenseManifest } from '../../scripts/lib/release-evidence.mjs';

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'ytdl-stage-test-'));
  const runnerTemp = join(cwd, 'runner');
  const reports = join(runnerTemp, 'ytdl-flow-install-trust');
  const installerDir = join(cwd, 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi');
  const licenses = join(cwd, 'src-tauri/licenses');
  for (const dir of [reports, installerDir, licenses, join(cwd, 'docs/reference')]) mkdirSync(dir, { recursive: true });
  const put = (file: string, value: unknown) => writeFileSync(join(cwd, file), typeof value === 'string' ? value : JSON.stringify(value));
  const version = '3.1.4';
  const sourceCommit = 'a'.repeat(40);
  put('package.json', { version });
  put('src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/YTDL-Flow_3.1.4_x64_zh-CN.msi', 'fixture bytes');
  const hash = fileSha256(join(installerDir, 'YTDL-Flow_3.1.4_x64_zh-CN.msi'));
  put('THIRD_PARTY_NOTICES.md', 'notices');
  put('src-tauri/toolchain-manifest.json', {});
  put('docs/reference/runtime-redistribution-audit-20261004.md', 'pending source review');
  put('src-tauri/licenses/runtime-source-review.json', { pending: ['bun'] });
  writeLicenseManifest(licenses, { version, sourceCommit, runtimeReviewComplete: false });
  const report = { status: 'passed', msiSha256: hash, nativeSmoke: 'passed', licenses: 'passed', upgrade: 'passed' };
  put('runner/ytdl-flow-install-trust/result.json', report);
  put('runner/ytdl-flow-install-trust/fresh-install.json', report);
  for (const phase of ['fresh', 'upgrade']) put(`runner/ytdl-flow-install-trust/native-${phase}.json`, { phase, status: 'passed', msiSha256: hash, productVersion: version });
  put('runner/ytdl-flow-install-trust/signature.json', { status: 'unsigned', msiSha256: hash, updaterVerified: false, authenticodeVerified: false });
  return { cwd, runnerTemp, sourceCommit, refType: 'tag', refName: `v${version}`, put };
}
describe('manual installer staging', () => {
  it('stages the tested installer and disclosures without updater metadata', () => {
    const input = fixture();
    prepareVerifiedRelease(input);
    const names = readdirSync(join(input.runnerTemp, 'verified-release'));
    expect(names).toHaveLength(7);
    expect(names).toContain('runtime-source-review.json');
    expect(names).not.toContain('latest.json');
    expect(names.some(name => name.endsWith('.sig'))).toBe(false);
  });
  it('fails before staging if fresh-install evidence or tag does not match', () => {
    const input = fixture();
    expect(() => prepareVerifiedRelease({ ...input, refName: 'v3.1.3' })).toThrow(/tag/);
    input.put('runner/ytdl-flow-install-trust/fresh-install.json', { status: 'failed' });
    expect(() => prepareVerifiedRelease(input)).toThrow(/Fresh/);
  });
});
