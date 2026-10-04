import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const commands = readFileSync(resolve('src-tauri/src/commands.rs'), 'utf8');
const updates = readFileSync(resolve('src-tauri/src/commands/updates.rs'), 'utf8');
const browsers = readFileSync(resolve('src-tauri/src/commands/browsers.rs'), 'utf8');
const dependencies = readFileSync(resolve('src-tauri/src/commands/dependencies.rs'), 'utf8');
const system = readFileSync(resolve('src-tauri/src/commands/system.rs'), 'utf8');
const service = readFileSync(resolve('src-tauri/src/services/download.rs'), 'utf8');
const tauriConfig = JSON.parse(readFileSync(resolve('src-tauri/tauri.conf.json'), 'utf8')) as {
  app?: { security?: { csp?: string } };
};
const capabilities = readFileSync(resolve('src-tauri/capabilities/default.json'), 'utf8');

describe('native media-tool safety contracts', () => {
  it('reserves smoke tool activity before the frontend can inspect tools and holds it through the run', () => {
    const startup = readFileSync(resolve('src-tauri/src/lib.rs'), 'utf8');
    const smoke = readFileSync(resolve('src-tauri/src/release_smoke.rs'), 'utf8');
    const reservation = startup.indexOf('let smoke_activity = if smoke_request.is_some()');
    expect(reservation).toBeGreaterThan(0);
    expect(reservation).toBeLessThan(startup.indexOf('tauri::Builder::default()'));
    expect(startup).toContain('release_smoke::run(handle, request_file, activity)');
    expect(smoke).toMatch(/pub async fn run\([\s\S]*?_activity: ToolActivityGuard/);
    expect(smoke).not.toContain('registry.begin_tool_activity()?');
  });
  it('never kills yt-dlp or ffmpeg globally by image name', () => {
    expect(commands).not.toMatch(/taskkill[\s\S]{0,240}\/IM/);
    expect(commands).toMatch(/ExecutablePath/);
    expect(commands).toMatch(/\/PID/);
    expect(commands).toMatch(/begin_tool_mutation/);
  });

  it('allows HTTPS thumbnails in the native CSP without opening broader resource classes', () => {
    const csp = tauriConfig.app?.security?.csp ?? '';
    expect(csp).toMatch(/img-src[^;]*\bhttps:\s+asset:/);
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).not.toMatch(/default-src[^;]*https:/);
    expect(csp).not.toMatch(/script-src[^;]*https:/);
    expect(csp).not.toMatch(/connect-src/);
  });

  it('does not grant frontend WebView arbitrary shell execute permission', () => {
    expect(capabilities).not.toContain('"shell:allow-execute"');
    expect(capabilities).toContain('"shell:allow-open"');
  });

  it('serializes every binary update behind the exclusive tool-mutation guard', () => {
    expect((updates.match(/begin_tool_mutation\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('registers tool activity around all bundled executable consumers', () => {
    expect(commands).toMatch(/get_video_metadata[\s\S]*?begin_tool_activity/);
    expect(commands).toMatch(/start_download[\s\S]*?begin_tool_activity/);
    expect(browsers).toMatch(/check_browser_cookies[\s\S]*?begin_tool_activity/);
    expect(browsers).toMatch(/check_browser_and_pot[\s\S]*?begin_tool_activity/);
    expect(dependencies).toMatch(/check_dependencies[\s\S]*?begin_tool_activity/);
    expect(system).toMatch(/get_binaries_info[\s\S]*?begin_tool_activity/);
    expect(service).toMatch(/sidecar\("yt-dlp"\)/);
  });
});
