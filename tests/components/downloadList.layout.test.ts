import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createI18n } from 'vue-i18n';
import DownloadList from '../../src/components/DownloadList.vue';
import type { TaskPresentationRow } from '../../src/application/taskPresentation';
import { resolveCurrentTaskActions } from '../../packages/application/src/current-task-projection';
import en from '../../src/locales/en-US.json';

const source = readFileSync(resolve('src/components/DownloadList.vue'), 'utf8');

describe('DownloadList touch target sizes', () => {
  it('restores compact bounded metadata bricks that wrap within the task container', () => {
    const brick = source.match(/\.primary-metadata-row \.metadata-chip\s*\{([^}]+)\}/)?.[1] ?? '';
    const row = source.match(/\.primary-metadata-row\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(brick).toMatch(/padding:\s*2px 6px/);
    expect(brick).toMatch(/border:\s*1px solid var\(--color-border\)/);
    expect(brick).toMatch(/background:\s*color-mix\(in srgb, var\(--color-secondary\) 12%, var\(--color-surface\)\)/);
    expect(brick).toMatch(/max-width:\s*100%/);
    expect(row).toMatch(/flex-wrap:\s*wrap/);
    expect(source.includes('class="brick-value"')).toBe(true);
    expect(source).toMatch(/\.brick-value\s*\{[^}]*text-overflow:\s*ellipsis/);
  });
  it('prevents vertical word breaking and wrapping on failure chip in error banner', () => {
    expect(source).toMatch(/\.failure-kind-chip\s*\{[\s\S]*?white-space:\s*nowrap;/);
    expect(source).toMatch(/\.failure-kind-chip\s*\{[\s\S]*?flex-shrink:\s*0;/);
    expect(source).toMatch(/\.failure-kind-chip\s*\{[\s\S]*?word-break:\s*keep-all;/);
  });

  it('keeps semantic status badges readable across theme palettes', () => {
    expect(source).toMatch(/\.task-status-badge\.downloading\s*\{[\s\S]*?color:\s*var\(--color-text\);/);
    expect(source).toMatch(/\.task-status-badge\.completed\s*\{[\s\S]*?color:\s*var\(--color-text\);/);
    expect(source).toMatch(/\.task-status-badge\.error\s*\{[\s\S]*?color:\s*var\(--color-text\);/);
    expect(source).toMatch(/\.failure-kind-chip\s*\{[\s\S]*?background:\s*var\(--color-error\);/);
    expect(source).toMatch(/\.failure-kind-chip\s*\{[\s\S]*?color:\s*var\(--color-on-error\);/);
  });

  it('renders a unified flat task list with rowId keyed rows and zero accordion jump', () => {
    expect(source).toMatch(/class="pill-count"/);
    expect(source).toMatch(/class="unified-queue-list/);
    expect(source).toMatch(/:key="item\.rowId"/);
    expect(source).toMatch(/class="task-status-badge/);
  });

  it('opens logs directly without a details layer and keeps file size in default metadata', () => {
    expect(source).not.toMatch(/rowDetailsExpanded|isDetailsExpanded|show_details|hide_details/);
    const actions = source.slice(source.indexOf('<div class="actions-section">'), source.indexOf('<div class="row-overflow-wrap">'));
    expect(actions).toContain('class="neo-button small ghost logs-toggle-btn"');
    expect(actions).toContain(':aria-expanded="isLogsExpanded(item.rowId)"');
    expect(actions).toContain('@click="toggleLogs(item.rowId)"');
    expect(source).toMatch(/class="metadata-chip filesize"/);
    expect(source).toMatch(/class="logs-panel"[\s\S]*?class="filename-row"/);
  });

  it('binds channel, duration and resolution/audio mode inside the ungated default metadata row', () => {
    const primaryRow = source.match(/<div[^>]*class="metadata-row primary-metadata-row"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(primaryRow).not.toBe('');
    expect(primaryRow).not.toMatch(/isDetailsExpanded/);
    expect(primaryRow).toMatch(/item\.metadata\.channel/);
    expect(primaryRow).toMatch(/item\.metadata\.duration/);
    expect(primaryRow).toMatch(/item\.metadata\.resolution/);
    expect(primaryRow).toMatch(/isAudioFormat\(getRowFormat\(item\)\)/);
    expect(primaryRow).toMatch(/download_list\.meta\.channel/);
    expect(primaryRow).toMatch(/download_list\.meta\.duration/);
    expect(primaryRow).toMatch(/download_list\.meta\.audio_mode_hint/);
    expect(primaryRow).toMatch(/download_list\.meta\.resolution/);
  });

  it('defaults an unselected video task to MP4/video instead of legacy MKV', () => {
    expect(source).toContain('resolveRowFormat(task, rowFormatSelections.value)');
    expect(source).toMatch(/from '\.\/downloadList\.projection'/);
    const projectionSource = readFileSync(resolve('src/components/downloadList.projection.ts'), 'utf8');
    expect(projectionSource).toMatch(/selectedFormat \?\? 'video'/);
    expect(projectionSource).not.toContain("selectedFormat ?? 'mkv'");
    expect(source).not.toContain("task.selectedFormat ?? 'mkv'");
  });

  it('groups formats with descriptions, aligned options and an explicit checked state', () => {
    expect(source).toContain('class="format-menu"');
    expect(source).toContain("t('download_list.format_group.video_hint')");
    expect(source).toContain("t('download_list.format_group.audio_hint')");
    expect(source).toContain('role="menuitemradio"');
    expect(source).toContain(':aria-checked="getRowFormat(item) === option.value"');
    expect(source).toContain('class="format-check"');
    expect(source).toMatch(/\.format-option\s*\{[^}]*grid-template-columns:\s*18px 1fr 18px/);
    expect(source).toMatch(/\.format-trigger\s*\{[^}]*min-height:\s*44px/);
  });

  it('keeps Catppuccin log actions visibly enabled in every outer theme', () => {
    expect(source).toMatch(
      /\.logs-panel \.copy-logs-btn,[\s\S]*?\.logs-panel \.collapse-logs-btn\s*\{[\s\S]*?background-color:\s*var\(--ctp-surface-0\);[\s\S]*?color:\s*var\(--ctp-text\);[\s\S]*?opacity:\s*1;[\s\S]*?font-weight:\s*700;/
    );
    expect(source).toMatch(
      /\.neo-button:not\(\.primary\):not\(\.danger\):not\(\.success\):not\(\.copy-logs-btn\):not\(\.collapse-logs-btn\):not\(\.logs-toggle-btn\)/
    );
  });

  it('keeps analyzing cards neutral and the row log toggle visually secondary', () => {
    const analyzingRule = source.match(/\.download-card\.analyzing\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(analyzingRule).toMatch(/border-color:\s*var\(--color-border\)/);
    expect(analyzingRule).not.toMatch(/var\(--color-secondary\)/);

    const logToggleRule = source.match(/\.logs-toggle-btn\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(logToggleRule).toMatch(/color:\s*var\(--color-text-muted\)/);
    expect(logToggleRule).toMatch(/box-shadow:\s*none/);
  });

  it('keeps text small controls flexible while icon-only small controls stay 44px square', () => {
    expect(source).toMatch(/\.neo-button\.small\s*\{[\s\S]*?min-height:\s*44px;[\s\S]*?padding:\s*6px 10px;/);
    expect(source).not.toMatch(/\.neo-button\.small\s*\{[^}]*?width:\s*44px;/);
    expect(source).toMatch(/\.neo-button\.icon-only\.small\s*\{[\s\S]*?width:\s*44px;[\s\S]*?min-width:\s*44px;/);
  });

  it('removes the virtual list render path for grouped sections', () => {
    expect(source).not.toMatch(/useVirtualList/);
    expect(source).not.toMatch(/virtual-list-container/);
  });

  it('provides a copy logs action button with accessible feedback', () => {
    expect(source).toMatch(/copy-logs-btn/);
    expect(source).toMatch(/copyTaskLogs/);
    expect(source).toMatch(/redactSensitiveText/);
    expect(source).toMatch(/redactSensitiveText\(lines\.join\('\\n'\)\)/);
    expect(source).toMatch(/redactSensitiveText\(item\.debugCommand\)/);
    expect(source).toMatch(/formatLogLine\(redactSensitiveText\(log\)\)/);
  });

  it('uses compact spacing between queue sections and cards', () => {
    expect(source).toMatch(/\.download-list-container\s*\{[\s\S]*?gap:\s*var\(--spacing-sm\);/);
  });

  it('uses one main card and distinguishes audio from video without separate layouts', () => {
    expect(source).toContain('class="unified-queue-list"');
    expect(source).toContain("isAudioFormat(getRowFormat(item)) ? 'task-audio' : 'task-video'");
    expect(source).toContain('class="status-icon-wrapper audio-artwork"');
    expect(source).toContain('class="audio-format-label"');
    expect(source).toMatch(/\.card-main\s*\{[^}]*border:\s*0;[^}]*box-shadow:\s*none;/);
    expect(source).toMatch(/\.unified-queue-list\s*\{[^}]*background:\s*transparent;/);
    expect(source).toMatch(/\.download-card\s*\{[^}]*var\(--color-secondary\) 6%/);
  });

  it('uses the task list container width as the responsive layout seam', () => {
    expect(source).toMatch(/\.download-list-container\s*\{[\s\S]*?container-type:\s*inline-size;/);
    expect(source).toMatch(/\.download-list-container\s*\{[\s\S]*?container-name:\s*download-list;/);
    expect(source).toMatch(/@container\s+download-list\s*\(max-width:\s*999px\)/);
    expect(source).toMatch(/@container\s+download-list\s*\(max-width:\s*719px\)/);
    expect(source).toMatch(/@container\s+download-list\s*\(max-width:\s*519px\)/);
  });

  it('promotes video identity with adaptive thumbnail geometry', () => {
    expect(source).toMatch(/\.thumbnail-wrapper\s*\{[\s\S]*?width:\s*120px;[\s\S]*?height:\s*68px;/);
    expect(source).toMatch(/@container\s+download-list\s*\(max-width:\s*999px\)[\s\S]*?\.thumbnail-wrapper,[\s\S]*?\.status-icon-wrapper\s*\{[\s\S]*?width:\s*96px;[\s\S]*?height:\s*54px;/);
    expect(source).toMatch(/@container\s+download-list\s*\(max-width:\s*719px\)[\s\S]*?\.thumbnail-wrapper,[\s\S]*?\.status-icon-wrapper\s*\{[\s\S]*?width:\s*128px;[\s\S]*?height:\s*72px;/);
  });

  it('lets the wide title breathe while reserving single-line truncation for compact tiers', () => {
    const baseTitle = source.match(/\.title\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(baseTitle).not.toMatch(/white-space:\s*nowrap/);
    expect(baseTitle).toMatch(/-webkit-line-clamp:\s*2/);
    expect(source).toMatch(/@container\s+download-list\s*\(max-width:\s*999px\)[\s\S]*?\.title\s*\{[\s\S]*?white-space:\s*nowrap;/);
  });

  it('keeps the narrow media-card tier on a two-line clamp instead of a global single-line nowrap', () => {
    expect(source).toMatch(
      /@container\s+download-list\s*\(max-width:\s*719px\)[\s\S]*?\.title\s*\{[\s\S]*?-webkit-line-clamp:\s*2;/
    );
  });
});

describe('DownloadList UX & resilience elevations', () => {
  it('does not expose queue-wide destructive batch controls', () => {
    expect(source).not.toMatch(/handleClearCompletedClick/);
    expect(source).not.toMatch(/handleCancelQueuedClick/);
    expect(source).not.toMatch(/retry-failed-downloads/);
    expect(source).not.toMatch(/queue-overflow-clear-completed/);
    expect(source).not.toMatch(/queue-overflow-cancel-queued/);
  });

  it('keeps format selection local to each task row without batch override state', () => {
    expect(source).toMatch(/rowFormatSelections/);
    expect(source).toMatch(/setRowFormat/);
    expect(source).not.toMatch(/batchFormat/);
    expect(source).not.toMatch(/customizedRowIds/);
    expect(source).not.toMatch(/handleOverrideAllFormat/);
    expect(source).not.toMatch(/override-all-btn/);
    expect(source).not.toMatch(/custom-format-tag/);
  });

  it('renders the waiting FIFO position independently of active rows', async () => {
    const items: TaskPresentationRow[] = ['downloading', 'queued'].map((status, index) => ({
      rowId: `badge-${index}`, id: `attempt-${index}`, url: 'https://example.com/video',
      status: status as TaskPresentationRow['status'], progress: 0, logs: [],
      actions: resolveCurrentTaskActions({ status: status as TaskPresentationRow['status'] }),
    }));
    const app = createSSRApp(DownloadList, { items, adminMode: false });
    app.use(createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': en } }));
    const html = await renderToString(app);
    expect(html).toMatch(/class="queue-position-badge"[^>]*>#1<\/span>/);
    expect(html).not.toMatch(/class="queue-position-badge"[^>]*>#2<\/span>/);
  });

  it('unifies GPU-accelerated scaleX progress fill across queued, analyzed and completed cards', () => {
    expect(source).toMatch(/transform:\s*\x60scaleX/);
  });

  it('unifies card icons using NeoIcon vector graphics and keeps the media fallback geometry stable', () => {
    expect(source).toMatch(/import NeoIcon from '\.\/NeoIcon\.vue'/);
    expect(source).toMatch(/<NeoIcon name="speed"/);
    expect(source).toMatch(/<NeoIcon name="file"/);
    expect(source).toMatch(/<NeoIcon :name="getStatusIconName\(item\.status\)"/);
    expect(source).toMatch(/\.status-icon-wrapper\s*\{[\s\S]*?width:\s*120px;[\s\S]*?height:\s*68px;/);
  });

  it('does not render a global batch download action', () => {
    expect(source).not.toMatch(/download_all_analyzed_count/);
    expect(source).not.toMatch(/btn-download-all/);
  });

  it('provides single-card undo removal toast buffer before final deletion', () => {
    expect(source).toMatch(/handleTaskRemoveWithUndo/);
    expect(source).toMatch(/pendingRemoval/);
    expect(source).toMatch(/pendingRemovalRowIds/);
    expect(source).toMatch(/undoRemoval/);
    expect(source).toMatch(/commitPendingRemoval/);
    expect(source).toMatch(/class="undo-toast/);
    expect(source).toMatch(/class="neo-button undo-btn"/);
  });

  it('keeps the default queue chrome compact and video-first', () => {
    expect(source).toMatch(/class="queue-toolbar"/);
    expect(source).toMatch(/class="neo-input search-input"/);
    expect(source).not.toMatch(/compact-summary|summary\.concurrencyUsed/);
    expect(source).not.toMatch(/class="summary-pills"/);
    expect(source).toMatch(/primary-filter-all/);
    expect(source).toMatch(/primary-filter-active/);
    expect(source).toMatch(/primary-filter-completed/);
    expect(source).toMatch(/class="filter-empty-state neo-box"/);
    expect(source).toMatch(/searchQuery/);
    expect(source).toMatch(/statusFilter/);
  });

  it('removes the redundant statistics popup while retaining lightweight filter counts', () => {
    expect(source).not.toMatch(/queueOverflowOpen|queue-overflow|compact-summary/);
    expect(source).toContain('primary-filter-all');
    expect(source).toContain('primary-filter-active');
    expect(source).toContain('primary-filter-completed');
    expect(source.match(/class="pill-count"/g)).toHaveLength(3);
  });

  it('does not expose multi-select or batch-selection state', () => {
    expect(source).not.toMatch(/card-select-checkbox/);
    expect(source).not.toMatch(/batch-selection-bar/);
    expect(source).not.toMatch(/btn-batch-download/);
    expect(source).not.toMatch(/btn-batch-remove/);
    expect(source).not.toMatch(/const toggleSelectAll =/);
    expect(source).not.toMatch(/selectedCount/);
  });

  it('never renders an empty overflow trigger or menu', () => {
    expect(source).toContain('v-if="getRowOverflowActions(item).length > 0"');
    expect(source).toContain('v-for="action in getRowOverflowActions(item)"');
    expect(source).not.toContain('hasRowOverflowActions');
  });

  it('exposes one contextual primary action plus an accessible overflow menu per row', () => {
    expect(source).toContain('getPrimaryTaskAction,');
    expect(source).toContain('getRowOverflowActions,');
    expect(source).toMatch(/const performPrimaryTaskAction/);
    expect(source).toMatch(/primary-task-action/);
    expect(source).toMatch(/row-overflow-trigger/);
    expect(source).toMatch(/aria-haspopup="menu"/);
    expect(source).toMatch(/:aria-expanded="isRowOverflowOpen\(item\.rowId\)"/);
    expect(source).toMatch(/class="row-overflow-menu"/);
    expect(source).toMatch(/role="menu"/);
    expect(source).toMatch(/data-row-overflow-trigger/);
    expect(source).toMatch(/performPrimaryTaskAction\(focusedTask\)/);
  });

  it('gates Delete and Backspace removal with the same canRemove action contract as the visible menu', () => {
    const shortcutStart = source.indexOf("if (e.key === 'Delete' || e.key === 'Backspace')");
    const deleteShortcut = source.slice(shortcutStart, shortcutStart + 700);
    expect(shortcutStart).toBeGreaterThan(-1);
    expect(deleteShortcut).toContain('focusedTask.actions.canRemove');
    expect(deleteShortcut.indexOf('focusedTask.actions.canRemove')).toBeLessThan(
      deleteShortcut.indexOf('handleTaskRemoveWithUndo(focusedTask)'),
    );
  });

  it('uses localized fallback copy for generic audio badges instead of embedding Chinese text', () => {
    expect(source).toContain("getAudioBadgeText(getRowFormat(item)) || t('download_list.meta.audio_mode')");

  });

  it('keeps secondary row controls visibly interactive on hover without hard-shadow promotion', () => {
    expect(source).toMatch(
      /\.neo-button\.logs-toggle-btn:hover\s*\{[\s\S]*?background:[^;]*color-mix\([^;]*var\(--color-primary\)[^;]*\);[\s\S]*?border-color:\s*var\(--color-primary\);/
    );
    expect(source).toMatch(
      /\.format-trigger:hover\s*\{[\s\S]*?background:[^;]*color-mix\([^;]*var\(--color-primary\)[^;]*\);[\s\S]*?border-color:\s*var\(--color-primary\);/
    );
    expect(source).toMatch(
      /\.row-overflow-trigger:hover\s*\{[\s\S]*?background:[^;]*color-mix\([^;]*var\(--color-primary\)[^;]*\);[\s\S]*?border-color:\s*var\(--color-primary\);/
    );
    expect(source).toMatch(
      /\.download-card:hover\s*\{[\s\S]*?transform:\s*translateY\(-2px\);[\s\S]*?box-shadow:\s*var\(--shadow-hard\);/
    );
  });

  it('keeps semantic task buttons on theme tokens instead of neutral component backgrounds', () => {
    expect(source).not.toMatch(/\.neo-button\s*\{[^}]*background-color:/);
    expect(source).not.toMatch(/\.neo-button:hover\s*\{[^}]*background-color:/);
  });

  it('scopes neutral button backgrounds without overriding semantic primary, danger, or success styling', () => {
    expect(source).toMatch(
      /\.neo-button:not\(\.primary\):not\(\.danger\):not\(\.success\)[^{]*\{[\s\S]*?background-color:\s*var\(--color-bg-alt\);/
    );
    expect(source).toMatch(
      /\.neo-button:not\(\.primary\):not\(\.danger\):not\(\.success\):not\(\.copy-logs-btn\):not\(\.collapse-logs-btn\):not\(\.logs-toggle-btn\):hover[^{]*\{[\s\S]*?background-color:\s*var\(--color-surface\);/
    );
    expect(source).not.toMatch(/\.neo-button\s*\{[^}]*background-color:/);
    expect(source).not.toMatch(/\.neo-button:hover\s*\{[^}]*background-color:/);
    expect(source).not.toMatch(/\.neo-button\.primary\s*\{[^}]*background-color:/);
    expect(source).not.toMatch(/\.neo-button\.danger\s*\{[^}]*background-color:/);
    expect(source).not.toMatch(/\.neo-button\.success\s*\{[^}]*background-color:/);

    // Semantic task buttons retain explicit semantic modifiers
    expect(source).toMatch(/class="neo-button primary primary-task-action"/);
    expect(source).toMatch(/class="neo-button danger primary-task-action"/);
    expect(source).toMatch(/class="neo-button success primary-task-action"/);

    // Neutral buttons retain generic classes so scoped neutral background applies
    expect(source).toMatch(/class="neo-button row-overflow-trigger"/);
    expect(source).toMatch(/class="neo-button copy-logs-btn"/);
    expect(source).toMatch(/class="neo-button small collapse-logs-btn"/);
  });

  it('keeps secondary task capabilities reachable through overflow with focus-safe dismissal', () => {
    expect(source).toMatch(/rowOverflowOpen/);
    expect(source).toMatch(/toggleRowOverflow/);
    expect(source).toMatch(/closeRowOverflow/);
    expect(source).toMatch(/focusRowOverflowTrigger/);
    expect(source).toMatch(/handleDocumentClick/);
    expect(source).toMatch(/document\.addEventListener\('click', handleDocumentClick\)/);
    expect(source).toMatch(/document\.removeEventListener\('click', handleDocumentClick\)/);
    expect(source).not.toMatch(/row-overflow-playlist/);
    expect(source).toMatch(/row-overflow-reanalyze/);
    expect(source).toMatch(/row-overflow-open-file/);
    expect(source).not.toMatch(/row-overflow-details/);
    expect(source).not.toMatch(/row-overflow-logs/);
    expect(source).toMatch(/row-overflow-remove/);
  });

  it('provides desktop keyboard navigation and shortcuts hint', () => {
    expect(source).toMatch(/handleGlobalKeydown/);
    expect(source).toMatch(/focusedRowId/);
    expect(source).toMatch(/class="kbd-shortcuts-tip"/);
    expect(source).toMatch(/window\.addEventListener\('keydown'/);
    expect(source).toMatch(/window\.removeEventListener\('keydown'/);
  });

  it('delegates status filtering to the projection seam and isolates keyboard shortcuts from modals', () => {
    expect(source).toMatch(/projectDownloadList\(items, \{[\s\S]*?statusFilter: statusFilter\.value/);
    const projectionSource = readFileSync(resolve('src/components/downloadList.projection.ts'), 'utf8');
    expect(projectionSource).toContain("case 'active':");
    expect(projectionSource).toContain("case 'waiting':");
    expect(projectionSource).toContain("case 'failed':");
    expect(projectionSource).toContain("case 'completed':");
    expect(source).toContain("activeEl?.closest?.('[role=\"dialog\"], [aria-modal=\"true\"]");
  });

  it('does not expose playlist expansion or selection UI', () => {
    expect(source).not.toMatch(/playlist-drawer/);
    expect(source).not.toMatch(/flatten-playlist/);
    expect(source).not.toMatch(/openPlaylistDrawer/);
    expect(source).not.toMatch(/playlistDrawerRef/);
  });

  it('keeps compact dismiss controls at least 44px square', () => {
    expect(source).toMatch(/\.search-clear-btn\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
    expect(source).toMatch(/\.undo-btn\s*\{[\s\S]*?height:\s*44px;/);
    expect(source).toMatch(/\.undo-dismiss-btn\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
  });
});

describe('DownloadList log panel interaction', () => {
  it('exposes explicit show/hide log labels and an in-panel collapse action', () => {
    expect(source).toMatch(/download_list\.actions\.show_log/);
    expect(source).toMatch(/download_list\.actions\.hide_log/);
    expect(source).toMatch(/class="neo-button small collapse-logs-btn"/);
    expect(source).toMatch(/@click="toggleLogs\(item\.rowId\)"/);
    expect(source).toMatch(/:aria-expanded="true"/);
  });
});
