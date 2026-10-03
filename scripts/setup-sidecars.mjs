import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  assertExplicitTargetMatchesHostTriple,
  getHostFacts,
  resolveTargetTriple,
} from './lib/target-triple.mjs';

// Configuration
const BIN_DIR = path.resolve('src-tauri', 'bin');

async function main() {
  console.log('🚀 Linking local binaries for Tauri Sidecar...');

  if (!fs.existsSync(BIN_DIR)) {
    console.error(`❌ Error: ${BIN_DIR} does not exist.`);
    console.error('Please create the directory and place yt-dlp.exe, ffmpeg.exe, and ffprobe.exe inside.');
    process.exit(1);
  }

  const { triple, source, sourceLabel } = resolveTargetTriple({
    requireExplicitTarget: process.env.CI === 'true',
  });
  if (!triple) {
    console.error('❌ Could not determine Rust target triple.');
    process.exit(1);
  }

  const host = getHostFacts();
  assertExplicitTargetMatchesHostTriple({
    scriptName: 'setup-sidecars.mjs',
    triple,
    source,
    hostTriple: host.triple,
  });

  console.log(`Target Triple: ${triple} (${sourceLabel})`);

  const binaries = ['yt-dlp', 'ffmpeg', 'ffprobe'];
  const isWin = process.platform === 'win32';
  const ext = isWin ? '.exe' : '';

  let missing = false;

  for (const bin of binaries) {
    const srcName = `${bin}${ext}`;
    const destName = bin === 'yt-dlp' ? `${bin}-${triple}${ext}` : srcName;
    const srcPath = path.join(BIN_DIR, srcName);
    const destPath = path.join(BIN_DIR, destName);

    // yt-dlp stays a target-aware sidecar; ffmpeg/ffprobe stay fixed host resources.
    if (fs.existsSync(srcPath)) {
      if (srcPath !== destPath) {
        console.log(`🔗 Copying ${srcName} -> ${destName}`);
        fs.copyFileSync(srcPath, destPath);
      }
      continue;
    }

    // Missing
    console.error(`❌ Missing binary: ${srcName} (searched in src-tauri/bin)`);
    missing = true;
  }

  if (missing) {
    console.error('\nPlease place the required executables in src-tauri/bin/ and run this script again.');
    process.exit(1);
  }

  console.log('✅ Sidecar setup complete.');
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
