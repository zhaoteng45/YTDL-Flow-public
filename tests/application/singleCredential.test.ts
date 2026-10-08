import { describe, expect, it, vi } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import SettingsPanel from '../../src/components/SettingsPanel.vue';
import { resolveYouTubeAnalysisInputs } from '../../src/application/platformCredentials';
import { useAppStore } from '../../src/stores/appStore';
import { DEFAULT_EXTRA_ARGS } from '../../src/constants';
import zh from '../../src/locales/zh-CN.json';
import en from '../../src/locales/en-US.json';

describe('single preferred credential', () => {
  it('never reads a legacy authorized backup after browser failure', async () => {
    const inspectCookieFile = vi.fn();
    const result = await resolveYouTubeAnalysisInputs(
      { ...DEFAULT_EXTRA_ARGS }, { kind: 'browser', ref: 'edge' },
      { path: 'C:/fixtures/legacy-backup.txt', authorized: true },
      { checkBrowserCookies: vi.fn().mockResolvedValue({ kind: 'locked' }), inspectCookieFile },
      () => true,
    );
    expect(inspectCookieFile).not.toHaveBeenCalled();
    expect(result.extraArgs.cookies).toBe('');
    expect(result.credential).toEqual({ source: 'anonymous', reason: 'browser-unavailable', browserFailure: 'locked' });
  });

  it.each(['zh-CN', 'en-US'])('offers no backup picker or authorization in the real panel (%s)', async (locale) => {
    const pinia = createPinia();
    const store = useAppStore(pinia);
    store.setPlatformCookie('youtube', 'C:/fixtures/preferred.txt');
    const app = createSSRApp(SettingsPanel);
    app.use(pinia).use(createI18n({ legacy: false, locale, messages: { 'zh-CN': zh, 'en-US': en } }));
    app.mixin({ created() {
      const state = (this as { $?: { setupState?: { showYouTubeModal?: boolean } } }).$?.setupState;
      if (state && 'showYouTubeModal' in state) state.showYouTubeModal = true;
    } });
    const html = await renderToString(app);
    expect(html).toContain('role="dialog"');
    expect(html).not.toContain('data-select-backup-cookie');
    expect(html).not.toContain('data-authorize-backup-cookie');
    expect(html).not.toContain('data-clear-backup-cookie');
    expect(store.getEffectivePlatformSource('youtube')).toEqual({ kind: 'file', ref: 'C:/fixtures/preferred.txt' });
  });
});
