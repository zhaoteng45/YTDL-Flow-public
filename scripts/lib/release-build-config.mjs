export function createReleaseBuildConfig(base, { version, signing } = {}) {
  const overlay = { bundle: {
    resources: [...new Set([...base.bundle.resources, 'licenses/**/*'])],
    createUpdaterArtifacts: Boolean(signing),
  } };
  if (version) overlay.version = version;
  if (signing) overlay.bundle.windows = signing.bundle.windows;
  return overlay;
}
