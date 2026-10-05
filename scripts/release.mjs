import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const targetVersion = process.argv[2];
const files = ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function versionParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Expected a release version X.Y.Z');
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Version components must be safe integers');
  return parts;
}

function updateToml(text, header, predicate) {
  let count = 0;
  const result = text.replace(/(^\[.*\][^\r\n]*\r?\n)([\s\S]*?)(?=^\[|(?![\s\S]))/gm, (block, title, body) => {
    if (title.trim() !== header || !predicate(Bun.TOML.parse(block))) return block;
    count++;
    return title + body.replace(/^version\s*=\s*"[^"]+"/m, `version = "${targetVersion}"`);
  });
  if (count !== 1) throw new Error(`Expected exactly one root package in ${header}`);
  return result;
}

function gitStep(label, args) {
  try { git(...args); } catch (error) { throw new Error(`Git step failed: ${label}`, { cause: error }); }
}

if (targetVersion === '--help' || targetVersion === '-h' || !targetVersion) {
  console.log('Usage: bun run release:prepare <X.Y.Z>\nUpdates package.json, Tauri, Cargo.toml and Cargo.lock. Requires a clean repository root; creates a local commit and tag. Remote publishing runs separately.');
  process.exit(targetVersion ? 0 : 1);
}

try {
  if (process.argv.length !== 3) throw new Error('Expected exactly one version argument');
  const next = versionParts(targetVersion);
  const original = files.map(file => readFileSync(file, 'utf8'));
  const pkg = JSON.parse(original[0]);
  const tauri = JSON.parse(original[1]);
  const cargo = Bun.TOML.parse(original[2]).package;
  const roots = Bun.TOML.parse(original[3]).package.filter(item => item.name === cargo.name);
  if (roots.length !== 1 || [tauri.version, cargo.version, roots[0].version].some(v => v !== pkg.version)) throw new Error('Current version files do not match');
  const current = versionParts(pkg.version);
  const firstDifference = next.findIndex((part, index) => part !== current[index]);
  if (firstDifference < 0 || next[firstDifference] < current[firstDifference]) throw new Error('New version must be greater than current version');
  if (path.resolve(git('rev-parse', '--show-toplevel')) !== path.resolve(process.cwd())) throw new Error('Run from the repository root');
  if (git('status', '--porcelain')) throw new Error('Worktree must be clean before preparing a release');
  if (git('tag', '--list', `v${targetVersion}`)) throw new Error('Release tag already exists');
  const parent = git('rev-parse', 'HEAD');

  pkg.version = targetVersion;
  tauri.version = targetVersion;
  const updated = [JSON.stringify(pkg, null, 2) + '\n', JSON.stringify(tauri, null, 2) + '\n',
    updateToml(original[2], '[package]', () => true),
    updateToml(original[3], '[[package]]', section => section.package[0].name === cargo.name)];
  // Validate the planned TOML before writing any file.
  if (Bun.TOML.parse(updated[2]).package.version !== targetVersion || Bun.TOML.parse(updated[3]).package.find(item => item.name === cargo.name).version !== targetVersion) throw new Error('Planned Cargo versions do not match');
  files.forEach((file, index) => writeFileSync(file, updated[index]));
  gitStep('Staging version files', ['add', '--', ...files]);
  const staged = git('diff', '--cached', '--name-only').split('\n').sort();
  if (JSON.stringify(staged) !== JSON.stringify([...files].sort())) throw new Error('Unexpected staged files; release commit stopped');
  gitStep('Creating release commit', ['commit', '-m', `chore(release): v${targetVersion}`]);
  const committedFiles = git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').sort();
  const normalize = text => text.replace(/\r\n/g, '\n');
  if (git('rev-parse', 'HEAD^') !== parent || JSON.stringify(committedFiles) !== JSON.stringify([...files].sort()) ||
      files.some((file, index) => normalize(git('show', `HEAD:${file}`)) !== normalize(updated[index]).trimEnd()) || git('status', '--porcelain')) {
    throw new Error('Release commit differs from planned files; tag creation stopped');
  }
  gitStep('Creating release tag', ['tag', `v${targetVersion}`]);
  console.log(`Version ${targetVersion} committed and tagged locally.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
