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
import { createCredentialOperations, type CookieFileInspection } from '../application/credentialOperations';
import { createAppUpdateOperations } from '../application/appUpdateOperations';
import { createDesktopFileOperations } from '../application/desktopFileOperations';
import {
  CREDENTIAL_PLATFORMS,
  detectCredentialPlatform,
  PLATFORM_CANONICAL_URL,
  migrateLegacyPlatformConfigs,
  inferLegacySourceKind,
  normalizePlatformCookieProfiles,
  normalizePlatformCredentialConfigs,
  resolveEffectivePlatformSource,
  resolveExtraArgsForUrl,
  resolveYouTubeAnalysisInputs,
  validateFrozenYouTubeCookieFile,
  updatePlatformBackupFile,
  type CredentialPlatform,
  type PlatformCookieProfiles,
  type PlatformCredentialConfigs,
  type PlatformFileImportResult,
} from '../application/platformCredentials';
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
  const platformCookies = ref<PlatformCookieProfiles>(
    normalizePlatformCookieProfiles(appStorage.get<unknown>(STORAGE_KEYS.PLATFORM_COOKIES, {})),
  );
  // Single source owner: explicit preferred/backup/authorization config.
  const platformCredentialConfigs = ref<PlatformCredentialConfigs>(
    migrateLegacyPlatformConfigs(
      normalizePlatformCredentialConfigs(appStorage.get<unknown>(STORAGE_KEYS.PLATFORM_CREDENTIALS, {})),
      platformCookies.value,
      extraArgs.value.cookies,
    ),
  );
  // Keep the legacy string view coherent for the existing SettingsPanel until its next phase.
  for (const platform of CREDENTIAL_PLATFORMS) {
    const preferred = platformCredentialConfigs.value[platform]?.preferred;
    if (preferred && (preferred.kind === 'browser' || preferred.kind === 'file') && preferred.ref) {
      platformCookies.value[platform] = preferred.ref;
    }
  }

  const persistPlatformConfig = (
    platform: CredentialPlatform,
    config: PlatformCredentialConfigs[CredentialPlatform],
  ) => {
    platformCredentialConfigs.value = { ...platformCredentialConfigs.value, [platform]: config };
  };

  // Compatibility adapter for SettingsPanel until the next phase. It writes the
  // legacy string view and the explicit source model from the same decision.
  const credentialEpochs: Record<CredentialPlatform, number> = { youtube: 0, bilibili: 0 };
  const setPlatformCookie = (platform: CredentialPlatform, value: string) => {
    credentialEpochs[platform]++;
    const normalized = value.trim();
    const nextProfiles = { ...platformCookies.value };
    if (normalized) nextProfiles[platform] = normalized;
    else delete nextProfiles[platform];
    platformCookies.value = nextProfiles;
    persistPlatformConfig(
      platform,
      normalized
        ? {
            ...platformCredentialConfigs.value[platform],
            preferred: { kind: inferLegacySourceKind(normalized), ref: normalized },
          }
        : { preferred: { kind: 'none' } },
    );
  };

  // Disconnect clears the platform's preferred/backup/authorization and records an
  // explicit `none` so old globals cannot resurrect on reload.
  const clearPlatformCookie = (platform: CredentialPlatform) => setPlatformCookie(platform, '');

  const getPlatformCredentialConfig = (platform: CredentialPlatform) =>
    platformCredentialConfigs.value[platform];

  const getEffectivePlatformSource = (platform: CredentialPlatform) =>
    resolveEffectivePlatformSource(platform, platformCredentialConfigs.value, platformCookies.value);

  const importPlatformCookieFile = async (
    platform: CredentialPlatform,
    filePath: string,
    isCurrent: () => boolean = () => true,
  ): Promise<PlatformFileImportResult> => {
    const epoch = ++credentialEpochs[platform];
    const normalized = filePath.trim();
    if (!normalized) return { ok: false, state: 'unreadable' };
    let inspection: CookieFileInspection;
    try {
      inspection = await credentials.inspectCookieFile(normalized, PLATFORM_CANONICAL_URL[platform]);
    } catch {
      return { ok: false, state: 'unreadable' };
    }
    if (epoch !== credentialEpochs[platform] || !isCurrent()) return { ok: false, state: 'unreadable' };
    if (inspection.state !== 'imported') {
      // Reject invalid/expired/mismatch without changing the existing config.
      return { ok: false, state: inspection.state };
    }
    platformCookies.value = { ...platformCookies.value, [platform]: normalized };
    persistPlatformConfig(platform, {
      ...platformCredentialConfigs.value[platform],
      preferred: { kind: 'file', ref: normalized },
    });
    return { ok: true, state: 'imported' };
  };

  const setPlatformBackupFile = (
    platform: CredentialPlatform,
    filePath: string,
    authorized?: boolean,
  ) => {
    credentialEpochs[platform]++;
    const current = platformCredentialConfigs.value[platform];
    const next = updatePlatformBackupFile(current, filePath, authorized === true);
    if (authorized === false && next.backup) {
      next.backup = { ...next.backup, authorized: false };
    }
    persistPlatformConfig(platform, next);
  };

  const getExtraArgsForUrl = (url: string): ExtraArgs =>
    resolveExtraArgsForUrl(
      extraArgs.value,
      platformCookies.value,
      url,
      platformCredentialConfigs.value,
    );

  const resolveAnalysisExtraArgs = (url: string, isCurrent: () => boolean = () => true) => {
    // No check result writes preferences. An in-flight attempt owns this copy,
    // even when the user changes or disconnects the platform meanwhile.
    const args = getExtraArgsForUrl(url);
    if (detectCredentialPlatform(url) !== 'youtube') return Promise.resolve({ extraArgs: args });
    const source = { ...getEffectivePlatformSource('youtube') };
    const configuredBackup = platformCredentialConfigs.value.youtube?.backup;
    const backup = configuredBackup ? { ...configuredBackup } : undefined;
    return resolveYouTubeAnalysisInputs(args, source, backup, credentials, isCurrent);
  };

  const validateDownloadCredential = (request: import('../../packages/contracts/src').DownloadStartRequest) =>
    validateFrozenYouTubeCookieFile(request, credentials);

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

  watch(platformCredentialConfigs, (newVal) => {
    appStorage.set(STORAGE_KEYS.PLATFORM_CREDENTIALS, newVal);
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
    platformCredentialConfigs,
    setPlatformCookie,
    clearPlatformCookie,
    getPlatformCredentialConfig,
    getEffectivePlatformSource,
    importPlatformCookieFile,
    setPlatformBackupFile,
    getExtraArgsForUrl,
    resolveAnalysisExtraArgs,
    validateDownloadCredential,
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
