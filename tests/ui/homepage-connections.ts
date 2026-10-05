import { createApp, h, nextTick, ref } from 'vue';
import { createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import InputSection from '../../src/components/InputSection.vue';
import SettingsPanel from '../../src/components/SettingsPanel.vue';
import { useAppStore } from '../../src/stores/appStore';
import { THEMES } from '../../src/constants';
import zh from '../../src/locales/zh-CN.json';
import en from '../../src/locales/en-US.json';
import '../../src/styles.css';
import '../../src/styles-system-themes.css';
import '../../src/styles-theme-experience.css';

const host = document.querySelector<HTMLElement>('#app')!;
const failures: { case: string; check: string }[] = [];
let checks = 0, caseCount = 0;
let app: ReturnType<typeof createApp> | undefined;
const settle = async () => { await nextTick(); await new Promise(r => setTimeout(r, 30)); await nextTick(); };
const check = (name: string, label: string, value: unknown) => { checks++; if (!value) failures.push({ case: name, check: label }); };
async function run() {
  for (const locale of ['zh-CN', 'en-US']) for (const theme of Object.values(THEMES)) {
    app?.unmount(); localStorage.clear(); document.documentElement.dataset.theme = theme;
    const pinia = createPinia(), store = useAppStore(pinia);
    let qrCalls = 0;
    Object.assign(store, {
      getInstalledBrowsers: async () => ['edge'],
      chooseCookieFile: async () => 'C:/fixtures/very-long-youtube-cookie-file-name-for-layout-testing.json',
      inspectCookieFile: async () => ({ state: 'imported', total: 1, matching: 1, fresh: 1 }),
      getBilibiliQrCode: async () => { qrCalls++; return { qrcode_key: 'fixture', url: 'https://example.com/qr' }; },
    });
    const intent = ref<'youtube-browser' | 'youtube-file' | 'bilibili' | null>(null);
    const i18n = createI18n({ legacy: false, locale, messages: { 'zh-CN': zh, 'en-US': en } });
    app = createApp({ render: () => h('main', { style: 'padding:16px;' }, [
      h(InputSection, { onConnect: (value: typeof intent.value) => { intent.value = value; } }),
      intent.value ? h(SettingsPanel, { connectionEntry: intent.value, onClose: () => { intent.value = null; } }) : null,
    ]) });
    app.use(pinia).use(i18n).mount(host); await settle();
    for (const entry of ['youtube-browser', 'youtube-file', 'bilibili']) {
      const name = `${locale}/${theme}/${entry}`; caseCount++;
      const button = host.querySelector<HTMLButtonElement>(`[data-connection-entry="${entry}"]`);
      check(name, 'homepage entry exists', button);
      if (!button) continue;
      const bounds = button.getBoundingClientRect();
      check(name, 'entry stays within viewport', bounds.left >= 0 && bounds.right <= innerWidth);
      check(name, 'touch target at least 44px', bounds.height >= 44);
      button.click(); await settle();
      check(name, 'opens direct connection dialog', host.querySelector('[aria-modal="true"]'));
      check(name, 'does not open settings behind connection', !host.querySelector('.settings-container'));
      if (entry === 'youtube-file') check(name, 'opens file tab directly', host.querySelector('.auth-modal input[readonly]'));
      if (entry === 'bilibili') check(name, 'starts QR flow', qrCalls === 1);
      const close = host.querySelector<HTMLButtonElement>('[aria-modal="true"] .close-btn');
      close?.click(); await settle();
      check(name, 'closing removes connection component', intent.value === null && !host.querySelector('[aria-modal="true"]'));
    }
    store.setPlatformCookie('youtube', 'C:/fixtures/' + 'long-name-'.repeat(30) + '.json');
    await settle();
    const name = `${locale}/${theme}/long-file`;
    caseCount++;
    const summary = host.querySelector<HTMLElement>('.platform-connection-summary');
    const source = summary?.querySelector<HTMLElement>('.platform-source');
    check(name, 'full path available on hover', summary?.title.endsWith('.json'));
    check(name, 'long filename is ellipsized', source && getComputedStyle(source).textOverflow === 'ellipsis' && source.scrollWidth > source.clientWidth);
    check(name, 'connection does not claim account login verified', host.textContent?.includes(i18n.global.t('settings.auth.credentials_pending')));
  }
}
void run().catch(e => { checks++; failures.push({ case: 'harness', check: String(e) }); }).finally(() => {
  const result = { done: true, caseCount, checkCount: checks, passedChecks: checks - failures.length, failures };
  Object.assign(window, { __YTDL_HOMEPAGE_CONNECTIONS__: result });
  document.querySelector('#qa-results')!.textContent = JSON.stringify(result, null, 2);
});
