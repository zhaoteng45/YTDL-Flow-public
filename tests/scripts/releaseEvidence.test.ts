import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeLicenseManifest, verifyLicenseBundle, assertReleaseEvidence } from '../../scripts/lib/release-evidence.mjs';

describe('final installer release evidence', () => {
  it('rejects a license removed or changed after inventory generation', () => {
    const root = mkdtempSync(join(tmpdir(), 'ytdl-license-test-'));
    mkdirSync(join(root, 'npm'));
    writeFileSync(join(root, 'npm', 'vue.txt'), 'Copyright Vue authors\nMIT license');
    writeLicenseManifest(root, { version: '3.1.1', sourceCommit: 'a'.repeat(40) });
    expect(verifyLicenseBundle(root).files).toHaveLength(1);
    writeFileSync(join(root, 'npm', 'vue.txt'), 'changed');
    expect(() => verifyLicenseBundle(root)).toThrow(/hash mismatch/);
  });
  it('blocks release when validation belongs to a different installer', () => {
    const evidence = {
      installerSha256: 'a'.repeat(64), sourceCommit: 'b'.repeat(40), version: '3.1.1',
      install: { status: 'passed', msiSha256: 'c'.repeat(64), nativeSmoke: 'passed', licenses: 'passed', upgrade: 'passed' },
      signature: { status: 'passed', msiSha256: 'a'.repeat(64), updaterVerified: true, authenticodeVerified: true },
      licenses: { version: '3.1.1', sourceCommit: 'b'.repeat(40), runtimeReviewComplete: true },
    };
    expect(() => assertReleaseEvidence(evidence)).toThrow(/different installer/);
    evidence.install.msiSha256 = evidence.installerSha256;
    expect(() => assertReleaseEvidence(evidence)).not.toThrow();
    evidence.signature.updaterVerified = false;
    expect(() => assertReleaseEvidence(evidence)).toThrow(/signature/);
    evidence.signature.updaterVerified = true;
    evidence.licenses.runtimeReviewComplete = false;
    expect(() => assertReleaseEvidence(evidence)).toThrow(/runtime license/);
  });
});
