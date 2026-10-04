import { createApp, h, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import DownloadList from '../../src/components/DownloadList.vue';
import type { TaskPresentationRow } from '../../src/application/taskPresentation';
import { resolveCurrentTaskActions } from '../../packages/application/src/current-task-projection';
import zh from '../../src/locales/zh-CN.json';
import en from '../../src/locales/en-US.json';
import '../../src/styles.css';
import '../../src/styles-system-themes.css';
import '../../src/styles-theme-experience.css';

declare global { interface Window { __YTDL_MENU_EDGE__?: Record<string, unknown> } }
const settle = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 100)); };
async function run() {
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme')!;
  const kind = params.get('menu')!;
  const locale = params.get('locale') ?? 'zh-CN';
  document.documentElement.dataset.theme = theme;
  const host = document.querySelector<HTMLElement>('#app')!;
  // Real DownloadList inside the same locally scrolling queue boundary as App.
  // Place the last row's trigger near its lower edge, with room above to flip.
  Object.assign(host.style, { position: 'fixed', left: '24px', top: '140px', width: 'calc(100vw - 48px)', height: 'calc(100vh - 164px)', overflowY: 'auto', minHeight: '0' });
  const status = kind === 'format' ? 'analyzed' : 'completed';
  const rows: TaskPresentationRow[] = Array.from({ length: 8 }, (_, index) => ({
    id: `attempt-${index}`, rowId: `edge-${index}`, url: `https://example.com/edge-${index}`,
    title: `Menu edge task ${index}`, status, progress: status === 'completed' ? 100 : 0,
    logs: [], cancelRequested: false, path: status === 'completed' ? 'C:\\test\\edge.mp4' : undefined,
    actions: resolveCurrentTaskActions({ status, cancelRequested: false, hasExecution: false, hasDownloadIntent: false }),
  }));
  const removed: string[] = [];
  const app = createApp({ render: () => h(DownloadList, { items: rows, adminMode: false, onRemove: (id: string) => removed.push(id) }) });
  app.use(createI18n({ legacy: false, locale, messages: { 'zh-CN': zh, 'en-US': en } })).mount(host);
  await settle();
  const failures: { check: string }[] = [];
  let passed = 0;
  const check = (name: string, ok: boolean) => { if (ok) passed++; else failures.push({ check: name }); };
  const card = host.querySelector<HTMLElement>('[data-row-id="edge-7"]')!;
  host.scrollTop = host.scrollHeight;
  const trigger = card.querySelector<HTMLElement>(kind === 'format' ? '.format-trigger' : '.row-overflow-trigger')!;
  const qr = host.getBoundingClientRect();
  const initialTrigger = trigger.getBoundingClientRect();
  host.scrollTop -= qr.bottom - initialTrigger.bottom - 24;
  const tr = trigger.getBoundingClientRect();
  check('trigger is visible near scroll-container bottom', tr.top >= qr.top && tr.bottom <= qr.bottom + 1 && qr.bottom - tr.bottom < 80);
  trigger.click();
  await settle();
  const menuSelector = kind === 'format' ? '.format-menu' : '.row-overflow-menu';
  const menu = document.querySelector<HTMLElement>(menuSelector)!;
  check('menu opens', Boolean(menu));
  const bounds = menu.getBoundingClientRect();
  check('menu rect stays in viewport', bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth);
  const options = [...menu.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
  check('all expected actions are present', options.length === (kind === 'format' ? 6 : 2));
  check('opening menu moves focus to the selected or first action', document.activeElement === options[0]);
  check('insufficient bottom space flips menu above trigger', bounds.bottom <= tr.top);
  const contained = () => {
    const r = document.querySelector<HTMLElement>(menuSelector)!.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  };
  host.scrollTop -= 20;
  await settle();
  const moved = trigger.getBoundingClientRect();
  const scrolledMenu = menu.getBoundingClientRect();
  check('scroll updates the anchored position without page scroll', Math.abs(scrolledMenu.bottom - (moved.top - 6)) < 1 && scrollY === 0);
  host.style.left = '40px';
  window.dispatchEvent(new Event('resize'));
  await settle();
  check('resize/layout change keeps menu clamped and anchored', contained() && Math.abs(menu.getBoundingClientRect().right - trigger.getBoundingClientRect().right) < 1);
  host.style.left = `${40 - trigger.getBoundingClientRect().left + 8}px`;
  window.dispatchEvent(new Event('resize'));
  await settle();
  check('left viewport edge clamps menu without clipping options', contained() && Math.abs(menu.getBoundingClientRect().left - 8) < 1);
  host.style.left = '40px';
  host.style.top = `${140 - trigger.getBoundingClientRect().top + 24}px`;
  window.dispatchEvent(new Event('resize'));
  await settle();
  check('adequate bottom space uses bottom placement', contained() && Math.abs(menu.getBoundingClientRect().top - trigger.getBoundingClientRect().bottom - 6) < 1);
  host.style.top = '140px';
  window.dispatchEvent(new Event('resize'));
  await settle();
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  check('End focuses last menu action', document.activeElement === options[options.length - 1]);
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  check('Home focuses first menu action', document.activeElement === options[0]);
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  check('ArrowDown moves menu focus', document.activeElement === options[1]);
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  check('Escape closes menu and restores trigger focus', !document.querySelector(menuSelector) && document.activeElement === trigger);
  trigger.click();
  await settle();
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await settle();
  check('outside pointer closes menu', !document.querySelector(menuSelector));
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: kind === 'format' ? 'End' : 'ArrowDown', bubbles: true }));
  await settle();
  const keyboardMenu = document.querySelector<HTMLElement>(menuSelector)!;
  const keyboardOptions = keyboardMenu.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]');
  check('trigger keyboard opens menu with appropriate initial focus', document.activeElement === keyboardOptions[kind === 'format' ? keyboardOptions.length - 1 : 0]);
  keyboardMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: kind === 'more', bubbles: true }));
  await settle();
  check('Tab continues in the original row focus order', !document.querySelector(menuSelector) && document.activeElement === card.querySelector(kind === 'format' ? '.primary-task-action' : '.logs-toggle-btn'));
  trigger.click();
  await settle();
  const finalMenu = document.querySelector<HTMLElement>(menuSelector)!;
  const finalOptions = [...finalMenu.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
  const hit = (button: HTMLElement) => {
    const r = button.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') === button;
  };
  for (const option of finalOptions) {
    finalMenu.scrollTop = option.offsetTop - finalMenu.clientHeight + option.offsetHeight;
    check(`menu item visible and not queue-clipped: ${option.textContent?.trim()}`, hit(option));
  }
  finalMenu.scrollTop = finalMenu.scrollHeight;
  const last = finalOptions.at(-1)!;
  check('last action is visible and hit-testable', hit(last));
  if (hit(last)) last.click();
  await settle();
  if (kind === 'format') check('last format selection updates trigger to Opus', trigger.textContent?.includes('Opus') === true);
  else {
    await new Promise(resolve => setTimeout(resolve, 250));
    check('Remove task hides the intended row', !host.querySelector('[data-row-id="edge-7"]'));
    await new Promise(resolve => setTimeout(resolve, 4100));
    check('Remove task emits the intended row ID after undo window', removed.includes('edge-7'));
  }
  // Leave an open menu for the runner's screenshot, after action assertions.
  const screenshotCard = host.querySelector<HTMLElement>('[data-row-id="edge-6"]')!;
  const screenshotTrigger = screenshotCard.querySelector<HTMLElement>(kind === 'format' ? '.format-trigger' : '.row-overflow-trigger')!;
  host.scrollTop = Math.max(0, host.scrollTop + screenshotTrigger.getBoundingClientRect().bottom - (qr.bottom - 24));
  screenshotTrigger.click();
  await settle();
  const screenshotMenu = document.querySelector<HTMLElement>(menuSelector);
  check('a different row menu opens after the previous action', Boolean(screenshotMenu) && screenshotTrigger.getAttribute('aria-expanded') === 'true');
  const otherTrigger = host.querySelector<HTMLElement>(`[data-row-id="edge-5"] ${kind === 'format' ? '.format-trigger' : '.row-overflow-trigger'}`)!;
  otherTrigger.click();
  await settle();
  check('switching rows preserves the newly opened menu', Boolean(document.querySelector(menuSelector)) && otherTrigger.getAttribute('aria-expanded') === 'true');
  const capturedMenu = document.querySelector<HTMLElement>(menuSelector);
  const capturedFirst = capturedMenu?.querySelector<HTMLElement>('[role^="menuitem"]');
  check('switched menu is painted and hit-testable', Boolean(capturedFirst) && hit(capturedFirst!));
  window.__YTDL_MENU_EDGE__ = { done: true, caseCount: 1, passedChecks: passed, checkCount: passed + failures.length, failures, scenarios: [theme, locale, kind], geometry: { trigger: tr.toJSON(), menu: bounds.toJSON(), queue: qr.toJSON(), capturedMenu: document.querySelector(menuSelector)?.getBoundingClientRect().toJSON() } };
}
void run().catch(error => { window.__YTDL_MENU_EDGE__ = { done: true, caseCount: 1, passedChecks: 0, checkCount: 1, failures: [{ check: String(error) }] }; });
