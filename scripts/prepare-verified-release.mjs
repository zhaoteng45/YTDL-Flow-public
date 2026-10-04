import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileSha256, verifyLicenseBundle, assertReleaseEvidence } from './lib/release-evidence.mjs';

export function prepareVerifiedRelease({ cwd, runnerTemp, sourceCommit, refType, refName }) {
const directory = path.join(cwd, 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi');
const files = fs.readdirSync(directory).filter((name) => name.endsWith('.msi'));
if (files.length !== 1) throw new Error('Expected exactly one final installer');
const installer = path.join(directory, files[0]);
const version = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).version;
if (refType === 'tag' && refName !== `v${version}`) {
  throw new Error('Release tag does not match the application version');
}
const readReport = (name) => JSON.parse(fs.readFileSync(path.join(runnerTemp, 'ytdl-flow-install-trust', name), 'utf8').replace(/^\uFEFF/, ''));
const install = readReport('result.json');
install.msiSha256 = install.msiSha256.toLowerCase();
const fresh = readReport('fresh-install.json');
if (fresh.status !== 'passed' || fresh.msiSha256.toLowerCase() !== fileSha256(installer) || fresh.nativeSmoke !== 'passed') {
  throw new Error('Fresh-install evidence did not pass for this installer');
}
const evidence = assertReleaseEvidence({
  distributionMode: 'manual-install',
  installerSha256: fileSha256(installer), version, sourceCommit, install, fresh,
  native: [readReport('native-fresh.json'), readReport('native-upgrade.json')],
  signature: readReport('signature.json'), licenses: verifyLicenseBundle(path.join(cwd, 'src-tauri/licenses')),
}, { signed: false });
const releaseRoot = path.join(runnerTemp, 'verified-release');
fs.mkdirSync(releaseRoot);
fs.copyFileSync(installer, path.join(releaseRoot, path.basename(installer)));
for (const file of ['THIRD_PARTY_NOTICES.md', 'src-tauri/toolchain-manifest.json', 'src-tauri/licenses/runtime-source-review.json', 'docs/reference/runtime-redistribution-audit-20261004.md']) {
  fs.copyFileSync(path.join(cwd, file), path.join(releaseRoot, path.basename(file)));
}
fs.writeFileSync(path.join(releaseRoot, 'release-evidence.json'), JSON.stringify(evidence, null, 2));
fs.writeFileSync(path.join(releaseRoot, 'SHA256SUMS.txt'), `${evidence.installerSha256}  ${files[0]}\n`);
console.log(`Verified manual installer files ready for v${version}; no updater metadata`);
return evidence;
}

if (import.meta.main) prepareVerifiedRelease({
  cwd: process.cwd(), runnerTemp: process.env.RUNNER_TEMP,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  refType: process.env.GITHUB_REF_TYPE, refName: process.env.GITHUB_REF_NAME,
});
