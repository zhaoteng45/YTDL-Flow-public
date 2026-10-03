import { $ } from 'bun';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

console.log('🧹 Cleaning up zombie processes and stale temporary credentials...');

const isWin = process.platform === 'win32';

// 1. 清理临时生成的敏感 Netscape Cookie 文本文件
try {
  const tmpDir = os.tmpdir();
  const entries = fs.readdirSync(tmpDir);
  for (const entry of entries) {
    if (entry.startsWith('ytdl_flow_cookies_') && entry.endsWith('.txt')) {
      try {
        fs.unlinkSync(path.join(tmpDir, entry));
      } catch {
        // 忽略可能正在被其他进程锁定的文件
      }
    }
  }
} catch (e) {
  console.log('⚠️ Warning during temporary cookies cleanup:', e.message);
}

// 2. 清理残存进程
try {
  if (isWin) {
    // Windows: Find processes with "tauri", "yt-dlp", "ffmpeg" in name and kill them
    await $`powershell -NoProfile -Command "Stop-Process -Name *tauri*,*yt-dlp*,*ffmpeg* -Force -ErrorAction SilentlyContinue"`.nothrow();
  } else {
    // Linux/Mac: pkill
    await $`pkill -f tauri`.nothrow();
  }
  console.log('✅ Cleanup complete.');
} catch (error) {
  console.log('⚠️ Cleanup warning (might be no processes to kill):', error.message);
}
