import { createApp, h, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import DownloadList from '../../src/components/DownloadList.vue';
import { resolveCurrentTaskActions } from '../../packages/application/src/current-task-projection';
import type { TaskPresentationRow } from '../../src/application/taskPresentation';
import zh from '../../src/locales/zh-CN.json';
import en from '../../src/locales/en-US.json';
import '../../src/styles.css';
import '../../src/styles-system-themes.css';
import '../../src/styles-theme-experience.css';

declare global { interface Window { __YTDL_LOG_AUDIT__?: Record<string, unknown> } }
const settle = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 240)); };
async function run() {
  const params = new URLSearchParams(location.search);
  document.documentElement.dataset.theme = params.get('theme')!;
  const locale = params.get('locale') ?? 'zh-CN';
  const adminMode = params.get('admin') === 'true';
  // External Clipboard API boundary substitute; no OS clipboard is touched.
  let copied = '';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (value: string) => { copied = value; },
  } });
  const row: TaskPresentationRow = {
    id: 'qa-attempt', rowId: 'qa-console', url: 'https://example.com/video',
    status: 'downloading', progress: 42, cancelRequested: false,
    title: '日志验收示例 · Console verification',
    metadata: { title: '日志验收示例 · Console verification', url: 'https://example.com/video', filename: 'console-check.mp4', thumbnail: '', duration: '100', channel: 'QA' },
    // 160 synthetic lines intentionally exceed the 340px console viewport.
    logs: Array.from({ length: 160 }, (_, index) => `[12:03:${String(index % 60).padStart(2, '0')}.125] [download] ${index % 5 === 0 ? 'WARNING: ' : ''}segment ${index + 1} token=QA_SYNTHETIC_SECRET`),
    debugCommand: 'yt-dlp https://example.com/video?token=QA_SYNTHETIC_SECRET',
    actions: resolveCurrentTaskActions({ status: 'downloading', cancelRequested: false, hasExecution: true, hasDownloadIntent: true }),
  };
  // Same finite local task-region boundary as the production Active shell.
  createApp({ render: () => h('main', { class: 'download-queue', style: 'padding:16px;max-width:1280px;margin:16px auto;height:calc(100dvh - 32px);box-sizing:border-box' }, [h(DownloadList, { items: [row], adminMode, maxConcurrency: 1 })]) })
    .use(createI18n({ legacy: false, locale, messages: { 'zh-CN': zh, 'en-US': en } })).mount('#app');
  await settle();
  const failures: Array<{ check: string }> = [];
  let passed = 0;
  const check = (name: string, condition: boolean) => { if (condition) passed++; else failures.push({ check: name }); };
  const toggle = document.querySelector<HTMLButtonElement>('.logs-toggle-btn')!;
  toggle.click(); await settle();
  const panel = document.querySelector<HTMLElement>('.logs-panel')!;
  const console = document.querySelector<HTMLElement>('.logs-container')!;
  check('logs expand and expose log semantics', toggle.getAttribute('aria-expanded') === 'true' && console.getAttribute('role') === 'log');
  const timestamps = [...console.querySelectorAll<HTMLElement>('.log-timestamp')];
  check('supplied timestamps align without generating missing time', timestamps.length === 160 && timestamps[0].getBoundingClientRect().width === timestamps[1].getBoundingClientRect().width);
  check('terminal content remains selectable', getComputedStyle(console).userSelect === 'text');
  const style = getComputedStyle(console);
  check('console stays within bounded viewport', console.clientHeight <= 340 && console.scrollHeight > console.clientHeight);
  check('console owns scrolling and paint', style.overflowY === 'auto' && style.overscrollBehaviorY === 'contain' && style.contain.includes('paint'));
  const pageY = window.scrollY;
  console.scrollTop = 600;
  await settle();
  check('long logs actually scroll locally', console.scrollTop >= 590 && window.scrollY === pageY);
  check('admin compatibility keeps synthetic credentials redacted', !panel.textContent!.includes('QA_SYNTHETIC_SECRET'));
  const command = panel.querySelector<HTMLButtonElement>('.text-btn.small')!;
  command.click(); await settle();
  check('command expands with redacted text', !!panel.querySelector('.cmd-box') && !panel.querySelector('.cmd-box')!.textContent!.includes('QA_SYNTHETIC_SECRET'));
  command.click(); await settle();
  check('command collapses', !panel.querySelector('.cmd-box'));
  const copy = panel.querySelector<HTMLButtonElement>('.copy-logs-btn')!;
  copy.click(); await settle();
  check('copy calls Clipboard API with task/command/logs and redacts payload', copied.includes('yt-dlp') && copied.includes('segment 160') && !copied.includes('QA_SYNTHETIC_SECRET'));
  check('copy exposes success feedback', !!copy.querySelector('span') && copy.textContent!.toLowerCase().includes(locale === 'zh-CN' ? '已复制' : 'copied'));
  check('console actions have usable targets', [...panel.querySelectorAll<HTMLButtonElement>('.logs-header-actions button')].every(button => button.getBoundingClientRect().height >= 43.5));
  check('logs do not grow the document beyond the logical window', document.documentElement.scrollHeight <= innerHeight + 1);
  panel.querySelector<HTMLButtonElement>('.collapse-logs-btn')!.click(); await settle();
  check('logs collapse and restore disclosure state', !document.querySelector('.logs-panel') && toggle.getAttribute('aria-expanded') === 'false');
  toggle.click(); await settle();
  commandIsOpenForCapture();
  await settle();
  window.__YTDL_LOG_AUDIT__ = { done: true, caseCount: 1, passedChecks: passed, checkCount: passed + failures.length, failures, scenarios: ['long-log-scroll', 'commands', 'clipboard-boundary', 'admin-redaction'], adminMode, locale };
}
function commandIsOpenForCapture() { document.querySelector<HTMLButtonElement>('.logs-header-actions .text-btn.small')?.click(); }
void run().catch(error => { window.__YTDL_LOG_AUDIT__ = { done: true, caseCount: 1, passedChecks: 0, checkCount: 1, failures: [{ check: String(error) }] }; });
