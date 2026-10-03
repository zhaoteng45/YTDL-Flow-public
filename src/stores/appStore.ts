import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import {
  safeInvoke,
  safeGetSystemDownloadDir,
  safeOpenDialog as safeOpen,
  safeOpenExternal,
} from '../utils/tauri';
import { THEMES, type AppTheme } from '../constants';
import { appStorage, STORAGE_KEYS } from '../utils/storage';
import { createToolchainOperations } from '../application/toolchainOperations';
import { createNotificationOperations } from '../application/notificationOperations';
import { createCredentialOperations } from '../application/credentialOperations';
import { createAppUpdateOperations } from '../application/appUpdateOperations';
import { createDesktopFileOperations } from '../application/desktopFileOperations';
import { resolveExtraArgsForUrl, type CredentialPlatform, type PlatformCookieProfiles } from '../application/platformCredentials';
import type { ExtraArgs } from '../types';
import { resolveQualitySettings } from '../application/qualitySettings';

const loadExtraArgs = (): ExtraArgs => {
  const saved = appStorage.get<Partial<ExtraArgs>>(STORAGE_KEYS.EXTRA_ARGS, {});
  return resolveQualitySettings(saved).settings;
};

const nativeInvoke = <T>(command: string, args?: Record<string, unknown>) =>
  safeInvoke<T>(command, args);

const toolchain = createToolchainOperations(nativeInvoke);
const notifications = createNotificationOperations({
  invoke: nativeInvoke,
  isPermissionGranted,
  requestPermission,
});
const credentials = createCredentialOperations(nativeInvoke);
const desktopFiles = createDesktopFileOperations({
  openDialog: safeOpen,
  openExternal: safeOpenExternal,
  getSystemDownloadDir: safeGetSystemDownloadDir,
  invoke: nativeInvoke,
});
const appUpdater = createAppUpdateOperations({
  check: async () => {
    const update = await check();
    if (update === null) return null;
    return {
      version: update.version,
      downloadAndInstall: (listener) => update.downloadAndInstall((event) => {
        listener({
          event: event.event,
          data: event.event === 'Started' ? { contentLength: event.data.contentLength } : {},
        });
      }),
    };
  },
  relaunch,
});

export const useAppStore = defineStore('app', () => {
  // ---- 设置与全局状态（任务生命周期由 CurrentTaskRuntime 独占） ----
  const dependenciesInstalled = ref(true);
  const appVersion = ref<string>('');

  const downloadDir = ref<string | null>(appStorage.getString(STORAGE_KEYS.DOWNLOAD_DIR));
  const systemDownloadDir = ref<string | null>(null);

  const extraArgs = ref<ExtraArgs>(loadExtraArgs());
  const legacyCodecPreferences = ref(resolveQualitySettings(extraArgs.value, appStorage.get<number>(STORAGE_KEYS.QUALITY_PREFERENCES_VERSION, 0)).needsCodecConfirmation);
  const confirmCodecPreferences = () => {
    legacyCodecPreferences.value = false;
    // Schema provenance, not a codec override or a configurable numerical limit.
    appStorage.set(STORAGE_KEYS.QUALITY_PREFERENCES_VERSION, 3);
  };
  watch([() => extraArgs.value.videoCodec, () => extraArgs.value.audioCodec], confirmCodecPreferences);
  const savedPlatformCookies = appStorage.get<PlatformCookieProfiles>(STORAGE_KEYS.PLATFORM_COOKIES, {});
  const platformCookies = ref<PlatformCookieProfiles>({ ...savedPlatformCookies });
  if (!platformCookies.value.youtube && !platformCookies.value.bilibili) {
    const legacyCookies = extraArgs.value.cookies?.trim();
    if (legacyCookies) {
      if (legacyCookies.toLowerCase().includes('bilibili_cookies')) {
        platformCookies.value.bilibili = legacyCookies;
      } else {
        platformCookies.value.youtube = legacyCookies;
      }
    }
  }

  const setPlatformCookie = (platform: CredentialPlatform, value: string) => {
    const normalized = value.trim();
    const next = { ...platformCookies.value };
    if (normalized) next[platform] = normalized;
    else delete next[platform];
    platformCookies.value = next;
  };
  const clearPlatformCookie = (platform: CredentialPlatform) => setPlatformCookie(platform, '');
  const getExtraArgsForUrl = (url: string): ExtraArgs =>
    resolveExtraArgsForUrl(extraArgs.value, platformCookies.value, url);

  const getBilibiliUserProfile = () =>
    appStorage.get<{ uname: string; face: string } | null>(STORAGE_KEYS.BILI_USER_INFO, null);
  const setBilibiliUserProfile = (profile: { uname: string; face: string }) =>
    appStorage.set(STORAGE_KEYS.BILI_USER_INFO, profile);
  const clearBilibiliUserProfile = () =>
    appStorage.remove(STORAGE_KEYS.BILI_USER_INFO);

  const theme = ref<AppTheme>(THEMES.MATERIAL);

  const applyTheme = (saveToStorage = true) => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      Object.values(THEMES).forEach((t) => {
        root.classList.remove(`${t}-theme`);
      });
      root.removeAttribute('data-theme');
      root.classList.add(`${theme.value}-theme`);
      root.setAttribute('data-theme', theme.value);
    }
    if (saveToStorage) {
      appStorage.set(STORAGE_KEYS.THEME, theme.value);
    }
  };

  const toggleTheme = () => {
    const modes = [THEMES.COBALT_BUTTER, THEMES.FLUENT, THEMES.MATERIAL] as const;
    const nextIndex = (modes.indexOf(theme.value) + 1) % modes.length;
    theme.value = modes[nextIndex];
    applyTheme(true);
  };

  const setTheme = (newTheme: AppTheme) => {
    theme.value = newTheme;
    applyTheme(true);
  };

  const initTheme = () => {
    const saved = appStorage.getString(STORAGE_KEYS.THEME);
    const validThemes = Object.values(THEMES) as string[];

    if (saved && validThemes.includes(saved)) {
      theme.value = saved as AppTheme;
    } else {
      theme.value = THEMES.MATERIAL;
    }

    // Persist the normalized value so removed legacy themes migrate once.
    applyTheme(true);
  };

  // ---- 目录 ----
  const initPaths = async () => {
    try {
      const dir = await desktopFiles.getSystemDownloadDirectory();
      systemDownloadDir.value = dir;
    } catch (e) {
      console.error('Failed to get system download dir:', e);
    }
  };

  watch(extraArgs, (newVal) => {
    appStorage.set(STORAGE_KEYS.EXTRA_ARGS, newVal);
  }, { deep: true });

  watch(platformCookies, (newVal) => {
    appStorage.set(STORAGE_KEYS.PLATFORM_COOKIES, newVal);
  }, { deep: true });

  const checkDependencies = async () => {
    try {
      try {
        const zombieCount = await toolchain.checkZombieProcesses();
        if (zombieCount > 0) {
          console.warn(`Found ${zombieCount} orphaned yt-dlp processes.`);
        }
      } catch (e) {
        console.warn('Failed to check zombies:', e);
      }

      const ok = await toolchain.checkDependencies();
      dependenciesInstalled.value = ok;

      try {
        const v = await toolchain.getAppVersion();
        appVersion.value = v;
      } catch (e) {
        console.warn('Failed to get app version:', e);
      }
    } catch (e) {
      console.error('Failed to check dependencies:', e);
      dependenciesInstalled.value = false;
    }
  };

  const setDownloadDir = (dir: string | null) => {
    downloadDir.value = dir;
    if (dir) {
      appStorage.set(STORAGE_KEYS.DOWNLOAD_DIR, dir);
    } else {
      appStorage.remove(STORAGE_KEYS.DOWNLOAD_DIR);
    }
  };

  const chooseDownloadDir = async (title = '选择下载目录') => {
    try {
      const selected = await desktopFiles.chooseDownloadDirectory(
        title,
        downloadDir.value || undefined,
      );
      if (selected) setDownloadDir(selected);
    } catch (e) {
      console.error('Failed to choose directory:', e);
      throw e;
    }
  };

  // ---- 文件 / 文件夹打开（需要目录知识，留在 adapter） ----
  const openFile = async (path?: string) => {
    if (!path) {
      throw new Error('No downloaded file path is available');
    }
    const baseDir = downloadDir.value || systemDownloadDir.value || undefined;
    try {
      await desktopFiles.openFile(path, baseDir);
    } catch (e) {
      console.error('Open file failed:', e);
      throw e;
    }
  };

  const openFolder = async (path?: string) => {
    const targetPath = path || '.';
    const baseDir = downloadDir.value || systemDownloadDir.value || undefined;
    try {
      await desktopFiles.openFileLocation(targetPath, baseDir);
    } catch (e) {
      console.error('Open folder failed:', e);
      throw e;
    }
  };

  return {
    // 状态
    dependenciesInstalled,
    appVersion,
    downloadDir,
    systemDownloadDir,
    extraArgs,
    legacyCodecPreferences,
    confirmCodecPreferences,
    platformCookies,
    setPlatformCookie,
    clearPlatformCookie,
    getExtraArgsForUrl,
    theme,
    // 目录 / 系统
    checkDependencies,
    checkZombieProcesses: toolchain.checkZombieProcesses,
    inspectToolHealth: toolchain.inspectHealth,
    killZombieProcesses: toolchain.killZombieProcesses,
    getBinariesInfo: toolchain.getBinariesInfo,
    updateTool: toolchain.updateTool,
    getNotificationPermission: notifications.getPermissionStatus,
    requestNotificationPermission: notifications.requestPermission,
    getNotificationSettings: notifications.getSettings,
    updateNotificationSettings: notifications.updateSettings,
    initNotificationI18n: notifications.initI18n,
    getInstalledBrowsers: credentials.getInstalledBrowsers,
    checkBrowserCookies: credentials.checkBrowserCookies,
    inspectCookieFile: credentials.inspectCookieFile,
    getBilibiliQrCode: credentials.getBilibiliQrCode,
    pollBilibiliQrCode: credentials.pollBilibiliQrCode,
    saveBilibiliCookies: credentials.saveBilibiliCookies,
    getBilibiliUserInfo: credentials.getBilibiliUserInfo,
    getBilibiliUserProfile,
    setBilibiliUserProfile,
    clearBilibiliUserProfile,
    runAppUpdate: appUpdater.run,
    chooseCookieFile: desktopFiles.chooseCookieFile,
    openExternalUrl: desktopFiles.openExternalUrl,
    setDownloadDir,
    chooseDownloadDir,
    openFile,
    openFolder,
    initPaths,
    // 主题
    toggleTheme,
    setTheme,
    initTheme,
  };
});
