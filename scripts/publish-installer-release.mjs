import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileSha256, assertReleaseEvidence } from './lib/release-evidence.mjs';
import { assertPublishIdentity, releaseAction } from './lib/installer-release.mjs';

const repository = process.env.GITHUB_REPOSITORY;
if (repository !== 'zhaoteng45/YTDL-Flow-public') throw new Error('Unexpected release repository');
const root = path.join(process.env.RUNNER_TEMP, 'verified-release');
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'release-evidence.json'), 'utf8'));
assertReleaseEvidence(evidence, { signed: false });
if (evidence.distributionMode !== 'manual-install') throw new Error('Expected manual installer evidence');
const tag = `v${evidence.version}`;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const head = git('rev-parse', 'HEAD');
if (head !== evidence.sourceCommit) throw new Error('Release evidence belongs to a different source');
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== tag) throw new Error('Unexpected release tag');
const refs = git('ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`).split(/\r?\n/).filter(Boolean);
const tagCommit = refs.find(line => line.endsWith('^{}'))?.split(/\s/)[0] ?? refs[0]?.split(/\s/)[0] ?? head;
assertPublishIdentity({ tag, version: evidence.version, sourceCommit: head, tagCommit });
const names = fs.readdirSync(root).sort();
const installer = `YTDL-Flow_${evidence.version}_x64_zh-CN.msi`;
const expected = [installer, 'THIRD_PARTY_NOTICES.md', 'toolchain-manifest.json', 'runtime-source-review.json', 'runtime-redistribution-audit-20261004.md', 'release-evidence.json', 'SHA256SUMS.txt'].sort();
if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('Unexpected or missing release assets');
if (fileSha256(path.join(root, installer)) !== evidence.installerSha256) throw new Error('Installer changed after acceptance');
let release = null;
try {
  release = JSON.parse(gh('api', `repos/${repository}/releases/tags/${tag}`));
} catch (error) {
  if (!/HTTP 404/.test(String(error.stderr))) throw error;
}
const action = releaseAction(release, { tag, sourceCommit: head });
if (release?.assets.some(asset => !expected.includes(asset.name))) throw new Error('Draft contains unexpected assets');
if (action === 'create') {
  gh('release', 'create', tag, '--repo', repository, '--target', head, '--draft', '--title', `YTDL-Flow ${evidence.version}`, '--notes-file', 'docs/RELEASE_INSTALLER_NOTES.md');
}
gh('release', 'upload', tag, ...names.map(name => path.join(root, name)), '--repo', repository, '--clobber');
const uploaded = JSON.parse(gh('api', `repos/${repository}/releases/tags/${tag}`));
if (!uploaded.draft || uploaded.assets.length !== names.length) throw new Error('Draft upload incomplete');
for (const asset of uploaded.assets) {
  if (!names.includes(asset.name) || asset.digest !== `sha256:${fileSha256(path.join(root, asset.name))}`) throw new Error('Uploaded release asset hash mismatch');
}
gh('release', 'edit', tag, '--repo', repository, '--draft=false', '--latest');
console.log(`Published https://github.com/${repository}/releases/tag/${tag}`);
