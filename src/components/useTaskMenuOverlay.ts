import { nextTick, onBeforeUnmount, ref, shallowRef } from 'vue';
import type { CSSProperties } from 'vue';

// One body-teleported, fixed-position menu at a time. The existing menu gap
// (6px) and an 8px viewport gutter are spacing, never overflow tolerances.
export function useTaskMenuOverlay(onDismiss: () => void) {
  const anchor = shallowRef<HTMLElement | null>(null);
  const menu = shallowRef<HTMLElement | null>(null);
  const style = ref<CSSProperties>({ visibility: 'hidden' });
  let frame = 0;
  let observer: ResizeObserver | undefined;
  let initialFocus: 'selected' | 'first' | 'last' = 'selected';

  const options = () => [...(menu.value?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not([disabled])') ?? [])];
  const close = (restoreFocus = false) => {
    const trigger = anchor.value;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('pointerdown', outside);
    anchor.value = null;
    menu.value = null;
    style.value = { visibility: 'hidden' };
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  };
  const dismiss = (restoreFocus = false) => { close(restoreFocus); onDismiss(); };
  const update = () => {
    const trigger = anchor.value;
    const popup = menu.value;
    if (!trigger || !popup) return;
    const rect = trigger.getBoundingClientRect();
    if (!trigger.isConnected || rect.bottom <= 0 || rect.top >= innerHeight) { dismiss(); return; }
    const gutter = 8;
    const gap = 6;
    const border = popup.offsetHeight - popup.clientHeight;
    const height = Math.min(popup.scrollHeight + border, innerHeight - gutter * 2);
    const width = Math.min(popup.offsetWidth, innerWidth - gutter * 2);
    const below = innerHeight - rect.bottom - gap - gutter;
    const above = rect.top - gap - gutter;
    const upward = height > below && above > below;
    const top = upward ? rect.top - gap - height : rect.bottom + gap;
    style.value = {
      position: 'fixed', top: `${Math.max(gutter, Math.min(top, innerHeight - gutter - height))}px`,
      left: `${Math.max(gutter, Math.min(rect.right - width, innerWidth - gutter - width))}px`,
      right: 'auto', maxWidth: `${innerWidth - gutter * 2}px`, maxHeight: `${innerHeight - gutter * 2}px`,
      overflowY: 'auto', visibility: 'visible',
    };
  };
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  }
  function outside(event: PointerEvent) {
    if (event.target instanceof Node && !menu.value?.contains(event.target) && !anchor.value?.contains(event.target)) dismiss();
  }
  const open = (trigger: HTMLElement, focus: typeof initialFocus = 'selected') => {
    close();
    anchor.value = trigger;
    initialFocus = focus;
  };
  const setMenu = (element: unknown) => {
    if (element === null && menu.value) {
      // Vue can mount the next row's portal before clearing the old row's ref.
      // Only dismiss if the current menu really disappeared after the patch.
      const current = menu.value;
      void nextTick(() => { if (menu.value === current && !current.isConnected) dismiss(); });
      return;
    }
    if (!(element instanceof HTMLElement) || !anchor.value || menu.value === element) return;
    menu.value = element;
    update();
    observer = new ResizeObserver(schedule);
    observer.observe(element);
    observer.observe(anchor.value);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    document.addEventListener('pointerdown', outside);
    // The first render is hidden until positioning is applied. Wait for that
    // DOM update: browsers cannot focus a visibility:hidden menu item.
    void nextTick(() => {
      if (menu.value !== element || !anchor.value) return;
      const buttons = options();
      const selected = buttons.find(button => button.getAttribute('aria-checked') === 'true');
      (initialFocus === 'last' ? buttons[buttons.length - 1] : initialFocus === 'first' ? buttons[0] : selected ?? buttons[0])?.focus({ preventScroll: true });
    });
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); dismiss(true); return; }
    if (event.key === 'Tab') {
      // Teleport changes DOM order; continue from the original trigger's tab
      // position rather than sending focus to an unrelated body-end control.
      const focusable = [...document.querySelectorAll<HTMLElement>('button:not([disabled]), summary, input, textarea, select, a[href], [tabindex="0"]')]
        .filter(element => !menu.value?.contains(element) && !element.closest('[inert]') && element.getClientRects().length > 0);
      const index = focusable.indexOf(anchor.value!);
      const next = focusable[index + (event.shiftKey ? -1 : 1)];
      if (next) { event.preventDefault(); dismiss(); next.focus({ preventScroll: true }); }
      else dismiss(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = options();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[target]?.focus({ preventScroll: true });
    buttons[target]?.scrollIntoView({ block: 'nearest' });
  };
  const focusout = (event: FocusEvent) => {
    if (event.relatedTarget instanceof Node && !menu.value?.contains(event.relatedTarget) && !anchor.value?.contains(event.relatedTarget)) dismiss();
  };
  onBeforeUnmount(() => close());
  return { anchor, style, open, close, setMenu, keydown, focusout };
}
