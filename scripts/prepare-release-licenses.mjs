import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { collectNpmLicenses } from './lib/npm-license-collection.mjs';
import { fileSha256, writeLicenseManifest } from './lib/release-evidence.mjs';

const root = process.cwd();
const output = path.join(root, 'src-tauri/licenses');
if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('License output is not empty; use a clean build checkout');
fs.mkdirSync(output, { recursive: true });
const copy = (source, destination) => {
  fs.mkdirSync(path.dirname(path.join(output, destination)), { recursive: true });
  fs.copyFileSync(path.join(root, source), path.join(output, destination));
};
copy('LICENSE', 'YTDL-Flow-LICENSE');
copy('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md');
copy('src-tauri/plugins/rustypipe/LICENSE', 'provider/LICENSE');
copy('src-tauri/plugins/rustypipe/provenance.json', 'provider/provenance.json');

const provenance = JSON.parse(fs.readFileSync('third-party/npm/provenance.json', 'utf8'));
const supplements = Object.fromEntries(Object.entries(provenance).map(([name, item]) => {
  const file = path.join(root, 'third-party/npm', item.file);
  if (fileSha256(file) !== item.sha256) throw new Error(`NPM supplement checksum mismatch: ${name}`);
  return [name, file];
}));
const npm = collectNpmLicenses(root, path.join(output, 'npm'), supplements);
fs.writeFileSync(path.join(output, 'npm-packages.json'), JSON.stringify(npm, null, 2));
copy('third-party/npm/provenance.json', 'npm-provenance.json');

const cargoAbout = process.env.CARGO_ABOUT;
if (!cargoAbout) throw new Error('CARGO_ABOUT must point to checksum-verified cargo-about 0.9.2');
const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl-cargo-licenses-'));
const collectRust = (manifest, destination) => {
  const raw = path.join(rawDir, destination);
  execFileSync(cargoAbout, ['generate', '--manifest-path', manifest, '--config', 'src-tauri/about.toml',
    '--locked', '--target', 'x86_64-pc-windows-msvc', '--format', 'json', '--fail', '--output-file', raw], { stdio: 'inherit' });
  const result = JSON.parse(fs.readFileSync(raw, 'utf8'));
  if (!result.licenses?.length) throw new Error(`Rust inventory is empty: ${manifest}`);
  const licenses = result.licenses.map((item) => ({
    id: item.id, name: item.name, text: item.text,
    usedBy: item.used_by.map(({ crate }) => ({ name: crate.name, version: crate.version, repository: crate.repository })),
  }));
  fs.writeFileSync(path.join(output, destination), JSON.stringify(licenses, null, 2));
  return licenses.length;
};
const rustCount = collectRust('src-tauri/Cargo.toml', 'rust-licenses.json');
const tools = JSON.parse(fs.readFileSync('src-tauri/toolchain-manifest.json', 'utf8')).windowsX64;
const registry = path.join(process.env.CARGO_HOME ?? path.join(os.homedir(), '.cargo'), 'registry/src');
const botguard = fs.readdirSync(registry).map((folder) => path.join(registry, folder, `rustypipe-botguard-${tools['rustypipe-botguard'].version}`, 'Cargo.toml')).find((file) => fs.existsSync(file));
if (!botguard) throw new Error('The pinned rustypipe-botguard crate source is missing');
const botCount = collectRust(botguard, 'rustypipe-licenses.json');

const downloads = [
  ['yt-dlp-LICENSE', 'https://raw.githubusercontent.com/yt-dlp/yt-dlp/3a08beaf031ab68f966401ead017ac81fe8486cf/LICENSE'],
  ['yt-dlp-THIRD_PARTY_LICENSES.txt', 'https://raw.githubusercontent.com/yt-dlp/yt-dlp/3a08beaf031ab68f966401ead017ac81fe8486cf/THIRD_PARTY_LICENSES.txt'],
  ['bun-LICENSE.md', 'https://raw.githubusercontent.com/oven-sh/bun/744846f844374847c902b5e7fd59b4342a51ef99/LICENSE.md'],
  ['GPL-3.0.txt', 'https://www.gnu.org/licenses/gpl-3.0.txt'],
];
const sources = [];
for (const [name, url] of downloads) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`License download failed: ${name}, HTTP ${response.status}`);
  const target = path.join(output, name);
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  sources.push({ file: name, url, sha256: fileSha256(target) });
}
fs.writeFileSync(path.join(output, 'license-sources.json'), JSON.stringify(sources, null, 2));
for (const flag of ['-L', '-buildconf']) {
  const text = execFileSync(path.join(root, 'src-tauri/bin/ffmpeg.exe'), ['-hide_banner', flag], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  fs.writeFileSync(path.join(output, flag === '-L' ? 'ffmpeg-license.txt' : 'ffmpeg-buildconf.txt'), text);
}
const review = JSON.parse(fs.readFileSync('third-party/runtime-source-review.json', 'utf8'));
const pending = Object.entries(review.tools).filter(([name, item]) => item.version !== tools[name]?.version || item.complete !== true)
  .map(([name, item]) => ({ name, version: tools[name]?.version, pending: item.pending ?? 'Version changed; recheck corresponding sources' }));
fs.writeFileSync(path.join(output, 'runtime-source-review.json'), JSON.stringify({ ...review, pending }, null, 2));
const manifest = writeLicenseManifest(output, {
  version: JSON.parse(fs.readFileSync('package.json', 'utf8')).version,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  runtimeReviewComplete: pending.length === 0,
});
console.log(`Collected ${npm.length} NPM packages, ${rustCount} app and ${botCount} botguard license texts; ${manifest.files.length} files.`);
if (pending.length) console.log(`PUBLICATION BLOCKED: runtime source review remains incomplete for ${pending.map((item) => item.name).join(', ')}`);
