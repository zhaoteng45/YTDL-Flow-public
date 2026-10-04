export function assertDraftIdentity(input) {
  if (input.humanVerified !== true) throw new Error('Human acceptance is required');
  if (input.isDraft !== true) throw new Error('Only an existing draft can be published');
  if (!/^v\d+\.\d+\.\d+$/.test(input.tag) || input.releaseTag !== input.tag || input.tag !== `v${input.evidence.version}`) {
    throw new Error('Release tag mismatch');
  }
  if (!/^[a-f0-9]{64}$/.test(input.expectedHash) || input.expectedHash !== input.actualHash || input.actualHash !== input.evidence.installerSha256) {
    throw new Error('The installer differs from the human-tested installer');
  }
  if (!/^[a-f0-9]{40}$/.test(input.tagCommit) || input.tagCommit !== input.evidence.sourceCommit) {
    throw new Error('Release source commit mismatch');
  }
  if (!/^[a-f0-9]{64}$/.test(input.signatureHash) || input.signatureHash !== input.evidence.signature?.updaterSignatureSha256) {
    throw new Error('Updater signature differs from the verified signature');
  }
}
