import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const fileSha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export const pendingRuntimeReviews = (tools, review) => Object.entries(tools)
  .filter(([name, item]) => review.tools?.[name]?.version !== item.version || review.tools?.[name]?.complete !== true)
  .map(([name, item]) => ({ name, version: item.version, pending: review.tools?.[name]?.pending ?? 'Missing or outdated review; recheck corresponding sources' }));

function filesIn(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`License bundle contains a symbolic link: ${name}`);
    return entry.isDirectory() ? filesIn(root, name) : [name];
  }).sort();
}

export function writeLicenseManifest(root, identity) {
  const files = filesIn(root).filter((name) => name !== 'manifest.json').map((name) => ({
    path: name, sha256: fileSha256(path.join(root, name)),
  }));
  if (!files.length) throw new Error('License bundle is empty');
  const manifest = { schemaVersion: 1, ...identity, files };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

export function verifyLicenseBundle(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error('Invalid or empty license manifest');
  }
  const seen = new Set();
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || !file.path || file.path.includes('\\') ||
        file.path.split('/').some((part) => part === '..' || part === '.') ||
        path.isAbsolute(file.path) || seen.has(file.path)) throw new Error('Unsafe license path');
    seen.add(file.path);
    const resolved = path.resolve(root, file.path);
    if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('Unsafe license path');
    if (!fs.existsSync(resolved)) throw new Error(`Missing license: ${file.path}`);
    if (fileSha256(resolved) !== file.sha256) throw new Error(`License hash mismatch: ${file.path}`);
  }
  const actual = filesIn(root).filter((name) => name !== 'manifest.json');
  if (actual.length !== seen.size || actual.some((name) => !seen.has(name))) {
    throw new Error('License bundle contains unlisted files');
  }
  return manifest;
}

export function assertReleaseEvidence(evidence, { signed = true } = {}) {
  if (!/^[a-f0-9]{64}$/.test(evidence.installerSha256) || !/^[a-f0-9]{40}$/.test(evidence.sourceCommit)) {
    throw new Error('Invalid release identity');
  }
  for (const report of [evidence.install, evidence.signature, evidence.fresh]) {
    if (report?.msiSha256?.toLowerCase() !== evidence.installerSha256) throw new Error('Evidence belongs to a different installer');
  }
  if (evidence.fresh.status !== 'passed' || evidence.fresh.nativeSmoke !== 'passed' || evidence.fresh.licenses !== 'passed') {
    throw new Error('Fresh installation verification did not pass');
  }
  if (!Array.isArray(evidence.native) || evidence.native.length !== 2 ||
      new Set(evidence.native.map(report => report.phase)).size !== 2 ||
      !evidence.native.some(report => report.phase === 'fresh') || !evidence.native.some(report => report.phase === 'upgrade')) {
    throw new Error('Native evidence phases are incomplete');
  }
  for (const report of evidence.native) {
    if (report.msiSha256 !== evidence.installerSha256 || report.productVersion !== evidence.version) {
      throw new Error('Native evidence belongs to a different installer');
    }
    if (report.status !== 'passed') throw new Error('Native verification did not pass');
  }
  if (evidence.install.status !== 'passed' || evidence.install.nativeSmoke !== 'passed' ||
      evidence.install.licenses !== 'passed' || evidence.install.upgrade !== 'passed') {
    throw new Error('Installed application verification did not pass');
  }
  if (signed && (evidence.signature.status !== 'passed' || !evidence.signature.updaterVerified || !evidence.signature.authenticodeVerified)) {
    throw new Error('Release signature verification did not pass');
  }
  if (!signed && (evidence.signature.status !== 'unsigned' || evidence.signature.updaterVerified !== false || evidence.signature.authenticodeVerified !== false)) {
    throw new Error('Manual installer release must explicitly record unsigned status');
  }
  if (evidence.licenses.version !== evidence.version || evidence.licenses.sourceCommit !== evidence.sourceCommit) {
    throw new Error('License inventory belongs to a different build');
  }
  if (signed && evidence.licenses.runtimeReviewComplete !== true) throw new Error('Bundled runtime license/source review is incomplete');
  return evidence;
}
