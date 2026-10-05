import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ciWorkflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
const verifierPath = resolve('scripts/verify-windows-msi-install.ps1');
const verifier = existsSync(verifierPath) ? readFileSync(verifierPath, 'utf8') : '';

function jobBlock(jobName: string, nextJobName?: string): string {
  const start = ciWorkflow.indexOf(`  ${jobName}:`);
  if (start < 0) return '';
  if (!nextJobName) return ciWorkflow.slice(start);
  const end = ciWorkflow.indexOf(`  ${nextJobName}:`, start + 1);
  return end < 0 ? ciWorkflow.slice(start) : ciWorkflow.slice(start, end);
}

describe('TICKET-014 Windows Install Trust contract', () => {
  const packagingSmoke = jobBlock('desktop-packaging-smoke', 'windows-install-trust');
  const installTrust = jobBlock('windows-install-trust');

  it('uses real install trust without a duplicate mock installer build', () => {
    expect(packagingSmoke).toBe('');

    expect(installTrust).toContain('name: Windows Install Trust');
    expect(installTrust).not.toContain('Mock Sidecars');
  });

  it('makes install trust prepare release-equivalent Windows x64 sidecars', () => {
    expect(installTrust).toContain('targets: x86_64-pc-windows-msvc');
    expect(installTrust).toContain(
      'bun scripts/prepare-release-sidecars.mjs --target x86_64-pc-windows-msvc',
    );
    expect(installTrust).toContain(
      'bun scripts/setup-sidecars.mjs --target x86_64-pc-windows-msvc',
    );
  });

  it('makes install trust build its own MSI and invoke the verifier', () => {
    expect(installTrust).toContain(
      'pwsh -NoProfile -File scripts/build-release-installer.ps1',
    );
    expect(installTrust).not.toContain('tauri:build -- --help');
    expect(installTrust).toContain(
      'pwsh -NoProfile -NonInteractive -File scripts/verify-windows-msi-install.ps1',
    );
    expect(installTrust).not.toContain('continue-on-error: true');
  });

  it('uploads install-trust diagnostics without making artifact upload the gate', () => {
    expect(installTrust).toContain('actions/upload-artifact@v4');
    expect(installTrust).toContain('if: always()');
    expect(installTrust).toContain('windows-install-trust-logs');
  });

  it('keeps installer binaries out of public CI diagnostics', () => {
    const upload = installTrust.slice(installTrust.indexOf('      - name: Upload Install-Trust Diagnostics'));
    expect(upload).toContain('ytdl-flow-install-trust/*.log');
    expect(upload).toContain('ytdl-flow-install-trust/*.json');
    expect(upload).not.toContain('release/bundle/msi/*.msi');
  });

  it('has a fail-closed MSI install verifier', () => {
    expect(existsSync(verifierPath)).toBe(true);
    expect(verifier).toContain('msiexec.exe');
    expect(verifier).toContain('/i');
    expect(verifier).toContain('/x');
    expect(verifier).toContain('/qn');
    expect(verifier).toContain('/norestart');
    expect(verifier).toContain('ProductCode');
    expect(verifier).toContain('ProductVersion');
    expect(verifier).toContain('$InstallStateUnknown = -1');
    expect(verifier).toContain('MsiQueryProductState');
    expect(verifier).toContain('[System.Diagnostics.ProcessStartInfo]::new()');
    expect(verifier).toContain('.ArgumentList.Add(');
    expect(verifier).toContain('.WaitForExit()');
    expect(verifier).toContain('.ExitCode');
    expect(verifier).not.toContain('$LASTEXITCODE');
    expect(verifier).toContain('Get-MsiFileSize');
    expect(verifier).toContain('FileSize');
    expect(verifier).toContain("if ($item.relative -eq 'yt-dlp-cool.exe')");
    expect(verifier).toContain('Get-FileHash');
    expect(verifier).toContain('yt-dlp-cool.exe');
    expect(verifier).toContain('yt-dlp.exe');
    expect(verifier).toContain('ffmpeg.exe');
    expect(verifier).toContain('ffprobe.exe');
    expect(verifier).toContain('bun.exe');
    expect(verifier).toContain('rustypipe-botguard.exe');
    expect(verifier).toContain('yt_dlp_get_pot_rustypipe.py');
    expect(verifier).not.toContain('Win32_Product');
  });

  it('keeps CI install trust separate from Native Human Gate claims', () => {
    expect(installTrust).not.toMatch(/human.?gate/i);
    expect(verifier).not.toMatch(/human.?gate/i);
  });
});
