import { createApp, h, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';

import DownloadList from '../../src/components/DownloadList.vue';
import { THEMES } from '../../src/constants';
import '../../src/styles.css';
import '../../src/styles-system-themes.css';
import '../../src/styles-theme-experience.css';
import zh from '../../src/locales/zh-CN.json';
import en from '../../src/locales/en-US.json';
import type { TaskPresentationRow } from '../../src/application/taskPresentation';
import type {
  CurrentFailureKind,
  CurrentTaskStatus,
} from '../../packages/contracts/src';
import { resolveCurrentTaskActions } from '../../packages/application/src/current-task-projection';

type Locale = 'zh-CN' | 'en-US';

interface Scenario {
  key: string;
  row: TaskPresentationRow;
  expectedOverflowItems: number;
}

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
    __YTDL_UI_MATRIX__?: MatrixResult;
  }
}

const host = document.querySelector<HTMLElement>('#app');
const report = document.querySelector<HTMLElement>('#qa-results');
if (!host || !report) throw new Error('QA host missing');

document.body.style.margin = '0';
document.body.style.padding = '12px';
document.body.style.background = 'var(--color-bg)';

const thumbnail =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">' +
      '<rect width="640" height="360" fill="#294b51"/>' +
      '<path d="M0 320L180 70L310 230L480 90L640 310V360H0Z" fill="#b5c9ab"/>' +
      '<circle cx="540" cy="60" r="24" fill="#e8d5aa"/>' +
    '</svg>',
  );

const baseMetadata = {
  title: '山野徒步记录 · 光影与远方',
  url: 'https://example.com/watch?v=video',
  thumbnail,
  channel: 'Weekend Stories',
  duration: '12:36',
  resolution: '1920×1080',
  filesize: '24.8 MB',
  filename: 'mountain-walk.mp4',
};

function row(
  key: string,
  status: CurrentTaskStatus,
  options: {
    failureKind?: CurrentFailureKind;
    selectedFormat?: TaskPresentationRow['selectedFormat'];
    progress?: number;
    path?: string;
    title?: string;
    metadata?: TaskPresentationRow['metadata'];
    cancelRequested?: boolean;
    hasExecution?: boolean;
    hasDownloadIntent?: boolean;
    logs?: readonly string[];
  } = {},
): TaskPresentationRow {
  const failureKind = options.failureKind;
  const actions = resolveCurrentTaskActions({
    status,
    ...(failureKind ? { failureKind } : {}),
    cancelRequested: options.cancelRequested === true,
    hasExecution: options.hasExecution === true,
    hasDownloadIntent: options.hasDownloadIntent === true,
  });
  const url = `https://example.com/${key}`;
  return {
    id: `attempt-${key}`,
    rowId: key,
    url,
    status,
    progress: options.progress ?? 0,
    logs: options.logs ?? [`[info] ${key} fixture log`],
    title: options.title ?? options.metadata?.title ?? (status === 'analyzing' ? url : baseMetadata.title),
    ...(options.selectedFormat !== undefined ? { selectedFormat: options.selectedFormat } : {}),
    cancelRequested: options.cancelRequested === true,
    actions,
    ...(options.metadata ? { metadata: options.metadata } : {}),
    ...(options.path ? { path: options.path } : {}),
    ...(failureKind ? { failureKind } : {}),
    ...(status === 'error' ? { errorMsg: `${key} failed for QA` } : {}),
  };
}

const longMetadata = {
  ...baseMetadata,
  title: 'Very long title '.repeat(24),
  channel: 'Very long channel '.repeat(40),
  filename: `very-long-${'filename-'.repeat(30)}.mkv`,
};

const audioMetadata = {
  ...baseMetadata,
  title: '林间声音 · 一个安静的下午',
  channel: 'Field Recording Studio',
  resolution: undefined,
  filename: 'forest-afternoon.mp3',
};

const scenarios: Scenario[] = [
  {
    key: 'analyzing',
    row: row('analyzing', 'analyzing'),
    expectedOverflowItems: 0,
  },
  {
    key: 'analyzed-video',
    row: row('analyzed-video', 'analyzed', { metadata: {
      ...baseMetadata,
      observedMaxHeight: 1080,
      requestedResolution: '2160p',
      youtubeDiagnostic: { cookieState: 'stale', runtimeState: 'succeeded', potState: 'generated' },
      clientCapabilities: [{ playerClient: 'mweb', observedMaxHeight: 1080, formats: [], diagnostic: { cookieState: 'stale', runtimeState: 'succeeded', potState: 'generated' } }],
    } }),
    expectedOverflowItems: 0,
  },
  {
    key: 'queued',
    row: row('queued', 'queued', { metadata: baseMetadata }),
    expectedOverflowItems: 0,
  },
  {
    key: 'pending',
    row: row('pending', 'pending', { metadata: baseMetadata }),
    expectedOverflowItems: 0,
  },
  {
    key: 'downloading',
    row: row('downloading', 'downloading', { metadata: baseMetadata, progress: 43 }),
    expectedOverflowItems: 0,
  },
  {
    key: 'processing',
    row: row('processing', 'processing', { metadata: baseMetadata, progress: 100 }),
    expectedOverflowItems: 0,
  },
  {
    key: 'completed',
    row: row('completed', 'completed', {
      metadata: baseMetadata,
      progress: 100,
      path: 'C:/Downloads/mountain-walk.mp4',
    }),
    expectedOverflowItems: 2,
  },
  {
    key: 'analysis-error',
    row: row('analysis-error', 'error', {
      failureKind: 'analysis',
      metadata: baseMetadata,
    }),
    expectedOverflowItems: 1,
  },
  {
    key: 'download-error',
    row: row('download-error', 'error', {
      failureKind: 'download',
      metadata: baseMetadata,
      hasExecution: true,
      hasDownloadIntent: true,
    }),
    expectedOverflowItems: 1,
  },
  {
    key: 'cancelled-error',
    row: row('cancelled-error', 'error', {
      failureKind: 'cancelled',
      metadata: baseMetadata,
      hasExecution: true,
      hasDownloadIntent: true,
    }),
    expectedOverflowItems: 1,
  },
  {
    key: 'analyzed-audio',
    row: row('analyzed-audio', 'analyzed', {
      metadata: audioMetadata,
      selectedFormat: 'mp3',
    }),
    expectedOverflowItems: 0,
  },
  {
    key: 'long-metadata',
    row: row('long-metadata', 'analyzed', {
      metadata: longMetadata,
      selectedFormat: 'mkv',
    }),
    expectedOverflowItems: 0,
  },
];

const i18nMessages = { 'zh-CN': zh, 'en-US': en };
const widths = [360, 519, 719, 960, 1280];
const locales: Locale[] = ['zh-CN', 'en-US'];
const themes = Object.values(THEMES);
const failures: MatrixFailure[] = [];
let passed = 0;
let app: ReturnType<typeof createApp> | undefined;

const settle = async () => {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

async function mount(locale: Locale, rows: readonly TaskPresentationRow[] = scenarios.map((scenario) => scenario.row)) {
  app?.unmount();
  const events: Array<{ rowId?: string; format?: string }> = [];
  const i18n = createI18n({
    legacy: false,
    locale,
    messages: i18nMessages,
  });
  app = createApp({
    render: () =>
      h(DownloadList, {
        items: rows,
        adminMode: false,
        maxConcurrency: 1,
        onDownload: (payload: { rowId?: string; format?: string }) => events.push(payload),
      }),
  });
  app.use(i18n);
  app.mount(host);
  await settle();
  return events;
}

function fail(locale: Locale, theme: string, width: number, check: string) {
  failures.push({ locale, theme, width, check });
}

function check(
  locale: Locale,
  theme: string,
  width: number,
  condition: unknown,
  label: string,
) {
  if (!condition) {
    fail(locale, theme, width, label);
    return false;
  }
  passed += 1;
  return true;
}

function visible(el: Element | null): el is HTMLElement {
  return Boolean(el && (el as HTMLElement).getClientRects().length);
}

function insideHost(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const outer = host.getBoundingClientRect();
  return rect.left >= outer.left - 1 && rect.right <= outer.right + 1;
}

function resolveToken(token: string) {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

async function validate(
  locale: Locale,
  theme: string,
  width: number,
  events: Array<{ rowId?: string; format?: string }>,
) {
  const label = `${locale} ${theme} ${width}`;
  const cards = [...host.querySelectorAll<HTMLElement>('.download-card')];

  check(locale, theme, width, cards.length === scenarios.length, `${label}: all semantic rows render`);
  check(locale, theme, width, host.scrollWidth <= host.clientWidth + 1, `${label}: host has no horizontal overflow`);

  for (const selector of [
    '.download-card',
    '.card-main',
    '.primary-metadata-row',
    '.format-menu',
    '.logs-panel',
    '.row-overflow-menu',
  ]) {
    for (const el of host.querySelectorAll<HTMLElement>(selector)) {
      if (!visible(el)) continue;
      check(locale, theme, width, insideHost(el), `${label}: ${selector} stays inside host`);
      check(locale, theme, width, el.scrollWidth <= el.clientWidth + 1, `${label}: ${selector} has no inner overflow`);
    }
  }

  const analyzing = host.querySelector<HTMLElement>('[data-row-id="analyzing"]');
  if (check(locale, theme, width, Boolean(analyzing), `${label}: analyzing row exists`) && analyzing) {
    const actualBorder = getComputedStyle(analyzing).borderTopColor;
    const semanticBorders = [
      resolveToken('--color-primary'),
      resolveToken('--color-success'),
      resolveToken('--color-error'),
    ];
    check(
      locale,
      theme,
      width,
      actualBorder !== 'transparent' && !semanticBorders.includes(actualBorder),
      `${label}: analyzing uses neutral border`,
    );
  }

  const zeroOverflow = host.querySelector<HTMLElement>('[data-row-id="analyzed-video"]');
  if (zeroOverflow) {
    check(
      locale,
      theme,
      width,
      !zeroOverflow.querySelector('.row-overflow-wrap'),
      `${label}: zero-action row has no overflow trigger`,
    );
  }

  const completed = host.querySelector<HTMLElement>('[data-row-id="completed"]');
  if (completed) {
    const trigger = completed.querySelector<HTMLButtonElement>('.row-overflow-trigger');
    check(locale, theme, width, Boolean(trigger), `${label}: completed row exposes overflow`);
    trigger?.scrollIntoView({ block: 'center' });
    trigger?.click();
    await settle();
    const menu = document.querySelector<HTMLElement>('.row-overflow-menu');
    const items = menu?.querySelectorAll('.row-overflow-menu-item').length ?? 0;
    check(locale, theme, width, visible(menu), `${label}: completed overflow opens`);
    check(locale, theme, width, items === 2, `${label}: completed overflow has two real actions`);
    trigger?.click();
    await settle();
  }

  for (const scenario of scenarios.filter((item) => item.expectedOverflowItems === 1)) {
    const card = host.querySelector<HTMLElement>(`[data-row-id="${scenario.key}"]`);
    const trigger = card?.querySelector<HTMLButtonElement>('.row-overflow-trigger');
    check(locale, theme, width, Boolean(trigger), `${label}: ${scenario.key} overflow trigger exists`);
    trigger?.scrollIntoView({ block: 'center' });
    trigger?.click();
    await settle();
    const menu = document.querySelector<HTMLElement>('.row-overflow-menu');
    const count = menu?.querySelectorAll('.row-overflow-menu-item').length ?? 0;
    check(locale, theme, width, visible(menu), `${label}: ${scenario.key} overflow opens`);
    check(locale, theme, width, count === 1, `${label}: ${scenario.key} overflow is not empty`);
    trigger?.click();
    await settle();
  }

  const video = host.querySelector<HTMLElement>('[data-row-id="analyzed-video"]');
  const audio = host.querySelector<HTMLElement>('[data-row-id="analyzed-audio"]');
  check(locale, theme, width, Boolean(video?.classList.contains('task-video')), `${label}: video identity`);
  check(locale, theme, width, Boolean(video?.querySelector('.thumbnail')), `${label}: video thumbnail`);
  check(locale, theme, width, Boolean(audio?.classList.contains('task-audio')), `${label}: audio identity`);
  check(locale, theme, width, Boolean(audio?.querySelector('.audio-artwork')), `${label}: audio artwork`);

  if (video) {
    const logToggle = video.querySelector<HTMLButtonElement>('.logs-toggle-btn');
    check(locale, theme, width, Boolean(logToggle), `${label}: direct log toggle exists`);
    if (logToggle) {
      const style = getComputedStyle(logToggle);
      check(locale, theme, width, style.boxShadow === 'none', `${label}: log toggle has no hard shadow`);
      logToggle.click();
      await settle();
      check(locale, theme, width, Boolean(video.querySelector('.logs-panel')), `${label}: logs expand directly`);
      check(locale, theme, width, logToggle.getAttribute('aria-expanded') === 'true', `${label}: logs aria-expanded`);
      video.querySelector<HTMLButtonElement>('.collapse-logs-btn')?.click();
      await settle();
    }

    const primaryAction = video.querySelector<HTMLButtonElement>('.primary-task-action');
    check(locale, theme, width, Boolean(primaryAction), `${label}: analyzed video primary action exists`);
    primaryAction?.click();
    await settle();
    const defaultDownload = events.at(-1);
    check(
      locale,
      theme,
      width,
      defaultDownload?.rowId === 'analyzed-video' && defaultDownload?.format === 'video',
      `${label}: unselected analyzed video emits MP4/video by default`,
    );

    const formatTrigger = video.querySelector<HTMLElement>('.format-trigger');
    check(locale, theme, width, formatTrigger?.textContent?.includes('MP4'), `${label}: default trigger label is MP4`);
    formatTrigger?.scrollIntoView({ block: 'center' });
    formatTrigger?.click();
    await settle();
    const menu = document.querySelector<HTMLElement>('.format-menu');
    check(locale, theme, width, formatTrigger?.getAttribute('aria-expanded') === 'true' && visible(menu), `${label}: format menu opens`);
    check(locale, theme, width, menu?.querySelectorAll('[role="menuitemradio"]').length === 6, `${label}: six current formats`);
    check(locale, theme, width, menu?.querySelectorAll('[role="group"] .format-group-heading').length === 2, `${label}: video/audio format groups`);
    const checkedFormat = menu?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
    check(locale, theme, width, checkedFormat?.textContent?.includes('MP4'), `${label}: MP4 is the checked default format`);
    menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    check(locale, theme, width, formatTrigger?.getAttribute('aria-expanded') === 'false' && !document.querySelector('.format-menu') && document.activeElement === formatTrigger, `${label}: Escape closes format menu`);
  }

  const longRow = host.querySelector<HTMLElement>('[data-row-id="long-metadata"]');
  if (longRow) {
    check(locale, theme, width, longRow.scrollWidth <= longRow.clientWidth + 1, `${label}: long metadata stays bounded`);
  }

  check(
    locale,
    theme,
    width,
    host.querySelectorAll('.row-overflow-menu:empty').length === 0,
    `${label}: no empty overflow menu nodes`,
  );
}

async function validateKeyboardRemovalContract() {
  const locale: Locale = 'en-US';
  const theme = 'light';
  const width = 960;
  const cases = [
    { key: 'analyzed-video', removable: false },
    { key: 'queued', removable: false },
    { key: 'downloading', removable: false },
    { key: 'processing', removable: false },
    { key: 'completed', removable: true },
    { key: 'analysis-error', removable: true },
  ] as const;

  document.documentElement.dataset.theme = theme;
  host.style.width = `${width}px`;
  host.style.maxWidth = 'none';

  for (const keyboardKey of ['Delete', 'Backspace'] as const) {
    for (const item of cases) {
      const scenario = scenarios.find((candidate) => candidate.key === item.key);
      if (!scenario) throw new Error(`Missing keyboard-removal scenario: ${item.key}`);

      await mount(locale, [scenario.row]);
      const card = host.querySelector<HTMLElement>(`[data-row-id="${item.key}"]`);
      check(locale, theme, width, Boolean(card), `${item.key}: keyboard-removal fixture exists`);
      card?.click();
      await settle();

      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: keyboardKey,
        bubbles: true,
        cancelable: true,
      }));
      await settle();

      const rowStillVisible = Boolean(host.querySelector(`[data-row-id="${item.key}"]`));
      check(
        locale,
        theme,
        width,
        item.removable ? !rowStillVisible : rowStillVisible,
        `${item.key}: ${keyboardKey} ${item.removable ? 'removes' : 'does not remove'} row according to canRemove`,
      );
    }
  }
}

async function run() {
  const total = locales.length * themes.length * widths.length;
  let combinations = 0;

  for (const locale of locales) {
    for (const theme of themes) {
      document.documentElement.dataset.theme = theme;
      for (const width of widths) {
        host.style.width = `${width}px`;
        host.style.maxWidth = 'none';
        const events = await mount(locale);
        await validate(locale, theme, width, events);
        combinations += 1;
        report.textContent = `RUNNING ${combinations}/${total} · failures=${failures.length}`;
      }
    }
  }

  await validateKeyboardRemovalContract();

  document.documentElement.dataset.theme = THEMES.COBALT_BUTTER;
  host.style.width = '960px';
  await mount('zh-CN');

  window.__YTDL_UI_MATRIX__ = {
    done: true,
    passed,
    total: combinations,
    failures,
    scenarios: scenarios.map((scenario) => scenario.key),
  };

  report.textContent =
    failures.length === 0
      ? `ALL PASS · ${combinations} combinations · ${scenarios.length} semantic scenarios`
      : `FAIL · ${failures.length} checks failed`;
}

window.__YTDL_UI_MATRIX__ = {
  done: false,
  passed: 0,
  total: 0,
  failures: [],
  scenarios: scenarios.map((scenario) => scenario.key),
};

run().catch((error) => {
  failures.push({
    locale: 'zh-CN',
    theme: 'runner',
    width: 0,
    check: error instanceof Error ? error.message : String(error),
  });
  window.__YTDL_UI_MATRIX__ = {
    done: true,
    passed,
    total: 0,
    failures,
    scenarios: scenarios.map((scenario) => scenario.key),
  };
  report.textContent = `FATAL · ${failures.at(-1)?.check ?? 'unknown'}`;
});
