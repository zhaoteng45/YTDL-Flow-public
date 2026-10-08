import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { describe, expect, it, vi } from 'vitest';
import SettingsPanel from '../../src/components/SettingsPanel.vue';
import { useAppStore } from '../../src/stores/appStore';
import zh from '../../src/locales/zh-CN.json';
import en from '../../src/locales/en-US.json';

const source = readFileSync(resolve('src/components/SettingsPanel.vue'), 'utf8');

describe('SettingsPanel resilience contracts', () => {
  it('does not report system health before zombie inspection succeeds and surfaces maintenance failures', () => {
    expect(source).toMatch(/const zombieCheckState = ref<'checking' \| 'ready' \| 'busy' \| 'error'>\('checking'\)/);
    expect(source).toMatch(/store\.inspectToolHealth/);
    expect(source).toMatch(/v-else-if="zombieCheckState === 'busy'"[^>]*role="status"/);
    expect(source).toMatch(/checkZombies[\s\S]*?zombieCheckState\.value = 'checking'[\s\S]*?zombieCheckState\.value = 'ready'[\s\S]*?catch \(err\)[\s\S]*?zombieCheckState\.value = 'error'/);
    expect(source).toMatch(/killZombies[\s\S]*?settings\.health\.clean_failed/);
    expect(source).toMatch(/v-if="zombieCheckState === 'checking'"/);
    expect(source).toMatch(/v-else-if="zombieCheckState === 'error'"[^>]*role="alert"/);
    expect(source).toMatch(/v-else-if="zombieCount > 0"/);
    expect(source).toMatch(/clearTimeout\(zombieRecheckTimer\)/);
  });

  it('does not present notification defaults as persisted settings when native loading fails', () => {
    expect(source).toMatch(/const notificationSettingsLoaded = ref\(false\)/);
    expect(source).toMatch(/loadNotificationSettings[\s\S]*?notificationSettingsLoaded\.value = true[\s\S]*?catch \(e\)[\s\S]*?notificationSettingsLoaded\.value = false[\s\S]*?settings\.notifications\.load_failed/);
    expect(source).toMatch(/:disabled="!notificationSettingsLoaded"/);
    expect(source).toMatch(/permission_check_failed/);
  });

  it('shows explicit loading and error states for environment detection instead of fake green checks', () => {
    expect(source).toMatch(/const binariesLoadState = ref<'loading' \| 'ready' \| 'error'>\('loading'\)/);
    expect(source).toMatch(/fetchBinariesInfo[\s\S]*?binariesLoadState\.value = 'loading'[\s\S]*?binariesLoadState\.value = 'ready'[\s\S]*?catch \(err\)[\s\S]*?binariesLoadState\.value = 'error'/);
    expect(source).toMatch(/v-if="binariesLoadState === 'ready'"/);
    expect(source).toMatch(/v-else-if="binariesLoadState === 'error'"[^>]*role="alert"/);
    expect(source).toMatch(/settings\.environment\.load_failed/);
    expect(source).not.toMatch(/<span class="status-dot success"><\/span>/);
  });

  it('rolls notification settings back when persistence fails and exposes an inline status', () => {
    expect(source).toMatch(/const notificationStatus = ref/);
    expect(source).toMatch(/const persistNotificationSettings = async \(rollback/);
    expect(source).toMatch(/Object\.assign\(notificationSettings, rollback\)/);
    expect(source).toMatch(/settings\.notifications\.save_failed/);
    expect(source).toMatch(/const updateNotificationPreference/);
    expect(source).not.toMatch(/v-model="notificationSettings\.onSuccess"/);
    expect(source).not.toMatch(/v-model="notificationSettings\.onError"/);
    expect(source).not.toMatch(/v-model="notificationSettings\.onCancel"/);
    expect(source).toMatch(/v-if="notificationStatus"[^>]*role="(status|alert)"/);
  });

  it('bounds Bilibili polling failures and does not derive status styling from localized text', () => {
    expect(source).toMatch(/const biliQrTone = ref<'neutral' \| 'error' \| 'success'>\('neutral'\)/);
    expect(source).toMatch(/const BILI_MAX_POLL_FAILURES = 3/);
    expect(source).toMatch(/biliPollFailures\+\+/);
    expect(source).toMatch(/biliPollFailures >= BILI_MAX_POLL_FAILURES/);
    expect(source).toMatch(/clearInterval\(pollTimer\)[\s\S]*?pollTimer = null/);
    expect(source).toMatch(/settings\.bili_login\.status\.poll_failed/);
    expect(source).toMatch(/:class="\{ error: biliQrTone === 'error', success: biliQrTone === 'success' \}"/);
    expect(source).not.toMatch(/biliQrStatus\.includes\('失败'\)/);
    expect(source).not.toMatch(/biliQrStatus\.includes\('成功'\)/);
  });

  it('does not claim YouTube file authentication is connected without a selected cookies file', () => {
    expect(source).toMatch(/const youtubeAuthStatus = ref/);
    expect(source).toMatch(/confirmYouTubeAuth[\s\S]*?youtubeAuthType\.value === 'file'[\s\S]*?!cookieFile\.value\.trim\(\)[\s\S]*?youtubeAuthStatus\.value/);
    expect(source).toMatch(/settings\.youtube_auth\.file_required/);
    expect(source).toMatch(/const isYouTubeConnected = computed\([\s\S]*?platformCookies\.value\.youtube/);
    expect(source).toMatch(/store\.setPlatformCookie\('youtube'/);
    expect(source).toMatch(/store\.clearPlatformCookie\('youtube'\)/);
    expect(source).toMatch(/store\.setPlatformCookie\('bilibili'/);
    expect(source).toMatch(/store\.clearPlatformCookie\('bilibili'\)/);
    expect(source).not.toMatch(/watch\(\[cookieMode, selectedBrowser, cookieFile\][\s\S]*?extraArgs\.value\.cookies/);
    expect(source).toMatch(/v-if="youtubeAuthStatus"[^>]*role="alert"/);
  });

  it('surfaces YouTube native file-picker and external-login failures inside the auth modal without leaking raw errors, private paths, accounts, or cookies to DOM or console', async () => {
    expect(source).toMatch(/selectCookieFile[\s\S]*?catch[\s\S]*?youtubeAuthStatus\.value/);
    expect(source).toMatch(/settings\.youtube_auth\.file_select_failed/);
    expect(source).toMatch(/openYouTubeLogin[\s\S]*?catch[\s\S]*?youtubeAuthStatus\.value/);
    expect(source).toMatch(/settings\.youtube_auth\.login_open_failed/);

    for (const locale of ['zh-CN', 'en-US'] as const) {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const pinia = createPinia();
        const store = useAppStore(pinia);
        const rawMarker =
          'SYNTHETIC_NATIVE_ERROR C:/fixtures/private-account/cookies.txt account=secret-user@example.com SAPISID=SECRET_COOKIE_VALUE';
        store.chooseCookieFile = async () => {
          throw new Error(rawMarker);
        };
        store.openExternalUrl = async () => {
          throw new Error(rawMarker);
        };

        const i18n = createI18n({
          legacy: false,
          locale,
          messages: { 'zh-CN': zh, 'en-US': en },
        });
        let state: {
          showYouTubeModal?: boolean;
          selectCookieFile: () => Promise<void>;
          openYouTubeLogin: () => Promise<void>;
          youtubeAuthStatus: { success: boolean; message: string } | null;
        } | undefined;

        const createHarness = () => {
          const app = createSSRApp(SettingsPanel);
          app.use(pinia).use(i18n);
          app.mixin({
            created() {
              const setupState = (this as { $?: { setupState?: typeof state } }).$?.setupState;
              if (setupState?.selectCookieFile) {
                setupState.showYouTubeModal = true;
                state = setupState;
              }
            },
          });
          return app;
        };

        await renderToString(createHarness());
        expect(state).toBeDefined();

        await state!.selectCookieFile();
        expect(state!.youtubeAuthStatus?.success).toBe(false);
        expect(state!.youtubeAuthStatus?.message).toBe(
          i18n.global.t('settings.youtube_auth.file_select_failed'),
        );
        for (const forbidden of [
          'SYNTHETIC_NATIVE_ERROR',
          'private-account',
          'secret-user@example.com',
          'SECRET_COOKIE_VALUE',
          '{error}',
        ]) {
          expect(state!.youtubeAuthStatus?.message).not.toContain(forbidden);
        }

        await state!.openYouTubeLogin();
        expect(state!.youtubeAuthStatus?.success).toBe(false);
        expect(state!.youtubeAuthStatus?.message).toBe(
          i18n.global.t('settings.youtube_auth.login_open_failed'),
        );
        for (const forbidden of [
          'SYNTHETIC_NATIVE_ERROR',
          'private-account',
          'secret-user@example.com',
          'SECRET_COOKIE_VALUE',
          '{error}',
        ]) {
          expect(state!.youtubeAuthStatus?.message).not.toContain(forbidden);
        }

        const loggedText = [
          ...consoleErrorSpy.mock.calls,
          ...consoleWarnSpy.mock.calls,
          ...consoleLogSpy.mock.calls,
        ]
          .flat()
          .map((arg) => String(arg))
          .join(' ');
        expect(loggedText).not.toMatch(
          /SYNTHETIC_NATIVE_ERROR|private-account|secret-user@example\.com|SECRET_COOKIE_VALUE/,
        );
      } finally {
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleLogSpy.mockRestore();
      }
    }
  });

});
