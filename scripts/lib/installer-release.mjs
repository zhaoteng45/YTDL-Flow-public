export function assertPublishIdentity({ tag, version, sourceCommit, tagCommit }) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || tag !== `v${version}`) throw new Error('Release tag/version mismatch');
  if (!/^[a-f0-9]{40}$/.test(sourceCommit) || tagCommit !== sourceCommit) throw new Error('Release source mismatch');
}

export function releaseAction(release, identity) {
  if (!release) return 'create';
  if (!release.draft) throw new Error('Version already published; publish fixes under a new version');
  if (release.tag_name !== identity.tag || release.target_commitish !== identity.sourceCommit) throw new Error('Draft source mismatch');
  return 'resume';
}
