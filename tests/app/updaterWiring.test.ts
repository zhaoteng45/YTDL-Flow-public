import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const libSource = readFileSync(resolve('src-tauri/src/lib.rs'), 'utf8');
const capabilitiesSource = readFileSync(resolve('src-tauri/capabilities/default.json'), 'utf8');
const tauriConf = readFileSync(resolve('src-tauri/tauri.conf.json'), 'utf8');
const settingsSource = readFileSync(resolve('src/components/SettingsPanel.vue'), 'utf8');
const storeSource = readFileSync(resolve('src/stores/appStore.ts'), 'utf8');
const updateOperationsSource = readFileSync(resolve('src/application/appUpdateOperations.ts'), 'utf8');
const zhSource = readFileSync(resolve('src/locales/zh-CN.json'), 'utf8');
const enSource = readFileSync(resolve('src/locales/en-US.json'), 'utf8');
const workflowSource = readFileSync(resolve('.github/workflows/release.yml'), 'utf8');

describe('app self-update wiring', () => {
  it('registers updater and process plugins with matching capabilities', () => {
    expect(libSource).toMatch(/tauri_plugin_updater::Builder::new\(\)\.build\(\)/);
    expect(libSource).toMatch(/tauri_plugin_process::init\(\)/);
    expect(capabilitiesSource).toMatch(/"updater:default"/);
    expect(capabilitiesSource).toMatch(/"process:default"/);
  });

  it('points the updater at signed GitHub release artifacts', () => {
    expect(tauriConf).toMatch(/"createUpdaterArtifacts":\s*true/);
    expect(JSON.parse(tauriConf).plugins.updater.endpoints).toEqual([
      'https://github.com/zhaoteng45/YTDL-Flow-public/releases/latest/download/latest.json',
    ]);
    expect(tauriConf).toMatch(/"pubkey":\s*"[A-Za-z0-9+/=]{100,}"/);
  });

  it('keeps updater/process native details behind the application seam', () => {
    expect(settingsSource).toMatch(/store\.runAppUpdate/);
    expect(settingsSource).not.toMatch(/@tauri-apps\/plugin-updater/);
    expect(settingsSource).not.toMatch(/@tauri-apps\/plugin-process/);
    expect(settingsSource).not.toMatch(/downloadAndInstall/);
    expect(storeSource).toMatch(/@tauri-apps\/plugin-updater/);
    expect(storeSource).toMatch(/@tauri-apps\/plugin-process/);
    expect(updateOperationsSource).toMatch(/downloadAndInstall/);
    expect(updateOperationsSource).toMatch(/deps\.relaunch\(\)/);
  });

  it('keeps app_update strings in sync across locales', () => {
    for (const key of [
      'check_btn',
      'checking',
      'latest',
      'downloading',
      'progress',
      'restarting',
      'failed',
    ]) {
      expect(zhSource).toMatch(new RegExp(`"${key}"`));
      expect(enSource).toMatch(new RegExp(`"${key}"`));
    }
  });

  it('signs release artifacts in CI', () => {
    expect(workflowSource).toMatch(/TAURI_SIGNING_PRIVATE_KEY:\s*\$\{\{\s*secrets\.TAURI_SIGNING_PRIVATE_KEY\s*\}\}/);
  });
});
