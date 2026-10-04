import { createApp } from 'vue';
import { createPinia } from 'pinia';
import i18n from '../../src/i18n';
import App from '../../src/App.vue';
import { useAppStore } from '../../src/stores/appStore';
import '../../src/styles.css';
import '../../src/styles-system-themes.css';
import '../../src/styles-theme-experience.css';

declare global {
  interface Window {
    __YTDL_APP_SHELL_AUDIT__?: {
      done: boolean;
      passedChecks: number;
      caseCount: number;
      checkCount: number;
      failures: Array<{ check: string }>;
      scenarios: string[];
      loadError?: string;
    };
  }
}

window.__YTDL_APP_SHELL_AUDIT__ = {
  done: false,
  passedChecks: 0,
  caseCount: 0,
  checkCount: 0,
  failures: [],
  scenarios: ['app-shell'],
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  let loadError = '';
  let pinia: ReturnType<typeof createPinia> | null = null;
  try {
    const app = createApp(App);
    pinia = createPinia();
    app.use(pinia);
    app.use(i18n);
    app.mount('#app');
  } catch (error) {
    loadError = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  }

  await sleep(700);
  const failures: Array<{ check: string }> = [];
  const checks: Array<[string, boolean]> = [
    ['app mounts', Boolean(document.querySelector('#app > *'))],
    ['theme control visible', Boolean(document.querySelector('.theme-selector'))],
    ['settings trigger visible', Boolean(document.querySelector('.settings-toggle'))],
    ['resource capture entry hidden', !document.querySelector('.capture-sidebar-panel')],
    ['one main landmark', document.querySelectorAll('main').length === 1],
    ['sidebar operation panel visible', Boolean(document.querySelector('.sidebar-panel'))],
  ];

  if (pinia) {
    const store = useAppStore(pinia);
    // Exercise the actual composer/runtime seam before inspecting active panes.
    const input = document.querySelector<HTMLTextAreaElement>('textarea');
    if (input) {
      input.value = 'https://example.com/shell-audit';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(20);
      document.querySelector<HTMLButtonElement>('.analyze-btn-large')?.click();
      await sleep(150);
    }
    const layout = document.querySelector<HTMLElement>('.app-layout');
    const sidebar = document.querySelector<HTMLElement>('.sidebar');
    const sidebarPanel = document.querySelector<HTMLElement>('.sidebar-panel');
    const main = document.querySelector<HTMLElement>('.main-content');
    const logo = document.querySelector<HTMLElement>('.logo');
    const themeTrigger = document.querySelector<HTMLButtonElement>('.selector-trigger');
    const settingsTrigger = document.querySelector<HTMLButtonElement>('.settings-toggle');

    if (themeTrigger) {
      themeTrigger.click();
      await sleep(40);
      themeTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      await sleep(40);
      const menu = document.querySelector<HTMLElement>('.dropdown-menu');
      const focused = document.querySelector<HTMLElement>('.dropdown-item.focused');
      if (menu && focused) {
        const menuRect = menu.getBoundingClientRect();
        const focusedRect = focused.getBoundingClientRect();
        checks.push([
          'theme keyboard active option scrolls into view',
          focusedRect.top >= menuRect.top - 1 && focusedRect.bottom <= menuRect.bottom + 1,
        ]);
      } else {
        checks.push(['theme keyboard active option scrolls into view', false]);
      }
      themeTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(20);
    } else {
      checks.push(['theme selector trigger available for keyboard visibility audit', false]);
    }

    store.setTheme('fluent');
    await sleep(80);
    if (layout && sidebar && sidebarPanel && main && logo) {
      const fluentLayout = getComputedStyle(layout);
      const fluentSidebarPanel = getComputedStyle(sidebarPanel);
      const fluentLogo = getComputedStyle(logo);
      const sidebarRect = sidebar.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      checks.push(
        ['fluent shell uses grid', fluentLayout.display === 'grid'],
        ['fluent operation pane leads content', sidebarRect.left < mainRect.left && sidebarRect.right <= mainRect.left + 2],
        ['fluent sidebar is integrated without hard shadow', fluentSidebarPanel.boxShadow === 'none'],
        ['fluent app identity uses normal casing', fluentLogo.textTransform === 'none'],
        ['fluent theme trigger hit target is at least 44px', (themeTrigger?.getBoundingClientRect().height ?? 0) >= 43.5],
        ['fluent settings trigger hit target is at least 44px', (settingsTrigger?.getBoundingClientRect().height ?? 0) >= 43.5],
      );
    } else {
      checks.push(['fluent shell nodes available', false]);
    }

    store.setTheme('material');
    await sleep(80);
    if (layout && sidebar && sidebarPanel && main && logo) {
      const materialLayout = getComputedStyle(layout);
      const materialSidebarPanel = getComputedStyle(sidebarPanel);
      const sidebarRect = sidebar.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      checks.push(
        ['material shell uses grid', materialLayout.display === 'grid'],
        ['material operation pane leads content', sidebarRect.left < mainRect.left && sidebarRect.right <= mainRect.left + 2],
        ['material supporting pane uses large container shape', Number.parseFloat(materialSidebarPanel.borderRadius) >= 20],
        ['material supporting pane has no neo hard shadow', materialSidebarPanel.boxShadow === 'none'],
        ['material theme trigger hit target is at least 44px', (themeTrigger?.getBoundingClientRect().height ?? 0) >= 43.5],
        ['material settings trigger hit target is at least 44px', (settingsTrigger?.getBoundingClientRect().height ?? 0) >= 43.5],
      );
    } else {
      checks.push(['material shell nodes available', false]);
    }

    store.setTheme('cobalt-butter');
    await sleep(40);
  }

  let passed = 0;
  for (const [check, ok] of checks) {
    if (ok) passed += 1;
    else failures.push({ check });
  }

  window.__YTDL_APP_SHELL_AUDIT__ = {
    done: true,
    passedChecks: passed,
    caseCount: 1,
    checkCount: checks.length,
    failures,
    scenarios: ['app-shell'],
    ...(loadError ? { loadError } : {}),
  };
}

void run();
