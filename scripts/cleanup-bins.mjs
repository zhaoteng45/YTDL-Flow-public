/**
 * cleanup-bins.mjs
 * 删除 src-tauri/bin/ 下所有带 Rust Target Triple 后缀的命名副本。
 * 用途：更新二进制文件前强制清理，确保 setup-sidecars.mjs 会重新生成。
 */
import { $ } from 'bun';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const BIN_DIR = path.resolve('src-tauri', 'bin');

async function getTargetTriple() {
  try {
    const res = await $`rustc -vV`.text();
    const match = res.match(/host: (.+)/);
    return match ? match[1].trim() : null;
  } catch (e) {
    console.error('❌ Failed to get target triple via rustc:', e.message);
    return null;
  }
}

async function main() {
  console.log('🧹 Cleaning up triple-named sidecar binaries...');

  if (!fs.existsSync(BIN_DIR)) {
    console.log('⚠️  src-tauri/bin/ does not exist, skipping cleanup.');
    return;
  }

  const triple = await getTargetTriple();
  if (!triple) {
    console.error('❌ Could not determine Rust target triple. Aborting cleanup.');
    process.exit(1);
  }
  console.log(`   Target Triple: ${triple}`);

  const binaries = ['yt-dlp', 'ffmpeg', 'ffprobe'];
  const isWin = process.platform === 'win32';
  const ext = isWin ? '.exe' : '';

  let cleaned = 0;
  for (const bin of binaries) {
    const tripleFile = path.join(BIN_DIR, `${bin}-${triple}${ext}`);
    if (fs.existsSync(tripleFile)) {
      fs.unlinkSync(tripleFile);
      console.log(`   🗑️  Removed: ${path.basename(tripleFile)}`);
      cleaned++;
    } else {
      console.log(`   ✅ Already absent: ${bin}-${triple}${ext}`);
    }
  }

  console.log(`🧹 Cleanup complete. Removed ${cleaned} file(s).\n`);
}

main();
