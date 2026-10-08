import { createApp, h, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import SettingsPanel from '../../src/components/SettingsPanel.vue';
import { useAppStore } from '../../src/stores/appStore';
import { THEMES } from '../../src/constants';
import type { BrowserCookieCheck } from '../../src/application/credentialOperations';
import zh from '../../src/locales/zh-CN.json';
import en from '../../src/locales/en-US.json';
import '../../src/styles.css';
import '../../src/styles-system-themes.css';
import '../../src/styles-theme-experience.css';

const host = document.querySelector<HTMLElement>('#app')!;
const failures: { case: string; check: string }[] = [];
let checks = 0;
let caseCount = 0;
let app: ReturnType<typeof createApp> | undefined;
const settle = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 10)); await nextTick(); };
const check = (label: string, condition: unknown, name: string) => {
  checks++;
  if (!condition) failures.push({ case: name, check: label });
};
const button = (label: string, root: ParentNode = host) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.trim() === label);

async function run() {
  for (const locale of ['zh-CN', 'en-US']) for (const theme of Object.values(THEMES)) {
    document.documentElement.dataset.theme = theme;
    for (const scenario of ['success', 'locked', 'decrypt_failed', 'permission_denied', 'exception', 'cancelled', 'selected-only']) {
      const name = `${locale}/${theme}/${scenario}`;
      caseCount++;
      app?.unmount();
      localStorage.clear();
      const pinia = createPinia();
      const store = useAppStore(pinia);
      store.platformCookies.youtube = '';
      store.platformCookies.bilibili = '';
      const calls: string[] = [];
      let resolveCheck!: (value: BrowserCookieCheck) => void;
      let rejectCheck!: (error: Error) => void;
      Object.assign(store, {
        getNotificationPermission: async () => true,
        getNotificationSettings: async () => ({ enabled: false, onSuccess: true, onError: true, onCancel: false }),
        getInstalledBrowsers: async () => ['firefox', 'edge'],
        getBinariesInfo: async () => ({ bun: '1.4.2', ytdlp: '2026.08.19', ffmpeg: '9.0.2' }),
        inspectToolHealth: async () => ({ state: 'ready', zombieCount: 0 }),
        checkBrowserCookies: (browser: string) => {
          calls.push(browser);
          return new Promise<BrowserCookieCheck>((resolve, reject) => { resolveCheck = resolve; rejectCheck = reject; });
        },
      });
      const i18n = createI18n({ legacy: false, locale, messages: { 'zh-CN': zh, 'en-US': en } });
      const t = (key: string) => i18n.global.t(key);
      app = createApp({ render: () => h('section', { style: 'height:800px;container:settings-frame / inline-size;' }, [h(SettingsPanel)]) });
      app.use(pinia).use(i18n).mount(host);
      await settle();
      host.querySelector<HTMLButtonElement>('[data-settings-tab="general"]')?.click();
      await settle();
      for (const [key, expected] of [
        ['settings.auth.youtube_login', 'rgb(255, 0, 51)'],
        ['settings.auth.bili_login', 'rgb(255, 102, 153)'],
      ]) {
        const entry = button(t(key));
        check('platform entry keeps official color across themes: ' + key,
          entry && getComputedStyle(entry).backgroundColor === expected, name);
        check('platform entry uses readable dark text: ' + key,
          entry && getComputedStyle(entry).color === 'rgb(15, 15, 15)', name);
      }
      store.setPlatformCookie('bilibili', 'bilibili-fixture');
      await settle();
      button(t('settings.auth.youtube_login'))?.click();
      await settle();
      let modal = host.querySelector<HTMLElement>('.auth-modal');
      check('opens browser connection dialog', modal, name);
      if (!modal) continue;
      const dialogBounds = modal.getBoundingClientRect();
      const footerBounds = modal.querySelector<HTMLElement>('.modal-footer')!.getBoundingClientRect();
      check('keeps connection actions inside visible dialog', footerBounds.bottom <= dialogBounds.bottom && footerBounds.top >= dialogBounds.top, name);
      check('keeps dialog inside viewport', dialogBounds.bottom <= innerHeight && dialogBounds.right <= innerWidth && dialogBounds.left >= 0 && dialogBounds.top >= 0, name);
      const select = modal.querySelector<HTMLSelectElement>('select');
      check('defaults to an installed browser', select && ['firefox', 'edge'].includes(select.value), name);
      if (select) { select.value = 'firefox'; select.dispatchEvent(new Event('change', { bubbles: true })); }
      await settle();
      if (scenario === 'selected-only') {
        button(t('settings.youtube_auth.auto_match'), modal)?.click();
      } else {
        button(t('settings.youtube_auth.confirm'), modal)?.click();
      }
      await settle();
      check('reads only the selected browser', calls.length === 1 && calls[0] === 'firefox', name);
      check('does not save unverified browser while reading', !store.platformCookies.youtube, name);
      check('disables repeated confirmation while reading', button(t('settings.youtube_auth.confirm'), modal)?.disabled, name);
      if (!resolveCheck) continue;
      if (scenario === 'cancelled') {
        button(t('settings.youtube_auth.cancel'), modal)?.click();
        await settle();
      }
      if (scenario === 'exception') rejectCheck(new Error('read unavailable'));
      else resolveCheck({ success: ['success', 'cancelled', 'selected-only'].includes(scenario), kind: (['success', 'cancelled', 'selected-only'].includes(scenario) ? 'ok' : scenario) as BrowserCookieCheck['kind'], message: 'native diagnostic must not become untranslated UI' });
      await settle();
      modal = host.querySelector<HTMLElement>('.auth-modal');
      if (scenario === 'success') {
        check('persists selected browser only after successful read', store.platformCookies.youtube === 'firefox', name);
        check('closes after successful connection', !modal, name);
        check('does not claim authenticated account', host.textContent?.includes(t('settings.auth.credentials_pending')), name);
      } else if (scenario === 'cancelled') {
        check('ignores completion after cancellation', !store.platformCookies.youtube && !modal, name);
      } else {
        check('keeps dialog and does not save', modal && !store.platformCookies.youtube, name);
        check('does not leak raw native diagnostic', !modal?.textContent?.includes('native diagnostic'), name);
        check('shows localized detection result', modal?.textContent?.includes(t(`settings.browser.${scenario === 'selected-only' ? 'read_success' : scenario === 'exception' ? 'execution_failed' : scenario}`)), name);
        if (scenario !== 'selected-only') {
          button(t('settings.youtube_auth.use_file'), modal!)?.click();
          await settle();
          check('offers direct file fallback', host.querySelector('.auth-modal input[readonly]'), name);
        }
      }
      check('keeps Bilibili credentials separate', store.platformCookies.bilibili === 'bilibili-fixture', name);
    }

    {
      const name = `${locale}/${theme}/single-source-and-safe-errors`;
      caseCount++;
      app?.unmount();
      localStorage.clear();
      const pinia = createPinia();
      const store = useAppStore(pinia);
      store.setPlatformCookie('youtube', 'edge');
      store.setPlatformCookie('bilibili', 'bilibili-fixture');

      let nextPickedPath: string | null = 'C:/fixtures/preferred-file.txt';
      let nextInspectState: 'imported' | 'invalid' | 'expired' | 'mismatch' | 'unreadable' = 'imported';
      let shouldThrowPicker = false;
      Object.assign(store, {
        getNotificationPermission: async () => true,
        getNotificationSettings: async () => ({ enabled: false, onSuccess: true, onError: true, onCancel: false }),
        getInstalledBrowsers: async () => ['firefox', 'edge'],
        getBinariesInfo: async () => ({ bun: '1.4.2', ytdlp: '2026.08.19', ffmpeg: '9.0.2' }),
        inspectToolHealth: async () => ({ state: 'ready', zombieCount: 0 }),
        chooseCookieFile: async () => {
          if (shouldThrowPicker) {
            throw new Error('SYNTHETIC_NATIVE_ERROR C:/Users/private-account/cookies.txt SAPISID=SECRET');
          }
          return nextPickedPath;
        },
        inspectCookieFile: async () => ({
          state: nextInspectState,
          total: 1,
          matching: 1,
          fresh: 1,
        }),
        openExternalUrl: async () => {
          throw new Error('SYNTHETIC_LOGIN_ERROR C:/Users/private-account/login');
        },
      });

      const i18n = createI18n({ legacy: false, locale, messages: { 'zh-CN': zh, 'en-US': en } });
      const t = (key: string) => i18n.global.t(key);
      app = createApp({
        render: () =>
          h('section', { style: 'height:800px;container:settings-frame / inline-size;' }, [h(SettingsPanel)]),
      });
      app.use(pinia).use(i18n).mount(host);
      await settle();

      host.querySelector<HTMLButtonElement>('[data-settings-tab="general"]')?.click();
      await settle();
      const manageBtn = host.querySelector<HTMLButtonElement>('[data-youtube-manage]');
      check('exposes YouTube manage button when connected', manageBtn, name);
      manageBtn?.focus();
      manageBtn?.click();
      await settle();

      const modal = host.querySelector<HTMLElement>('.auth-modal');
      check('opens YouTube management modal', modal, name);
      if (modal) {
        const authBody = modal.querySelector<HTMLElement>('.auth-body');
        const footer = modal.querySelector<HTMLElement>('.modal-footer');
        const dialogRect = modal.getBoundingClientRect();
        const footerRect = footer?.getBoundingClientRect();
        check(
          'modal body is scrollable and footer remains reachable inside dialog',
          authBody &&
            getComputedStyle(authBody).overflowY === 'auto' &&
            footerRect &&
            footerRect.bottom <= dialogRect.bottom + 1 &&
            dialogRect.bottom <= innerHeight + 1,
          name,
        );

        const buttons = Array.from(modal.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
        check(
          'all active buttons in auth modal meet 44px minimum touch target height',
          buttons.length > 0 && buttons.every((btn) => btn.offsetHeight >= 44),
          name,
        );

        check('offers no backup picker or authorization',
          !modal.querySelector('[data-select-backup-cookie]') &&
          !modal.querySelector('[data-authorize-backup-cookie]'), name);
        button(t('settings.youtube_auth.file_tab'), modal)?.click();
        await settle();
        nextPickedPath = null;
        button(t('settings.cookies_pick_file'), modal)?.click();
        await settle();
        check('cancelled preferred file selection preserves selected browser',
          store.getEffectivePlatformSource('youtube').kind === 'browser', name);
        nextPickedPath = 'C:/fixtures/expired.txt';
        nextInspectState = 'expired';
        button(t('settings.cookies_pick_file'), modal)?.click();
        await settle();
        check('expired preferred file keeps previous source and displays safe reason',
          store.getEffectivePlatformSource('youtube').kind === 'browser' &&
          modal.textContent?.includes(t('input.cookie_state.expired')), name);
        shouldThrowPicker = true;
        button(t('settings.cookies_pick_file'), modal)?.click();
        await settle();
        check('native picker failure uses safe localized message',
          modal.textContent?.includes(t('settings.youtube_auth.file_select_failed')) &&
          !modal.textContent?.includes('SYNTHETIC_NATIVE_ERROR') &&
          !modal.textContent?.includes('private-account'), name);
        button(t('settings.youtube_auth.browser_tab'), modal)?.click();
        await settle();

        button(t('settings.youtube_auth.open_login'), modal)?.click();
        await settle();
        check(
          'external login open failure uses safe localized message without leaking native error',
          modal.textContent?.includes(t('settings.youtube_auth.login_open_failed')) &&
            !modal.textContent?.includes('SYNTHETIC_LOGIN_ERROR') &&
            !modal.textContent?.includes('private-account'),
          name,
        );

        const focusables = Array.from(
          modal.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null);
        const firstFocusable = focusables[0];
        const lastFocusable = focusables[focusables.length - 1];
        lastFocusable?.focus();
        modal.parentElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        check('Tab traps focus from last to first element inside modal', document.activeElement === firstFocusable, name);

        modal.parentElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await settle();
        check(
          'Escape closes modal and restores focus to trigger',
          !host.querySelector('.auth-modal') && document.activeElement === manageBtn,
          name,
        );
      }
    }
  }
}
void run().catch(error => { checks++; failures.push({ case: 'harness', check: String(error) }); }).finally(() => {
  const result = { done: true, caseCount, checkCount: checks, passedChecks: checks - failures.length, failures };
  Object.assign(window, { __YTDL_YOUTUBE_CONNECTION__: result });
  document.querySelector('#qa-results')!.textContent = JSON.stringify(result, null, 2);
});
