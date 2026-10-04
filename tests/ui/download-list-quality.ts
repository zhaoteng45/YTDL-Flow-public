import { createApp, h, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import DownloadList from '../../src/components/DownloadList.vue';
import { THEMES } from '../../src/constants';
import type { TaskPresentationRow } from '../../src/application/taskPresentation';
import type { ExtraArgs } from '../../src/types';
import { resolveCurrentTaskActions } from '../../packages/application/src/current-task-projection';
import zh from '../../src/locales/zh-CN.json';
import en from '../../src/locales/en-US.json';
import '../../src/styles.css';
import '../../src/styles-system-themes.css';
import '../../src/styles-theme-experience.css';

const host = document.querySelector<HTMLElement>('#app')!;
const failures: { check: string }[] = [];
let total = 0;
const check = (ok: boolean, label: string) => { total++; if (!ok) failures.push({ check: label }); };
const row = (rowId: string, status: TaskPresentationRow['status'], orderKey = 0,
  failureKind?: TaskPresentationRow['failureKind'], errorMsg?: string): TaskPresentationRow => ({
  id: rowId, rowId, status, orderKey, failureKind, errorMsg, url: `https://example.com/${rowId}`,
  title: rowId, progress: 0, logs: [], actions: resolveCurrentTaskActions({ status, failureKind }),
});
const items = [row('running', 'downloading'), row('third', 'queued', 30),
  row('parse', 'error', 0, 'analysis'), row('first', 'queued', 10), row('ready', 'analyzed'),
  row('second', 'queued', 20), row('cancel', 'error', 0, 'cancelled'),
  row('download', 'error', 0, 'download'), row('network', 'error', 0, 'download', 'Connection timed out'),
  row('unknown', 'error', 0, 'unknown')];
const sourceFormat = { formatId: '137', width: 1920, height: 1080, fps: 30, vcodec: 'h264', acodec: 'none', ext: 'mp4', protocol: 'https', usable: true };
items.push({ ...row('section', 'analyzed'), metadata: { title: 'section', thumbnail: '', channel: '', duration: '100', url: 'https://example.com/video', availableFormats: [sourceFormat, { ...sourceFormat, formatId: '137-hls', protocol: 'm3u8_native' }] } });
items.push(row('credentials', 'error', 0, 'download', 'Sign in to watch this video'));
items.push({ ...row('subtitle', 'completed'), logs: ['[Subtitle] failed; retrying media without optional subtitles'] });
const originalMedia = window.matchMedia;
const originalScroll = Element.prototype.scrollIntoView;
let reduced = false;
let lastScroll: ScrollIntoViewOptions | undefined;
window.matchMedia = (query) => query === '(prefers-reduced-motion: reduce)'
  ? { ...originalMedia.call(window, query), matches: reduced } as MediaQueryList
  : originalMedia.call(window, query);
Element.prototype.scrollIntoView = function (options) {
  lastScroll = typeof options === 'object' ? options : undefined;
};
try {
  for (const theme of Object.values(THEMES)) for (const locale of ['zh-CN', 'en-US'] as const) {
    document.documentElement.dataset.theme = theme;
    let downloaded: { rowId: string; options?: Partial<ExtraArgs> } | undefined;
    let recovery: { rowId: string; action: string } | undefined;
    const app = createApp({ render: () => h(DownloadList, { items, adminMode: false, onDownload: (payload) => { downloaded = payload; }, onRecover: (payload) => { recovery = payload; } }) });
    app.use(createI18n({ legacy: false, locale, messages: { 'zh-CN': zh, 'en-US': en } }));
    app.mount(host);
    await nextTick();
    const prefix = `${theme}/${locale}`;
    const section = host.querySelector<HTMLElement>('[data-row-id="section"]')!;
    const detailToggle = section.querySelector<HTMLButtonElement>('[data-task-detail-toggle]')!;
    check(detailToggle.getAttribute('aria-expanded') === 'false' && !section.querySelector('.task-details-panel'), `${prefix} details closed by default`);
    detailToggle.click(); await nextTick();
    check(detailToggle.getAttribute('aria-expanded') === 'true', `${prefix} details open by explicit action`);
    const select = section.querySelector<HTMLSelectElement>('.task-options select')!;
    check(select.options.length === 2, `${prefix} equivalent transport dedup`);
    select.value = '137'; select.dispatchEvent(new Event('change', { bubbles: true }));
    const times = section.querySelectorAll<HTMLInputElement>('.task-options input');
    times[0]!.value = '1:00'; times[0]!.dispatchEvent(new Event('input', { bubbles: true }));
    times[1]!.value = '1:10'; times[1]!.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    section.querySelector<HTMLButtonElement>('.primary-task-action')!.click(); await nextTick();
    check(downloaded?.rowId === 'section' && downloaded?.options?.formatSelector === '137+bestaudio' && downloaded?.options?.sectionStart === 60 && downloaded?.options?.sectionEnd === 70, `${prefix} UI submits validated format and section`);
    downloaded = undefined;
    times[1]!.value = '0:30'; times[1]!.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
    section.querySelector<HTMLButtonElement>('.primary-task-action')!.click(); await nextTick();
    check(!downloaded && Boolean(section.querySelector('[role="alert"]')), `${prefix} invalid section blocks download`);
    host.querySelector<HTMLButtonElement>('[data-row-id="credentials"] .recovery-button')!.click(); await nextTick();
    check(recovery?.rowId === 'credentials' && recovery?.action === 'credentials', `${prefix} credential recovery routing`);
    check(Boolean(host.querySelector('[data-row-id="subtitle"] .subtitle-warning')), `${prefix} subtitle delivery warning`);
    section.querySelector<HTMLButtonElement>('[data-detail-view="diagnostics"]')!.click(); await nextTick();
    check(Boolean(section.querySelector('.attempt-diagnostics')) && !section.querySelector('.task-options'), `${prefix} diagnostics replaces configuration content`);
    section.querySelector<HTMLButtonElement>('.logs-toggle-btn')!.click(); await nextTick();
    detailToggle.click(); await nextTick();
    check(!section.querySelector('.task-details-panel') && Boolean(section.querySelector('.logs-panel')), `${prefix} direct logs remain independent`);
    const badge = (id: string, selector: string) => host.querySelector(`[data-row-id="${id}"] ${selector}`)?.textContent?.trim();
    check(badge('third', '.queue-position-badge') === '#3', `${prefix} full mixed FIFO`);
    const search = host.querySelector<HTMLInputElement>('input')!;
    search.value = 'third'; search.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
    check(badge('third', '.queue-position-badge') === '#3', `${prefix} search preserves FIFO`);
    search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
    const labels = locale === 'en-US'
      ? ['Parse Failed', 'Cancelled', 'Download Failed', 'Network Failed', 'Unknown Error']
      : ['解析失败', '已取消', '下载失败', '网络失败', '未知错误'];
    ['parse', 'cancel', 'download', 'network', 'unknown'].forEach((id, index) =>
      check(badge(id, '.task-status-badge') === labels[index], `${prefix} ${id} label`));
    search.blur();
    for (const reduce of [false, true]) {
      reduced = reduce; lastScroll = undefined;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
      await nextTick();
      check(lastScroll?.behavior === (reduce ? 'auto' : 'smooth'), `${prefix} reduced=${reduce} scrolling`);
    }
    const selected = () => host.querySelector('.is-card-focused')?.getAttribute('data-row-id');
    const previous = selected();
    for (const tag of ['input', 'textarea', 'select', 'button', 'div']) {
      const control = document.createElement(tag); control.tabIndex = 0;
      if (tag === 'div') control.setAttribute('role', 'combobox');
      document.body.append(control); control.focus();
      for (const key of ['j', 'k', ' ', 'Delete', 'ArrowDown', 'Escape']) {
        lastScroll = undefined;
        control.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        await nextTick();
        check(selected() === previous && lastScroll === undefined && host.querySelectorAll('.download-card').length === items.length,
          `${prefix} ${tag} isolates ${key}`);
      }
      control.remove();
    }
    const menu = document.createElement('div'); menu.setAttribute('role', 'menu');
    const child = document.createElement('span'); menu.append(child); document.body.append(menu);
    for (const role of ['menu', 'button', 'combobox']) {
      menu.setAttribute('role', role);
      const event = new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true });
      child.dispatchEvent(event); await nextTick();
      check(selected() === previous, `${prefix} nested ${role} isolated`);
    }
    menu.remove();
    const handled = new KeyboardEvent('keydown', { key: 'j', cancelable: true }); handled.preventDefault();
    window.dispatchEvent(handled); await nextTick();
    check(selected() === previous, `${prefix} defaultPrevented isolated`);
    app.unmount();
  }
} finally {
  window.matchMedia = originalMedia;
  Element.prototype.scrollIntoView = originalScroll;
}
const result = { done: true, caseCount: 4, passedChecks: total - failures.length, checkCount: total, failures, scenarios: ['U1', 'U2', 'U3', 'U4'] };
const requestedTheme = new URLSearchParams(location.search).get('theme');
document.documentElement.dataset.theme = Object.values(THEMES).includes(requestedTheme as typeof THEMES[keyof typeof THEMES]) ? requestedTheme! : 'material';
const previewItems = items.filter(item => ['section', 'credentials', 'running'].includes(item.rowId)).map(item => ({ ...item, title: item.rowId === 'running' ? '示例：正在下载的媒体' : item.rowId === 'credentials' ? '示例：需要登录凭证的视频' : '示例：选择格式与下载片段', ...(item.metadata ? { metadata: { ...item.metadata, title: '示例：选择格式与下载片段', channel: '示例频道', duration: '01:40' } } : {}) }));
const preview = createApp({ render: () => h(DownloadList, { items: previewItems, adminMode: false }) });
preview.use(createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zh, 'en-US': en } }));
preview.mount(host); await nextTick();
host.querySelector<HTMLButtonElement>('[data-row-id="section"] [data-task-detail-toggle]')?.click(); await nextTick();
Object.assign(window, { __YTDL_QUALITY__: result });
document.querySelector('#qa-results')!.textContent = JSON.stringify(result, null, 2);
