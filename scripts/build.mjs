import { execSync } from 'node:child_process';
import process from 'node:process';

// Helper to run commands and exit on failure
function run(cmd) {
  console.log(`\n🚀 Running: ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    console.error(`\n❌ Build failed during: ${cmd}`);
    process.exit(1);
  }
}

console.log('🏗️  Starting Production Build Sequence...');

// Builds do not terminate unrelated processes or delete temporary credentials.
// Rust startup owns the safe stale-cookie cleanup lifecycle.

// 1. Type Check (tsc)
console.log('\n📝 Running Type Check...');
run('bun run typecheck');

// 2. Lint
console.log('\n🔍 Running Linter...');
run('bun run lint');

// 3. Tauri Build (which runs the frontend build hook)
console.log('\n🦀 Building Tauri App...');
run('bun run tauri:build');

console.log('\n✅ Build Sequence Completed Successfully!');
