import { invoke, type InvokeArgs } from '@tauri-apps/api/core';
import { downloadDir as getSystemDownloadDir } from '@tauri-apps/api/path';
import { listen, type UnlistenFn, type Event } from '@tauri-apps/api/event';
import { open as openDialog, type OpenDialogOptions } from '@tauri-apps/plugin-dialog';
import { open as openExternal } from '@tauri-apps/plugin-shell';

// Safe Tauri wrapper
export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const safeInvoke = async <T>(cmd: string, args?: InvokeArgs): Promise<T> => {
  if (!isTauri()) {
    console.debug(`[Web Mock] invoke('${cmd}')`, args);
    // Return mock values for critical startup commands
    if (cmd === 'get_app_version') return 'Web Preview' as unknown as T;
    if (cmd === 'check_dependencies') return true as unknown as T;
    if (cmd === 'check_zombie_processes') return 0 as unknown as T;
    if (cmd === 'inspect_tool_health') return { state: 'ready', zombieCount: 0 } as unknown as T;
    if (cmd === 'get_installed_browsers') return ['chrome', 'edge'] as unknown as T;
    if (cmd === 'get_binaries_info') {
      return { ytdlp: 'Web Preview', ffmpeg: 'Web Preview', bun: 'Web Preview' } as unknown as T;
    }
    if (cmd === 'check_browser_and_pot') {
      return { success: true, browser: 'edge', cookies_ok: true, pot_ok: true, message: '已成功从 Edge 获取登录态并就绪 PO Token' } as unknown as T;
    }
    return undefined as unknown as T;
  }
  return invoke(cmd, args);
};

export const safeGetSystemDownloadDir = async (): Promise<string | null> => {
  if (!isTauri()) return null;
  return getSystemDownloadDir();
};

export const safeListen = async <T>(event: string, handler: (event: Event<T>) => void): Promise<UnlistenFn> => {
  if (!isTauri()) {
    console.debug(`[Web Mock] listen('${event}')`);
    return () => {};
  }
  return listen<T>(event, handler);
};

export const safeOpenDialog = async (options: OpenDialogOptions): Promise<string | string[] | null> => {
  if (!isTauri()) {
    alert('Web Mode: Cannot open system dialog');
    return null;
  }
  return openDialog(options);
};

export const safeOpenExternal = async (url: string): Promise<void> => {
  if (!isTauri()) {
    window.open(url, '_blank');
    return;
  }
  return openExternal(url);
};
