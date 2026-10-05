<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, nextTick, unref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from './stores/appStore';
import brandLogo from '../src-tauri/icons/source/ytdl-flow-primary.svg';
import type { DownloadFormat, ExtraArgs } from './types';
import type { TaskPresentationRow } from './application/taskPresentation';
import type { DownloadRecoveryAction } from './application/downloadRecovery';
import { createCurrentTaskAppRuntime } from './v2-runtime/currentTaskAppRuntime';
import { disposeTaskRuntimeWithRetry } from './appWiring.helpers';
import type { AppTheme } from './constants';
import CapturePanel from './components/CapturePanel.vue';
import InputSection from './components/InputSection.vue';
import DownloadList from './components/DownloadList.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import ThemeSelector from './components/ThemeSelector.vue';
import NeoIcon from './components/NeoIcon.vue';

const { t } = useI18n();
const store = useAppStore();
const taskRuntime = createCurrentTaskAppRuntime({
  getGlobalExtraArgs: (sourceUrl) =>
    sourceUrl ? store.getExtraArgsForUrl(sourceUrl) : ({ ...unref(store.extraArgs) }),
  getDownloadDir: () =>
    unref(store.downloadDir) ?? unref(store.systemDownloadDir) ?? undefined,
});
const taskRows = ref<TaskPresentationRow[]>(taskRuntime.listRows());
const stopTaskRows = taskRuntime.subscribeRows((rows) => {
  taskRows.value = rows;
});
const taskActions = taskRuntime.actions;
const appVersion = computed<string>(() => unref(store.appVersion));
const dependenciesInstalled = computed<boolean>(() => unref(store.dependenciesInstalled));
const extraArgs = computed<ExtraArgs>(() => unref(store.extraArgs));
const tasks = computed<TaskPresentationRow[]>(() => taskRows.value);
const theme = computed<AppTheme>(() => unref(store.theme));

const showSettings = ref(false);
const connectionEntry = ref<import('./application/platformCredentials').PlatformConnectionEntry | null>(null);
let connectionReturnFocus: HTMLElement | null = null;
const openConnection = (entry: NonNullable<typeof connectionEntry.value>) => {
  connectionReturnFocus = document.activeElement as HTMLElement | null;
  connectionEntry.value = entry;
};
const closeConnection = async () => {
  connectionEntry.value = null;
  await nextTick();
  connectionReturnFocus?.focus();
  connectionReturnFocus = null;
};
// Resource Capture is paused by product decision. Keep its implementation and
// runtime seam available, but do not expose the sidebar entry until resumed.
const resourceCaptureVisible = false;
const actionNotice = ref('');
const inputSectionRef = ref();
const settingsTriggerRef = useTemplateRef<HTMLButtonElement>('settingsTriggerRef');
const settingsModalRef = useTemplateRef<HTMLElement>('settingsModalRef');

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';
let settingsReturnFocus: HTMLElement | null = null;

const focusFirstInModal = (container: HTMLElement | null) => {
  if (!container) return;
  const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  (first ?? container).focus();
};

const trapTabKey = (container: HTMLElement | null, event: KeyboardEvent) => {
  if (!container || event.key !== 'Tab') return;
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null,
  );
  if (items.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
};

const isModalOpen = computed(() => showSettings.value || connectionEntry.value !== null);

watch(showSettings, async (open) => {
  if (open) {
    settingsReturnFocus = (document.activeElement as HTMLElement | null) ?? settingsTriggerRef.value;
    await nextTick();
    focusFirstInModal(settingsModalRef.value);
  } else {
    await nextTick();
    (settingsReturnFocus ?? settingsTriggerRef.value)?.focus?.();
    settingsReturnFocus = null;
  }
});

// 初始化通知国际化模板
const initNotificationI18n = async () => {
  try {
    await store.initNotificationI18n({
        successTitle: t('notification.success.title'),
        errorTitle: t('notification.error.title'),
        cancelTitle: t('notification.cancel.title'),
        batchSuccessTitle: t('notification.success.batch'),
        batchErrorTitle: t('notification.error.batch'),
        batchCancelTitle: t('notification.cancel.batch'),
        tasksCompleted: t('notification.tasks_completed'),
        openFolder: t('notification.open_folder')
      });
  } catch (e) {
    console.error('Failed to init notification i18n', e);
  }
};

const setTaskActionFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  actionNotice.value = `${t('download_list.summary.failed')}: ${message}`;
};

const handleTaskDownload = async (payload: { rowId: string, format: DownloadFormat, options?: Partial<ExtraArgs> }) => {
  actionNotice.value = '';
  try {
    await taskActions.startDownload(payload.rowId, payload.format, payload.options);
  } catch (error) {
    setTaskActionFailure(error);
  }
};

const handleTaskCancel = async (rowId: string) => {
  actionNotice.value = '';
  try {
    const result = await taskActions.cancel(rowId);
    const outcome = result.settlement ? await result.settlement : result.outcome;
    if (outcome.type === 'cancel-rejected') {
      actionNotice.value = `${t('download_list.summary.failed')}: ${outcome.error.message}`;
    } else if (outcome.type === 'not-cancellable') {
      actionNotice.value = '';
    }
  } catch (error) {
    setTaskActionFailure(error);
  }
};

const handleTaskRemove = async (rowId: string) => {
  // A captured row owns native secret material. Do not remove the UI owner
  // until native revocation has completed successfully.
  const row = tasks.value.find((task) => task.rowId === rowId);
  if (row?.capture) {
    try {
      await taskRuntime.capture.revokeRow({ capture: row.capture });
    } catch (error) {
      console.error('Failed to revoke the capture context:', error);
      return;
    }
  }
  taskActions.remove(rowId);
};

const handleTaskRetryDownload = async (rowId: string) => {
  actionNotice.value = '';
  try {
    await taskActions.retryDownload(rowId);
  } catch (error) {
    setTaskActionFailure(error);
  }
};

const handleTaskRecovery = async ({ rowId, action }: { rowId: string; action: DownloadRecoveryAction }) => {
  actionNotice.value = '';
  try {
    switch (action) {
      case 'credentials': showSettings.value = true; break;
      case 'directory': await store.chooseDownloadDir(); break;
      case 'format':
      case 'reanalyze': await taskActions.reanalyze(rowId); break;
      case 'retry': {
        const row = tasks.value.find((task) => task.rowId === rowId);
        if (row?.failureKind === 'analysis') await taskActions.reanalyze(rowId);
        else await taskActions.retryDownload(rowId);
        break;
      }
    }
  } catch (error) { setTaskActionFailure(error); }
};

const handleTaskReanalyze = async (rowId: string) => {
  actionNotice.value = '';
  try {
    await taskActions.reanalyze(rowId);
  } catch (error) {
    setTaskActionFailure(error);
  }
};

const handleTaskOpenFolder = async (rowId: string) => {
  actionNotice.value = '';
  try {
    const task = tasks.value.find((task) => task.rowId === rowId);
    await store.openFolder(task?.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    actionNotice.value = t('app.open_folder_failed', { error: message });
  }
};

const handleTaskOpenFile = async (rowId: string) => {
  actionNotice.value = '';
  try {
    const task = tasks.value.find((task) => task.rowId === rowId);
    await store.openFile(task?.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    actionNotice.value = t('app.open_file_failed', { error: message });
  }
};

// 生命周期管理
onMounted(async () => {
  store.initTheme();
  store.initPaths();
  await store.checkDependencies();
  initNotificationI18n();


});

onUnmounted(async () => {
  stopTaskRows();
  try {
    await disposeTaskRuntimeWithRetry(taskRuntime);
  } catch (error) {
    console.error('Failed to dispose task runtime:', error);
  }


});
</script>

<template>
  <div class="container">
    <header class="header" :inert="isModalOpen">
      <div class="header-main">
        <img class="brand-logo" :src="brandLogo" :alt="t('app.title')" width="48" height="48" />
        <h1 class="logo">{{ t('app.title') }}</h1>
        <div v-if="appVersion" class="badge">v{{ appVersion }}</div>
      </div>

      <div class="header-actions">
        <div class="theme-switcher">
          <span class="theme-label">{{ t('app.theme') }}</span>
          <ThemeSelector :model-value="theme" @update:model-value="store.setTheme" />
        </div>
        <button
          ref="settingsTriggerRef"
          class="neo-button icon-btn settings-toggle header-control"
          @click="showSettings = !showSettings"
          :class="{ active: showSettings }"
          :title="t('app.settings')"
          :aria-expanded="showSettings"
          aria-controls="settings-dialog"
          :aria-label="t('app.settings')"
        >
          <NeoIcon name="gear" :size="18" />
          <span class="btn-text">{{ t('app.settings') }}</span>
        </button>
      </div>
    </header>

    <div v-if="!dependenciesInstalled" class="banner-error" :inert="isModalOpen">
      <NeoIcon name="warn" :size="18" class="banner-icon" />
      <span>{{ t('app.dependency_error') }}</span>
    </div>

    <div v-if="actionNotice" class="banner-error action-notice" role="alert" aria-live="assertive" :inert="isModalOpen">
      <NeoIcon name="warn" :size="18" class="banner-icon" />
      <span>{{ actionNotice }}</span>
      <button type="button" class="neo-button icon-only micro ghost" :aria-label="t('settings.close')" @click="actionNotice = ''">
        <NeoIcon name="cross" :size="13" />
      </button>
    </div>

    <!-- Layout Change: Sidebar + Main Content -->
    <div class="app-layout" :data-workspace-state="tasks.length === 0 ? 'empty' : 'active'" :class="{ disabled: !dependenciesInstalled }" :inert="isModalOpen">

      <!-- Sidebar: Operations & Settings -->
      <aside class="sidebar">
        <div class="neo-box sidebar-panel glass-panel">
          <h3 class="panel-title">
            <NeoIcon name="sliders" :size="18" class="svg-icon" />
            <span>{{ tasks.length === 0 ? t('app.workspace_start') : t('app.operation_panel') }}</span>
          </h3>
            <InputSection ref="inputSectionRef" @analyze="taskActions.analyzeUrls" @connect="openConnection" />
        </div>

        <div v-if="resourceCaptureVisible" class="neo-box sidebar-panel glass-panel capture-sidebar-panel">
          <h3 class="panel-title">
            <NeoIcon name="search" :size="18" class="svg-icon" />
            <span>{{ t('capture.title') }}</span>
          </h3>
          <CapturePanel :capture="taskRuntime.capture" />
        </div>
      </aside>

      <!-- Main Content: Workspace (Analysis + Queue) -->
      <main class="main-content">
        <!-- Empty State -->
        <section v-if="tasks.length === 0" class="empty-state-shell">
          <div class="empty-state neo-box">
            <h3>{{ t('app.workspace_hero') }}</h3>
            <p>{{ t('app.start_guide') }}</p>
            <div class="empty-actions">
              <button class="neo-button ghost" @click="inputSectionRef?.handlePaste()">
                <NeoIcon name="paste" :size="16" class="svg-icon" />
                <span>{{ t('input.paste') }}</span>
              </button>
            </div>
            <ol class="workspace-guide" :aria-label="t('app.workspace_guide')">
              <li><NeoIcon name="link" :size="20" aria-hidden="true" /><div><strong>{{ t('app.workspace_link') }}</strong><span>{{ t('app.workspace_link_hint') }}</span></div></li>
              <li><NeoIcon name="sliders" :size="20" aria-hidden="true" /><div><strong>{{ t('app.workspace_format') }}</strong><span>{{ t('app.workspace_format_hint') }}</span></div></li>
              <li><NeoIcon name="folder" :size="20" aria-hidden="true" /><div><strong>{{ t('app.workspace_file') }}</strong><span>{{ t('app.workspace_file_hint') }}</span></div></li>
            </ol>
          </div>
        </section>

        <!-- Unified Task List -->
        <section class="download-queue" v-if="tasks.length > 0">
          <h2 class="section-title">{{ t('app.task_list') || 'Tasks' }} ({{ tasks.length }})</h2>
          <DownloadList
            :items="tasks"
            :admin-mode="!!extraArgs.adminMode"
            :max-concurrency="1"
            @open-folder="handleTaskOpenFolder"
            @recover="handleTaskRecovery"
            @cancel="handleTaskCancel"
            @download="handleTaskDownload"
            @remove="handleTaskRemove"
            @retry-download="handleTaskRetryDownload"
            @reanalyze="handleTaskReanalyze"
            @open-file="handleTaskOpenFile"
          />
        </section>
      </main>

    </div>

    <SettingsPanel v-if="connectionEntry" :connection-entry="connectionEntry" @close="closeConnection" />
    <!-- Settings Modal -->
    <div
      v-if="showSettings"
      class="modal-overlay"
      @click.self="showSettings = false"
      @keydown.escape.stop="showSettings = false"
      @keydown.tab="trapTabKey(settingsModalRef, $event)"
    >
      <div
        id="settings-dialog"
        ref="settingsModalRef"
        class="modal-content settings-modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        tabindex="-1"
      >
        <SettingsPanel @close="showSettings = false" />
      </div>
    </div>

  </div>
</template>

<style scoped>
.container {
  max-width: 1600px;
  margin: 0 auto;
  padding: var(--spacing-md);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  margin-bottom: var(--spacing-md);
  padding-bottom: var(--spacing-sm);
  border-bottom: 2px solid var(--color-border);
}

.header-main {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-md);
}

.section-title {
  margin-bottom: 0 !important;
}

.logo {
  font-size: 1.45rem;
  font-weight: 800;
  margin: 0;
  letter-spacing: -0.02em;
  text-transform: none;
  text-shadow: none;
  color: var(--color-text);
  line-height: 1.2;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.theme-switcher {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.icon-btn {
  font-size: 0.9rem;
  padding: var(--spacing-sm) var(--spacing-md);
  min-height: auto;
  display: flex;
  align-items: center;
}

.btn-text {
  margin-left: var(--spacing-sm);
  font-size: 0.95rem;
  font-weight: 600;
}

.badge {
  background-color: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface));
  color: var(--color-on-secondary, var(--color-text-muted));
  font-size: 0.75rem;
  font-weight: 700;
  padding: 2px 8px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  box-shadow: none;
  text-transform: none;
  letter-spacing: 0;
}

.theme-label {
  font-weight: 900;
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Layout: Sidebar + Main Content */
.app-layout {
  display: flex;
  gap: var(--spacing-lg);
  flex: 1;
  align-items: start;
}

.sidebar {
  width: 420px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  position: sticky;
  top: var(--spacing-md);
  z-index: 10;
}

.main-content {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
  min-width: 0;
}

/* Responsive Design */
@media (max-width: 900px) {
  .app-layout {
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .sidebar {
    width: 100%;
    position: static;
    order: -1;
  }

  .main-content {
    width: 100%;
  }
}

.section-title {
  font-size: 1.2rem;
  font-weight: 900;
  margin: 0 0 var(--spacing-md) 0;
  text-transform: uppercase;
}

.status-box {
  text-align: center;
  padding: var(--spacing-xl);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
  animation: fadeIn 0.2s ease-out;
}

.modal-content {
  background-color: var(--color-surface);
  width: 90%;
  max-width: 800px;
  height: 85vh;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-hard);
  border: var(--border-width) solid var(--color-border);
  overflow: hidden;
  animation: scaleIn 0.2s ease-out;
  display: flex;
  flex-direction: column;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes scaleIn {
  from {
    transform: scale(0.95);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

@media (max-width: 1024px) {
  .header {
    flex-wrap: wrap;
  }

  .app-layout {
    flex-direction: column;
  }

  .sidebar {
    width: 100%;
    position: static;
  }

  .dedication-badge {
    order: 3;
    width: 100%;
    justify-content: center;
  }
}

.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.banner-error {
  background-color: var(--color-error);
  color: var(--color-bg);
  padding: var(--spacing-md);
  border-radius: var(--radius-sm);
  margin-bottom: var(--spacing-lg);
  font-weight: bold;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  border: var(--border-width) solid var(--color-border);
  box-shadow: var(--shadow-hard);
}

.sidebar-panel {
  padding: var(--spacing-md);
  background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-bg-alt) 100%);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-hard);
}

.panel-title {
  font-size: 1.1rem;
  font-weight: 900;
  margin: 0 0 var(--spacing-md) 0;
  padding-bottom: var(--spacing-xs);
  border-bottom: 3px solid var(--color-border);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.panel-title .svg-icon {
  margin-right: 6px;
}

.svg-icon {
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}

.banner-icon {
  color: var(--color-error);
  margin-right: 6px;
}

.empty-state-shell {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 420px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 640px;
  min-height: 360px;
  color: var(--color-text-muted);
  border: 3px dashed var(--color-border);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-bg-alt) 100%);
  box-shadow: var(--shadow-hard);
  padding: 32px 28px;
  text-align: center;
}

.empty-icon {
  width: 96px;
  height: 96px;
  margin-bottom: var(--spacing-md);
  position: relative;
}

.empty-icon .icon-folder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 3.4rem;
  filter: drop-shadow(3px 3px 0 var(--color-shadow));
}

.empty-state h3 {
  font-size: 1.5rem;
  margin: 0 0 var(--spacing-sm) 0;
  color: var(--color-text);
  font-weight: 900;
  text-shadow: 1px 1px 0 var(--color-shadow);
}

.empty-state p {
  font-size: 1rem;
  margin: 0;
  opacity: 0.8;
  max-width: 32ch;
}

.empty-actions {
  display: flex;
  gap: var(--spacing-md);
  margin-top: var(--spacing-md);
}

@media (prefers-reduced-motion: reduce) {
  .modal-overlay,
  .modal-content {
    animation: none;
  }
}
</style>
