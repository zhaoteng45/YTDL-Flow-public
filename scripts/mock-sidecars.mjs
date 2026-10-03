import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  assertExplicitTargetMatchesHostTriple,
  getHostFacts,
  resolveTargetTriple,
} from './lib/target-triple.mjs';

const BIN_DIR = path.resolve('src-tauri', 'bin');

if (!fs.existsSync(BIN_DIR)) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
}

const isWin = process.platform === 'win32';
const ext = isWin ? '.exe' : '';

const binaries = ['yt-dlp', 'ffmpeg', 'ffprobe', 'bun', 'rustypipe-botguard'];

let triple;
let source;
let sourceLabel;

try {
  ({ triple, source, sourceLabel } = resolveTargetTriple({
    requireExplicitTarget: process.env.CI === 'true',
  }));

  assertExplicitTargetMatchesHostTriple({
    scriptName: 'mock-sidecars.mjs',
    triple,
    source,
    hostTriple: getHostFacts().triple,
  });
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

console.log(`👻 Creating mock sidecars for CI...${triple ? ` (${triple}, ${sourceLabel})` : ''}`);

binaries.forEach(bin => {
  const srcPath = path.join(BIN_DIR, `${bin}${ext}`);
  if (!fs.existsSync(srcPath)) {
    fs.writeFileSync(srcPath, isWin ? 'Mock Binary' : '#!/bin/sh\necho "Mock Binary"');
    if (!isWin) fs.chmodSync(srcPath, 0o755);
    console.log(`Created mock ${bin}${ext}`);
  }
});

console.log('✅ Mock sidecars ready.');
