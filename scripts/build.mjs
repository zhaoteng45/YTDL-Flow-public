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

// 1. Cleanup Zombies
run('bun run cleanup');

// 2. Type Check (tsc)
console.log('\n📝 Running Type Check...');
run('bun run typecheck');

// 3. Lint
console.log('\n🔍 Running Linter...');
run('bun run lint');

// 4. Tauri Build (which runs the frontend build hook)
console.log('\n🦀 Building Tauri App...');
run('bun run tauri:build');

console.log('\n✅ Build Sequence Completed Successfully!');
