import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileSha256, verifyLicenseBundle, assertReleaseEvidence } from './lib/release-evidence.mjs';

const directory = 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi';
const files = fs.readdirSync(directory).filter((name) => name.endsWith('.msi'));
if (files.length !== 1) throw new Error('Expected exactly one final installer');
const installer = path.join(directory, files[0]);
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) {
  throw new Error('Release tag does not match the application version');
}
const readReport = (name) => JSON.parse(fs.readFileSync(path.join(process.env.RUNNER_TEMP, 'ytdl-flow-install-trust', name), 'utf8').replace(/^\uFEFF/, ''));
const install = readReport('result.json');
install.msiSha256 = install.msiSha256.toLowerCase();
const fresh = readReport('fresh-install.json');
if (fresh.status !== 'passed' || fresh.msiSha256.toLowerCase() !== fileSha256(installer) || fresh.nativeSmoke !== 'passed') {
  throw new Error('Fresh-install evidence did not pass for this installer');
}
const evidence = assertReleaseEvidence({
  installerSha256: fileSha256(installer), version, sourceCommit, install,
  signature: readReport('signature.json'), licenses: verifyLicenseBundle('src-tauri/licenses'),
});
const signature = fs.readFileSync(installer + '.sig', 'utf8').trim();
const releaseRoot = path.join(process.env.RUNNER_TEMP, 'verified-release');
fs.mkdirSync(releaseRoot);
for (const file of [installer, installer + '.sig']) fs.copyFileSync(file, path.join(releaseRoot, path.basename(file)));
fs.writeFileSync(path.join(releaseRoot, 'release-evidence.json'), JSON.stringify(evidence, null, 2));
fs.writeFileSync(path.join(releaseRoot, 'SHA256SUMS.txt'), `${evidence.installerSha256}  ${files[0]}\n`);
fs.writeFileSync(path.join(releaseRoot, 'latest.json'), JSON.stringify({
  version, notes: `YTDL-Flow ${version}`, pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': { signature, url: `https://github.com/zhaoteng45/YTDL-Flow-public/releases/download/v${version}/${encodeURIComponent(files[0])}` } },
}, null, 2));
console.log(`Verified release files ready for draft v${version}`);
