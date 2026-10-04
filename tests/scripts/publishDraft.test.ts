import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { assertDraftIdentity } from '../../scripts/lib/draft-release.mjs';

const identity = () => ({
  tag: 'v3.1.3', expectedHash: 'a'.repeat(64), actualHash: 'a'.repeat(64),
  signatureHash: 'd'.repeat(64),
  humanVerified: true, isDraft: true, releaseTag: 'v3.1.3',
  tagCommit: 'b'.repeat(40), evidence: { version: '3.1.3', sourceCommit: 'b'.repeat(40), installerSha256: 'a'.repeat(64), signature: { updaterSignatureSha256: 'd'.repeat(64) } },
});
describe('publish the installer accepted by the release owner', () => {
  it('rejects incomplete acceptance before contacting GitHub', () => {
    expect(() => execFileSync('bun', ['scripts/publish-verified-draft.mjs'], {
      env: { ...process.env, RELEASE_TAG: 'v3.1.3', INSTALLER_SHA256: 'a'.repeat(64), HUMAN_VERIFIED: 'false' },
      stdio: 'pipe',
    })).toThrow(/human-tested MSI SHA256 and human acceptance/);
  });
  it('accepts an existing draft with the same tag, source and tested MSI hash', () => {
    expect(() => assertDraftIdentity(identity())).not.toThrow();
  });
  it.each(['expectedHash', 'actualHash'])('rejects a replaced or untested MSI (%s)', field => {
    expect(() => assertDraftIdentity({ ...identity(), [field]: 'c'.repeat(64) })).toThrow(/installer/i);
  });
  it('rejects missing human acceptance, public releases and mismatched source/tag', () => {
    expect(() => assertDraftIdentity({ ...identity(), humanVerified: false })).toThrow(/human/i);
    expect(() => assertDraftIdentity({ ...identity(), isDraft: false })).toThrow(/draft/i);
    expect(() => assertDraftIdentity({ ...identity(), releaseTag: 'v3.1.2' })).toThrow(/tag/i);
    expect(() => assertDraftIdentity({ ...identity(), tagCommit: 'c'.repeat(40) })).toThrow(/source/i);
  });
  it('rejects a replaced updater signature even when metadata contains the same signature', () => {
    expect(() => assertDraftIdentity({ ...identity(), signatureHash: 'e'.repeat(64) })).toThrow(/signature/i);
  });
});
