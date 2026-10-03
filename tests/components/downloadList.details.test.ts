import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createI18n } from 'vue-i18n';
import { expect, it } from 'vitest';
import DownloadList from '../../src/components/DownloadList.vue';
import { resolveCurrentTaskActions } from '../../packages/application/src/current-task-projection';
import en from '../../src/locales/en-US.json';
it('keeps advanced task details closed while retaining direct log access', async () => {
  const app = createSSRApp(DownloadList, { items: [{ id: 'attempt-a', rowId: 'row-a', url: 'https://example.com/video', status: 'analyzed', progress: 0, logs: [], actions: resolveCurrentTaskActions({ status: 'analyzed' }) }], adminMode: false });
  app.use(createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': en } }));
  const html = await renderToString(app);
  expect(html).toMatch(/data-task-detail-toggle[^>]*aria-expanded="false"/);
  expect(html).not.toContain('class="task-details-panel"');
  expect(html).toContain('logs-toggle-btn');
});
