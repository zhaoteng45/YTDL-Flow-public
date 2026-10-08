import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';
import DownloadList from '../../src/components/DownloadList.vue';
import type { TaskPresentationRow } from '../../src/application/taskPresentation';
import { resolveCurrentTaskActions } from '../../packages/application/src/current-task-projection';
import zh from '../../src/locales/zh-CN.json';
import en from '../../src/locales/en-US.json';

function makeRow(
  rowId: string,
  status: TaskPresentationRow['status'],
  overrides: Partial<TaskPresentationRow> = {},
): TaskPresentationRow {
  return {
    id: overrides.id ?? `attempt-${rowId}`,
    rowId,
    url: 'https://www.youtube.com/watch?v=fixture',
    status,
    progress: overrides.progress ?? 0,
    logs: overrides.logs ?? [],
    cancelRequested: false,
    metadata: overrides.metadata ?? {
      title: `Title ${rowId}`,
      thumbnail: '',
      duration: '03:20',
      channel: 'Channel',
      resolution: '1920x1080',
      url: 'https://www.youtube.com/watch?v=fixture',
    },
    actions:
      overrides.actions ??
      resolveCurrentTaskActions({
        status,
        ...(overrides.failureKind ? { failureKind: overrides.failureKind } : {}),
      }),
    ...overrides,
  };
}

async function renderList(
  items: TaskPresentationRow[],
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
  openDetailRowIds: readonly string[] = [],
  detailViews: Record<string, 'options' | 'diagnostics'> = {},
): Promise<string> {
  const app = createSSRApp(DownloadList, { items, adminMode: false });
  app.use(
    createI18n({
      legacy: false,
      locale,
      messages: { 'zh-CN': zh, 'en-US': en },
    }),
  );
  if (openDetailRowIds.length > 0) {
    app.mixin({
      created() {
        const setupState = (
          this as {
            $?: {
              setupState?: {
                toggleTaskDetails?: (task: TaskPresentationRow) => void;
                taskDetailViews?: Record<string, 'options' | 'diagnostics'>;
              };
            };
          }
        ).$?.setupState;
        if (typeof setupState?.toggleTaskDetails === 'function') {
          for (const rowId of openDetailRowIds) {
            const target = items.find((item) => item.rowId === rowId);
            if (target) {
              setupState.toggleTaskDetails(target);
              if (detailViews[rowId] && setupState.taskDetailViews) {
                setupState.taskDetailViews[rowId] = detailViews[rowId];
              }
            }
          }
        }
      },
    });
  }
  return renderToString(app);
}

describe('DownloadList task details and credential source display', () => {
  it('keeps advanced task details closed while retaining direct log access', async () => {
    const html = await renderList(
      [
        {
          id: 'attempt-a',
          rowId: 'row-a',
          url: 'https://example.com/video',
          status: 'analyzed',
          progress: 0,
          logs: [],
          cancelRequested: false,
          actions: resolveCurrentTaskActions({ status: 'analyzed' }),
        },
      ],
      'en-US',
    );
    expect(html).toMatch(/data-task-detail-toggle[^>]*aria-expanded="false"/);
    expect(html).not.toContain('class="task-details-panel"');
    expect(html).toContain('logs-toggle-btn');
  });

  it('renders browser, preferred file, backup file and anonymous sources on task cards and omits unfinished analysis', async () => {
    const rows: TaskPresentationRow[] = [
      makeRow('browser-row', 'analyzed', {
        credential: { source: 'browser', reason: 'browser-ok' },
      }),
      makeRow('file-row', 'queued', {
        credential: { source: 'file', reason: 'file-ok' },
      }),
      makeRow('backup-row', 'downloading', {
        progress: 45,
        credential: { source: 'file', reason: 'backup-file', browserFailure: 'locked' },
      }),
      makeRow('anon-row', 'completed', {
        progress: 100,
        path: 'C:/Downloads/out.mp4',
        credential: {
          source: 'anonymous',
          reason: 'backup-unavailable',
          browserFailure: 'decrypt_failed',
          fileFailure: 'expired',
        },
      }),
      makeRow('analyzing-row', 'analyzing', {
        metadata: undefined,
        credential: undefined,
      }),
    ];

    const zhHtml = await renderList(rows, 'zh-CN');
    expect(zhHtml).toContain('title="实际凭证来源"');
    expect(zhHtml).toContain('浏览器');
    expect(zhHtml).toContain('Cookies 文件');
    expect(zhHtml).toContain('备用 Cookies 文件');
    expect(zhHtml).toContain('匿名');

    const analyzingOnlyHtml = await renderList(
      [
        makeRow('analyzing-row', 'analyzing', {
          metadata: undefined,
          credential: undefined,
        }),
      ],
      'zh-CN',
      ['analyzing-row'],
    );
    expect(analyzingOnlyHtml).not.toContain('data-credential-source');
    expect(analyzingOnlyHtml).not.toContain('data-detail-credential-source');
    expect(analyzingOnlyHtml).not.toContain('实际凭证来源');

    const enHtml = await renderList(rows, 'en-US');
    expect(enHtml).toContain('title="Actual credential source"');
    expect(enHtml).toContain('Browser');
    expect(enHtml).toContain('Cookies file');
    expect(enHtml).toContain('Backup Cookies file');
    expect(enHtml).toContain('Anonymous');

    for (const html of [zhHtml, enHtml]) {
      expect(html).not.toMatch(/C:\/|C:\\|cookies\.txt|locked|decrypt_failed|expired/i);
    }
  });

  it('displays the frozen credential source inside expanded task details across queued, downloading, failed and completed states', async () => {
    const rows: TaskPresentationRow[] = [
      makeRow('analyzed-browser', 'analyzed', {
        credential: { source: 'browser', reason: 'browser-ok' },
      }),
      makeRow('queued-file', 'queued', {
        credential: { source: 'file', reason: 'file-ok' },
      }),
      makeRow('failed-backup', 'error', {
        failureKind: 'download',
        credential: { source: 'file', reason: 'backup-file', browserFailure: 'locked' },
        actions: resolveCurrentTaskActions({
          status: 'error',
          failureKind: 'download',
          hasExecution: true,
          hasDownloadIntent: true,
        }),
      }),
      makeRow('completed-anon', 'completed', {
        progress: 100,
        path: 'C:/Downloads/out.mp4',
        credential: {
          source: 'anonymous',
          reason: 'smart-anonymous',
          browserFailure: 'locked',
        },
      }),
    ];

    const zhDetailsHtml = await renderList(
      rows,
      'zh-CN',
      ['analyzed-browser', 'queued-file', 'failed-backup', 'completed-anon'],
      { 'analyzed-browser': 'diagnostics' },
    );
    expect(zhDetailsHtml).toContain('class="task-details-panel"');
    expect(zhDetailsHtml).toMatch(/<dt[^>]*>实际凭证来源<\/dt><dd[^>]*data-detail-credential-source[^>]*>浏览器<\/dd>/);
    expect(zhDetailsHtml).toMatch(/<dt[^>]*>实际凭证来源<\/dt><dd[^>]*data-detail-credential-source[^>]*>Cookies 文件<\/dd>/);
    expect(zhDetailsHtml).toMatch(/<dt[^>]*>实际凭证来源<\/dt><dd[^>]*data-detail-credential-source[^>]*>备用 Cookies 文件<\/dd>/);
    expect(zhDetailsHtml).toMatch(/<dt[^>]*>实际凭证来源<\/dt><dd[^>]*data-detail-credential-source[^>]*>匿名<\/dd>/);
    expect(zhDetailsHtml).not.toMatch(/locked|unreadable|preferred-file-unavailable|smart-anonymous/i);

    const optionsViewHtml = await renderList(
      [rows[0]!],
      'en-US',
      ['analyzed-browser'],
      { 'analyzed-browser': 'options' },
    );
    expect(optionsViewHtml).toContain('Actual credential source');
    expect(optionsViewHtml).toContain('Browser');
  });

  it('renders localized frozen credential reasons and browser/file failure states in both zh-CN and en-US without leaking unknown enums or paths', async () => {
    const rows: TaskPresentationRow[] = [
      makeRow('expired-preferred', 'analyzed', {
        credential: {
          source: 'anonymous',
          reason: 'preferred-file-unavailable',
          fileFailure: 'expired',
        },
      }),
      makeRow('locked-backup-used', 'queued', {
        credential: {
          source: 'file',
          reason: 'backup-file',
          browserFailure: 'locked',
        },
      }),
      makeRow('unauth-backup', 'downloading', {
        progress: 25,
        credential: {
          source: 'anonymous',
          reason: 'backup-not-authorized',
          browserFailure: 'decrypt_failed',
        },
      }),
      makeRow('both-failed', 'error', {
        failureKind: 'download',
        credential: {
          source: 'anonymous',
          reason: 'backup-unavailable',
          browserFailure: 'permission_denied',
          fileFailure: 'mismatch',
        },
      }),
      makeRow('smart-anon', 'completed', {
        progress: 100,
        path: 'C:/Downloads/out.mp4',
        credential: {
          source: 'anonymous',
          reason: 'smart-anonymous',
          browserFailure: 'not_found',
        },
      }),
      makeRow('unknown-injected', 'analyzed', {
        credential: {
          source: 'anonymous',
          reason: 'RAW_SECRET_REASON C:/Users/private/cookies.txt' as unknown as 'unconfigured',
          browserFailure: 'RAW_BROWSER_ERROR' as unknown as 'locked',
          fileFailure: 'RAW_FILE_ERROR' as unknown as 'invalid',
        },
      }),
    ];

    const openIds = rows.map((r) => r.rowId);
    const zhHtml = await renderList(rows, 'zh-CN', openIds);
    expect(zhHtml).toContain(zh.input.cookie_state.expired);
    expect(zhHtml).toContain(zh.settings.browser.locked);
    expect(zhHtml).toContain(zh.settings.browser.decrypt_failed);
    expect(zhHtml).toContain(zh.settings.browser.permission_denied);
    expect(zhHtml).toContain(zh.input.cookie_state.mismatch);
    expect(zhHtml).toContain(zh.settings.browser.not_found);
    expect(zhHtml).not.toMatch(/RAW_SECRET_REASON|RAW_BROWSER_ERROR|RAW_FILE_ERROR|C:\/Users\/private/i);

    const enHtml = await renderList(rows, 'en-US', openIds);
    expect(enHtml).toContain(en.input.cookie_state.expired);
    expect(enHtml).toContain(en.settings.browser.locked);
    expect(enHtml).toContain(en.settings.browser.decrypt_failed);
    expect(enHtml).toContain(en.settings.browser.permission_denied);
    expect(enHtml).toContain(en.input.cookie_state.mismatch);
    expect(enHtml).toContain(en.settings.browser.not_found);
    expect(enHtml).not.toMatch(/RAW_SECRET_REASON|RAW_BROWSER_ERROR|RAW_FILE_ERROR|C:\/Users\/private/i);
  });

  it('updates the displayed credential source after reanalyze produces a new attempt while preserving actions and queue badges', async () => {
    const firstAttempt = makeRow('row-1', 'error', {
      id: 'attempt-1',
      failureKind: 'analysis',
      credential: { source: 'browser', reason: 'browser-ok' },
    });
    const firstHtml = await renderList([firstAttempt], 'zh-CN', ['row-1']);
    expect(firstHtml).toContain('浏览器');
    expect(firstHtml).toContain('重新解析');

    const analyzingAttempt = makeRow('row-1', 'analyzing', {
      id: 'attempt-2',
      metadata: undefined,
      credential: undefined,
    });
    const analyzingHtml = await renderList([analyzingAttempt], 'zh-CN');
    expect(analyzingHtml).not.toContain('data-credential-source');

    const secondAttempt = makeRow('row-1', 'queued', {
      id: 'attempt-2',
      credential: { source: 'file', reason: 'backup-file', browserFailure: 'locked' },
    });
    const secondHtml = await renderList([secondAttempt], 'zh-CN', ['row-1']);
    expect(secondHtml).toContain('备用 Cookies 文件');
    expect(secondHtml).not.toContain('>浏览器<');
    expect(secondHtml).toContain('#1');
    expect(secondHtml).toContain('取消下载');
  });
});
