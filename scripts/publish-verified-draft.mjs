import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { assertDraftIdentity } from './lib/draft-release.mjs';
import { assertReleaseEvidence, fileSha256 } from './lib/release-evidence.mjs';

const tag = process.env.RELEASE_TAG ?? '';
const expectedHash = (process.env.INSTALLER_SHA256 ?? '').trim().toLowerCase();
if (!/^v\d+\.\d+\.\d+$/.test(tag) || !/^[a-f0-9]{64}$/.test(expectedHash) || process.env.HUMAN_VERIFIED !== 'true') {
  throw new Error('Provide the draft version, human-tested MSI SHA256 and human acceptance');
}
const repo = process.env.GITHUB_REPOSITORY;
if (repo !== 'zhaoteng45/YTDL-Flow-public') throw new Error('Unexpected release repository');
const gh = (...args) => execFileSync('gh', [...args, '--repo', repo], { encoding: 'utf8' });
const release = JSON.parse(gh('release', 'view', tag, '--json', 'isDraft,tagName,targetCommitish,assets'));
if (!release.isDraft) throw new Error('Only an existing draft can be published');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl-publish-'));
try {
  gh('release', 'download', tag, '--dir', directory);
  const files = fs.readdirSync(directory);
  const installers = files.filter(name => name.endsWith('.msi'));
  if (installers.length !== 1) throw new Error('Expected exactly one draft MSI');
  const installer = installers[0];
  const required = [installer, installer + '.sig', 'latest.json', 'release-evidence.json', 'SHA256SUMS.txt'];
  if (files.length !== required.length || required.some(name => !files.includes(name))) throw new Error('Incomplete or unexpected draft assets');
  const evidence = assertReleaseEvidence(JSON.parse(fs.readFileSync(path.join(directory, 'release-evidence.json'), 'utf8')));
  // A manually prepared draft may not have a tag yet. Its target must be an exact SHA.
  const ref = spawnSync('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' });
  const tagCommit = ref.status === 0 ? ref.stdout.trim() : release.targetCommitish;
  assertDraftIdentity({ tag, expectedHash, actualHash: fileSha256(path.join(directory, installer)),
    humanVerified: true, isDraft: release.isDraft, releaseTag: release.tagName, tagCommit, evidence,
    signatureHash: fileSha256(path.join(directory, installer + '.sig')) });
  const latest = JSON.parse(fs.readFileSync(path.join(directory, 'latest.json'), 'utf8'));
  const platform = latest.platforms?.['windows-x86_64'];
  const signature = fs.readFileSync(path.join(directory, installer + '.sig'), 'utf8').trim();
  if (latest.version !== evidence.version || !signature || platform?.signature !== signature ||
      platform?.url !== `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(installer)}`) {
    throw new Error('Updater metadata does not match the accepted installer');
  }
  if (fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8').trim() !== `${expectedHash}  ${installer}`) throw new Error('Checksum asset mismatch');
  gh('release', 'edit', tag, '--draft=false', '--latest');
  console.log(`Published ${tag}, installer SHA256 ${expectedHash}`);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
