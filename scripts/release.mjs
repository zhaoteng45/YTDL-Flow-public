import path from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const targetVersion = args[0];

function printHelp() {
  console.log(`Usage: bun run release:prepare <new_version>

Local helper only:
- updates version fields in package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml
- creates a local git commit and tag when running inside a git worktree

Remote publishing is handled separately by the GitHub tagged release workflow.
Use the Bun version pinned by package.json#packageManager; Bun is the supported JavaScript runtime.`);
}

function isGitWorktree() {
  try {
    return execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe', encoding: 'utf8' }).trim() === 'true';
  } catch {
    return false;
  }
}

function runGitStep(label, command) {
  console.log(`📦 ${label}...`);

  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error(`❌ Git step failed: ${label}`);
    if (error instanceof Error && error.message) {
      console.error(error.message);
    }
    process.exit(1);
  }
}

if (targetVersion === '--help' || targetVersion === '-h') {
  printHelp();
  process.exit(0);
}

if (!targetVersion) {
  printHelp();
  process.exit(1);
}

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, 'package.json');
const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');

// 1. Update package.json
console.log(`📝 Updating package.json to ${targetVersion}...`);
const packageJson = await Bun.file(packageJsonPath).json();
packageJson.version = targetVersion;
await Bun.write(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

// 2. Update tauri.conf.json
console.log(`📝 Updating tauri.conf.json to ${targetVersion}...`);
const tauriConf = await Bun.file(tauriConfPath).json();
tauriConf.version = targetVersion;
await Bun.write(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');

// 3. Update Cargo.toml
console.log(`📝 Updating Cargo.toml to ${targetVersion}...`);
let cargoToml = await Bun.file(cargoTomlPath).text();
// Replace version = "x.y.z" with version = "new_version"
// Note: This regex assumes the first occurrence of version = "..." is the package version
cargoToml = cargoToml.replace(/^version\s*=\s*"[^"]+"/m, `version = "${targetVersion}"`);
await Bun.write(cargoTomlPath, cargoToml);

// 4. Git Commit & Tag (Optional - purely local helper)
if (!isGitWorktree()) {
  console.log('ℹ️ Not inside a git worktree; skipping local git commit/tag steps.');
} else {
  runGitStep('Staging version files', 'git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml');
  runGitStep('Creating release commit', `git commit -m "chore(release): v${targetVersion}"`);
  runGitStep('Creating release tag', `git tag v${targetVersion}`);
  console.log(`✅ Version bumped to ${targetVersion} and tagged.`);
}
