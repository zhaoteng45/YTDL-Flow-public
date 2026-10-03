import { createApp, h, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { createPinia } from 'pinia';

import InputSection from '../../src/components/InputSection.vue';
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
    __YTDL_INPUT_UI_MATRIX__?: MatrixResult;
  }
}

const host = document.querySelector<HTMLElement>('#app');
const report = document.querySelector<HTMLElement>('#qa-results');
if (!host || !report) throw new Error('QA host missing');

document.body.style.margin = '0';
document.body.style.padding = '12px';
document.body.style.background = 'var(--color-bg)';

const messages = { 'zh-CN': zh, 'en-US': en };
const locales: Locale[] = ['zh-CN', 'en-US'];
const themes = Object.values(THEMES);
const widths = [320, 420, 560];
const scenarios = ['empty', 'multi-url-preview', 'analyze-emission'];
const failures: MatrixFailure[] = [];
let passed = 0;
let app: ReturnType<typeof createApp> | undefined;

const settle = async () => {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
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

function pxAtLeast(value: string, minimum: number) {
  return Number.parseFloat(value) >= minimum;
}

async function mount(locale: Locale) {
  app?.unmount();
  localStorage.clear();

  const pinia = createPinia();
  const store = useAppStore(pinia);
  store.downloadDir = 'C:/Users/zhao/Downloads/Very Long Media Archive Directory';
  store.systemDownloadDir = 'C:/Users/zhao/Downloads';
  store.extraArgs.cookies = '';

  const analyzeEvents: string[][] = [];
  const i18n = createI18n({
    legacy: false,
    locale,
    messages,
  });

  app = createApp({
    render: () =>
      h(
        'section',
        { class: 'neo-box sidebar-panel glass-panel input-matrix-panel' },
        [
          h(InputSection, {
            onAnalyze: (urls: string[]) => analyzeEvents.push(urls),
          }),
        ],
      ),
  });
  app.use(pinia);
  app.use(i18n);
  app.mount(host);
  await settle();

  return analyzeEvents;
}

function setTextarea(value: string) {
  const textarea = host.querySelector<HTMLTextAreaElement>('textarea');
  if (!textarea) throw new Error('textarea missing');
  textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  return settle();
}

async function validate(locale: Locale, theme: string, width: number) {
  const label = `${locale} ${theme} ${width}`;
  const analyzeEvents = await mount(locale);

  check(locale, theme, width, host.scrollWidth <= host.clientWidth + 1, `${label}: empty state no horizontal overflow`);

  const wrapper = host.querySelector<HTMLElement>('.input-wrapper');
  const textarea = host.querySelector<HTMLTextAreaElement>('.neo-textarea');
  const analyze = host.querySelector<HTMLButtonElement>('.analyze-btn-large');
  const directory = host.querySelector<HTMLElement>('.dir-select-btn');
  const openDirectory = host.querySelector<HTMLElement>('.open-dir-btn');

  check(locale, theme, width, Boolean(wrapper && textarea && analyze && directory && openDirectory), `${label}: primary controls render`);

  if (wrapper) {
    const style = getComputedStyle(wrapper);
    check(locale, theme, width, style.boxShadow === 'none', `${label}: nested input wrapper has no hard shadow`);
    check(locale, theme, width, Number.parseFloat(style.borderTopWidth) <= 1, `${label}: composer wrapper avoids a second heavy frame`);
    const field = wrapper.querySelector('textarea');
    check(locale, theme, width, !!field && Number.parseFloat(getComputedStyle(field).borderTopWidth) >= 1, `${label}: actual input retains a visible boundary`);
  }

  if (directory) {
    const style = getComputedStyle(directory);
    check(locale, theme, width, style.boxShadow === 'none', `${label}: directory control has no hard shadow`);
    check(locale, theme, width, style.borderTopWidth === '1px', `${label}: directory control uses Level-B border`);
  }

  if (openDirectory) {
    const style = getComputedStyle(openDirectory);
    check(locale, theme, width, style.boxShadow === 'none', `${label}: directory utility button has no hard shadow`);
    check(locale, theme, width, pxAtLeast(style.width, 44) && pxAtLeast(style.height, 44), `${label}: directory utility target >=44px`);
  }

  if (textarea) {
    check(locale, theme, width, pxAtLeast(getComputedStyle(textarea).fontSize, 16), `${label}: textarea font >=16px`);
    const pasteBtn = host.querySelector<HTMLElement>('.paste-btn');
    if (pasteBtn) {
      const textareaRect = textarea.getBoundingClientRect();
      const pasteRect = pasteBtn.getBoundingClientRect();
      check(locale, theme, width, pasteRect.right <= textareaRect.right + 1, `${label}: paste button within textarea right edge`);
      check(locale, theme, width, pasteRect.top >= textareaRect.top - 1, `${label}: paste button within textarea top edge`);
      check(locale, theme, width, pasteRect.bottom <= textareaRect.bottom, `${label}: paste button within textarea bottom edge`);
    }
  }

  await setTextarea(
    'https://www.youtube.com/watch?v=alpha1234567\nhttps://www.youtube.com/watch?v=beta12345678',
  );

  const preview = host.querySelector<HTMLElement>('.link-preview');
  check(locale, theme, width, Boolean(preview), `${label}: multi-url preview renders`);
  if (preview) {
    const style = getComputedStyle(preview);
    check(locale, theme, width, style.boxShadow === 'none', `${label}: link preview has no hard shadow`);
    check(locale, theme, width, preview.scrollWidth <= preview.clientWidth + 1, `${label}: link preview no horizontal overflow`);
  }

  check(locale, theme, width, host.querySelectorAll('.link-chip').length === 2, `${label}: two URL chips`);
  check(locale, theme, width, host.scrollWidth <= host.clientWidth + 1, `${label}: populated state no horizontal overflow`);

  analyze?.click();
  await settle();
  check(locale, theme, width, analyzeEvents.length === 1, `${label}: analyze emits once`);
  check(locale, theme, width, analyzeEvents[0]?.length === 2, `${label}: analyze emits two normal URLs`);
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

  document.documentElement.dataset.theme = THEMES.COBALT_BUTTER;
  host.style.width = '420px';
  await mount('zh-CN');
  await setTextarea('https://www.youtube.com/watch?v=alpha1234567');

  window.__YTDL_INPUT_UI_MATRIX__ = {
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

window.__YTDL_INPUT_UI_MATRIX__ = {
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
  window.__YTDL_INPUT_UI_MATRIX__ = {
    done: true,
    passed,
    total: 0,
    failures,
    scenarios,
  };
  report.textContent = `FATAL · ${failures.at(-1)?.check ?? 'unknown'}`;
});
