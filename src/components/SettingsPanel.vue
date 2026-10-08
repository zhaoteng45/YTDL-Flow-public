<script setup lang="ts">
import { toRefs, ref, watch, reactive, computed, nextTick, onMounted, onUnmounted, useId, useTemplateRef } from 'vue';
import { useClipboard } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '../stores/appStore';
import { APP_SELF_UPDATE_ENABLED } from '../constants';

import QRCode from 'qrcode';
import NeoIcon from './NeoIcon.vue';
import { useFilenameSettings } from './settingsPanel.filename';
import { createToolOperationQueue, toolVersionDisplay } from './settingsPanel.tools';
import type { PlatformConnectionEntry } from '../application/platformCredentials';

const store = useAppStore();
const runToolOperation = createToolOperationQueue();
const { t } = useI18n();
const props = defineProps<{ connectionEntry?: PlatformConnectionEntry }>();
const emit = defineEmits<{ close: [] }>();
let disposed = false;
const { extraArgs, platformCookies } = toRefs(store);
const needsCodecConfirmation = computed(() => store.legacyCodecPreferences);
const useAutomaticCodecs = () => {
    extraArgs.value.videoCodec = 'auto';
    extraArgs.value.audioCodec = 'auto';
};

const commonLanguages = computed(() => [
    { code: 'zh-Hans', label: t('settings.languages.zh_hans') },
    { code: 'en', label: t('settings.languages.en') },
]);

const selectedLangs = ref<string[]>([]);

// Cookies State
const cookieMode = ref<'none' | 'browser' | 'file'>('none');
const browserOptions = ref<{ value: string; label: string }[]>([]);
const detectedBrowsers = ref<string[]>([]);
const selectedBrowser = ref('chrome');
const cookieFile = ref('');
const youtubeAuthStatus = ref<{ success: boolean; message: string } | null>(null);
const userInfo = ref<{ uname: string; face: string } | null>(null);

// Zombie Check
const zombieCount = ref(0);
const zombieCheckState = ref<'checking' | 'ready' | 'busy' | 'error'>('checking');
const activeToolOperations = ref(0);
const zombieHealthStatus = ref('');
let zombieRecheckTimer: ReturnType<typeof setTimeout> | null = null;

const checkZombies = async () => {
    zombieCheckState.value = 'checking';
    zombieHealthStatus.value = '';
    try {
        const health = await runToolOperation('health', () => store.inspectToolHealth());
        if (health.state === 'busy') {
            activeToolOperations.value = health.activeOperations;
            zombieCheckState.value = 'busy';
            return;
        }
        zombieCount.value = health.zombieCount;
        zombieCheckState.value = 'ready';
    } catch (err) {
        console.error('Failed to check zombies', err);
        zombieCheckState.value = 'error';
        zombieHealthStatus.value = t('settings.health.check_failed', { error: String(err) });
    }
};

const killZombies = async () => {
    if (zombieCheckState.value !== 'ready' || anyToolUpdating.value) return;
    zombieCheckState.value = 'checking';
    zombieHealthStatus.value = '';
    try {
        await runToolOperation('cleanup', () => store.killZombieProcesses());
        zombieCheckState.value = 'checking';
        if (zombieRecheckTimer) clearTimeout(zombieRecheckTimer);
        zombieRecheckTimer = setTimeout(() => {
            zombieRecheckTimer = null;
            void checkZombies();
        }, 500);
    } catch (err) {
        console.error('Failed to kill zombies', err);
        zombieCheckState.value = 'error';
        zombieHealthStatus.value = t('settings.health.clean_failed', { error: String(err) });
    }
};

// Notification Settings
interface NotificationSettings {
    enabled: boolean;
    onSuccess: boolean;
    onError: boolean;
    onCancel: boolean;
}

const notificationSettings = reactive<NotificationSettings>({
    enabled: true,
    onSuccess: true,
    onError: true,
    onCancel: false
});

const permissionGranted = ref<boolean | null>(null);
const notificationStatus = ref<{ success: boolean; message: string } | null>(null);
const notificationSettingsLoaded = ref(false);

// Check permission status
const checkNotificationPermission = async () => {
    try {
        permissionGranted.value = await store.getNotificationPermission();
    } catch (e) {
        console.error('Failed to check notification permission', e);
        permissionGranted.value = null;
        notificationStatus.value = {
            success: false,
            message: t('settings.notifications.permission_check_failed'),
        };
    }
};

const persistNotificationSettings = async (rollback?: NotificationSettings) => {
    try {
        await store.updateNotificationSettings({ ...notificationSettings });
        notificationStatus.value = null;
        return true;
    } catch (e) {
        console.error('Failed to persist notification settings', e);
        if (rollback) {
            Object.assign(notificationSettings, rollback);
        }
        notificationStatus.value = {
            success: false,
            message: t('settings.notifications.save_failed'),
        };
        return false;
    }
};

// Request permission and toggle notifications
const toggleNotifications = async (enabled: boolean) => {
    const rollback = { ...notificationSettings };
    notificationStatus.value = null;

    if (enabled) {
        let granted = permissionGranted.value;

        if (!granted) {
            try {
                granted = await store.requestNotificationPermission();
            } catch (e) {
                console.error('Failed to request permission', e);
                granted = false;
            }
        }

        if (!granted) {
            Object.assign(notificationSettings, rollback);
            notificationStatus.value = {
                success: false,
                message: t('settings.notifications.permission_denied'),
            };
            return;
        }
    }

    notificationSettings.enabled = enabled;
    await persistNotificationSettings(rollback);
};

const updateNotificationPreference = async (
    key: 'onSuccess' | 'onError' | 'onCancel',
    enabled: boolean,
) => {
    const rollback = { ...notificationSettings };
    notificationSettings[key] = enabled;
    await persistNotificationSettings(rollback);
};

const handleNotificationPreferenceChange = (
    key: 'onSuccess' | 'onError' | 'onCancel',
    event: Event,
) => {
    const input = event.target as HTMLInputElement | null;
    if (!input) return;
    void updateNotificationPreference(key, input.checked);
};

// Load settings from backend
const loadNotificationSettings = async () => {
    notificationSettingsLoaded.value = false;
    try {
        const settings = await store.getNotificationSettings();
        Object.assign(notificationSettings, settings);
        notificationSettingsLoaded.value = true;
    } catch (e) {
        console.error('Failed to load notification settings', e);
        notificationSettingsLoaded.value = false;
        notificationStatus.value = {
            success: false,
            message: t('settings.notifications.load_failed'),
        };
    }
};

const fetchBrowsers = async () => {
    try {
        const detected = await store.getInstalledBrowsers();
        detectedBrowsers.value = detected || [];
        // Full list of yt-dlp supported browsers
        const supported = ['chrome', 'firefox', 'edge', 'brave', 'opera', 'vivaldi', 'chromium', 'safari'];

        // Merge detected with supported (ensure all supported are listed, prioritize detected)
        const unique = Array.from(new Set([...(detected || []), ...supported]));

        // Sort: Detected first, then others
        unique.sort((a, b) => {
            const aDetected = detected?.includes(a);
            const bDetected = detected?.includes(b);
            if (aDetected && !bDetected) return -1;
            if (!aDetected && bDetected) return 1;
            return a.localeCompare(b);
        });

        browserOptions.value = unique.map(b => ({
            value: b,
            label: b.charAt(0).toUpperCase() + b.slice(1) + (detected?.includes(b) ? t('settings.browser.detected_suffix') : '')
        }));
    } catch (err) {
        console.error('Failed to fetch browsers', err);
        // Fallback
        browserOptions.value = ['chrome', 'edge', 'chromium', 'firefox'].map(b => ({
            value: b,
            label: b.charAt(0).toUpperCase() + b.slice(1)
        }));
    }
};

const initCookiesState = () => {
    const val = platformCookies.value.youtube?.trim();
    if (!val) {
        if (cookieMode.value !== 'none') cookieMode.value = 'none';
        return;
    }

    const browsers = browserOptions.value.map(b => b.value);
    if (browsers.includes(val.toLowerCase())) {
        if (cookieMode.value !== 'browser') cookieMode.value = 'browser';
        if (selectedBrowser.value !== val.toLowerCase()) selectedBrowser.value = val.toLowerCase();
    } else {
        if (cookieMode.value !== 'file') cookieMode.value = 'file';
        if (cookieFile.value !== val) cookieFile.value = val;
    }
};
initCookiesState();

const binariesInfo = ref({ ytdlp: 'Unknown', ffmpeg: 'Unknown', bun: 'Unknown' });
const binariesLoadState = ref<'loading' | 'ready' | 'error'>('loading');
const isUpdatingBinaries = reactive({ ytdlp: false, ffmpeg: false, bun: false });
const anyToolUpdating = computed(() => Object.values(isUpdatingBinaries).some(Boolean));
const toolUpdateStatus = ref('');
const toolUpdateFailed = ref(false);
const toolVersions = computed(() => ({
    ytdlp: toolVersionDisplay(binariesInfo.value.ytdlp),
    ffmpeg: toolVersionDisplay(binariesInfo.value.ffmpeg),
    bun: toolVersionDisplay(binariesInfo.value.bun),
}));

const fetchBinariesInfo = async () => {
    binariesLoadState.value = 'loading';
    try {
        const info = await runToolOperation('versions', () => store.getBinariesInfo());
        binariesInfo.value = info;
        binariesLoadState.value = 'ready';
    } catch (err) {
        console.error('Failed to fetch binaries info', err);
        binariesLoadState.value = 'error';
    }
};

const updateTool = async (tool: 'ytdlp' | 'ffmpeg' | 'bun') => {
    if (anyToolUpdating.value) return;
    isUpdatingBinaries[tool] = true;
    toolUpdateStatus.value = '';
    toolUpdateFailed.value = false;
    try {
        const result = await runToolOperation('update', () => store.updateTool(tool));
        toolUpdateStatus.value = t('settings.tools.update_result', { tool, result });
    } catch (e) {
        toolUpdateFailed.value = true;
        toolUpdateStatus.value = t('settings.tools.update_failed', { tool, error: String(e) });
    } finally {
        await fetchBinariesInfo();
        await checkZombies();
        isUpdatingBinaries[tool] = false;
    }
};

// App self-update (tauri-plugin-updater; signed bundles from GitHub Releases)
const appUpdateStatus = ref('');
const isCheckingAppUpdate = ref(false);

const checkAppUpdate = async () => {
    if (isCheckingAppUpdate.value) return;
    isCheckingAppUpdate.value = true;
    try {
        appUpdateStatus.value = t('settings.app_update.checking');
        const result = await store.runAppUpdate((event) => {
            if (event.phase === 'restarting') {
                appUpdateStatus.value = t('settings.app_update.restarting');
                return;
            }
            if (event.totalBytes === null) {
                appUpdateStatus.value = t('settings.app_update.downloading', { version: event.version });
                return;
            }
            appUpdateStatus.value = t('settings.app_update.progress', {
                version: event.version,
                total: event.totalBytes > 0 ? formatFileSize(event.totalBytes) : '?',
            });
        });
        if (result.status === 'latest') {
            appUpdateStatus.value = t('settings.app_update.latest');
        }
    } catch (e) {
        console.error('App update failed', e);
        appUpdateStatus.value = t('settings.app_update.failed');
    } finally {
        isCheckingAppUpdate.value = false;
    }
};

const formatFileSize = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

onMounted(async () => {
    if (!props.connectionEntry) {
        checkNotificationPermission();
        loadNotificationSettings();
    }
    if (props.connectionEntry === 'bilibili') {
        userInfo.value = store.getBilibiliUserProfile();
        await startBilibiliLogin();
        return;
    }
    await fetchBrowsers();
    if (disposed) return;
    // Set default selected browser: Prefer Chrome, otherwise first available
    if (browserOptions.value.length > 0) {
        const available = browserOptions.value.map(b => b.value);
        if (detectedBrowsers.value.includes('chrome')) {
            selectedBrowser.value = 'chrome';
        } else if (detectedBrowsers.value.length > 0) {
            selectedBrowser.value = detectedBrowsers.value[0];
        } else if (!available.includes(selectedBrowser.value)) {
            selectedBrowser.value = available[0];
        }
    }
    initCookiesState();

    // Load saved user info
    userInfo.value = store.getBilibiliUserProfile();
    if (props.connectionEntry) {
        openYouTubeModal();
        if (props.connectionEntry === 'youtube-file') youtubeAuthType.value = 'file';
    }
});

let youtubeFileEpoch = 0;
let youtubeDisconnectEpoch = 0;

// Keep the YouTube login editor in sync with the persisted YouTube-only profile.
watch(() => platformCookies.value.youtube, () => {
    if (browserOptions.value.length > 0) {
        initCookiesState();
    }
});

watch(
    () => store.platformCredentialConfigs.youtube,
    (nextConfig) => {
        if (nextConfig?.preferred.kind === 'none') {
            youtubeDisconnectEpoch++;
            youtubeFileEpoch++;
        }
    },
    { deep: true },
);

const selectCookieFile = async () => {
    youtubeAuthStatus.value = null;
    const epoch = ++youtubeFileEpoch;
    const wasModalOpen = showYouTubeModal.value;
    const startTab = youtubeAuthType.value;
    const startDisconnect = youtubeDisconnectEpoch;
    const isCurrent = () =>
        !disposed &&
        epoch === youtubeFileEpoch &&
        startDisconnect === youtubeDisconnectEpoch &&
        (!wasModalOpen || showYouTubeModal.value) &&
        youtubeAuthType.value === startTab;
    try {
        const selected = await store.chooseCookieFile(t('settings.cookies_pick_file'));
        if (!selected || !isCurrent()) return;
        const normalized = selected.trim();
        if (!normalized) return;
        const inspection = await store.inspectCookieFile(normalized, 'https://www.youtube.com/');
        if (!isCurrent()) return;
        if (inspection.state !== 'imported') {
            youtubeAuthStatus.value = { success: false, message: t(`input.cookie_state.${inspection.state}`) };
            return;
        }
        cookieFile.value = normalized;
        youtubeAuthStatus.value = { success: true, message: t(`input.cookie_state.${inspection.state}`) };
    } catch {
        if (!isCurrent()) return;
        youtubeAuthStatus.value = {
            success: false,
            message: t('settings.youtube_auth.file_select_failed'),
        };
    }
};

const isCheckingBrowser = ref(false);
const checkResult = ref<{ success: boolean, message: string } | null>(null);
const checkedBrowser = ref('');
let browserCheckEpoch = 0;
const resetBrowserCheck = () => {
    browserCheckEpoch++;
    isCheckingBrowser.value = false;
    checkedBrowser.value = '';
    checkResult.value = null;
};
watch(selectedBrowser, resetBrowserCheck);
onUnmounted(resetBrowserCheck);

const copyStatus = ref('');
const { copy: copyToClipboard } = useClipboard();
const copyEnvInfo = async () => {
    if (!binariesInfo.value) return;
    const text = `Bun: ${binariesInfo.value.bun}\nyt-dlp: ${binariesInfo.value.ytdlp}\nFFmpeg: ${binariesInfo.value.ffmpeg}`;
    try {
        await copyToClipboard(text);
        copyStatus.value = t('settings.common.copied');
        setTimeout(() => copyStatus.value = '', 2000);
    } catch (e) {
        console.error('Failed to copy', e);
        copyStatus.value = t('settings.common.copy_failed');
    }
};

const autoDetectBrowser = async (): Promise<boolean> => {
    if (isCheckingBrowser.value) return false;
    const browser = selectedBrowser.value.trim();
    if (!browser) {
        checkResult.value = { success: false, message: t('settings.youtube_auth.browser_required') };
        return false;
    }
    const epoch = ++browserCheckEpoch;
    isCheckingBrowser.value = true;
    checkedBrowser.value = '';
    checkResult.value = null;
    try {
        const result = await store.checkBrowserCookies(browser);
        if (epoch !== browserCheckEpoch || !showYouTubeModal.value) return false;
        checkResult.value = {
            success: result.success,
            message: t(`settings.browser.${result.success ? 'read_success' : result.kind}`),
        };
        if (result.success) checkedBrowser.value = browser;
        return result.success;
    } catch {
        if (epoch === browserCheckEpoch && showYouTubeModal.value) {
            checkResult.value = { success: false, message: t('settings.browser.execution_failed') };
        }
        return false;
    } finally {
        if (epoch === browserCheckEpoch) isCheckingBrowser.value = false;
    }
};

const openYouTubeLogin = async () => {
    youtubeAuthStatus.value = null;
    try {
        await store.openExternalUrl('https://accounts.google.com/ServiceLogin?service=youtube');
    } catch {
        youtubeAuthStatus.value = {
            success: false,
            message: t('settings.youtube_auth.login_open_failed'),
        };
    }
};

// YouTube Login State (Mimic Bilibili)
const showYouTubeModal = ref(false);
const youtubeAuthType = ref<'browser' | 'file'>('browser');
const isYouTubeConnected = computed(() => Boolean(platformCookies.value.youtube?.trim()));
const youtubeConnectionInfo = computed(() => {
    const profile = platformCookies.value.youtube?.trim();
    if (!profile) return '';
    const browser = browserOptions.value.find((option) => option.value.toLowerCase() === profile.toLowerCase());
    if (browser) return t('settings.auth.credentials_from', { name: browser.label });
    const name = profile.split(/[/\\]/).pop() || 'cookies.txt';
    return t('settings.auth.credentials_from', { name });
});

const openYouTubeModal = () => {
    resetBrowserCheck();
    youtubeFileEpoch++;
    youtubeAuthStatus.value = null;
    showYouTubeModal.value = true;
    youtubeAuthType.value = props.connectionEntry === 'youtube-file' ? 'file' : 'browser';
};

watch(youtubeAuthType, () => {
    youtubeFileEpoch++;
    resetBrowserCheck();
});

const confirmYouTubeAuth = async () => {
    if (isCheckingBrowser.value) return;
    youtubeAuthStatus.value = null;

    if (youtubeAuthType.value === 'file') {
        if (!cookieFile.value.trim()) {
            youtubeAuthStatus.value = {
                success: false,
                message: t('settings.youtube_auth.file_required'),
            };
            return;
        }
        const file = cookieFile.value;
        const result = await store.importPlatformCookieFile('youtube', file,
            () => !disposed && showYouTubeModal.value && youtubeAuthType.value === 'file' && cookieFile.value === file);
        if (!result.ok) {
            youtubeAuthStatus.value = { success: false, message: t(`input.cookie_state.${result.state}`) };
            return;
        }
        cookieMode.value = 'file';
    } else {
        if (!selectedBrowser.value.trim()) {
            youtubeAuthStatus.value = {
                success: false,
                message: t('settings.youtube_auth.browser_required'),
            };
            return;
        }
        const browser = selectedBrowser.value.trim();
        if (checkedBrowser.value !== browser && !await autoDetectBrowser()) return;
        if (!showYouTubeModal.value || youtubeAuthType.value !== 'browser' || selectedBrowser.value.trim() !== browser) return;
        cookieMode.value = 'browser';
        store.setPlatformCookie('youtube', browser);
    }

    showYouTubeModal.value = false;
};

const disconnectYouTube = () => {
    youtubeDisconnectEpoch++;
    youtubeFileEpoch++;
    resetBrowserCheck();
    store.clearPlatformCookie('youtube');
    cookieMode.value = 'none';
    cookieFile.value = '';
};

// Bilibili QR State
const showBiliQr = ref(false);
const biliQrImg = ref('');
const biliQrKey = ref('');
const biliQrStatus = ref('');
const biliQrTone = ref<'neutral' | 'error' | 'success'>('neutral');
const BILI_MAX_POLL_FAILURES = 3;
let biliPollFailures = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const stopBilibiliPolling = () => {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
};

const isBilibiliLoggedIn = computed(() => Boolean(platformCookies.value.bilibili?.trim()));

const logoutBilibili = () => {
    store.clearPlatformCookie('bilibili');
    userInfo.value = null;
    store.clearBilibiliUserProfile();
};

const startBilibiliLogin = async () => {
    try {
        showBiliQr.value = true;
        biliQrStatus.value = t('settings.bili_login.status.getting_qr');
        biliQrTone.value = 'neutral';
        biliPollFailures = 0;
        biliQrImg.value = '';

        // 1. Get QR Code
        const data = await store.getBilibiliQrCode();
        if (disposed || !showBiliQr.value) return;
        biliQrKey.value = data.qrcode_key;

        // 2. Generate Image
        biliQrImg.value = await QRCode.toDataURL(data.url, { margin: 2, width: 200 });
        if (disposed || !showBiliQr.value) return;
        biliQrStatus.value = t('settings.bili_login.status.scan_please');

        // 3. Start Polling
        stopBilibiliPolling();
        pollTimer = setInterval(pollBilibiliStatus, 3000);

    } catch (e) {
        console.error('Failed to start login:', e);
        biliQrTone.value = 'error';
        biliQrStatus.value = t('settings.bili_login.status.error_prefix') + e;
    }
};

const pollBilibiliStatus = async () => {
    if (!showBiliQr.value || !biliQrKey.value) return;

    try {
        const res = await store.pollBilibiliQrCode(biliQrKey.value);
        biliPollFailures = 0;

        if (res.status === 'success' && res.cookies) {
            // Login Success
            biliQrTone.value = 'success';
            biliQrStatus.value = t('settings.bili_login.status.success');
            stopBilibiliPolling();

            // Save Cookies to File
            const path = await store.saveBilibiliCookies(res.cookies);

            // Fetch User Info
            try {
                const info = await store.getBilibiliUserInfo(res.cookies);
                if (info.is_login) {
                    userInfo.value = { uname: info.uname, face: info.face };
                    store.setBilibiliUserProfile(userInfo.value);
                }
            } catch (e) {
                console.error('Failed to fetch user info:', e);
                // Continue even if user info fetch fails
            }
            // Persist Bilibili credentials independently from YouTube.
            store.setPlatformCookie('bilibili', path);

            // Close modal after delay
            setTimeout(() => {
                showBiliQr.value = false;
            }, 1500);

        } else if (res.status === 'scanned') {
            biliQrTone.value = 'neutral';
            biliQrStatus.value = t('settings.bili_login.status.scanned');
        } else if (res.status === 'expired') {
            biliQrTone.value = 'error';
            biliQrStatus.value = t('settings.bili_login.status.expired');
            stopBilibiliPolling();
        } else if (res.status === 'error') {
            biliQrTone.value = 'error';
            biliQrStatus.value = res.message;
            stopBilibiliPolling();
        }
    } catch (e) {
        console.error('Poll failed:', e);
        biliPollFailures++;
        biliQrTone.value = 'error';
        if (biliPollFailures >= BILI_MAX_POLL_FAILURES) {
            biliQrStatus.value = t('settings.bili_login.status.poll_failed');
            stopBilibiliPolling();
        } else {
            biliQrStatus.value = t('settings.bili_login.status.poll_retrying', {
                attempt: biliPollFailures,
                max: BILI_MAX_POLL_FAILURES,
            });
        }
    }
};

const closeBiliQr = () => {
    showBiliQr.value = false;
    stopBilibiliPolling();
};

// Modal focus trap: keep Tab cycling inside open dialogs, restore focus on close
const FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const youtubeModalRef = useTemplateRef<HTMLElement>('youtubeModalRef');
const biliModalRef = useTemplateRef<HTMLElement>('biliModalRef');
const youtubeModalTitleId = useId();
const biliModalTitleId = useId();
let lastFocusedElement: HTMLElement | null = null;

const trapTabKey = (container: HTMLElement | null, event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !container) return;
    const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
    );
    if (items.length === 0) {
        event.preventDefault();
        return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
    }
};

const focusFirstInModal = (container: HTMLElement | null) => {
    if (!container) return;
    lastFocusedElement = document.activeElement as HTMLElement | null;
    const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? container).focus();
};

const releaseModalFocus = () => {
    lastFocusedElement?.focus?.();
    lastFocusedElement = null;
};

watch(showYouTubeModal, (open) => {
    youtubeFileEpoch++;
    if (open) {
        nextTick(() => focusFirstInModal(youtubeModalRef.value));
    } else {
        resetBrowserCheck();
        releaseModalFocus();
        if (props.connectionEntry) emit('close');
    }
});

watch(showBiliQr, (open) => {
    if (open) {
        nextTick(() => focusFirstInModal(biliModalRef.value));
    } else {
        releaseModalFocus();
        if (props.connectionEntry) emit('close');
    }
});

onUnmounted(() => {
    disposed = true;
    youtubeFileEpoch++;
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    if (zombieRecheckTimer) {
        clearTimeout(zombieRecheckTimer);
        zombieRecheckTimer = null;
    }
});

// Video Renaming State
const { isRenamingEnabled, renameOptions, effectiveTemplate, setOption } = useFilenameSettings(extraArgs);
const handleRenameOption = (key: keyof typeof renameOptions.value, event: Event) => {
    setOption(key, (event.target as HTMLInputElement).checked);
};

const templateVariables = computed(() => [
    { label: t('settings.renaming.variables.title'), value: '%(title)s' },
    { label: t('settings.renaming.variables.uploader'), value: '%(uploader)s' },
    { label: t('settings.renaming.variables.upload_date'), value: '%(upload_date)s' },
    { label: t('settings.renaming.variables.resolution'), value: '%(resolution)s' },
    { label: t('settings.renaming.variables.id'), value: '%(id)s' },
    { label: t('settings.renaming.variables.ext'), value: '%(ext)s' },
]);

const insertTemplateVariable = (variable: string) => {
    const current = extraArgs.value.filenameTemplate || '';
    if (!current) {
        extraArgs.value.filenameTemplate = `${variable}.%(ext)s`;
    } else if (current.includes('.%(ext)s')) {
        extraArgs.value.filenameTemplate = current.replace('.%(ext)s', ` - ${variable}.%(ext)s`);
    } else {
        extraArgs.value.filenameTemplate = `${current} - ${variable}`;
    }
};

const renamePreview = computed(() => effectiveTemplate.value
    .replace(/%\(title\)s/g, 'How To De-Slop A Codebase')
    .replace(/%\(uploader\)s/g, 'Matt Pocock')
    .replace(/%\(upload_date\)s/g, '20260429')
    .replace(/%\(extractor_key\)s/g, 'YouTube')
    .replace(/%\(resolution\)s/g, '1080p')
    .replace(/%\(id\)s/g, '3MP8D-mdheA')
    .replace(/%\(ext\)s/g, 'mp4'));

// Initialize local state from store
watch(() => extraArgs.value.subLangs, (newVal) => {
    if (!newVal) {
        selectedLangs.value = [];
        return;
    }

    const langs = newVal.split(',').map(s => s.trim());
    const commonCodes = commonLanguages.value.map(l => l.code);

    // Only select the ones that exist in our common list
    selectedLangs.value = langs.filter(l => commonCodes.includes(l));
}, { immediate: true });

// Update store when selection changes
watch(selectedLangs, (newVal) => {
    extraArgs.value.subLangs = newVal.join(',');
});

type SettingsTab = 'general' | 'format' | 'advanced' | 'tools';
const settingsTabOrder: SettingsTab[] = ['general', 'format', 'advanced', 'tools'];
const activeTab = ref<SettingsTab>('format');
watch(activeTab, async tab => {
    if (tab !== 'tools') return;
    await fetchBinariesInfo();
    await checkZombies();
});
const settingsTabsRef = useTemplateRef<HTMLElement>('settingsTabsRef');
const settingsTabOrientation = ref<'horizontal' | 'vertical'>('horizontal');
let settingsTabsResizeObserver: ResizeObserver | null = null;

const syncSettingsTabOrientation = () => {
    const tabs = settingsTabsRef.value;
    if (!tabs || typeof window === 'undefined') return;
    settingsTabOrientation.value = window.getComputedStyle(tabs).flexDirection === 'column'
        ? 'vertical'
        : 'horizontal';
};

onMounted(() => {
    nextTick(() => {
        syncSettingsTabOrientation();
        if (typeof ResizeObserver !== 'undefined' && settingsTabsRef.value) {
            settingsTabsResizeObserver = new ResizeObserver(syncSettingsTabOrientation);
            settingsTabsResizeObserver.observe(settingsTabsRef.value);
        }
    });
    window.addEventListener('resize', syncSettingsTabOrientation);
});

onUnmounted(() => {
    settingsTabsResizeObserver?.disconnect();
    settingsTabsResizeObserver = null;
    window.removeEventListener('resize', syncSettingsTabOrientation);
});

const handleSettingsTabKeydown = (event: KeyboardEvent, tab: SettingsTab) => {
    syncSettingsTabOrientation();
    const vertical = settingsTabOrientation.value === 'vertical';
    const previousKey = vertical ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
    if (![previousKey, nextKey, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();

    const currentIndex = settingsTabOrder.indexOf(tab);
    let nextIndex = currentIndex;
    if (event.key === nextKey) nextIndex = (currentIndex + 1) % settingsTabOrder.length;
    if (event.key === previousKey) nextIndex = (currentIndex - 1 + settingsTabOrder.length) % settingsTabOrder.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = settingsTabOrder.length - 1;

    const nextTab = settingsTabOrder[nextIndex];
    activeTab.value = nextTab;
    const tabList = (event.currentTarget as HTMLElement | null)?.parentElement;
    tabList?.querySelector<HTMLButtonElement>(`[data-settings-tab="${nextTab}"]`)?.focus();
};

// User Agent Options
const userAgentOptions = computed(() => [
    { label: t('settings.advanced.ua_default'), value: '' },
    { label: 'Google Chrome (Windows)', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    { label: 'Google Chrome (macOS)', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    { label: 'Mozilla Firefox (Windows)', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0' },
    { label: 'Safari (macOS)', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15' },
    { label: 'Microsoft Edge (Windows)', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0' }
]);

const uaMode = ref('select'); // 'select' or 'custom'

// Initialize UA mode
watch(() => extraArgs.value.userAgent, (newVal) => {
    if (!newVal) {
        uaMode.value = 'select';
        return;
    }
    const isPreset = userAgentOptions.value.some(opt => opt.value === newVal);
    if (!isPreset) {
        uaMode.value = 'custom';
    } else {
        uaMode.value = 'select';
    }
}, { immediate: true });

const handleUASelect = (e: Event) => {
    const val = (e.target as HTMLSelectElement).value;
    if (val === 'custom_mode') {
        uaMode.value = 'custom';
        // Keep existing value or clear? Keep existing is safer.
    } else {
        extraArgs.value.userAgent = val;
    }
};

</script>

<template>
    <div v-if="!connectionEntry" class="settings-container">
        <div class="settings-header">
            <h3 id="settings-dialog-title">{{ t('settings.title') }}</h3>
            <button class="close-btn" @click="$emit('close')" :title="t('settings.close')" :aria-label="t('settings.close')">
                <NeoIcon name="cross" :size="16" :stroke-width="2.5" />
            </button>
        </div>

        <div ref="settingsTabsRef" class="settings-tabs" role="tablist" :aria-label="t('settings.title')" :aria-orientation="settingsTabOrientation">
            <button id="settings-tab-general" class="tab-btn" role="tab" data-settings-tab="general"
                :class="{ active: activeTab === 'general' }" :aria-selected="activeTab === 'general'"
                :aria-pressed="activeTab === 'general'" :tabindex="activeTab === 'general' ? 0 : -1"
                @click="activeTab = 'general'" @keydown="handleSettingsTabKeydown($event, 'general')">
                <NeoIcon name="gear" :size="14" class="tab-icon" />
                <span>{{ t('settings.tabs.general') }}</span>
            </button>
            <button id="settings-tab-format" class="tab-btn" role="tab" data-settings-tab="format"
                :class="{ active: activeTab === 'format' }" :aria-selected="activeTab === 'format'"
                :aria-pressed="activeTab === 'format'" :tabindex="activeTab === 'format' ? 0 : -1"
                @click="activeTab = 'format'" @keydown="handleSettingsTabKeydown($event, 'format')">
                <NeoIcon name="tv" :size="14" class="tab-icon" />
                <span>{{ t('settings.tabs.format') }}</span>
            </button>
            <button id="settings-tab-advanced" class="tab-btn" role="tab" data-settings-tab="advanced"
                :class="{ active: activeTab === 'advanced' }" :aria-selected="activeTab === 'advanced'"
                :aria-pressed="activeTab === 'advanced'" :tabindex="activeTab === 'advanced' ? 0 : -1"
                @click="activeTab = 'advanced'" @keydown="handleSettingsTabKeydown($event, 'advanced')">
                <NeoIcon name="zap" :size="14" class="tab-icon" />
                <span>{{ t('settings.tabs.advanced') }}</span>
            </button>
            <button id="settings-tab-tools" class="tab-btn" role="tab" data-settings-tab="tools"
                :class="{ active: activeTab === 'tools' }" :aria-selected="activeTab === 'tools'"
                :aria-pressed="activeTab === 'tools'" :tabindex="activeTab === 'tools' ? 0 : -1"
                @click="activeTab = 'tools'" @keydown="handleSettingsTabKeydown($event, 'tools')">
                <NeoIcon name="disk" :size="14" class="tab-icon" />
                <span>{{ t('settings.tabs.tools') }}</span>
            </button>
        </div>

        <div class="settings-content custom-scrollbar">
            <header class="settings-page-heading">
                <h3>{{ t(`settings.tabs.${activeTab}`) }}</h3>
                <p>{{ t(`settings.page_hint.${activeTab}`) }}</p>
            </header>
            <!-- Tab: General (Accounts & Notifications) -->
            <div v-if="activeTab === 'general'" class="tab-pane fade-in" role="tabpanel" aria-labelledby="settings-tab-general">
                <!-- Cookies Section -->
                <div class="setting-group">
                    <h4>{{ t('settings.auth.title') }}</h4>

                    <!-- Login Area -->
                    <div class="direct-login-area">
                        <!-- Bilibili -->
                        <div v-if="!isBilibiliLoggedIn" class="login-action">
                            <button class="neo-button platform-login-button small" data-platform="bilibili" @click="startBilibiliLogin">
                                <NeoIcon name="tv" :size="14" class="u-mr-xs" /> {{ t('settings.auth.bili_login') }}
                            </button>
                            <span class="helper-text inline">{{ t('settings.auth.bili_helper') }}</span>
                        </div>

                        <div v-else class="logged-in-state fade-in">
                            <div class="user-badge">
                                <img v-if="userInfo && userInfo.face" :src="userInfo.face" class="user-avatar"
                                    alt="Avatar" referrerpolicy="no-referrer">
                                <NeoIcon name="check" :size="14" class="u-mr-xs text-success" v-else />
                                <span class="text">{{ userInfo ? userInfo.uname : t('settings.auth.logged_in_as')
                                }}</span>
                            </div>
                            <button class="text-btn danger small" @click="logoutBilibili">
                                {{ t('settings.auth.logout') }}
                            </button>
                        </div>

                        <!-- YouTube (Redesigned) -->
                        <div v-if="!isYouTubeConnected" class="login-action" style="margin-top: 12px;">
                            <button class="neo-button platform-login-button small" data-platform="youtube" @click="openYouTubeModal">
                                <NeoIcon name="play" :size="14" class="u-mr-xs" /> {{ t('settings.auth.youtube_login') }}
                            </button>
                            <span class="helper-text inline">{{ t('settings.auth.youtube_helper') }}</span>
                        </div>

                        <div v-else class="logged-in-state fade-in" style="margin-top: 12px;">
                            <div class="user-badge cookie-path-preview" :data-cookie-path="platformCookies.youtube" tabindex="0" :aria-label="platformCookies.youtube">
                                <NeoIcon name="cookie" :size="14" class="u-mr-xs" />
                                <span class="cookie-connection-name">{{ youtubeConnectionInfo }}<small class="helper-text">{{ t('settings.auth.credentials_pending') }}</small></span>
                            </div>
                            <button class="neo-button secondary small" type="button" data-youtube-manage @click="openYouTubeModal">
                                {{ t('settings.youtube_auth.manage') }}
                            </button>
                            <button class="text-btn danger small" @click="disconnectYouTube">
                                {{ t('settings.auth.logout') }}
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Notification Settings -->
                <div class="setting-group">
                    <div class="group-header">
                        <h4><NeoIcon name="bell" :size="16" class="section-title-icon" /> {{ t('settings.notifications.title') }}</h4>
                        <label class="toggle-switch">
                            <input type="checkbox"
                                   :checked="notificationSettings.enabled"
                                   :disabled="!notificationSettingsLoaded"
                                   :aria-label="t('settings.notifications.title')"
                                   @change="toggleNotifications(!notificationSettings.enabled)" />
                            <span class="slider"></span>
                        </label>
                    </div>
                    <span class="helper-text">{{ t('settings.notifications.hint') }}</span>
                    <span
                        v-if="notificationStatus"
                        class="helper-text notification-status"
                        :class="{ 'error-text': !notificationStatus.success }"
                        role="status"
                        aria-live="polite"
                    >
                        {{ notificationStatus.message }}
                    </span>

                    <div v-if="notificationSettingsLoaded && notificationSettings.enabled" class="sub-settings fade-in">
                        <div class="setting-item-inline">
                            <label>
                                <input type="checkbox" :checked="notificationSettings.onSuccess"
                                       @change="handleNotificationPreferenceChange('onSuccess', $event)" />
                                {{ t('settings.notifications.on_success') }}
                            </label>
                        </div>
                        <div class="setting-item-inline">
                            <label>
                                <input type="checkbox" :checked="notificationSettings.onError"
                                       @change="handleNotificationPreferenceChange('onError', $event)" />
                                {{ t('settings.notifications.on_error') }}
                            </label>
                        </div>
                        <div class="setting-item-inline">
                            <label>
                                <input type="checkbox" :checked="notificationSettings.onCancel"
                                       @change="handleNotificationPreferenceChange('onCancel', $event)" />
                                {{ t('settings.notifications.on_cancel') }}
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Tab: Output (Naming, Quality, Post-processing) -->
            <div v-if="activeTab === 'format'" class="tab-pane fade-in" role="tabpanel" aria-labelledby="settings-tab-format">
                <!-- Video Renaming Section -->
                <div class="setting-group">
                    <div class="group-header">
                        <h4>{{ t('settings.renaming.title') }}</h4>
                        <label class="toggle-switch">
                            <input type="checkbox" v-model="isRenamingEnabled" :aria-label="t('settings.renaming.title')">
                            <span class="slider"></span>
                        </label>
                    </div>
                    <div v-if="isRenamingEnabled" class="renaming-options fade-in">
                        <div class="rename-grid">
                            <label class="checkbox-label small">
                                <input type="checkbox" :checked="renameOptions.title" @change="handleRenameOption('title', $event)" class="neo-checkbox small">
                                <span>{{ t('settings.renaming.options.title') }}</span>
                            </label>
                            <label class="checkbox-label small">
                                <input type="checkbox" :checked="renameOptions.platform" @change="handleRenameOption('platform', $event)" class="neo-checkbox small">
                                <span>{{ t('settings.renaming.options.platform') }}</span>
                            </label>
                            <label class="checkbox-label small">
                                <input type="checkbox" :checked="renameOptions.uploader" @change="handleRenameOption('uploader', $event)" class="neo-checkbox small">
                                <span>{{ t('settings.renaming.options.uploader') }}</span>
                            </label>
                            <label class="checkbox-label small">
                                <input type="checkbox" :checked="renameOptions.date" @change="handleRenameOption('date', $event)" class="neo-checkbox small">
                                <span>{{ t('settings.renaming.options.date') }}</span>
                            </label>
                            <label class="checkbox-label small">
                                <input type="checkbox" :checked="renameOptions.subLangs" @change="handleRenameOption('subLangs', $event)" class="neo-checkbox small">
                                <span>{{ t('settings.renaming.options.sub_langs') }}</span>
                            </label>
                        </div>
                        <div class="rename-preview">
                            <div>{{ t('settings.renaming.preview') }}: <span class="preview-text">{{ renamePreview
                                    }}</span></div>
                            <details class="expert-disclosure filename-template-disclosure">
                                <summary>
                                    <span>{{ t('settings.renaming.advanced_template') }}</span>
                                    <span class="expert-disclosure-hint">{{ t('settings.renaming.advanced_template_hint') }}</span>
                                </summary>
                                <div class="expert-disclosure-body">
                            <!-- Quick Click Variable Pills -->
                            <div class="template-variable-pills" style="display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0;">
                                <button
                                    v-for="v in templateVariables"
                                    :key="v.value"
                                    type="button"
                                    class="neo-button micro ghost template-pill"
                                    :title="t('settings.renaming.insert_variable', { variable: v.value })"
                                    @click="insertTemplateVariable(v.value)"
                                >
                                    + {{ v.label }}
                                </button>
                            </div>
                            <!-- Debug / Manual Template View -->
                            <div class="template-debug" style="margin-top: 8px;">
                                <label for="settings-filename-template" class="input-label" style="font-size: 0.8em; color: var(--color-text-muted);">
                                    {{ t('settings.renaming.template') }}:
                                </label>
                                <input id="settings-filename-template" type="text" v-model="extraArgs.filenameTemplate"
                                    class="neo-input small full-width"
                                    style="font-family: monospace; font-size: 0.85em;"
                                    placeholder="%(title)s.%(ext)s" />
                            </div>
                                </div>
                            </details>
                        </div>
                    </div>
                    <span class="helper-text">{{ t('settings.renaming.helper') }}</span>
                </div>

                <!-- Quality & Codecs -->
                <div class="setting-group">
                    <h4>{{ t('settings.format.quality_title') }}</h4>
                    <div class="grid-2-col">
                        <div class="input-item">
                            <label for="settings-resolution" class="input-label">{{ t('settings.format.max_res') }}</label>
                            <select id="settings-resolution" v-model="extraArgs.resolution" class="neo-select">
                                <option value="best">{{ t('settings.format.res_best') }}</option>
                                <option value="4320">8K (4320p)</option>
                                <option value="2160">4K (2160p)</option>
                                <option value="1440">2K (1440p)</option>
                                <option value="1080">1080p (FHD)</option>
                                <option value="720">720p (HD)</option>
                                <option value="480">480p</option>
                            </select>
                        </div>
                        <div class="input-item">
                            <label for="settings-video-codec" class="input-label">{{ t('settings.format.video_codec') }}</label>
                            <select id="settings-video-codec" v-model="extraArgs.videoCodec" class="neo-select">
                                <option value="auto">{{ t('settings.format.codec_auto') }}</option>
                                <option value="h264">{{ t('settings.format.codec_h264') }}</option>
                                <option value="h265">{{ t('settings.format.codec_h265') }}</option>
                                <option value="vp9">{{ t('settings.format.codec_vp9') }}</option>
                                <option value="av1">{{ t('settings.format.codec_av1') }}</option>
                            </select>
                        </div>
                        <div class="input-item">
                            <label for="settings-audio-codec" class="input-label">{{ t('settings.format.audio_codec') }}</label>
                            <select id="settings-audio-codec" v-model="extraArgs.audioCodec" class="neo-select">
                                <option value="auto">{{ t('settings.format.codec_auto') }}</option>
                                <option value="aac">{{ t('settings.format.audio_aac') }}</option>
                                <option value="opus">{{ t('settings.format.audio_opus') }}</option>
                                <option value="mp3">{{ t('settings.format.audio_mp3') }}</option>
                                <option value="m4a">{{ t('settings.format.audio_m4a') }}</option>
                            </select>
                        </div>
                    </div>
                    <span class="helper-text">{{ t('settings.format.quality_helper') }}</span>
                    <div v-if="needsCodecConfirmation" class="helper-text" role="status">
                        {{ t('settings.format.legacy_codec_hint') }}
                        <button type="button" class="text-btn" @click="useAutomaticCodecs">{{ t('settings.format.use_auto') }}</button>
                        <button type="button" class="text-btn" @click="store.confirmCodecPreferences">{{ t('settings.format.keep_codecs') }}</button>
                    </div>
                </div>

                <!-- Post-processing -->
                <div class="setting-group">
                    <h4>{{ t('settings.output.postprocess_title') }}</h4>

                    <div class="setting-subsection">
                        <div class="group-header">
                            <span class="sub-label strong">{{ t('settings.format.subtitles_title') }}</span>
                            <label class="toggle-switch">
                                <input type="checkbox" v-model="extraArgs.embedSubs" :aria-label="t('settings.format.subtitles_title')">
                                <span class="slider"></span>
                            </label>
                        </div>
                        <span class="helper-text">{{ t('settings.format.embed_subs') }}</span>
                        <div v-if="extraArgs.embedSubs" class="lang-selection-area fade-in">
                            <label class="sub-label">{{ t('settings.format.select_lang') }}</label>
                            <div class="lang-grid">
                                <label v-for="lang in commonLanguages" :key="lang.code" class="lang-checkbox-item">
                                    <input type="checkbox" :value="lang.code" v-model="selectedLangs" class="neo-checkbox small">
                                    <span>{{ lang.label }}</span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div class="setting-subsection">
                        <div class="group-header">
                            <span class="sub-label strong">{{ t('settings.format.sponsorblock_title') }}</span>
                            <label class="toggle-switch">
                                <input type="checkbox" v-model="extraArgs.sponsorblock" :aria-label="t('settings.format.sponsorblock_title')">
                                <span class="slider"></span>
                            </label>
                        </div>
                        <span class="helper-text">{{ t('settings.format.sponsorblock_helper') }}</span>
                    </div>
                </div>

                <!-- Metadata & Sidecar Files -->
                <div class="setting-group">
                    <h4>{{ t('settings.archive.title') }}</h4>

                    <div class="setting-subsection">
                        <div class="group-header">
                            <span class="sub-label strong">{{ t('settings.format.metadata_title') }}</span>
                            <label class="toggle-switch">
                                <input type="checkbox" v-model="extraArgs.embedMetadata" :aria-label="t('settings.format.metadata_title')">
                                <span class="slider"></span>
                            </label>
                        </div>
                        <span class="helper-text">{{ t('settings.format.metadata_helper') }}</span>
                    </div>

                    <div class="setting-subsection">
                        <div class="group-header">
                            <span class="sub-label strong">{{ t('settings.archive.thumbnail_title') }}</span>
                            <label class="toggle-switch">
                                <input type="checkbox" v-model="extraArgs.writeThumbnail" :aria-label="t('settings.archive.thumbnail_title')">
                                <span class="slider"></span>
                            </label>
                        </div>
                        <span class="helper-text">{{ t('settings.archive.thumbnail_helper') }}</span>
                    </div>

                    <div class="setting-subsection">
                        <div class="group-header">
                            <span class="sub-label strong">{{ t('settings.archive.json_title') }}</span>
                            <label class="toggle-switch">
                                <input type="checkbox" v-model="extraArgs.writeInfoJson" :aria-label="t('settings.archive.json_title')">
                                <span class="slider"></span>
                            </label>
                        </div>
                        <span class="helper-text">{{ t('settings.archive.json_helper') }}</span>
                    </div>
                </div>
            </div>

            <!-- Tab: Advanced (Performance, Network & Compatibility) -->
            <div v-if="activeTab === 'advanced'" class="tab-pane fade-in" role="tabpanel" aria-labelledby="settings-tab-advanced">

                <!-- Download Performance -->
                <div class="setting-group">
                    <h4>{{ t('settings.advanced.performance_title') }}</h4>
                    <div class="setting-subsection">
                        <span class="sub-label strong">{{ t('settings.advanced.concurrency_title') }}</span>
                        <div class="range-input">
                            <input id="settings-concurrent-fragments" :aria-label="t('settings.advanced.concurrency_title')" v-model.number="extraArgs.concurrentFragments" type="range" min="1" max="16" step="1"
                                class="range-slider" />
                            <div class="range-value-labels">
                                <span>1</span>
                                <span>{{ extraArgs.concurrentFragments || 1 }}</span>
                                <span>16</span>
                            </div>
                        </div>
                        <span class="helper-text">{{ t('settings.advanced.concurrency_helper') }}</span>
                    </div>
                </div>

                <!-- Network & Compatibility -->
                <div class="setting-group">
                    <h4>{{ t('settings.advanced.compatibility_title') }}</h4>

                    <div class="setting-subsection">
                        <label for="settings-proxy" class="sub-label strong">{{ t('settings.advanced.proxy_title') }}</label>
                        <input id="settings-proxy" :aria-label="t('settings.advanced.proxy_title')" v-model="extraArgs.proxy" type="text"
                            :placeholder="t('settings.advanced.proxy_placeholder')" class="neo-input full-width" />
                        <span class="helper-text">{{ t('settings.advanced.proxy_helper') }}</span>
                    </div>

                    <div class="setting-subsection">
                        <div class="group-header">
                            <label for="settings-ua-select" class="sub-label strong">{{ t('settings.advanced.ua_title') }}</label>
                            <button v-if="uaMode === 'custom'" class="text-btn small"
                                @click="uaMode = 'select'; extraArgs.userAgent = ''">
                                {{ t('settings.advanced.back_to_presets') }}
                            </button>
                        </div>
                        <div v-if="uaMode === 'select'">
                            <select id="settings-ua-select" :aria-label="t('settings.advanced.ua_title')" :value="extraArgs.userAgent"
                                @change="handleUASelect" class="neo-select full-width">
                                <option v-for="opt in userAgentOptions" :key="opt.label" :value="opt.value">
                                    {{ opt.label }}
                                </option>
                                <option value="custom_mode">{{ t('settings.advanced.custom_mode') }}</option>
                            </select>
                        </div>
                        <div v-else class="fade-in">
                            <input id="settings-ua-custom" :aria-label="t('settings.advanced.ua_title')" v-model="extraArgs.userAgent"
                                type="text" placeholder="Mozilla/5.0..." class="neo-input full-width" />
                        </div>
                        <span class="helper-text">{{ t('settings.advanced.ua_helper') }}</span>
                    </div>

                    <div class="setting-subsection">
                        <label for="settings-player-client" class="sub-label strong">{{ t('settings.client.title') }}</label>
                        <div class="client-config-grid">
                            <select id="settings-player-client" v-model="extraArgs.playerClient" class="neo-select full-width"
                                :aria-label="t('settings.client.title')">
                                <option value="smart">{{ t('settings.client.smart_option') }}</option>
                                <option value="android">{{ t('settings.client.android_option') }}</option>
                                <option value="web">{{ t('settings.client.web_option') }}</option>
                                <option value="ios">{{ t('settings.client.ios_option') }}</option>
                                <option value="tv">{{ t('settings.client.tv_option') }}</option>
                            </select>

                            <details class="expert-disclosure" v-if="['web', 'ios'].includes(extraArgs.playerClient || '')">
                                <summary>
                                    <span>{{ t('settings.client.expert_title') }}</span>
                                    <span class="expert-disclosure-hint">{{ t('settings.client.expert_hint') }}</span>
                                </summary>
                                <div class="expert-disclosure-body">
                                    <div class="config-item full-width" v-if="['web', 'ios'].includes(extraArgs.playerClient || '')">
                                        <label for="settings-po-token" class="input-label">
                                            PO Token
                                            <span class="badge warning" :title="t('settings.client.optional')">{{ t('settings.client.po_token_badge') }}</span>
                                        </label>
                                        <input id="settings-po-token" type="text" v-model="extraArgs.poToken"
                                            class="neo-input full-width monospace"
                                            :placeholder="t('settings.client.po_token_placeholder')" />
                                        <span class="helper-text warning">{{ t('settings.client.po_token_hint') }}</span>
                                    </div>

                                    <div class="config-item full-width" v-if="['web', 'ios'].includes(extraArgs.playerClient || '')">
                                        <label for="settings-visitor-data" class="input-label">
                                            Visitor Data {{ t('settings.client.optional') }}
                                        </label>
                                        <input id="settings-visitor-data" type="text" v-model="extraArgs.visitorData"
                                            class="neo-input full-width monospace"
                                            :placeholder="t('settings.client.visitor_data_placeholder')" />
                                    </div>
                                </div>
                            </details>
                        </div>
                    </div>
                </div>

            </div>
            <!-- Tab: Tools (App, Toolchain & System Health) -->
            <div v-if="activeTab === 'tools'" class="tab-pane fade-in" role="tabpanel" aria-labelledby="settings-tab-tools">
                <!-- App Self-Update -->
                <div v-if="APP_SELF_UPDATE_ENABLED" class="setting-group">
                    <h4>{{ t('settings.app_update.title') }}</h4>
                    <div class="settings-tool-row app-tool-row">
                        <div class="tool-header">
                            <span class="tool-name">{{ t('settings.app_update.current') }}</span>
                            <span class="tool-status ok">{{ store.appVersion || '—' }}</span>
                        </div>
                        <div class="tool-actions tool-actions-row">
                            <button class="neo-button secondary small" type="button" @click="checkAppUpdate"
                                :disabled="isCheckingAppUpdate">
                                {{ isCheckingAppUpdate ? t('settings.app_update.checking') :
                                    t('settings.app_update.check_btn') }}
                            </button>
                            <span v-if="appUpdateStatus" class="helper-text inline" role="status">{{ appUpdateStatus }}</span>
                        </div>
                    </div>
                    <span class="helper-text">
                        {{ t('settings.app_update.hint') }}
                    </span>
                </div>

                <div class="setting-group">
                    <div class="group-header">
                        <h4>{{ t('settings.tools.title') }}</h4>
                        <button v-if="binariesLoadState === 'ready'" class="text-btn small" @click="copyEnvInfo">
                            {{ copyStatus || t('settings.environment.copy_info') }}
                        </button>
                    </div>
                    <div v-if="binariesLoadState === 'ready'" class="tools-grid">
                        <!-- yt-dlp -->
                        <div class="settings-tool-row">
                            <div class="tool-header">
                                <span class="tool-name">yt-dlp</span>
                                <span class="tool-status" :class="{ unavailable: !toolVersions.ytdlp.available }" :title="toolVersions.ytdlp.full">
                                    {{ toolVersions.ytdlp.available ? toolVersions.ytdlp.label : t('settings.tools.unavailable') }}
                                </span>
                            </div>
                            <div class="tool-actions">
                                <button class="neo-button secondary small" @click="updateTool('ytdlp')"
                                    :disabled="anyToolUpdating || zombieCheckState === 'busy'">
                                    {{ isUpdatingBinaries.ytdlp ? t('settings.tools.updating') :
                                        t('settings.tools.update_btn') }}
                                </button>
                            </div>
                        </div>

                        <!-- ffmpeg -->
                        <div class="settings-tool-row">
                            <div class="tool-header">
                                <span class="tool-name">FFmpeg</span>
                                <span class="tool-status" :class="{ unavailable: !toolVersions.ffmpeg.available }" :title="toolVersions.ffmpeg.full">
                                    {{ toolVersions.ffmpeg.available ? toolVersions.ffmpeg.label : t('settings.tools.unavailable') }}
                                </span>
                            </div>
                            <div class="tool-actions">
                                <button class="neo-button secondary small" @click="updateTool('ffmpeg')"
                                    :disabled="anyToolUpdating || zombieCheckState === 'busy'">
                                    {{ isUpdatingBinaries.ffmpeg ? t('settings.tools.updating') :
                                        t('settings.tools.reinstall_btn') }}
                                </button>
                            </div>
                        </div>

                        <!-- Bun -->
                        <div class="settings-tool-row">
                            <div class="tool-header">
                                <span class="tool-name">Bun</span>
                                <span class="tool-status" :class="{ unavailable: !toolVersions.bun.available }" :title="toolVersions.bun.full">
                                    {{ toolVersions.bun.available ? toolVersions.bun.label : t('settings.tools.unavailable') }}
                                </span>
                            </div>
                            <div class="tool-actions">
                                <button class="neo-button secondary small" @click="updateTool('bun')"
                                    :disabled="anyToolUpdating || zombieCheckState === 'busy'">
                                    {{ isUpdatingBinaries.bun ? t('settings.tools.updating') :
                                        t('settings.tools.upgrade_btn') }}
                                </button>
                            </div>
                        </div>
                    </div>
                    <div v-else-if="binariesLoadState === 'error'" class="loading-state error-text" role="alert" aria-live="polite">
                        <NeoIcon name="warn" :size="16" />
                        <span>{{ t('settings.environment.load_failed') }}</span>
                        <button class="text-btn" type="button" @click="fetchBinariesInfo">{{ t('settings.health.recheck') }}</button>
                    </div>
                    <div v-else class="loading-state">
                        <div class="spinner-small"></div>
                        <span>{{ t('settings.environment.detecting') }}</span>
                    </div>
                    <p v-if="toolUpdateStatus" class="tool-update-status" :class="{ 'error-text': toolUpdateFailed }" :role="toolUpdateFailed ? 'alert' : 'status'" aria-live="polite">{{ toolUpdateStatus }}</p>
                    <details v-if="binariesLoadState === 'ready'" class="tool-version-details">
                        <summary>{{ t('settings.tools.version_details') }}</summary>
                        <dl>
                            <template v-for="(version, tool) in toolVersions" :key="tool">
                                <dt>{{ tool === 'ffmpeg' ? 'FFmpeg' : tool === 'ytdlp' ? 'yt-dlp' : 'Bun' }}</dt>
                                <dd>{{ version.available ? version.full : t('settings.tools.unavailable') }}</dd>
                            </template>
                        </dl>
                    </details>
                    <span class="helper-text">
                        {{ t('settings.tools.hint') }}
                    </span>
                </div>

                <!-- Health Check Section -->
                <div class="setting-group">
                    <h4>{{ t('settings.health.title') }}</h4>
                    <div class="zombie-check-area" :class="{ 'has-zombies': zombieCheckState === 'ready' && zombieCount > 0 }">
                        <div v-if="zombieCheckState === 'checking'" class="zombie-safe fade-in">
                            <NeoIcon name="refresh" :size="16" />
                            <span>{{ t('settings.health.checking') }}</span>
                        </div>
                        <div v-else-if="zombieCheckState === 'busy'" class="zombie-safe zombie-busy fade-in" role="status" aria-live="polite">
                            <NeoIcon name="time" :size="20" />
                            <span>{{ t('settings.health.busy', { count: activeToolOperations }) }}</span>
                            <button class="text-btn" type="button" @click="checkZombies">{{ t('settings.health.recheck') }}</button>
                        </div>
                        <div v-else-if="zombieCheckState === 'error'" class="zombie-alert fade-in" role="alert" aria-live="polite">
                            <NeoIcon name="warn" :size="16" class="warning-icon" />
                            <div class="zombie-msg">
                                <strong>{{ zombieHealthStatus }}</strong>
                            </div>
                            <button class="text-btn" @click="checkZombies">
                                {{ t('settings.health.recheck') }}
                            </button>
                        </div>
                        <div v-else-if="zombieCount > 0" class="zombie-alert fade-in">
                            <NeoIcon name="warn" :size="16" class="warning-icon" />
                            <div class="zombie-msg">
                                <strong>{{ t('settings.health.zombies_found', { count: zombieCount }) }}</strong>
                                <span class="sub-msg">{{ t('settings.health.may_consume_mem') }}</span>
                            </div>
                            <button class="neo-button danger small" @click="killZombies">
                                {{ t('settings.health.clean') }}
                            </button>
                        </div>
                        <div v-else class="zombie-safe fade-in">
                            <NeoIcon name="check" :size="16" class="success-icon" />
                            <span>{{ t('settings.health.healthy') }}</span>
                            <button class="text-btn" @click="checkZombies">
                                {{ t('settings.health.recheck') }}
                            </button>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </div>

    <!-- YouTube Login Modal -->
    <div v-if="showYouTubeModal" class="modal-overlay" @click.self="showYouTubeModal = false" @keydown.escape.stop="showYouTubeModal = false" @keydown.tab.stop="trapTabKey(youtubeModalRef, $event)" tabindex="-1" role="dialog" aria-modal="true" :aria-labelledby="youtubeModalTitleId">
        <div ref="youtubeModalRef" class="modal-content auth-modal">
            <div class="modal-header">
                <div class="modal-title" :id="youtubeModalTitleId">
                    <NeoIcon name="play" :size="18" class="modal-title-icon" />
                    <h3>{{ t('settings.youtube_auth.title') }}</h3>
                </div>
                <button class="close-btn" @click="showYouTubeModal = false" :aria-label="t('settings.close')">
                    <NeoIcon name="cross" :size="16" :stroke-width="2.5" />
                </button>
            </div>
            <div class="auth-body">
                <p class="auth-desc">{{ t('settings.youtube_auth.description') }}</p>

                <div class="auth-tabs">
                    <button class="auth-tab" :class="{ active: youtubeAuthType === 'browser' }"
                        :disabled="isCheckingBrowser" @click="youtubeAuthType = 'browser'">
                        {{ t('settings.youtube_auth.browser_tab') }}
                    </button>
                    <button class="auth-tab" :class="{ active: youtubeAuthType === 'file' }"
                        :disabled="isCheckingBrowser" @click="youtubeAuthType = 'file'">
                        {{ t('settings.youtube_auth.file_tab') }}
                    </button>
                </div>

                <div v-if="youtubeAuthType === 'browser'" class="auth-content fade-in">
                    <div class="info-box small-text text-muted"
                        style="margin-bottom: 12px; background: var(--color-bg-alt); padding: 8px; border-radius: 4px; display: flex; gap: 8px; align-items: flex-start;">
                        <NeoIcon name="warn" :size="15" class="tip-icon" />
                        <span>{{ t('settings.youtube_auth.browser_policy_note') }}</span>
                    </div>

                    <p class="small-text text-muted">{{ t('settings.youtube_auth.login_step') }}</p>
                    <button class="neo-button small full-width" style="margin-bottom: 12px;" @click="openYouTubeLogin">
                        <NeoIcon name="external" :size="13" class="u-mr-xs" /> {{ t('settings.youtube_auth.open_login') }}
                    </button>

                    <p class="small-text text-muted">{{ t('settings.youtube_auth.browser_step') }}</p>
                    <div class="browser-select-row" style="display: flex; gap: 8px; align-items: center;">
                        <select v-if="browserOptions.length > 0" v-model="selectedBrowser" class="neo-select"
                            :disabled="isCheckingBrowser"
                            style="flex: 1;" :aria-label="t('settings.youtube_auth.browser_select_label')">
                            <option v-for="opt in browserOptions" :key="opt.value" :value="opt.value">
                                {{ opt.label }}
                            </option>
                        </select>
                        <button class="neo-button secondary small" @click="autoDetectBrowser"
                            :disabled="isCheckingBrowser" :title="t('settings.youtube_auth.auto_scan_title')">
                            <span><NeoIcon :name="isCheckingBrowser ? 'hourglass' : 'zap'" :size="13" class="u-mr-xs" /> {{ t('settings.youtube_auth.auto_match') }}</span>
                        </button>
                    </div>
                    <p v-if="isCheckingBrowser" class="small-text text-muted" role="status">{{ t('settings.browser.scanning') }}</p>
                    <div v-if="checkResult" class="small-text" role="status"
                        :class="checkResult.success ? 'text-success' : 'text-error'" style="margin-top: 4px; display: flex; align-items: center; gap: 4px;">
                        <NeoIcon :name="checkResult.success ? 'check' : 'warn'" :size="13" />
                        <span>{{ checkResult.message.replace(/^[✅❌]\s*/, '') }}</span>
                    </div>
                    <button v-if="checkResult && !checkResult.success" class="neo-button small" style="margin-top: 8px;" @click="youtubeAuthType = 'file'">{{ t('settings.youtube_auth.use_file') }}</button>

                    <div class="text-warning small-text" style="margin-top: 8px;">
                        {{ t('settings.youtube_auth.uncommon_browser_tip') }}
                    </div>

                </div>

                <div v-if="youtubeAuthType === 'file'" class="auth-content fade-in">
                    <div class="step-guide">
                        <div class="step-item">
                            <span class="step-num">1</span>
                            <div class="step-content">
                                <p>{{ t('settings.youtube_auth.extension_step') }} <span class="highlight">"Get cookies.txt LOCALLY"</span></p>
                                <div class="step-links">
                                    <a href="#"
                                        @click.prevent="store.openExternalUrl('https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc')">Chrome
                                        {{ t('settings.youtube_auth.store_suffix') }}</a>
                                    <span class="divider">|</span>
                                    <a href="#"
                                        @click.prevent="store.openExternalUrl('https://addons.mozilla.org/zh-CN/firefox/addon/get-cookies-txt-locally/')">Firefox
                                        {{ t('settings.youtube_auth.store_suffix') }}</a>
                                    <span class="divider">|</span>
                                    <a href="#"
                                        @click.prevent="store.openExternalUrl('https://microsoftedge.microsoft.com/addons/detail/get-cookiestxt-locally/lkhdajdccjigbadsjlkmoaaofjoewhlo')">Edge
                                        {{ t('settings.youtube_auth.store_suffix') }}</a>
                                </div>
                            </div>
                        </div>
                        <div class="step-item">
                            <span class="step-num">2</span>
                            <div class="step-content">
                                <p>{{ t('settings.youtube_auth.export_step') }}</p>
                            </div>
                        </div>
                        <div class="step-item">
                            <span class="step-num">3</span>
                            <div class="step-content">
                                <p>{{ t('settings.youtube_auth.choose_file_step') }}</p>
                                <div class="file-input-wrapper">
                                    <input type="text" v-model="cookieFile" readonly :placeholder="t('settings.youtube_auth.file_placeholder')"
                                        class="neo-input" :title="cookieFile" :aria-label="t('settings.youtube_auth.file_path_label')">
                                    <button @click="selectCookieFile" class="neo-button"><NeoIcon name="folder" :size="13" class="u-mr-xs" /> {{ t('settings.cookies_pick_file') }}</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div
                    v-if="youtubeAuthStatus"
                    class="auth-inline-status"
                    :class="youtubeAuthStatus.success ? 'text-success' : 'text-error'"
                    role="alert"
                >
                    <NeoIcon :name="youtubeAuthStatus.success ? 'check' : 'warn'" :size="14" />
                    <span>{{ youtubeAuthStatus.message }}</span>
                </div>

            </div>
            <div class="modal-footer">
                <button class="neo-button" @click="showYouTubeModal = false">{{ t('settings.youtube_auth.cancel') }}</button>
                <button class="neo-button primary" :disabled="isCheckingBrowser" :aria-busy="isCheckingBrowser" @click="confirmYouTubeAuth">{{ t(youtubeAuthType === 'file' ? 'settings.youtube_auth.confirm_file' : 'settings.youtube_auth.confirm') }}</button>
            </div>
        </div>
    </div>

    <!-- Bilibili QR Modal -->
    <div v-if="showBiliQr" class="modal-overlay" @click.self="closeBiliQr" @keydown.escape.stop="closeBiliQr" @keydown.tab.stop="trapTabKey(biliModalRef, $event)" tabindex="-1" role="dialog" aria-modal="true" :aria-labelledby="biliModalTitleId">
        <div ref="biliModalRef" class="modal-content qr-modal">
            <div class="modal-header">
                <div class="modal-title" :id="biliModalTitleId">
                    <NeoIcon name="tv" :size="18" class="modal-title-icon" />
                    <h3>{{ t('settings.bili_login.title') }}</h3>
                </div>
                <button class="close-btn" @click="closeBiliQr" :aria-label="t('settings.close')">
                    <NeoIcon name="cross" :size="16" :stroke-width="2.5" />
                </button>
            </div>
            <div class="qr-body">
                <div class="qr-wrapper">
                    <div v-if="biliQrImg" class="qr-img-container">
                        <img :src="biliQrImg" alt="Bilibili QR Code" />
                        <div class="qr-scan-line"></div>
                    </div>
                    <div v-else class="loading-spinner"></div>
                </div>

                <div class="qr-info">
                    <p class="qr-status"
                        :class="{ error: biliQrTone === 'error', success: biliQrTone === 'success' }">
                        {{ biliQrStatus }}
                    </p>
                    <p class="qr-hint">
                        {{ t('settings.bili_login.scan_hint_1') }} <span class="highlight">{{
                            t('settings.bili_login.scan_hint_app') }}</span><br>
                        {{ t('settings.bili_login.scan_hint_2') }} <span class="icon-scan">{{
                            t('settings.bili_login.scan_hint_icon') }}</span> {{ t('settings.bili_login.scan_hint_3') }}
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.settings-container {
    background-color: var(--color-surface);
    height: 100%;
    display: flex;
    flex-direction: column;
    /* Ensure it takes full space of modal */
}

.settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-md) var(--spacing-lg);
    border-bottom: var(--border-width) var(--border-style, solid) var(--color-border);
}

.settings-header h3 {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 700;
}

.close-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
    padding: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    transition: color 0.15s ease, transform 0.15s ease;
}

.close-btn:hover {
    color: var(--color-text);
    transform: scale(1.1);
}

.settings-tabs {
    display: flex;
    padding: 0 var(--spacing-lg);
    border-bottom: var(--border-width) var(--border-style, solid) var(--color-border);
    background-color: var(--color-bg-alt);
    gap: 4px;
    overflow-x: auto;
    flex-wrap: nowrap;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
}

.settings-tabs::-webkit-scrollbar {
    display: none;
}

.tab-btn {
    flex-shrink: 0;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: var(--spacing-md) var(--spacing-lg);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--color-text-muted);
    font-weight: 600;
    cursor: pointer;
    transition: color 160ms ease, background-color 160ms ease, border-color 160ms ease, opacity 160ms ease;
}

.tab-btn:hover {
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-primary) 7%, var(--color-surface));
    border-bottom-color: var(--color-primary);
}

.tab-btn.active {
    color: var(--color-primary);
    border-bottom-color: var(--color-primary);
}

.tab-icon {
    flex-shrink: 0;
    opacity: 0.85;
    transition: transform 0.15s ease, opacity 0.15s ease;
}

.tab-btn:hover .tab-icon,
.tab-btn.active .tab-icon {
    opacity: 1;
}

.tab-btn.active .tab-icon {
    transform: scale(1.08);
}

.section-title-icon {
    display: inline-block;
    vertical-align: -0.15em;
    margin-right: 6px;
    color: var(--color-primary);
}

.feature-check-icon {
    color: var(--color-success);
    flex-shrink: 0;
}

.tip-icon {
    flex-shrink: 0;
    color: var(--color-primary);
    margin-top: 2px;
}

.modal-title-icon {
    flex-shrink: 0;
    color: var(--color-primary);
}

.auth-modal {
    width: 450px;
    max-width: 90vw;
    max-height: min(90vh, 720px);
    display: flex;
    flex-direction: column;
}

.modal-content {
    background-color: var(--color-surface);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-hard);
    border: 2px solid var(--color-border);
    overflow: hidden;
    animation: popIn 0.3s ease-out;
}

.auth-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: var(--spacing-lg);
}

.auth-modal > .modal-header,
.auth-modal > .modal-footer {
    flex-shrink: 0;
}

.auth-modal > .modal-footer {
    margin-top: 0;
    padding: var(--spacing-md) var(--spacing-lg);
}

.cookie-connection-name > .helper-text {
    display: block;
}

.auth-desc {
    margin-bottom: var(--spacing-md);
    color: var(--color-text);
}

.auth-tabs {
    display: flex;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-lg);
    background-color: var(--color-bg-alt);
    padding: 4px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    /* Added border for visibility */
}

.auth-tab {
    flex: 1;
    min-height: 44px;
    padding: var(--spacing-sm) var(--spacing-md);
    border: 1px solid transparent;
    /* Prepare for border transition */
    background: none;
    cursor: pointer;
    font-weight: 600;
    color: var(--color-text-muted);
    border-radius: var(--radius-sm);
    transition: color 160ms ease, background-color 160ms ease, border-color 160ms ease, opacity 160ms ease;
    opacity: 0.7;
    /* Default opacity */
}

.file-input-wrapper > .neo-button,
.modal-footer > .neo-button {
    min-height: 44px;
    flex-shrink: 0;
}

.auth-tab:hover {
    color: var(--color-text);
    background-color: var(--color-bg-hover);
    /* Slight hover bg */
    opacity: 1;
}

.auth-tab.active {
    background-color: var(--color-surface);
    color: var(--color-primary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    border-color: var(--color-border);
    /* Add border to active tab */
    opacity: 1;
}

.auth-content {
    min-height: 120px;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
}

.modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--spacing-md);
    margin-top: var(--spacing-xl);
    padding-top: var(--spacing-md);
    border-top: 1px solid var(--color-border);
}

.guide-link {
    margin-top: 4px;
    font-size: 0.8rem;
    text-align: right;
}

.guide-link a {
    color: var(--color-primary);
    text-decoration: none;
}

.guide-link a:hover {
    text-decoration: underline;
}

.settings-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--spacing-lg);
}

.tab-pane {
    max-width: 600px;
    margin: 0 auto;
}

.setting-group {
    margin-bottom: var(--spacing-xl);
    padding-bottom: var(--spacing-lg);
    border-bottom: 1px dashed var(--color-border);
}

.setting-group:last-child {
    border-bottom: none;
}

.setting-group h4 {
    margin: 0 0 var(--spacing-md) 0;
    font-size: 1rem;
    color: var(--color-text);
    font-weight: 700;
}

.group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-md);
}

.expert-disclosure {
    margin-top: var(--spacing-sm);
    border-top: 1px solid color-mix(in srgb, var(--color-border) 32%, transparent);
}

.expert-disclosure > summary {
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    list-style: none;
    cursor: pointer;
    color: var(--color-text);
    font-size: 0.85rem;
    font-weight: 700;
}

.expert-disclosure > summary::-webkit-details-marker {
    display: none;
}

.expert-disclosure > summary::after {
    content: '▾';
    margin-left: var(--spacing-xs);
    color: var(--color-primary);
    flex-shrink: 0;
}

.expert-disclosure[open] > summary::after {
    content: '▴';
}

.expert-disclosure-hint {
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: 0.75rem;
    font-weight: 500;
    text-align: right;
}

.expert-disclosure-body {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    padding: 0 0 var(--spacing-sm);
}

.filename-template-disclosure .expert-disclosure-body {
    font-family: var(--font-body);
}

.setting-subsection {
    padding: var(--spacing-sm) 0 var(--spacing-md);
    border-top: 1px solid color-mix(in srgb, var(--color-border) 20%, transparent);
}

.setting-subsection:first-of-type {
    padding-top: 0;
    border-top: none;
}

.setting-subsection:last-child {
    padding-bottom: 0;
}

.setting-subsection .group-header {
    margin-bottom: var(--spacing-xs);
}

.setting-subsection > .neo-input,
.setting-subsection > .neo-select,
.setting-subsection > .range-input,
.setting-subsection > .client-config-grid {
    margin-top: var(--spacing-sm);
}

.sub-label.strong {
    color: var(--color-text);
    font-weight: 700;
}

.client-config-grid {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
}

.direct-login-area {
    margin-bottom: var(--spacing-lg);
}

.login-action,
.logged-in-state {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
}

.logged-in-state {
    background-color: var(--color-bg-alt);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    justify-content: space-between;
    width: 100%;
}

.user-badge {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-weight: 600;
    color: var(--color-success);
    min-width: 0;
    flex: 1 1 auto;
}

.cookie-connection-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}

.logged-in-state > button {
    flex-shrink: 0;
    white-space: nowrap;
}

.user-badge > svg { flex-shrink: 0; }

.user-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--color-border);
}

.text-btn.danger {
    color: var(--color-error);
    text-decoration: none;
    border: 1px solid transparent;
    padding: 2px 8px;
    border-radius: 4px;
}

.text-btn.danger:hover {
    background-color: var(--color-error-bg);
    border-color: var(--color-error);
}

.divider-line {
    height: 1px;
    background-color: var(--color-border);
    margin: var(--spacing-lg) 0;
    opacity: 0.5;
}

/* QR Modal Styles */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.6);
    z-index: 2000;
    display: flex;
    justify-content: center;
    align-items: center;
    backdrop-filter: blur(4px);
}

.step-guide {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 8px;
}

.step-item {
    display: flex;
    gap: 12px;
    align-items: flex-start;
}

.step-num {
    background: var(--color-primary);
    color: var(--color-background);
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    flex-shrink: 0;
    font-size: 0.9rem;
    margin-top: 2px;
}

.step-content {
    flex: 1;
}

.step-content p {
    margin: 0 0 4px 0;
    font-size: 0.95rem;
    line-height: 1.4;
}

.step-links {
    display: flex;
    gap: 8px;
    font-size: 0.9rem;
    align-items: center;
}

.step-links a {
    color: var(--color-primary);
    text-decoration: none;
}

.step-links a:hover {
    text-decoration: underline;
}

.step-links .divider {
    color: var(--color-text-muted);
}

.highlight {
    color: var(--color-primary);
    font-weight: 500;
}

.code {
    background: var(--color-bg-alt);
    padding: 2px 4px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.9em;
}

.qr-modal {
    max-height: min(90vh, 680px);
    display: flex;
    flex-direction: column;
    background-color: var(--color-surface);
    border: 3px solid var(--color-border);
    box-shadow: 8px 8px 0 rgba(0, 0, 0, 0.2);
    border-radius: var(--radius-lg);
    width: 380px;
    padding: 0;
    overflow: hidden;
    animation: popIn 0.3s ease-out;
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-md) var(--spacing-lg);
    background-color: var(--color-bg-alt);
    border-bottom: 2px solid var(--color-border);
}

.modal-title {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
}

.modal-title h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
}

.qr-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: var(--spacing-xl) var(--spacing-lg);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
}

.qr-wrapper {
    position: relative;
    margin-bottom: var(--spacing-lg);
}

.qr-img-container {
    background: white;
    padding: 12px;
    border: 2px solid var(--color-border);
    border-radius: 8px;
    box-shadow: var(--shadow-sm);
    position: relative;
    overflow: hidden;
}

.qr-img-container img {
    display: block;
    width: 180px;
    height: 180px;
}

.qr-scan-line {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 3px;
    background: var(--color-primary);
    box-shadow: 0 0 4px var(--color-primary);
    animation: scan 2.5s linear infinite;
    opacity: 0.6;
    pointer-events: none;
}

@keyframes scan {
    0% {
        transform: translateY(0);
    }

    100% {
        transform: translateY(200px);
    }
}

.qr-status {
    font-size: 1.1rem;
    font-weight: 700;
    margin-bottom: var(--spacing-sm);
    color: var(--color-text);
}

.qr-status.error {
    color: var(--color-error);
}

.qr-status.success {
    color: var(--color-success);
}

.qr-hint {
    font-size: 0.9rem;
    color: var(--color-text-muted);
    line-height: 1.6;
}

.highlight {
    color: var(--color-text);
    font-weight: 700;
    background-color: var(--color-surface-variant);
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.1);
}

.icon-scan {
    display: inline-block;
    font-size: 1.1em;
    vertical-align: middle;
    color: var(--color-text);
}

.loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid var(--color-bg-alt);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 70px 0;
}

@keyframes spin {
    0% {
        transform: rotate(0deg);
    }

    100% {
        transform: rotate(360deg);
    }
}

@keyframes popIn {
    0% {
        transform: scale(0.9);
        opacity: 0;
    }

    100% {
        transform: scale(1);
        opacity: 1;
    }
}

.info-box {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-sm);
}

.info-box {
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    padding: var(--spacing-md);
    border-radius: var(--radius-sm);
    margin-bottom: var(--spacing-md);
    font-size: 0.9rem;
    color: var(--color-text);
}

.info-title {
    font-weight: 700;
    margin-bottom: var(--spacing-xs);
    color: var(--color-primary);
}

.info-box p {
    margin: var(--spacing-xs) 0;
    line-height: 1.4;
}

.info-box ol {
    margin: var(--spacing-xs) 0;
    padding-left: 20px;
}

.info-box li {
    margin-bottom: 4px;
}

.warning-text {
    color: var(--color-warning);
    /* Amber for warning */
    font-weight: 600;
    font-size: 0.85rem;
    margin-top: var(--spacing-xs) !important;
}

/* Reusing existing styles but scoped properly */
.neo-input,
.neo-select {
    width: 100%;
    padding: 10px 12px;
    background-color: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font-size: 0.95rem;
    transition: border-color 0.2s;
    box-sizing: border-box;
    /* Ensure padding doesn't affect width */
}

.neo-input:focus,
.neo-select:focus {
    outline: none;
    border-color: var(--color-primary);
}

.neo-checkbox,
.neo-radio {
    accent-color: var(--color-primary);
    width: 16px;
    height: 16px;
}

/* Range Input & Labels */
.range-input {
    width: 100%;
    padding: 10px 0;
}

.range-slider {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin: 0 0 8px;
    accent-color: var(--color-primary);
    cursor: pointer;
}

.range-value-labels {
    display: flex;
    justify-content: space-between;
    color: var(--color-text-muted);
    font-size: 0.85rem;
    font-weight: 500;
}

/* Text Button */
.text-btn {
    background: none;
    border: none;
    color: var(--color-primary);
    cursor: pointer;
    text-decoration: underline;
    font-size: 0.9rem;
    padding: 0;
}

.text-btn.small {
    font-size: 0.8rem;
}

.text-btn:hover {
    color: var(--color-secondary);
}

.helper-text {
    display: block;
    font-size: 0.8rem;
    color: var(--color-text-muted);
    margin-top: 6px;
    line-height: 1.4;
}

/* Toggle Switch */
.toggle-switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
}

.toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
}

.slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--color-bg-alt);
    transition: background-color 160ms ease, border-color 160ms ease;
    border-radius: 9999px;
    border: 1px solid var(--color-border);
}

.slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 2px;
    bottom: 2px;
    background-color: var(--color-text-muted);
    transition: transform 160ms ease, background-color 160ms ease;
    border-radius: 50%;
}

input:checked+.slider {
    background-color: var(--color-primary);
    border-color: var(--color-primary);
}

input:checked+.slider:before {
    transform: translateX(20px);
    background-color: var(--color-text);
}

/* Rename Grid */
.rename-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 12px 0;
}

.checkbox-label.small {
    font-size: 0.85rem;
}

.rename-preview {
    background: var(--color-bg-alt);
    padding: 12px;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.9rem;
    line-height: 1.5;
    margin-top: 12px;
    border: 1px solid var(--color-border);
}

.preview-text {
    color: var(--color-primary);
    font-weight: bold;
    word-break: break-all;
}

.template-code {
    margin-top: 8px;
    color: var(--color-text-muted);
    font-size: 0.8rem;
}

/* Grid 2 Columns */
.grid-2-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 8px;
}

.input-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.input-label {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--color-text-muted);
}

/* Lang Grid */
.lang-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 12px;
}

.lang-checkbox-item,
.checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 0.9rem;
    user-select: none;
    padding: 4px 0;
}

.text-warning {
    color: var(--color-warning);
    /* Warning color for better visibility on light/dark */
    font-weight: 500;
    margin-bottom: 6px;
}

.small-text {
    font-size: 0.85rem;
}

/* Cookies */
.cookies-mode-selector {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
}

.mode-content {
    background: var(--color-bg-alt);
    padding: 12px;
    border-radius: var(--radius-sm);
}

.file-input-wrapper {
    display: flex;
    gap: 8px;
}


/* Update Section */
.update-section {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
}

.update-result {
    font-size: 0.85rem;
    padding: 8px;
    border-radius: var(--radius-sm);
    margin-bottom: 8px;
}

.has-update {
    background-color: var(--color-warning-bg);
    color: var(--color-warning);
    border: 1px solid var(--color-warning-border);
}

.success-text {
    color: var(--color-success);
}

.error-text {
    color: var(--color-error);
}

/* Fade In */
.fade-in {
    animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
    from {
        opacity: 0;
        transform: translateY(5px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* Scrollbar */
.custom-scrollbar::-webkit-scrollbar {
    width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
    background-color: var(--color-border);
    border-radius: var(--radius-sm);
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: var(--color-text-muted);
}

/* Health Check */
.zombie-check-area {
    background-color: var(--color-bg-alt);
    padding: 12px;
    border-radius: var(--radius-sm);
    margin-top: 8px;
    transition: background-color 180ms ease, border-color 180ms ease;
}

.zombie-check-area.has-zombies {
    border: 1px solid var(--color-error);
    background-color: color-mix(in srgb, var(--color-error), transparent 95%);
}

.zombie-alert,
.zombie-safe {
    display: flex;
    align-items: center;
    gap: 12px;
}

.zombie-msg {
    display: flex;
    flex-direction: column;
    flex: 1;
}

.sub-msg {
    font-size: 0.8rem;
    color: var(--color-text-muted);
    font-weight: normal;
}

.warning-icon {
    font-size: 1.5rem;
}

.success-icon {
    font-size: 1.5rem;
}

.zombie-alert span {
    color: var(--color-error);
    font-weight: bold;
}

.zombie-safe span {
    color: var(--color-success);
    font-weight: 500;
    flex: 1;
}

.zombie-safe.zombie-busy {
    background: var(--color-bg-hover);
    border-radius: var(--radius-sm);
    padding: 8px;
    color: var(--color-primary);
}
.zombie-safe.zombie-busy span { color: var(--color-text); }

.env-info {
    display: flex;
    flex-direction: column;
    gap: 0;
    background-color: var(--color-bg-alt);
    border: 2px solid var(--color-border);
    border-radius: var(--radius-sm);
    overflow: hidden;
}

.env-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-border);
    transition: background-color 0.2s;
}

.env-item:last-child {
    border-bottom: none;
}

.env-item:hover {
    background-color: var(--color-surface);
}

.env-name {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    color: var(--color-text);
}

.env-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    color: var(--color-primary);
}

.env-val {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: 0.9em;
    color: var(--color-text-muted);
}

.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--color-border);
}

.status-dot.success {
    background-color: var(--color-success);
    box-shadow: 0 0 4px var(--color-success);
}

.loading-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 20px;
    background-color: var(--color-bg-alt);
    border: 2px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    font-style: italic;
}

.spinner-small {
    width: 16px;
    height: 16px;
    border: 2px solid var(--color-text-muted);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

/* Tools Management Styles */
.tools-grid {
    display: flex;
    flex-direction: column;
    margin-bottom: 12px;
}

.settings-tool-row {
    min-height: 52px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--spacing-md);
    padding: var(--spacing-sm) 0;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 20%, transparent);
}

.settings-tool-row:last-child {
    border-bottom: none;
}

.app-tool-row {
    padding-top: 0;
}

.tool-header {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: var(--spacing-sm);
}

.tool-name {
    font-weight: 600;
    font-size: 0.95rem;
}

.tool-status {
    min-width: 0;
    font-size: 0.8rem;
    color: var(--color-text-muted);
    overflow-wrap: anywhere;
}

.tool-status.ok {
    color: var(--color-success);
}
.tool-update-status {
    font-size: 0.875rem;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.tool-actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;
}

.tool-actions-row {
    margin-top: 0;
    gap: var(--spacing-sm);
}

/* Notification Settings */
.setting-item-inline {
    display: flex;
    align-items: center;
    padding: 0.5rem 0;
}

.setting-item-inline label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
}

.sub-settings {
    margin-top: 0.75rem;
    padding-left: 1rem;
    border-left: 2px solid var(--color-border);
}

@media (prefers-reduced-motion: reduce) {
    .slider,
    .slider::before {
        transition: none;
    }
    .qr-scan-line,
    .spinner-small,
    .fade-in {
        animation: none;
    }
}
</style>
