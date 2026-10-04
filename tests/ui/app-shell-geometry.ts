import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import App from '../../src/App.vue';
import i18n from '../../src/i18n';
import { useAppStore } from '../../src/stores/appStore';
import type { AppTheme } from '../../src/constants';
import '../../src/styles.css';
import '../../src/styles-system-themes.css';
import '../../src/styles-theme-experience.css';

declare global {
  interface Window { __YTDL_SHELL_GEOMETRY__?: Record<string, unknown> }
}

const settle = async () => {
  await nextTick();
  await new Promise(resolve => setTimeout(resolve, 100));
  // Measure final colors, not a frame inside the theme color transition.
  await Promise.all(document.getAnimations()
    .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
    .map(animation => animation.finished.catch(() => undefined)));
};
async function run() {
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme') as AppTheme;
  const state = params.get('state') ?? 'empty';
  if (params.get('locale') === 'en-US') i18n.global.locale.value = 'en-US';
  const pinia = createPinia();
  const app = createApp(App).use(pinia).use(i18n);
  app.mount('#app');
  await settle();
  useAppStore(pinia).setTheme(theme);
  if (params.has('review')) useAppStore(pinia).extraArgs.cookies = 'C:/fixtures/cookies-www.youtube.com.json';
  await settle();
  if (state === 'active') {
    // Use production input → CurrentTaskService, not a duplicated fixture owner.
    const input = document.querySelector<HTMLTextAreaElement>('textarea')!;
    input.value = params.get('capture') === 'stress' ? Array.from({ length: 12 }, (_, index) => `https://example.com/geometry-${index}`).join('\n') : 'https://example.com/geometry';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    document.querySelector<HTMLButtonElement>('.analyze-btn-large')!.click();
    await settle();
  }
  const failures: Array<{ check: string }> = [];
  window.scrollTo(0, 0);
  let passed = 0;
  const check = (name: string, condition: boolean) => { if (condition) passed++; else failures.push({ check: name }); };
  const probe = document.createElement('span');
  const expectedThemeName = { material: '蓝宝石', fluent: '酒红', 'cobalt-butter': '石墨' }[theme];
  check('homepage theme selector renders the Chinese name', document.querySelector('.selector-trigger')?.textContent?.trim() === expectedThemeName);
  probe.style.color = 'var(--color-primary)';
  document.body.append(probe);
  const primary = getComputedStyle(probe).color;
  probe.remove();
  const expectedPrimary = { material: 'rgb(36, 87, 167)', fluent: 'rgb(132, 61, 75)', 'cobalt-butter': 'rgb(184, 204, 232)' }[theme];
  check('theme renders its approved independent primary', primary === expectedPrimary);
  const textarea = document.querySelector('textarea')!;
  const placeholder = getComputedStyle(textarea, '::placeholder');
  const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const bg = rgb(getComputedStyle(textarea).backgroundColor);
  const opacity = Number(placeholder.opacity);
  const fg = rgb(placeholder.color).map((channel, i) => channel * opacity + bg[i] * (1 - opacity));
  const luminance = (channels: number[]) => channels.map(channel => {
    const c = channel / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (Math.max(luminance(fg), luminance(bg)) + 0.05) / (Math.min(luminance(fg), luminance(bg)) + 0.05);
  check('rendered placeholder contrast meets AA including opacity', contrast >= 4.5);
  const header = document.querySelector<HTMLElement>('.header')!;
  if (theme === 'cobalt-butter') {
    check('Graphite renders the approved dark header', getComputedStyle(header).backgroundColor === 'rgb(32, 35, 40)');
    for (const control of header.querySelectorAll<HTMLElement>('.header-control, .logo, .badge')) {
      const style = getComputedStyle(control);
      const backdrop = style.backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(header).backgroundColor : style.backgroundColor;
      const [light, dark] = [luminance(rgb(style.color)), luminance(rgb(backdrop))].sort((a,b) => b-a);
      check('Graphite header foreground meets AA', (light + 0.05) / (dark + 0.05) >= 4.5);
    }
  }
  const layout = document.querySelector<HTMLElement>('.app-layout')!;
  const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
  const main = document.querySelector<HTMLElement>('.main-content')!;
  const rect = layout.getBoundingClientRect();
  const sr = sidebar.getBoundingClientRect();
  const mr = main.getBoundingClientRect();
  if (params.has('review')) {
    const label = document.querySelector<HTMLElement>('.selector-trigger .label-text')!;
    const trigger = document.querySelector<HTMLElement>('.selector-trigger')!;
    const labelRect = label.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    check('theme name is geometrically centered', Math.abs(labelRect.left + labelRect.width / 2 - triggerRect.left - triggerRect.width / 2) <= 1);
    trigger.click();
    await settle();
    for (const option of document.querySelectorAll<HTMLElement>('.dropdown-item')) {
      const text = option.querySelector<HTMLElement>('.item-label')!.getBoundingClientRect();
      const bounds = option.getBoundingClientRect();
      check('menu theme name is geometrically centered', Math.abs(text.left + text.width / 2 - bounds.left - bounds.width / 2) <= 1);
    }
    trigger.click();
    await settle();
    check('permanent shortcut cheat sheet is absent', !document.querySelector('.kbd-shortcuts-tip'));
    const cookie = document.querySelector<HTMLElement>('.cookie-title-text')!;
    check('cookie heading is not truncated', cookie.scrollWidth <= cookie.clientWidth + 1);
    const inputBounds = document.querySelector('textarea')!.getBoundingClientRect();
    const actions = document.querySelector('.input-actions')!.getBoundingClientRect();
    check('input tools do not overlap editable text', actions.top >= inputBounds.bottom - 1);
    if (innerWidth > 980) check('composer stays on the left in all themes and states', sr.right <= mr.left + 1);
    if (innerWidth >= 1920 && state === 'empty') check('wide empty workspace uses available width', rect.width >= 1400);
  }
  const composer = document.querySelector<HTMLElement>('.sidebar-panel')!;
  const composerBackground = getComputedStyle(composer).backgroundColor;
  const expectedSurface = { material: 'rgb(246, 248, 252)', fluent: 'rgb(250, 247, 242)', 'cobalt-butter': 'rgb(32, 35, 40)' }[theme];
  check('composer uses the approved working surface', composerBackground === expectedSurface ||
    (composerBackground === 'rgba(0, 0, 0, 0)' && getComputedStyle(sidebar).backgroundColor === expectedSurface));
  check('row count projects requested workspace state', layout.dataset.workspaceState === state);
  check('document has no horizontal overflow', document.documentElement.scrollWidth <= innerWidth + 1);
  check('layout stays inside viewport', rect.left >= 8 && rect.right <= innerWidth - 8);
  check('composer remains usable', document.querySelector('textarea')!.getBoundingClientRect().width >= 260);
  check('header has no overflow', document.querySelector('.header')!.scrollWidth <= document.querySelector('.header')!.clientWidth + 1);
  check('operation pane has no backdrop blur', getComputedStyle(sidebar).backdropFilter === 'none');
  if (state === 'empty') {
    check('empty first screen needs no page scrolling (1px rounding)', document.documentElement.scrollHeight <= innerHeight + 1);
    for (const selector of ['.header', 'textarea', '.input-actions', '.analyze-btn-large', '.dir-control-group', '.cookie-control-group']) {
      const bounds = document.querySelector(selector)!.getBoundingClientRect();
      check(`${selector} fully visible in empty first screen`, bounds.top >= 0 && bounds.bottom <= innerHeight + 1);
    }
    const brand = document.querySelector<HTMLImageElement>('.brand-logo');
    check('formal logo is loaded and leads compact wordmark', Boolean(brand?.complete && brand.naturalWidth && brand.getBoundingClientRect().height >= 40));
    const er = document.querySelector('.empty-state')!.getBoundingClientRect();
    check('empty composition stays bounded on large desktops', rect.width <= 1680 + 1);
    // Round-three native brief permits an expressive supporting plane; budget is
    // 540px beside the composer, 200px for the stacked workflow ribbon.
    check('empty guide fits its horizontal or ribbon budget', er.height <= (innerWidth > 980 ? 540 : 200) && er.width <= 1240);
    check('guide has no competing primary action', !document.querySelector('.empty-state .primary'));
    if (innerWidth > 980) {
      check('empty workbench does not stretch to fill the viewport', rect.height <= Math.max(sr.height, mr.height) + 2);
      check('composer leads horizontal composition in every theme', sr.right <= mr.left + 1);
    } else {
      check('empty start surface has no stretched inter-pane void', mr.top - sr.bottom <= 40 && rect.height <= sr.height + mr.height + 40);
      check('composer leads guidance in a vertical start surface', sr.bottom <= mr.top + 1);
    }
  } else {
    check('actual task card mounted', Boolean(document.querySelector('.download-card')));
    check('active workspace uses contained regions instead of page scroll', document.documentElement.scrollHeight <= innerHeight + 1);
    if (params.get('capture') === 'stress') {
      const queue = document.querySelector<HTMLElement>('.download-queue')!;
      check('many production task rows use a local scroll region', document.querySelectorAll('.download-card').length === 12 && queue.scrollHeight > queue.clientHeight + 1);
      if (innerWidth <= 980) {
        const analyze = document.querySelector('.analyze-btn-large')!.getBoundingClientRect();
        check('compact active primary stays visible even with many link previews', analyze.top >= sr.top && analyze.bottom <= sr.bottom);
        check('compact active task region outweighs command strip', mr.height > sr.height);
      }
      queue.scrollTop = queue.scrollHeight;
      check('task region scroll reaches later tasks without moving the page', queue.scrollTop > 0 && window.scrollY === 0);
      queue.scrollTop = 0;
    }
    const wide = innerWidth > 980;
    check('active task workspace has usable content width', mr.width >= (wide ? 500 : innerWidth - 100));
    if (wide) {
      check('active operation pane stays within brief', sr.width >= 320 && sr.width <= 380);
      check('active operation pane stays on the left in every theme', sr.right <= mr.left + 1);
    } else {
      check('narrow active workspace stacks support before tasks', sr.bottom <= mr.top + 1);
    }
  }
  const settingsGeometry: Record<string, unknown> = {};
  if (params.get('capture') === 'settings') {
    document.querySelector<HTMLButtonElement>('.settings-toggle')!.click();
    await settle();
    const dialog = document.querySelector<HTMLElement>('.settings-modal-content')!;
    const bounds = dialog.getBoundingClientRect();
    check('full-window settings backdrop does not blur', getComputedStyle(document.querySelector('.modal-overlay')!).backdropFilter === 'none');
    check('production settings dialog stays inside desktop frame', bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth);
    for (const tab of ['general', 'advanced', 'format', 'tools']) {
      document.querySelector<HTMLButtonElement>(`[data-settings-tab="${tab}"]`)!.click();
      await settle();
      const content = document.querySelector<HTMLElement>('.settings-content')!;
      content.scrollTop = 0;
      const cr = content.getBoundingClientRect();
      const groups = [...content.querySelectorAll<HTMLElement>('.tab-pane > .setting-group')];
      const visible = groups.filter(group => group.getBoundingClientRect().bottom <= cr.bottom + 1).length;
      settingsGeometry[tab] = { totalGroups: groups.length, fullyVisibleGroups: visible, clientHeight: content.clientHeight, scrollHeight: content.scrollHeight };
      check(`${tab} settings avoids horizontal overflow`, content.scrollWidth <= content.clientWidth + 1);
      check(`${tab} core settings have visible groups`, visible >= Math.min(innerHeight >= 900 ? 2 : 1, groups.length));
    }
  }
  window.__YTDL_SHELL_GEOMETRY__ = { done: true, passed, total: passed + failures.length, failures,
    scenarios: [theme, state], geometry: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio, primary,
      pageScroll: document.documentElement.scrollHeight > innerHeight + 1,
      localScroll: [...document.querySelectorAll<HTMLElement>('.download-queue, .settings-content, .logs-container')].some(el => el.scrollHeight > el.clientHeight + 1),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      scrollHeight: document.documentElement.scrollHeight, layout: rect.toJSON(), support: sr.toJSON(), content: mr.toJSON(), settings: settingsGeometry } };
}
void run().catch(error => { window.__YTDL_SHELL_GEOMETRY__ = { done: true, passed: 0, total: 1, failures: [{ check: String(error) }] }; });
