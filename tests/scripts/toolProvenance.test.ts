import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertImmutableArtifactUrl,
  verifyArtifactBuffer,
} from '../../scripts/lib/tool-provenance.mjs';

describe('trusted tool provenance', () => {
  it('accepts bytes only when they match the trusted SHA-256', () => {
    const bytes = new TextEncoder().encode('abc');
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

    expect(
      verifyArtifactBuffer(bytes, {
        label: 'fixture',
        expectedSha256: expected,
      }),
    ).toBe(expected);
  });

  it('rejects a digest mismatch before the artifact can be installed', () => {
    const bytes = new TextEncoder().encode('tampered');

    expect(() =>
      verifyArtifactBuffer(bytes, {
        label: 'fixture',
        expectedSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      }),
    ).toThrow(/SHA-256 mismatch/i);
  });

  it('rejects mutable release aliases', () => {
    expect(() =>
      assertImmutableArtifactUrl(
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
      ),
    ).toThrow(/mutable/i);

    expect(() =>
      assertImmutableArtifactUrl(
        'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
      ),
    ).toThrow(/mutable/i);

    expect(() =>
      assertImmutableArtifactUrl(
        'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe',
      ),
    ).not.toThrow();
  });

  it('wires the trusted manifest into release sidecar acquisition before install', () => {
    const releaseScript = readFileSync(resolve('scripts/prepare-release-sidecars.mjs'), 'utf8');

    expect(releaseScript).toContain('toolchain-manifest.json');
    expect(releaseScript).toContain('verifyArtifactBuffer');
    expect(releaseScript).toContain('ytDlpArtifact.url');
    expect(releaseScript).toContain('ffmpegArtifact.url');
    expect(releaseScript).toContain('bunArtifact.url');
    expect(releaseScript).not.toContain('latest/download/yt-dlp.exe');
    expect(releaseScript).not.toContain('ffmpeg-release-essentials.zip');
    expect(releaseScript).not.toContain('latest/download/bun-windows-x64.zip');
  });

  it('requires Bun and FFmpeg streamed downloads to verify before extracting or replacing', () => {
    const updaterSource = readFileSync(resolve('src-tauri/src/commands/updates.rs'), 'utf8');
    const bunStart = updaterSource.indexOf('async fn update_bun_impl');
    const ffmpegStart = updaterSource.indexOf('pub async fn update_ffmpeg');
    const ytdlpStart = updaterSource.indexOf('pub async fn update_ytdlp');
    const bunSource = updaterSource.slice(bunStart, ffmpegStart);
    const ffmpegSource = updaterSource.slice(ffmpegStart, ytdlpStart);

    expect(updaterSource).toContain('fetch_bun_windows_x64_sha256');
    expect(updaterSource).toContain('fetch_ffmpeg_windows_x64_sha256');

    for (const source of [bunSource, ffmpegSource]) {
      const verifyIndex = source.indexOf('download_verified_archive(&client, url, &zip_path, &expected_sha256).await?');
      const extractIndex = source.indexOf('expand_archive(&zip_path, &extract_dir)');
      const replaceIndex = source.indexOf('atomic_replace_files');

      expect(verifyIndex).toBeGreaterThanOrEqual(0);
      expect(extractIndex).toBeGreaterThan(verifyIndex);
      expect(replaceIndex).toBeGreaterThan(extractIndex);
    }
    expect(updaterSource).toContain('while let Some(chunk) = response.chunk().await?');
    expect(updaterSource).toContain('digest.update(&chunk)');
    expect(updaterSource).toContain('SHA-256 mismatch');
  });

  it('keeps archive extraction paths out of PowerShell source strings', () => {
    const updaterSource = readFileSync(resolve('src-tauri/src/commands/updates.rs'), 'utf8');
    const releaseScript = readFileSync(resolve('scripts/prepare-release-sidecars.mjs'), 'utf8');

    expect(updaterSource).not.toContain("Expand-Archive -Path '{}' -DestinationPath '{}' -Force");
    expect(updaterSource).toContain('$env:YTDL_FLOW_UPDATE_ZIP');
    expect(updaterSource).toContain('$env:YTDL_FLOW_UPDATE_EXTRACT');
    expect(updaterSource).toContain('tempfile::Builder');
    expect(updaterSource).not.toContain('join("bun_update.zip")');
    expect(updaterSource).not.toContain('join("ffmpeg_update.zip")');
    expect(releaseScript).not.toContain("Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force");
    expect(releaseScript).toContain('$env:YTDL_FLOW_UPDATE_ZIP');
    expect(releaseScript).toContain('$env:YTDL_FLOW_UPDATE_EXTRACT');
  });

  it('pins the Windows x64 release artifacts to exact versions and upstream digests', () => {
    const manifest = JSON.parse(
      readFileSync(resolve('src-tauri/toolchain-manifest.json'), 'utf8'),
    ) as {
      windowsX64: Record<
        string,
        { version: string; url?: string; sha256?: string }
      >;
    };

    expect(manifest.windowsX64['yt-dlp']).toEqual({
      version: '2026.08.19',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe',
      sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a',
    });

    expect(manifest.windowsX64.ffmpeg).toEqual({
      version: '9.0.2',
      url: 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip',
      sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
    });

    expect(manifest.windowsX64.bun).toEqual({
      version: '1.4.2',
      url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-windows-x64.zip',
      sha256: 'ce4c17497b2f29712a99d3d53f028de28cd42e3bacb8589599e7f000e49b6405',
    });

    expect(manifest.windowsX64['rustypipe-botguard']).toEqual({
      version: '0.1.2',
    });
  });
});
