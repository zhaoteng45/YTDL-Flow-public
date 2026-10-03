/**
 * prepare-release-sidecars.mjs
 * 纯净自包含：检查并更新五个发布所需 Sidecar/Resource 二进制文件，并在最后输出版本对比报告：
 *   1. yt-dlp              — 从 GitHub Releases 官方下载最新稳定版
 *   2. ffmpeg              — Windows 发布准备时从 Gyan.dev 刷新最新稳定构建
 *   3. ffprobe             — 与 FFmpeg 同包同步刷新
 *   4. bun                 — Windows 发布准备时从 GitHub Releases 刷新最新稳定运行时
 *   5. rustypipe-botguard  — 发布必备 PO Token provider；若缺失用 Cargo 从固定稳定版本构建
 *
 * 运行前请确保 cleanup-bins.mjs 已执行（由 update-bins script 保证顺序）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import process from 'node:process';
import {
    assertExplicitTargetMatchesHostTriple,
    getHostFacts,
    resolveTargetTriple,
} from './lib/target-triple.mjs';
import {
    assertImmutableArtifactUrl,
    sha256Hex,
    verifyArtifactBuffer,
} from './lib/tool-provenance.mjs';

const BIN_DIR = path.resolve('src-tauri', 'bin');
const TOOLCHAIN_MANIFEST = JSON.parse(
    fs.readFileSync(path.resolve('src-tauri', 'toolchain-manifest.json'), 'utf8'),
);
const WINDOWS_X64_TOOLS = TOOLCHAIN_MANIFEST.windowsX64;
const RUSTYPIPE_BOTGUARD_VERSION = WINDOWS_X64_TOOLS['rustypipe-botguard'].version;

if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
}

let triple;
let source;
let sourceLabel;

try {
    ({ triple, source, sourceLabel } = resolveTargetTriple({
        requireExplicitTarget: process.env.CI === 'true',
    }));
} catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
}

if (!triple) {
    console.error('❌ Could not determine target triple.');
    process.exit(1);
}

const host = getHostFacts();

const isWin = process.platform === 'win32';
const ext = isWin ? '.exe' : '';

// ── 工具函数 ──────────────────────────────────────────────────────────────

async function downloadFile(url, dest, options = {}) {
    const { expectedSha256, label = url, requireImmutableUrl = false } = options;
    if (requireImmutableUrl) {
        assertImmutableArtifactUrl(url);
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const buffer = await response.arrayBuffer();

    // Verify before writing the artifact into the release input directory.
    const sha256 = expectedSha256
        ? verifyArtifactBuffer(buffer, { label, expectedSha256 })
        : sha256Hex(buffer);
    console.log(`   🔒 SHA-256: ${sha256.slice(0, 16)}...${sha256.slice(-8)}`);

    await Bun.write(dest, buffer);
    if (!isWin) fs.chmodSync(dest, 0o755);
}


/**
 * 获取二进制版本号，提取第一行中最有意义的版本字符串。
 * @param {string} binPath
 * @param {string} versionFlag
 * @returns {string}
 */
function expandArchive(zipPath, destinationPath) {
    execFileSync(
        'powershell',
        [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Expand-Archive -LiteralPath $env:YTDL_FLOW_UPDATE_ZIP -DestinationPath $env:YTDL_FLOW_UPDATE_EXTRACT -Force',
        ],
        {
            stdio: 'inherit',
            env: {
                ...process.env,
                YTDL_FLOW_UPDATE_ZIP: zipPath,
                YTDL_FLOW_UPDATE_EXTRACT: destinationPath,
            },
        },
    );
}

function getBinaryVersion(binPath, versionFlag = '--version') {
    try {
        const raw = execSync(`"${binPath}" ${versionFlag}`, {
            encoding: 'utf-8',
            stderr: 'pipe',
        }).split('\n')[0].trim();
        return raw || '(unknown)';
    } catch (e) {
        // ffmpeg/ffprobe 版本信息输出到 stderr
        try {
            const raw2 = e.stderr?.split('\n')[0].trim();
            return raw2 || '(unknown)';
        } catch {
            return '(unknown)';
        }
    }
}

// ── 报告数组 ──────────────────────────────────────────────────────────────
// { name, before, after, status: 'ok' | 'failed' | 'skipped', note? }
const report = [];

// ── 主流程 ────────────────────────────────────────────────────────────────

async function main() {
    const startTime = Date.now();

    assertExplicitTargetMatchesHostTriple({
        scriptName: 'prepare-release-sidecars.mjs',
        triple,
        source,
        hostTriple: host.triple,
    });

    console.log('📦 Preparing release sidecar binaries...');
    console.log(`   Target Triple : ${triple} (${sourceLabel})`);
    if (host.triple) {
        console.log(`   Host Triple   : ${host.triple}`);
    }
    console.log(`   Platform      : ${process.platform}`);
    console.log(`   Time          : ${new Date().toLocaleString('zh-CN')}\n`);
    console.log('─'.repeat(56));

    // ── 1. yt-dlp ──────────────────────────────────────────────────────────
    const ytDlpDest = path.join(BIN_DIR, `yt-dlp${ext}`);
    const ytDlpArtifact = isWin ? WINDOWS_X64_TOOLS['yt-dlp'] : null;
    const ytDlpUrl = isWin
        ? ytDlpArtifact.url
        : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

    const ytDlpBefore = fs.existsSync(ytDlpDest)
        ? getBinaryVersion(ytDlpDest)
        : '(not found)';

    console.log(`\n⬇️  [1/4] Downloading yt-dlp ${ytDlpArtifact ? ytDlpArtifact.version : '(latest)'}...`);
    try {
        await downloadFile(
            ytDlpUrl,
            ytDlpDest,
            ytDlpArtifact
                ? {
                      expectedSha256: ytDlpArtifact.sha256,
                      label: `yt-dlp ${ytDlpArtifact.version}`,
                      requireImmutableUrl: true,
                  }
                : {},
        );
        const ytDlpAfter = getBinaryVersion(ytDlpDest);
        console.log(`   ✅ Done.`);
        report.push({ name: 'yt-dlp', before: ytDlpBefore, after: ytDlpAfter, status: 'ok' });
    } catch (e) {
        console.error(`   ❌ Failed: ${e.message}`);
        report.push({ name: 'yt-dlp', before: ytDlpBefore, after: '(failed)', status: 'failed', note: e.message });
        process.exit(1);
    }

    // ── 2 & 3. FFmpeg & FFprobe ─────────────────────────────────────────────
    const ffmpegDest = path.join(BIN_DIR, `ffmpeg${ext}`);
    const ffprobeDest = path.join(BIN_DIR, `ffprobe${ext}`);

    const ffmpegBefore = fs.existsSync(ffmpegDest)
        ? getBinaryVersion(ffmpegDest, '-version')
        : '(not found)';
    const ffprobeBefore = fs.existsSync(ffprobeDest)
        ? getBinaryVersion(ffprobeDest, '-version')
        : '(not found)';

    if (isWin) {
        console.log(`\n⬇️  [2/4 & 3/4] Refreshing official FFmpeg release from Gyan.dev...`);
            const ffmpegArtifact = WINDOWS_X64_TOOLS.ffmpeg;
            const ffmpegZipUrl = ffmpegArtifact.url;
            const tempDir = path.resolve(BIN_DIR, '..', '..', 'temp_ffmpeg_download');
            const zipPath = path.join(tempDir, 'ffmpeg.zip');

            if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
            fs.mkdirSync(tempDir, { recursive: true });

            try {
                await downloadFile(ffmpegZipUrl, zipPath, {
                    expectedSha256: ffmpegArtifact.sha256,
                    label: `FFmpeg ${ffmpegArtifact.version}`,
                    requireImmutableUrl: true,
                });
                expandArchive(zipPath, tempDir);

                const files = fs.readdirSync(tempDir, { recursive: true });
                const foundFFmpeg = files.find(f => typeof f === 'string' && f.endsWith('ffmpeg.exe'));
                const foundFFprobe = files.find(f => typeof f === 'string' && f.endsWith('ffprobe.exe'));

                if (!foundFFmpeg || !foundFFprobe) {
                    throw new Error('ffmpeg.exe or ffprobe.exe not found in downloaded zip archive');
                }

                fs.copyFileSync(path.join(tempDir, foundFFmpeg), ffmpegDest);
                fs.copyFileSync(path.join(tempDir, foundFFprobe), ffprobeDest);
                console.log(`   ✅ Extracted and bundled official FFmpeg & FFprobe.`);
            } catch (err) {
                console.error(`   ❌ Failed to download/extract FFmpeg: ${err.message}`);
                report.push({ name: 'ffmpeg', before: ffmpegBefore, after: '(failed)', status: 'failed', note: err.message });
                report.push({ name: 'ffprobe', before: ffprobeBefore, after: '(failed)', status: 'failed', note: err.message });
                process.exit(1);
            } finally {
                if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
            }
    } else if (!fs.existsSync(ffmpegDest) || !fs.existsSync(ffprobeDest)) {
        console.error('   ❌ FFmpeg missing. Please place ffmpeg/ffprobe binary in src-tauri/bin/.');
        process.exit(1);
    } else {
        console.log(`\n📦 [2/4 & 3/4] Verifying bundled FFmpeg & FFprobe in src-tauri/bin/...`);
        console.log(`   ffmpeg : ${ffmpegBefore}`);
        console.log(`   ffprobe: ${ffprobeBefore}`);
    }

    const ffmpegAfter = getBinaryVersion(ffmpegDest, '-version');
    const ffprobeAfter = getBinaryVersion(ffprobeDest, '-version');
    report.push({ name: 'ffmpeg', before: ffmpegBefore, after: ffmpegAfter, status: 'ok' });
    report.push({ name: 'ffprobe', before: ffprobeBefore, after: ffprobeAfter, status: 'ok' });

    // ── 4. bun ─────────────────────────────────────────────────────────────
    console.log(`\n📦 [4/4] Verifying/Upgrading bun runtime...`);
    const bunPath = path.join(BIN_DIR, `bun${ext}`);

    const bunBefore = fs.existsSync(bunPath)
        ? getBinaryVersion(bunPath, '--version')
        : '(not found)';

    if (isWin) {
        console.log(`\n⬇️  Refreshing official Bun release archive...`);
            const bunArtifact = WINDOWS_X64_TOOLS.bun;
            const bunZipUrl = bunArtifact.url;
            const tempDir = path.resolve(BIN_DIR, '..', '..', 'temp_bun_download');
            const zipPath = path.join(tempDir, 'bun.zip');

            if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
            fs.mkdirSync(tempDir, { recursive: true });

            try {
                await downloadFile(bunZipUrl, zipPath, {
                    expectedSha256: bunArtifact.sha256,
                    label: `Bun ${bunArtifact.version}`,
                    requireImmutableUrl: true,
                });
                expandArchive(zipPath, tempDir);

                const files = fs.readdirSync(tempDir, { recursive: true });
                const foundBun = files.find(f => typeof f === 'string' && f.endsWith('bun.exe'));

                if (!foundBun) {
                    throw new Error('bun.exe not found in downloaded zip archive');
                }

                fs.copyFileSync(path.join(tempDir, foundBun), bunPath);
                console.log(`   ✅ Extracted and bundled official Bun.`);
            } catch (err) {
                console.error(`   ❌ Failed to download/extract Bun: ${err.message}`);
                report.push({ name: 'bun', before: bunBefore, after: '(failed)', status: 'failed', note: err.message });
                process.exit(1);
            } finally {
                if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
            }
    } else if (!fs.existsSync(bunPath)) {
        console.error('   ❌ Bun missing. Please place bun binary in src-tauri/bin/.');
        process.exit(1);
    }

    const bunAfter = getBinaryVersion(bunPath, '--version');
    console.log(`   ✅ Done. Bun version: ${bunAfter}`);
    report.push({ name: 'bun', before: bunBefore, after: bunAfter, status: 'ok' });

    // ── 5. rustypipe-botguard ──────────────────────────────────────────────
    console.log(`\n📦 [5/5] Verifying/Upgrading rustypipe-botguard runtime...`);
    const bgPath = path.join(BIN_DIR, `rustypipe-botguard${ext}`);

    const bgBefore = fs.existsSync(bgPath)
        ? getBinaryVersion(bgPath, '--version')
        : '(not found)';

    if (!fs.existsSync(bgPath)) {
        const tempDir = path.resolve(BIN_DIR, '..', '..', 'temp_rustypipe_botguard_install');
        const installedPath = path.join(tempDir, 'bin', `rustypipe-botguard${ext}`);

        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });

        console.log(
            `   ⬇️  Building rustypipe-botguard ${RUSTYPIPE_BOTGUARD_VERSION} with Cargo...`,
        );

        try {
            execSync(
                `cargo install rustypipe-botguard --version ${RUSTYPIPE_BOTGUARD_VERSION} --locked --root "${tempDir}"`,
                { stdio: 'inherit' },
            );

            if (!fs.existsSync(installedPath)) {
                throw new Error(`Cargo install completed but ${installedPath} was not produced`);
            }

            fs.copyFileSync(installedPath, bgPath);
            console.log('   ✅ Built and bundled rustypipe-botguard.');
        } catch (err) {
            console.error(`   ❌ Failed to build rustypipe-botguard: ${err.message}`);
            report.push({
                name: 'rustypipe-botguard',
                before: bgBefore,
                after: '(failed)',
                status: 'failed',
                note: err.message,
            });
            process.exit(1);
        } finally {
            if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }

    const bgAfter = getBinaryVersion(bgPath, '--version');
    console.log(`   ✅ Done. rustypipe-botguard version: ${bgAfter}`);
    report.push({ name: 'rustypipe-botguard', before: bgBefore, after: bgAfter, status: 'ok' });

    // ── 最终报告 ───────────────────────────────────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const statusIcon = { ok: '✅', failed: '❌', skipped: '⚠️ ' };

    console.log('\n' + '═'.repeat(56));
    console.log('  📋  UPDATE REPORT');
    console.log('═'.repeat(56));
    console.log(`  Finished at : ${new Date().toLocaleString('zh-CN')}`);
    console.log(`  Elapsed     : ${elapsed}s`);
    console.log('─'.repeat(56));

    for (const item of report) {
        const icon = statusIcon[item.status] ?? '❓';
        console.log(`\n  ${icon} ${item.name}`);
        console.log(`     Before : ${item.before}`);
        console.log(`     After  : ${item.after}`);
        if (item.note) {
            console.log(`     Note   : ${item.note}`);
        }
    }

    console.log('\n' + '─'.repeat(56));
    const failed = report.filter(r => r.status === 'failed').length;
    const skipped = report.filter(r => r.status === 'skipped').length;
    const ok = report.filter(r => r.status === 'ok').length;
    console.log(`  Summary : ${ok} updated, ${skipped} skipped, ${failed} failed`);
    console.log('═'.repeat(56) + '\n');
}

main().catch(e => {
    console.error(`❌ ${e.message || e}`);
    process.exit(1);
});
