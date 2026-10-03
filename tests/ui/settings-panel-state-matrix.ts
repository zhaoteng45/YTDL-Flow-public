import { createApp, h, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { createPinia } from 'pinia';

import SettingsPanel from '../../src/components/SettingsPanel.vue';
import { useAppStore } from '../../src/stores/appStore';
import { THEMES } from '../../src/constants';
import '../../src/styles.css';
import '../../src/styles-system-themes.css';
import '../../src/styles-theme-experience.css';
import zh from '../../src/locales/zh-CN.json';
import en from '../../src/locales/en-US.json';

type Locale = 'zh-CN' | 'en-US';

interface MatrixFailure {
  locale: Locale;
  theme: string;
  width: number;
  check: string;
}

interface MatrixResult {
  done: boolean;
  passed: number;
  total: number;
  failures: MatrixFailure[];
  scenarios: string[];
}

declare global {
  interface Window {
    __YTDL_SETTINGS_UI_MATRIX__?: MatrixResult;
  }
}

const host = document.querySelector<HTMLElement>('#app');
const report = document.querySelector<HTMLElement>('#qa-results');
if (!host || !report) throw new Error('QA host missing');

document.body.style.margin = '0';
document.body.style.padding = '12px';
document.body.style.background = 'var(--color-bg)';
// This matrix measures settled appearance, not transient color interpolation.
// Production reduced-motion/interaction behavior has separate gates.
const settledStyles = document.createElement('style');
settledStyles.textContent = 'html, body, #app *, #app *::before, #app *::after { transition: none !important; animation: none !important; }';
document.head.append(settledStyles);

const messages = { 'zh-CN': zh, 'en-US': en };
const locales: Locale[] = ['zh-CN', 'en-US'];
const themes = Object.values(THEMES);
const widths = [360, 720, 960];
const scenarios = ['format-tab', 'general-tab', 'advanced-tab', 'tools-tab'];
const failures: MatrixFailure[] = [];
let passed = 0;
let app: ReturnType<typeof createApp> | undefined;

const settle = async () => {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await nextTick();
};

function check(
  locale: Locale,
  theme: string,
  width: number,
  condition: unknown,
  label: string,
) {
  if (!condition) {
    failures.push({ locale, theme, width, check: label });
    return false;
  }
  passed += 1;
  return true;
}

async function mount(locale: Locale) {
  app?.unmount();
  localStorage.clear();

  const pinia = createPinia();
  const store = useAppStore(pinia);
  Object.assign(store, {
    checkZombieProcesses: async () => 0,
    inspectToolHealth: async () => ({ state: 'ready', zombieCount: 0 }),
    killZombieProcesses: async () => 0,
    getBinariesInfo: async () => ({
      ytdlp: '2026.09.28',
      ffmpeg: '7.1',
      bun: '1.4.2',
    }),
    getNotificationPermission: async () => true,
    requestNotificationPermission: async () => true,
    getNotificationSettings: async () => ({
      enabled: true,
      onSuccess: true,
      onError: true,
      onCancel: false,
    }),
    updateNotificationSettings: async () => {},
    getInstalledBrowsers: async () => ['chrome', 'edge'],
  });

  const filenameBefore = store.extraArgs.filenameTemplate;

  const i18n = createI18n({
    legacy: false,
    locale,
    messages,
  });

  app = createApp({
    render: () =>
      h(
        'section',
        {
          class: 'settings-matrix-shell',
          style: 'height:760px;width:100%;min-width:0;container:settings-frame / inline-size;',
        },
        [h(SettingsPanel)],
      ),
  });
  app.use(pinia);
  app.use(i18n);
  app.mount(host);
  await settle();

  return { store, filenameBefore };
}

function noHorizontalOverflow(el: HTMLElement | null) {
  return Boolean(el && el.scrollWidth <= el.clientWidth + 1);
}

function contrast(foreground: string, background: string) {
  const luminance = (value: string) => {
    const channels = (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

function validateBrand(locale: Locale, theme: string, width: number) {
  const root = getComputedStyle(document.documentElement);
  const expectedPrimary = { material: '#2457A7', fluent: '#843D4B', 'cobalt-butter': '#30363D' }[theme];
  check(locale, theme, width, root.getPropertyValue('--color-primary').trim().toUpperCase() === expectedPrimary, 'theme uses its approved independent primary');
  const probe = document.createElement('button');
  probe.className = 'neo-button primary';
  host.append(probe);
  const primary = getComputedStyle(probe);
  check(locale, theme, width, contrast(primary.color, primary.backgroundColor) >= 4.5, 'computed primary action pair meets AA');
  probe.className = 'neo-button secondary';
  const secondary = getComputedStyle(probe);
  const surfaces = { material: 'rgb(246, 248, 252)', fluent: 'rgb(250, 247, 242)', 'cobalt-butter': 'rgb(246, 247, 248)' };
  check(locale, theme, width, secondary.backgroundColor === surfaces[theme as keyof typeof surfaces], 'ordinary secondary uses the approved theme surface');
  check(locale, theme, width, contrast(secondary.color, secondary.backgroundColor) >= 4.5, 'computed secondary pair meets AA');
  check(locale, theme, width, contrast(secondary.borderTopColor, secondary.backgroundColor) >= 3, 'secondary control border meets 3:1');
  probe.remove();
  for (const name of ['success', 'warning', 'danger', 'info', 'busy']) {
    probe.style.backgroundColor = `var(--semantic-${name}-bg)`;
    probe.style.color = `var(--semantic-${name}-text)`;
    host.append(probe);
    const semantic = getComputedStyle(probe);
    check(locale, theme, width, contrast(semantic.color, semantic.backgroundColor) >= 4.5, `${name} text/background meets AA`);
    probe.remove();
  }
  probe.style.backgroundColor = 'var(--color-surface-subtle)';
  probe.style.color = 'var(--color-text-muted)';
  host.append(probe);
  check(locale, theme, width, contrast(getComputedStyle(probe).color, getComputedStyle(probe).backgroundColor) >= 4.5, 'muted text on actual subtle surface meets AA');
  probe.remove();
}

async function activateTab(index: number) {
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('.tab-btn')];
  const button = buttons[index];
  if (!button) throw new Error(`tab ${index} missing`);
  button.click();
  await settle();
  return button;
}

async function validate(locale: Locale, theme: string, width: number) {
  const label = `${locale} ${theme} ${width}`;
  const { store, filenameBefore } = await mount(locale);
  validateBrand(locale, theme, width);

  const palette = {
    material: ['rgb(226, 232, 241)', 'rgb(36, 87, 167)'],
    fluent: ['rgb(231, 224, 216)', 'rgb(132, 61, 75)'],
    'cobalt-butter': ['rgb(221, 225, 229)', 'rgb(48, 54, 61)'],
  }[theme];
  check(locale, theme, width, getComputedStyle(document.body).backgroundColor === palette?.[0], `${label}: approved tinted canvas renders`);
  const primaryProbe = document.createElement('button');
  primaryProbe.className = 'neo-button primary';
  primaryProbe.textContent = 'Download';
  host.append(primaryProbe);
  const primaryStyle = getComputedStyle(primaryProbe);
  check(locale, theme, width, primaryStyle.backgroundColor === palette?.[1], `${label}: independent primary color renders`);
  check(locale, theme, width, contrast(primaryStyle.color, primaryStyle.backgroundColor) >= 4.5, `${label}: primary action text meets AA`);
  primaryProbe.remove();

  const container = host.querySelector<HTMLElement>('.settings-container');
  const content = host.querySelector<HTMLElement>('.settings-content');
  const tabList = host.querySelector<HTMLElement>('.settings-tabs');
  const tabs = [...host.querySelectorAll<HTMLButtonElement>('.tab-btn')];

  check(locale, theme, width, Boolean(container && content), `${label}: settings shell renders`);
  check(locale, theme, width, tabs.length === 4, `${label}: four tabs render`);
  check(locale, theme, width, noHorizontalOverflow(container), `${label}: settings container no horizontal overflow`);
  check(locale, theme, width, store.extraArgs.filenameTemplate === filenameBefore, `${label}: mount does not mutate filename template`);
  check(locale, theme, width, !host.textContent?.includes('原始日志'), `${label}: no raw-log admin copy`);
  check(locale, theme, width, !host.textContent?.includes('Raw Logs'), `${label}: no raw-log admin copy English`);

  if (tabList && tabs.length === 4) {
    const vertical = getComputedStyle(tabList).flexDirection === 'column';
    check(
      locale,
      theme,
      width,
      tabList.getAttribute('aria-orientation') === (vertical ? 'vertical' : 'horizontal'),
      `${label}: tablist aria orientation matches rendered direction`,
    );

    tabs[0].click();
    await settle();
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', {
      key: vertical ? 'ArrowDown' : 'ArrowRight',
      bubbles: true,
    }));
    await settle();
    check(
      locale,
      theme,
      width,
      tabs[1].getAttribute('aria-selected') === 'true',
      `${label}: rendered-direction arrow key advances tab`,
    );

    if (theme === THEMES.FLUENT || theme === THEMES.MATERIAL) {
      check(
        locale,
        theme,
        width,
        tabs.every((tab) => tab.getBoundingClientRect().height >= 43.5),
        `${label}: system-theme tab hit targets stay at least 44px`,
      );
    }
  }

  for (let index = 0; index < tabs.length; index += 1) {
    const button = await activateTab(index);
    const pane = host.querySelector<HTMLElement>('.tab-pane');
    check(locale, theme, width, button.getAttribute('aria-pressed') === 'true', `${label}: tab ${index} aria pressed`);
    check(locale, theme, width, Boolean(pane), `${label}: tab ${index} pane renders`);
    check(locale, theme, width, noHorizontalOverflow(pane), `${label}: tab ${index} pane no horizontal overflow`);
    const selected = getComputedStyle(button);
    check(locale, theme, width, contrast(selected.color, selected.backgroundColor) >= 4.5, `${label}: selected nav text meets AA`);

    for (const group of host.querySelectorAll<HTMLElement>('.setting-group')) {
      check(locale, theme, width, noHorizontalOverflow(group), `${label}: tab ${index} group no horizontal overflow`);
      const groupStyle = getComputedStyle(group);
      check(locale, theme, width, ['rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)'].includes(groupStyle.backgroundColor) && groupStyle.boxShadow === 'none', `${label}: ordinary groups do not add nested gray cards`);
      const heading = group.querySelector('h4');
      const primaryText = { material: 'rgb(36, 48, 71)', fluent: 'rgb(48, 45, 48)', 'cobalt-butter': 'rgb(38, 43, 50)' }[theme];
      if (heading) check(locale, theme, width, getComputedStyle(heading).color === primaryText, `${label}: normal group headings use primary text, not brand`);
    }

    if (index === 1) {
      const renameToggle = host.querySelector<HTMLInputElement>('.setting-group input[type="checkbox"]');
      check(locale, theme, width, Boolean(renameToggle), `${label}: output rename toggle renders`);
      check(locale, theme, width, store.extraArgs.filenameTemplate === filenameBefore, `${label}: opening output remains side-effect free`);
    }

    if (index === 2) {
      check(locale, theme, width, !host.textContent?.includes('Core Engine Strategy'), `${label}: no static engine feature board`);
      check(locale, theme, width, !host.textContent?.includes('核心引擎策略'), `${label}: no static engine feature board zh`);
    }

    if (index === 3) {
      store.inspectToolHealth = async () => ({ state: 'busy', activeOperations: 2 });
      host.querySelector<HTMLButtonElement>('.zombie-check-area button')?.click();
      await settle();
      check(locale, theme, width, Boolean(host.querySelector('.zombie-check-area [role="status"]')), `${label}: busy health is nonblocking status`);
      check(locale, theme, width, !host.querySelector('.zombie-check-area [role="alert"]'), `${label}: busy health is not error`);
      store.inspectToolHealth = async () => { throw new Error('inspection denied'); };
      host.querySelector<HTMLButtonElement>('.zombie-check-area button')?.click();
      await settle();
      check(locale, theme, width, Boolean(host.querySelector('.zombie-check-area [role="alert"]')), `${label}: true inspection failure is alert`);
      store.inspectToolHealth = async () => ({ state: 'ready', zombieCount: 0 });
      host.querySelector<HTMLButtonElement>('.zombie-check-area button')?.click();
      await settle();
      check(locale, theme, width, host.querySelectorAll('.settings-tool-row').length === 4, `${label}: four flat tool rows render`);
      check(locale, theme, width, host.querySelectorAll('.tool-card').length === 0, `${label}: no nested tool cards render`);
      for (const row of host.querySelectorAll<HTMLElement>('.settings-tool-row')) {
        check(locale, theme, width, noHorizontalOverflow(row), `${label}: tool row no horizontal overflow`);
        check(locale, theme, width, ['rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)'].includes(getComputedStyle(row).backgroundColor), `${label}: tool rows stay on ordinary surface`);
      }
    }
  }
}

async function run() {
  const combinations = locales.length * themes.length * widths.length;
  let completed = 0;

  for (const locale of locales) {
    for (const theme of themes) {
      document.documentElement.dataset.theme = theme;
      for (const width of widths) {
        host.style.width = `${width}px`;
        host.style.maxWidth = 'none';
        await validate(locale, theme, width);
        completed += 1;
        report.textContent = `RUNNING ${completed}/${combinations} · failures=${failures.length}`;
      }
    }
  }

  const captureTheme = new URLSearchParams(location.search).get('theme');
  document.documentElement.dataset.theme = themes.find(theme => theme === captureTheme) ?? THEMES.MATERIAL;
  host.style.width = captureTheme ? '960px' : '720px';
  await mount('zh-CN');
  await activateTab(3);

  window.__YTDL_SETTINGS_UI_MATRIX__ = {
    done: true,
    passed,
    total: combinations,
    failures,
    scenarios,
  };
  report.textContent =
    failures.length === 0
      ? `ALL PASS · ${combinations} combinations`
      : `FAIL · ${failures.length} checks failed`;
}

window.__YTDL_SETTINGS_UI_MATRIX__ = {
  done: false,
  passed: 0,
  total: 0,
  failures: [],
  scenarios,
};

run().catch((error) => {
  failures.push({
    locale: 'zh-CN',
    theme: 'runner',
    width: 0,
    check: error instanceof Error ? error.message : String(error),
  });
  window.__YTDL_SETTINGS_UI_MATRIX__ = {
    done: true,
    passed,
    total: 0,
    failures,
    scenarios,
  };
  report.textContent = `FATAL · ${failures.at(-1)?.check ?? 'unknown'}`;
});
