<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTaskMenuOverlay } from './useTaskMenuOverlay';
import type { DownloadFormat, ExtraArgs } from '../types';
import { displayFormats, resolveTaskDownloadOptions, type TaskDownloadOptions } from '../application/taskDownloadOptions';
import type { TaskPresentationRow } from '../application/taskPresentation';
import { useI18n } from 'vue-i18n';
import {
  classifyTaskFailure,
  getAudioBadgeText,
  getCaptureFailureText,
  getCredentialFailureKeys,
  getCredentialReasonKey,
  getCredentialSourceKey,
  getDownloadListStatusText,
  getPrimaryTaskAction,
  getRowOverflowActions,
  getTaskActions,
  isAudioFormat,
  parseDownloadErrorMessage,
  shouldShowNumericProgress,
} from './downloadList.helpers';
import { projectDownloadList, resolveRowFormat } from './downloadList.projection';
import { formatLogLine } from '../utils/logFormatter';
import { redactSensitiveText } from '../utils/redactSensitiveText';
import { qualityMessage } from '../application/qualityPresentation';
import { getDownloadRecovery, type DownloadRecoveryAction } from '../application/downloadRecovery';
import { getAttemptDiagnostics } from '../application/attemptDiagnostics';
import { nextTaskDetailView, type TaskDetailView } from './taskDetailDisclosure';
import PlatformIcon from './PlatformIcon.vue';
import NeoIcon from './NeoIcon.vue';

const {
  items,
  downloadAllPending = false,
} = defineProps<{
  items: TaskPresentationRow[];
  adminMode: boolean;
  maxConcurrency?: number;
  downloadAllPending?: boolean;
}>();

const { t } = useI18n();

interface DownloadPayload {
  rowId: string;
  format: DownloadFormat;
  options?: Partial<ExtraArgs>;
}

const emit = defineEmits<{
  (e: 'download', payload: DownloadPayload): void;
  (e: 'download-all', payloads: DownloadPayload[]): void;
  (e: 'cancel', rowId: string): void;
  (e: 'retry-download', rowId: string): void;
  (e: 'reanalyze', rowId: string): void;
  (e: 'remove', rowId: string): void;
  (e: 'open-folder', rowId: string): void;
  (e: 'open-file', rowId: string): void;
  (e: 'recover', payload: { rowId: string; action: DownloadRecoveryAction }): void;
}>();

const imageLoadErrors = ref<Record<string, boolean>>({});
const rowLogsExpanded = ref<Record<string, boolean>>({});
const rowCommandExpanded = ref<Record<string, boolean>>({});
const rowOverflowOpen = ref<Record<string, boolean>>({});
const formatOpenRowId = ref<string | null>(null);
const menuOverlay = useTaskMenuOverlay(() => {
  rowOverflowOpen.value = {};
  formatOpenRowId.value = null;
});
const taskDetailViews = ref<Record<string, TaskDetailView>>({});
const taskDetailsOpen = ref<Record<string, boolean>>({});
const toggleTaskDetails = (task: TaskPresentationRow) => {
  taskDetailsOpen.value[task.rowId] = !taskDetailsOpen.value[task.rowId];
  taskDetailViews.value[task.rowId] = nextTaskDetailView(taskDetailViews.value[task.rowId], !task.capture && getTaskActions(task).canStartDownload);
};
const rowFormatSelections = ref<Record<string, DownloadFormat>>({});
const rowOptions = ref<Record<string, TaskDownloadOptions>>({});
const rowOptionErrors = ref<Record<string, string>>({});
const optionsFor = (rowId: string) => rowOptions.value[rowId] ?? (rowOptions.value[rowId] = { formatId: '' });
const availableFormatsFor = (task: TaskPresentationRow) => displayFormats(task.metadata?.availableFormats ?? [], isAudioFormat(getRowFormat(task)));
const formatDescription = (format: ReturnType<typeof displayFormats>[number]) => [format.height ? `${format.height}p` : format.bitrate ? `${Math.round(format.bitrate)} kbps` : format.formatId, format.fps ? `${format.fps} fps` : '', format.ext, format.language, format.vcodec === 'none' ? format.acodec : format.vcodec].filter(Boolean).join(' · ');
const transferPhase = (task: TaskPresentationRow) => {
  if (task.status === 'processing') return 'processing';
  for (let i = task.logs.length - 1; i >= 0; i--) { const match = /\[Phase\] (video|audio)/.exec(task.logs[i]!); if (match) return match[1]; }
  return 'transfer';
};
const subtitleFailed = (task: TaskPresentationRow) => task.logs.some(line => line.includes('[Subtitle] failed;'));
const formatGroups = [
  { kind: 'video', icon: 'tv', options: [{ value: 'video', label: 'MP4' }, { value: 'mkv', label: 'MKV' }] },
  { kind: 'audio', icon: 'music', options: [{ value: 'mp3', label: 'MP3' }, { value: 'flac', label: 'FLAC' }, { value: 'm4a', label: 'M4A' }, { value: 'opus', label: 'Opus' }] },
] satisfies { kind: string; icon: string; options: { value: DownloadFormat; label: string }[] }[];
const formatLabel = (format: DownloadFormat) => format === 'video' ? 'MP4' : format === 'opus' ? 'Opus' : format.toUpperCase();

const closeFormatPicker = (restoreFocus = false) => {
  if (formatOpenRowId.value === null) return;
  menuOverlay.close(restoreFocus);
  formatOpenRowId.value = null;
};

const toggleFormatPicker = (rowId: string, event: MouseEvent) => {
  if (formatOpenRowId.value === rowId) { closeFormatPicker(); return; }
  closeAllRowOverflows();
  menuOverlay.open(event.currentTarget as HTMLElement);
  formatOpenRowId.value = rowId;
};
const handleFormatKeydown = (rowId: string, event: KeyboardEvent) => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  closeAllRowOverflows();
  menuOverlay.open(event.currentTarget as HTMLElement, event.key === 'End' || event.key === 'ArrowUp' ? 'last' : event.key === 'Home' ? 'first' : 'selected');
  formatOpenRowId.value = rowId;
};

const getRowFormat = (task: TaskPresentationRow): DownloadFormat =>
  resolveRowFormat(task, rowFormatSelections.value);

const readyRows = computed(() => items.filter(task => getPrimaryTaskAction(task) === 'download'));
const bulkRequestPending = ref(false);
watch(() => downloadAllPending, (pending) => {
  if (!pending) bulkRequestPending.value = false;
});
const downloadPayloadFor = (task: TaskPresentationRow): DownloadPayload | undefined => {
  try {
    const options = resolveTaskDownloadOptions(optionsFor(task.rowId), task.metadata?.availableFormats ?? [], getRowFormat(task));
    rowOptionErrors.value[task.rowId] = '';
    return { rowId: task.rowId, format: getRowFormat(task), ...(Object.keys(options).length ? { options } : {}) };
  } catch (error) {
    rowOptionErrors.value[task.rowId] = t(`download_list.task_options.${error instanceof Error && error.message === 'TASK_FORMAT_UNAVAILABLE' ? 'invalid_format' : 'invalid_section'}`);
    return undefined;
  }
};
const downloadAll = () => {
  if (downloadAllPending || bulkRequestPending.value) return;
  const payloads = readyRows.value.map(downloadPayloadFor).filter((payload): payload is DownloadPayload => payload !== undefined);
  if (!payloads.length) return;
  bulkRequestPending.value = true;
  emit('download-all', payloads);
};

const performPrimaryTaskAction = (task: TaskPresentationRow) => {
  switch (getPrimaryTaskAction(task)) {
    case 'download': {
      const payload = downloadPayloadFor(task);
      if (payload) emit('download', payload);
      break;
    }
    case 'cancel':
      emit('cancel', task.rowId);
      break;
    case 'retry-download':
      emit('retry-download', task.rowId);
      break;
    case 'reanalyze':
      emit('reanalyze', task.rowId);
      break;
    case 'open-folder':
      emit('open-folder', task.rowId);
      break;
    default:
      break;
  }
};

const isRowOverflowOpen = (rowId: string) => Boolean(rowOverflowOpen.value[rowId]);

const focusRowOverflowTrigger = async (rowId: string) => {
  if (typeof document === 'undefined') return;
  await nextTick();
  const trigger = Array.from(document.querySelectorAll<HTMLElement>('[data-row-overflow-trigger]'))
    .find((element) => element.dataset.rowOverflowTrigger === rowId);
  trigger?.focus();
};

const closeRowOverflow = (rowId: string, restoreFocus = false) => {
  if (!rowOverflowOpen.value[rowId]) return;
  const next = { ...rowOverflowOpen.value };
  delete next[rowId];
  rowOverflowOpen.value = next;
  menuOverlay.close();
  if (restoreFocus) void focusRowOverflowTrigger(rowId);
};

const closeAllRowOverflows = () => {
  if (Object.keys(rowOverflowOpen.value).length === 0) return;
  rowOverflowOpen.value = {};
  menuOverlay.close();
};

const toggleRowOverflow = (rowId: string, event: MouseEvent | KeyboardEvent) => {
  const shouldOpen = !isRowOverflowOpen(rowId);
  closeFormatPicker();
  closeAllRowOverflows();
  if (shouldOpen) {
    menuOverlay.open(event.currentTarget as HTMLElement, 'first');
    rowOverflowOpen.value = { [rowId]: true };
  }
};

const handleDocumentClick = (event: MouseEvent) => {
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest('.row-overflow-wrap, .row-overflow-menu, .format-picker, .format-menu')
  ) return;
  closeFormatPicker();
  closeAllRowOverflows();
};

const handleOverflowReanalyze = (task: TaskPresentationRow) => {
  closeRowOverflow(task.rowId);
  emit('reanalyze', task.rowId);
};

const handleOverflowOpenFile = (task: TaskPresentationRow) => {
  closeRowOverflow(task.rowId);
  emit('open-file', task.rowId);
};

const handleOverflowRemove = (task: TaskPresentationRow) => {
  closeRowOverflow(task.rowId);
  handleTaskRemoveWithUndo(task);
};

interface PendingRemoval {
  task: TaskPresentationRow;
  timeoutId: ReturnType<typeof setTimeout>;
  secondsLeft: number;
  intervalId: ReturnType<typeof setInterval>;
}

const pendingRemoval = ref<PendingRemoval | null>(null);
const pendingRemovalRowIds = ref<Record<string, boolean>>({});

// Search, Status Filter & Keyboard state
const searchQuery = ref('');
const statusFilter = ref<'all' | 'active' | 'waiting' | 'failed' | 'completed'>('all');
const searchInputRef = ref<HTMLInputElement | null>(null);
const focusedRowId = ref<string | null>(null);

const handleTaskRemoveWithUndo = (task: TaskPresentationRow) => {
  if (pendingRemoval.value) {
    commitPendingRemoval();
  }

  const rowId = task.rowId;
  pendingRemovalRowIds.value[rowId] = true;

  let remaining = 4;
  const intervalId = setInterval(() => {
    remaining -= 1;
    if (pendingRemoval.value && pendingRemoval.value.task.rowId === rowId) {
      pendingRemoval.value.secondsLeft = remaining;
    }
  }, 1000);

  const timeoutId = setTimeout(() => {
    commitPendingRemoval();
  }, 4000);

  pendingRemoval.value = {
    task,
    timeoutId,
    secondsLeft: remaining,
    intervalId,
  };
};

const undoRemoval = () => {
  if (!pendingRemoval.value) return;
  clearTimeout(pendingRemoval.value.timeoutId);
  clearInterval(pendingRemoval.value.intervalId);

  const rowId = pendingRemoval.value.task.rowId;
  delete pendingRemovalRowIds.value[rowId];
  pendingRemoval.value = null;
};

const commitPendingRemoval = () => {
  if (!pendingRemoval.value) return;
  clearTimeout(pendingRemoval.value.timeoutId);
  clearInterval(pendingRemoval.value.intervalId);

  const rowId = pendingRemoval.value.task.rowId;
  delete pendingRemovalRowIds.value[rowId];
  emit('remove', rowId);
  pendingRemoval.value = null;
};

const projection = computed(() =>
  projectDownloadList(items, {
    searchQuery: searchQuery.value,
    statusFilter: statusFilter.value,
    pendingRemovalRowIds: pendingRemovalRowIds.value,
    rowFormatSelections: rowFormatSelections.value,
  }),
);

const scrollToFocusedRow = (rowId: string) => {
  if (typeof document === 'undefined') return;
  const el = document.querySelector(`[data-row-id="${rowId}"]`);
  if (el && typeof el.scrollIntoView === 'function') {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  }
};

const handleGlobalKeydown = (e: KeyboardEvent) => {
  if (e.defaultPrevented) return;
  const interactiveSelector = 'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="button"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"]';
  const target = e.target instanceof Element ? e.target : null;
  const activeElement = document.activeElement;
  const ownsSearchEscape = e.key === 'Escape' && activeElement === searchInputRef.value;
  if (!ownsSearchEscape && (target?.closest(interactiveSelector) || activeElement?.closest(interactiveSelector))) return;
  const openOverflowRowId = Object.keys(rowOverflowOpen.value)
    .find((rowId) => rowOverflowOpen.value[rowId]);
  if (openOverflowRowId) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeRowOverflow(openOverflowRowId, true);
    }
    return;
  }

  const activeEl = document.activeElement;
  if (activeEl?.closest('.format-picker, .format-menu')) return;

  // 模态对话框内部聚焦时静默队列快捷键
  const isInsideModal = Boolean(
    activeEl?.closest?.('[role="dialog"], [aria-modal="true"], .modal-overlay, .modal-content'),
  );
  if (isInsideModal) return;

  const isInputActive =
    activeEl &&
    (activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.tagName === 'SELECT' ||
      (activeEl as HTMLElement).isContentEditable);

  if (e.key === '/' && !isInputActive) {
    e.preventDefault();
    searchInputRef.value?.focus();
    return;
  }

  if (isInputActive) {
    if (e.key === 'Escape') {
      if (searchQuery.value) {
        searchQuery.value = '';
      } else {
        (activeEl as HTMLElement)?.blur();
      }
    }
    return;
  }

  if (e.key === 'Escape') {
    if (searchQuery.value) {
      searchQuery.value = '';
      return;
    }
    focusedRowId.value = null;
    return;
  }

  const tasks = projection.value.visibleRows;
  if (tasks.length === 0) return;

  const currentIndex = tasks.findIndex((t) => t.rowId === focusedRowId.value);

  if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
    e.preventDefault();
    const nextIndex = currentIndex < tasks.length - 1 ? currentIndex + 1 : 0;
    focusedRowId.value = tasks[nextIndex].rowId;
    scrollToFocusedRow(focusedRowId.value);
    return;
  }

  if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
    e.preventDefault();
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : tasks.length - 1;
    focusedRowId.value = tasks[prevIndex].rowId;
    scrollToFocusedRow(focusedRowId.value);
    return;
  }

  if (focusedRowId.value) {
    const focusedTask = tasks.find((t) => t.rowId === focusedRowId.value);
    if (!focusedTask) return;

    if (e.key === ' ') {
      const activeTag = activeEl?.tagName;
      if (activeTag === 'BUTTON' || activeTag === 'A') return;
      e.preventDefault();
      performPrimaryTaskAction(focusedTask);
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!focusedTask.actions.canRemove) return;
      e.preventDefault();
      handleTaskRemoveWithUndo(focusedTask);
      const remainingTasks = tasks.filter((t) => t.rowId !== focusedTask.rowId);
      if (remainingTasks.length > 0) {
        const nextIdx = Math.min(currentIndex, remainingTasks.length - 1);
        focusedRowId.value = remainingTasks[nextIdx].rowId;
      } else {
        focusedRowId.value = null;
      }
      return;
    }
  }
};

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleGlobalKeydown);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('click', handleDocumentClick);
  }
});

onBeforeUnmount(() => {
  if (pendingRemoval.value) {
    commitPendingRemoval();
  }
  Object.values(copiedTimers).forEach(clearTimeout);
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleGlobalKeydown);
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('click', handleDocumentClick);
  }
});

watch(
  () => items.map((item) => item.rowId),
  (rowIds) => {
    const keep = new Set(rowIds);
    if (formatOpenRowId.value && !keep.has(formatOpenRowId.value)) closeFormatPicker();
    if (Object.keys(rowOverflowOpen.value).some(rowId => !keep.has(rowId))) closeAllRowOverflows();
    imageLoadErrors.value = Object.fromEntries(
      Object.entries(imageLoadErrors.value).filter(([rowId]) => keep.has(rowId)),
    );
    rowLogsExpanded.value = Object.fromEntries(
      Object.entries(rowLogsExpanded.value).filter(([rowId]) => keep.has(rowId)),
    );
    rowCommandExpanded.value = Object.fromEntries(
      Object.entries(rowCommandExpanded.value).filter(([rowId]) => keep.has(rowId)),
    );
    rowOverflowOpen.value = Object.fromEntries(
      Object.entries(rowOverflowOpen.value).filter(([rowId]) => keep.has(rowId)),
    );
    rowFormatSelections.value = Object.fromEntries(
      Object.entries(rowFormatSelections.value).filter(([rowId]) => keep.has(rowId)),
    ) as Record<string, DownloadFormat>;
    pendingRemovalRowIds.value = Object.fromEntries(
      Object.entries(pendingRemovalRowIds.value).filter(([rowId]) => keep.has(rowId)),
    );
  },
  { immediate: true },
);

const setRowFormat = (task: TaskPresentationRow, format: DownloadFormat) => {
  rowFormatSelections.value[task.rowId] = format;
  optionsFor(task.rowId).formatId = '';
  closeFormatPicker(true);
};

const toggleLogs = (rowId: string) => {
  rowLogsExpanded.value[rowId] = !rowLogsExpanded.value[rowId];
};

const isLogsExpanded = (rowId: string) => Boolean(rowLogsExpanded.value[rowId]);

const toggleCommand = (rowId: string) => {
  rowCommandExpanded.value[rowId] = !rowCommandExpanded.value[rowId];
};

const isCommandExpanded = (rowId: string) => Boolean(rowCommandExpanded.value[rowId]);

const copiedRowIds = ref<Record<string, boolean>>({});
const copiedTimers: Record<string, ReturnType<typeof setTimeout>> = {};

const copyTaskLogs = async (task: TaskPresentationRow) => {
  const lines: string[] = [];
  lines.push(`【任务】: ${task.metadata?.title || task.title || task.url}`);
  lines.push(`【链接】: ${task.url}`);
  lines.push(`【状态】: ${task.status} (${Math.round(task.progress || 0)}%)`);
  lines.push(`【诊断】: ${JSON.stringify(getAttemptDiagnostics(task))}`);
  if (task.errorMsg) {
    lines.push(`【错误】: ${task.errorMsg}`);
  }
  if (task.debugCommand) {
    lines.push(`【命令】: ${task.debugCommand}`);
  }
  lines.push('【详细日志】:');
  if (task.logs && task.logs.length > 0) {
    lines.push(...task.logs);
  } else {
    lines.push('(暂无日志)');
  }
  const text = redactSensitiveText(lines.join('\n'));
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      copiedRowIds.value[task.rowId] = true;
      if (copiedTimers[task.rowId]) {
        clearTimeout(copiedTimers[task.rowId]);
      }
      copiedTimers[task.rowId] = setTimeout(() => {
        delete copiedRowIds.value[task.rowId];
        delete copiedTimers[task.rowId];
      }, 2000);
    }
  } catch (e) {
    console.error('Failed to copy logs to clipboard', e);
  }
};

const handleImageError = (rowId: string) => {
  imageLoadErrors.value[rowId] = true;
};

const getErrorState = (errorMsg?: string) => {
  const recovery = getDownloadRecovery(errorMsg);
  if (recovery?.kind === 'cookieFile') return {
    title: t('download_list.recovery.authentication'),
    hint: t('download_list.recovery.decision'),
  };
  if (recovery && recovery.kind !== 'unknown') return { title: t(recovery.messageKey), hint: '' };
  return parseDownloadErrorMessage(errorMsg, {
    youtubeMessages: {
      JS_RUNTIME_FAILURE: t('download_list.quality.runtime_failure'),
      COOKIE_REFRESH_REQUIRED: t('download_list.quality.refresh_cookie'),
      AUTH_REQUIRED: t('download_list.quality.auth_required'),
      SMART_DECISION_REQUIRED: t('download_list.quality.reanalyze'),
      SMART_NO_USABLE_FORMAT: t('download_list.quality.no_usable'),
    },
    fallback: t('download.error.unknown.title'),
    filesystemTitle: t('download.error.filesystem.title'),
    filesystemAction: t('download.error.filesystem.action'),
  });
};

const recoverTask = (task: TaskPresentationRow) => {
  const recovery = getDownloadRecovery(task.errorMsg);
  if (recovery && !['none', 'wait'].includes(recovery.action)) emit('recover', { rowId: task.rowId, action: recovery.action });
};

const getCaptureFailure = (task: TaskPresentationRow) => getCaptureFailureText(task, t);

const getFailureKindText = (task: TaskPresentationRow) => {
  const kind = classifyTaskFailure(task) || 'unknown';
  const key = `download_list.failure_kind.${kind}`;
  const translated = t(key);
  return translated === key ? kind : translated;
};

const getStatusIconName = (status: TaskPresentationRow['status']) => {
  switch (status) {
    case 'completed':
      return 'check';
    case 'error':
      return 'cross';
    case 'processing':
      return 'gear';
    case 'downloading':
      return 'download';
    case 'queued':
    case 'pending':
      return 'hourglass';
    case 'analyzing':
      return 'search';
    case 'analyzed':
      return 'file';
    default:
      return 'file';
  }
};

const getStatusText = (task: TaskPresentationRow) => getDownloadListStatusText(task.status, t, task.failureKind, task.errorMsg);

const getCredentialReasonText = (credential: TaskPresentationRow['credential']) => {
  const reasonKey = getCredentialReasonKey(credential);
  if (!reasonKey) return '';
  const parts = [t(reasonKey), ...getCredentialFailureKeys(credential).map((key) => t(key))];
  return parts.join(' · ');
};

const getProgressColor = (status: TaskPresentationRow['status']) => {
  switch (status) {
    case 'completed':
      return 'var(--color-success)';
    case 'error':
      return 'var(--color-error)';
    case 'processing':
      return 'var(--color-secondary)';
    case 'queued':
      return 'var(--color-text-light)';
    case 'analyzing':
      return 'var(--color-secondary)';
    default:
      return 'var(--color-primary)';
  }
};
</script>

<template>
  <div class="download-list-container">
    <!-- Compact queue chrome: video rows remain the primary visual surface. -->
    <div class="queue-toolbar">
      <div class="toolbar-search-row">
        <div class="search-input-shell">
          <NeoIcon name="search" :size="15" class="search-icon" />
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            class="neo-input search-input"
            :placeholder="t('download_list.filter.search_placeholder')"
            :aria-label="t('download_list.filter.search_aria')"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="search-clear-btn"
            :aria-label="t('download_list.filter.clear_search')"
            @click="searchQuery = ''"
          >
            <NeoIcon name="cross" :size="13" stroke-width="2.5" />
          </button>
        </div>

        <div class="status-filter-pills" role="group" :aria-label="t('download_list.filter.status_group')">
          <button
            type="button"
            class="filter-pill primary-filter-all"
            :class="{ active: statusFilter === 'all' }"
            :aria-pressed="statusFilter === 'all'"
            @click="statusFilter = 'all'"
          >
            {{ t('download_list.filter.all') }}
            <span class="pill-count">{{ projection.summary.total }}</span>
          </button>
          <button
            type="button"
            class="filter-pill active-pill primary-filter-active"
            :class="{ active: statusFilter === 'active' }"
            :aria-pressed="statusFilter === 'active'"
            @click="statusFilter = 'active'"
          >
            {{ t('download_list.filter.active') }}
            <span class="pill-count">{{ projection.summary.active }}</span>
          </button>
          <button
            type="button"
            class="filter-pill completed-pill primary-filter-completed"
            :class="{ active: statusFilter === 'completed' }"
            :aria-pressed="statusFilter === 'completed'"
            @click="statusFilter = 'completed'"
          >
            {{ t('download_list.filter.completed') }}
            <span class="pill-count">{{ projection.summary.completed }}</span>
          </button>
        </div>

        <button type="button" class="neo-button primary download-all-button"
          :disabled="readyRows.length === 0 || downloadAllPending || bulkRequestPending"
          :aria-busy="downloadAllPending || bulkRequestPending"
          @click="downloadAll">
          <NeoIcon name="download" :size="16" />
          {{ t('download_list.actions.download_all', { count: readyRows.length }) }}
        </button>
      </div>
    </div>

    <!-- Filter Empty State -->
    <div v-if="projection.summary.total > 0 && projection.visibleRows.length === 0" class="filter-empty-state neo-box">
      <NeoIcon name="search" :size="28" stroke-width="2" class="empty-icon" />
      <div class="empty-text">
        <span class="empty-title">{{ t('download_list.filter.empty') }}</span>
        <span v-if="searchQuery" class="empty-query">「{{ searchQuery }}」</span>
      </div>
      <button class="neo-button small ghost" type="button" @click="searchQuery = ''; statusFilter = 'all'">
        <NeoIcon name="refresh" :size="14" />
        {{ t('download_list.filter.reset') }}
      </button>
    </div>

    <!-- Unified Flat Task List: 原地状态演进，零位置跳跃 -->
    <section class="unified-queue-list">
      <div v-if="projection.visibleRows.length === 0 && projection.summary.total === 0" class="queue-empty-state">
        {{ t('app.no_tasks_default') }}
      </div>
      <TransitionGroup v-else name="queue-row" tag="div" class="queue-rows">
        <div
          v-for="item in projection.visibleRows"
          :key="item.rowId"
          :data-row-id="item.rowId"
          class="download-card neo-box"
          :class="[item.status, isAudioFormat(getRowFormat(item)) ? 'task-audio' : 'task-video', { 'is-card-focused': focusedRowId === item.rowId }]"
          @click="focusedRowId = item.rowId"
        >
          <div class="card-main">
            <!-- Fixed Aspect Thumbnail Shell -->
            <div v-if="isAudioFormat(getRowFormat(item))" class="status-icon-wrapper audio-artwork" :aria-label="t('download_list.format_group.audio')">
              <NeoIcon name="music" :size="28" />
              <span class="audio-format-label">{{ formatLabel(getRowFormat(item)) }}</span>
            </div>
            <div v-else-if="item.metadata?.thumbnail && !imageLoadErrors[item.rowId]" class="thumbnail-wrapper">
              <img
                :src="item.metadata.thumbnail"
                class="thumbnail"
                referrerpolicy="no-referrer"
                loading="lazy"
                :alt="item.metadata?.title || item.title || item.url"
                @error="handleImageError(item.rowId)"
              />
            </div>
            <div v-else class="status-icon-wrapper" :class="item.status">
              <NeoIcon :name="getStatusIconName(item.status)" :size="20" class="status-icon" :class="'icon-status-' + item.status" />
            </div>

            <!-- Task Main Information -->
            <div class="info-section">
              <div class="header-row">
                <div class="title-wrapper">
                  <PlatformIcon :url="item.url" />
                  <span class="title" :title="item.metadata?.title || item.title || item.url">
                    {{ item.metadata?.title || item.title || item.url }}
                  </span>
                  <span v-if="item.capture" class="capture-origin-chip">
                    {{ t('capture.title') }} · {{ item.capture.siteLabel }}
                  </span>
                  <!-- State Indicator Badge: secondary to media identity -->
                  <span class="task-status-badge" :class="item.status">
                    {{ getStatusText(item) }}
                    <span v-if="item.status === 'processing' || item.status === 'analyzing'" class="dots-animation">...</span>
                  </span>
                  <span v-if="item.status === 'queued'" class="queue-position-badge" :title="`#${projection.queuePositions.get(item.rowId)}`">#{{ projection.queuePositions.get(item.rowId) }}</span>
                  <span v-if="item.status === 'downloading' && item.speed" class="speed-badge">
                    <NeoIcon name="speed" :size="12" class="brick-icon" /> {{ item.speed }}
                  </span>
                </div>
              </div>

              <!-- Core media identity and compact secondary metadata. -->
              <div v-if="item.metadata || getCredentialSourceKey(item.credential)" class="metadata-row primary-metadata-row">
                <template v-if="item.metadata">
                  <span v-if="item.metadata.channel" class="metadata-chip" :title="t('download_list.meta.channel')">
                    <NeoIcon name="user" :size="12" class="brick-icon" /> <span class="brick-value">{{ item.metadata.channel }}</span>
                  </span>
                  <span v-if="item.metadata.duration" class="metadata-chip" :title="t('download_list.meta.duration')">
                    <NeoIcon name="time" :size="12" class="brick-icon" /> <span class="brick-value">{{ item.metadata.duration }}</span>
                  </span>
                  <span
                    v-if="isAudioFormat(getRowFormat(item))"
                    class="metadata-chip audio-mode"
                    :title="t('download_list.meta.audio_mode_hint')"
                  >
                    <NeoIcon name="music" :size="12" class="brick-icon" /> <span class="brick-value">{{ getAudioBadgeText(getRowFormat(item)) || t('download_list.meta.audio_mode') }}</span>
                  </span>
                  <span
                    v-else-if="item.metadata.resolution"
                    class="metadata-chip resolution"
                    :title="t('download_list.meta.resolution')"
                  >
                    <NeoIcon name="tv" :size="12" class="brick-icon" /> <span class="brick-value">{{ t('download_list.meta.video_mode') }} · {{ item.metadata.resolution }}</span>
                  </span>
                  <span v-if="item.metadata.filesize" class="metadata-chip filesize" :title="t('download_list.meta.filesize')">
                    <NeoIcon name="disk" :size="12" class="brick-icon" /> <span class="brick-value">{{ item.metadata.filesize }}</span>
                  </span>
                </template>
                <span
                  v-if="getCredentialSourceKey(item.credential)"
                  class="metadata-chip credential-source"
                  data-credential-source
                  :title="t('download_list.credential_source.label')"
                >
                  <NeoIcon name="cookie" :size="12" class="brick-icon" /> <span class="brick-value">{{ t(getCredentialSourceKey(item.credential)!) }}</span>
                </span>
              </div>

              <!-- Hardware Accelerated Progress Bar -->
              <div v-if="item.metadata?.observedMaxHeight !== undefined && item.metadata.observedMaxHeight !== null" class="quality-observation" role="status">
                {{ t(qualityMessage(item.metadata, item.metadata.requestedResolution).key, qualityMessage(item.metadata, item.metadata.requestedResolution).params) }}
                <span v-if="item.metadata.youtubeDiagnostic?.cookieState === 'stale'">{{ t('download_list.quality.stale_cookie') }}</span>
                <details v-if="item.metadata.clientCapabilities?.length" class="quality-capabilities">
                  <summary>{{ t('download_list.quality.capabilities') }}</summary>
                  <div v-for="capability in item.metadata.clientCapabilities" :key="capability.playerClient">
                    {{ capability.playerClient }} · {{ capability.observedMaxHeight ? `${capability.observedMaxHeight}p` : t('download_list.quality.unavailable') }}
                    · {{ t('download_list.quality.runtime') }}: {{ capability.diagnostic.runtimeState }} · POT: {{ capability.diagnostic.potState }}
                  </div>
                </details>
              </div>
              <div v-if="item.status !== 'analyzed'" class="progress-section">
                <div
                  class="progress-track"
                  role="progressbar"
                  :aria-valuenow="item.progress"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  :aria-label="`${t('download_list.progress')}: ${Math.round(item.progress)}%`"
                >
                  <div
                    class="progress-fill"
                    :style="{
                      transform: `scaleX(${Math.min(Math.max(item.progress, 0), 100) / 100})`,
                      backgroundColor: getProgressColor(item.status),
                    }"
                    :class="{
                      'progress-liquid': item.status === 'downloading',
                      'progress-glow-complete': item.status === 'completed',
                    }"
                  />
                </div>
              </div>

              <!-- Micro Status Row -->
              <div v-if="shouldShowNumericProgress(item.status)" class="meta-row">
                <div class="status-container">
                  <span class="percentage">{{ Math.round(item.progress) }}%</span>
                  <span v-if="item.status === 'downloading' || item.status === 'processing'">{{ t(`download_list.transfer_phase.${transferPhase(item)}`) }}</span>
                </div>
              </div>

              <p v-if="rowOptionErrors[item.rowId]" class="error-hint" role="alert">{{ rowOptionErrors[item.rowId] }}</p>
              <p v-if="subtitleFailed(item)" class="subtitle-warning" role="status">{{ t('download_list.task_options.subtitle_failed') }}</p>

              <!-- Error Alert Banner -->
              <div v-if="item.status === 'error'" class="error-banner" role="alert">
                <NeoIcon name="warn" :size="16" class="error-icon" />
                <div class="error-content">
                  <div class="error-title-row">
                    <div class="error-title">
                      {{ getCaptureFailure(item) ?? getErrorState(item.errorMsg).title }}
                    </div>
                    <span v-if="getFailureKindText(item) && getFailureKindText(item) !== getDownloadListStatusText(item.status, t)" class="failure-kind-chip">{{ getFailureKindText(item) }}</span>
                  </div>
                  <div v-if="getErrorState(item.errorMsg).hint" class="error-hint">{{ getErrorState(item.errorMsg).hint }}</div>
                  <button v-if="!item.capture && item.failureKind !== 'cancelled' && getDownloadRecovery(item.errorMsg) && !['none', 'wait'].includes(getDownloadRecovery(item.errorMsg)!.action)"
                    type="button" class="neo-button small recovery-button" @click="recoverTask(item)">
                    {{ t(`download_list.recovery_action.${getDownloadRecovery(item.errorMsg)!.action}`) }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Task Contextual Actions: one primary action + progressive overflow. -->
            <div class="actions-section">
              <div v-if="getTaskActions(item).canStartDownload" class="action-group format-action-group">
                <div class="format-picker">
                  <button type="button" class="format-trigger" aria-haspopup="menu" :aria-expanded="formatOpenRowId === item.rowId"
                    :aria-label="`${t('download_list.actions.select_format')}: ${formatLabel(getRowFormat(item))}`"
                    @click.stop="toggleFormatPicker(item.rowId, $event)" @keydown.stop="handleFormatKeydown(item.rowId, $event)">
                    <NeoIcon :name="isAudioFormat(getRowFormat(item)) ? 'music' : 'tv'" :size="16" />
                    <span>{{ formatLabel(getRowFormat(item)) }}</span>
                    <NeoIcon name="chevron-up" :size="14" class="format-chevron" />
                  </button>
                  <Teleport to="body">
                  <div v-if="formatOpenRowId === item.rowId" :ref="menuOverlay.setMenu" :style="menuOverlay.style.value"
                    class="format-menu" role="menu" :aria-label="t('download_list.actions.select_format')"
                    @keydown.stop="menuOverlay.keydown" @focusout="menuOverlay.focusout">
                    <div v-for="group in formatGroups" :key="group.kind" class="format-group" role="group" :aria-label="t(`download_list.format_group.${group.kind}`)">
                      <div class="format-group-heading">
                        <strong>{{ t(`download_list.format_group.${group.kind}`) }}</strong>
                        <span>{{ group.kind === 'video' ? t('download_list.format_group.video_hint') : t('download_list.format_group.audio_hint') }}</span>
                      </div>
                      <button v-for="option in group.options" :key="option.value" type="button"
                        class="format-option" role="menuitemradio" :aria-checked="getRowFormat(item) === option.value"
                        @click="setRowFormat(item, option.value)">
                        <NeoIcon :name="group.icon" :size="16" />
                        <span>{{ option.label }}</span>
                        <NeoIcon v-if="getRowFormat(item) === option.value" name="check" :size="16" class="format-check" />
                      </button>
                    </div>
                  </div>
                  </Teleport>
                </div>
              </div>

              <button
                v-if="getPrimaryTaskAction(item) === 'download'"
                class="neo-button primary primary-task-action"
                type="button"
                @click="performPrimaryTaskAction(item)"
              >
                <NeoIcon name="download" :size="15" />
                <span>{{ t('pending_list.download_this') }}</span>
              </button>
              <button
                v-else-if="getPrimaryTaskAction(item) === 'cancel'"
                class="neo-button danger primary-task-action"
                type="button"
                @click="performPrimaryTaskAction(item)"
              >
                <NeoIcon name="cross" :size="14" />
                <span>{{ t('download_list.actions.cancel') }}</span>
              </button>
              <button
                v-else-if="getPrimaryTaskAction(item) === 'retry-download'"
                class="neo-button primary primary-task-action"
                type="button"
                @click="performPrimaryTaskAction(item)"
              >
                <NeoIcon name="refresh" :size="15" />
                <span>{{ t('download_list.actions.retry_download') }}</span>
              </button>
              <button
                v-else-if="getPrimaryTaskAction(item) === 'reanalyze'"
                class="neo-button primary primary-task-action"
                type="button"
                @click="performPrimaryTaskAction(item)"
              >
                <NeoIcon name="search" :size="15" />
                <span>{{ t('download_list.actions.reanalyze') }}</span>
              </button>
              <button
                v-else-if="getPrimaryTaskAction(item) === 'open-folder'"
                class="neo-button primary primary-task-action"
                type="button"
                @click="performPrimaryTaskAction(item)"
              >
                <NeoIcon name="folder" :size="15" />
                <span>{{ t('download_list.actions.open_folder') }}</span>
              </button>

              <button class="neo-button small ghost task-details-toggle" type="button" data-task-detail-toggle
                :aria-expanded="Boolean(taskDetailsOpen[item.rowId])" :aria-controls="`task-details-${item.rowId}`" @click="toggleTaskDetails(item)">
                <NeoIcon name="sliders" :size="15" /><span>{{ t('download_list.details.title') }}</span>
              </button>
              <button class="neo-button small ghost logs-toggle-btn" type="button"
                :aria-expanded="isLogsExpanded(item.rowId)"
                :aria-controls="`task-logs-${item.rowId}`"
                @click="toggleLogs(item.rowId)">
                <NeoIcon name="log" :size="15" />
                <span>{{ isLogsExpanded(item.rowId) ? t('download_list.actions.hide_log') : t('download_list.actions.show_log') }}</span>
              </button>
              <div v-if="getRowOverflowActions(item).length > 0" class="row-overflow-wrap">
                <button
                  type="button"
                  class="neo-button row-overflow-trigger"
                  aria-haspopup="menu"
                  :aria-expanded="isRowOverflowOpen(item.rowId)"
                  :aria-label="t('download_list.actions.more_actions')"
                  :title="t('download_list.actions.more_actions')"
                  :data-row-overflow-trigger="item.rowId"
                  @click.stop="toggleRowOverflow(item.rowId, $event)"
                  @keydown.down.prevent.stop="toggleRowOverflow(item.rowId, $event)"
                >
                  •••
                </button>

                <Teleport to="body">
                <div
                  v-if="isRowOverflowOpen(item.rowId)"
                  :ref="menuOverlay.setMenu"
                  :style="menuOverlay.style.value"
                  class="row-overflow-menu"
                  role="menu"
                  @click.stop
                  @keydown.stop="menuOverlay.keydown"
                  @focusout="menuOverlay.focusout"
                >
                  <template v-for="action in getRowOverflowActions(item)" :key="action">
                    <button
                      v-if="action === 'reanalyze'"
                      type="button"
                      role="menuitem"
                      class="row-overflow-menu-item row-overflow-reanalyze"
                      @click="handleOverflowReanalyze(item)"
                    >
                      <NeoIcon name="search" :size="14" />
                      <span>{{ t('download_list.actions.reanalyze') }}</span>
                    </button>
                    <button
                      v-else-if="action === 'open-file'"
                      type="button"
                      role="menuitem"
                      class="row-overflow-menu-item row-overflow-open-file"
                      @click="handleOverflowOpenFile(item)"
                    >
                      <NeoIcon name="play" :size="14" />
                      <span>{{ t('download_list.actions.open_file') }}</span>
                    </button>
                    <button
                      v-else-if="action === 'remove'"
                      type="button"
                      role="menuitem"
                      class="row-overflow-menu-item row-overflow-remove danger"
                      @click="handleOverflowRemove(item)"
                    >
                      <NeoIcon name="cross" :size="14" />
                      <span>{{ t('download_list.actions.remove') }}</span>
                    </button>
                  </template>
                </div>
                </Teleport>
              </div>
            </div>
          </div>

          <section v-if="taskDetailsOpen[item.rowId]" class="task-details-panel" :id="`task-details-${item.rowId}`" :aria-label="t('download_list.details.title')">
            <div class="task-details-nav">
              <button v-if="!item.capture && getTaskActions(item).canStartDownload" type="button" data-detail-view="options" :aria-pressed="taskDetailViews[item.rowId] === 'options'" @click="taskDetailViews[item.rowId] = 'options'">{{ t('download_list.details.options') }}</button>
              <button type="button" data-detail-view="diagnostics" :aria-pressed="taskDetailViews[item.rowId] === 'diagnostics'" @click="taskDetailViews[item.rowId] = 'diagnostics'">{{ t('download_list.details.diagnostics') }}</button>
            </div>
            <div v-if="taskDetailViews[item.rowId] === 'options' && !item.capture && getTaskActions(item).canStartDownload">
              <section v-if="!item.capture && getTaskActions(item).canStartDownload" class="task-options">
                <h4>{{ t('download_list.task_options.title') }}</h4>
                <div class="task-options-fields">
                  <label v-if="availableFormatsFor(item).length">{{ t('download_list.task_options.source_format') }}
                    <select v-model="optionsFor(item.rowId).formatId">
                      <option value="">{{ t('download_list.task_options.automatic') }}</option>
                      <option v-for="format in availableFormatsFor(item)" :key="format.formatId" :value="format.formatId">{{ formatDescription(format) }}</option>
                    </select>
                  </label>
                  <label>{{ t('download_list.task_options.start') }}<input v-model="optionsFor(item.rowId).start" type="text" inputmode="decimal" placeholder="0:00" /></label>
                  <label>{{ t('download_list.task_options.end') }}<input v-model="optionsFor(item.rowId).end" type="text" inputmode="decimal" :placeholder="t('download_list.task_options.full_end')" /></label>
                </div>
                <p>{{ t('download_list.task_options.hint') }}</p>
                <p v-if="getCredentialSourceKey(item.credential)" class="task-credential-summary" data-detail-credential-source>{{ t('download_list.credential_source.label') }}: {{ t(getCredentialSourceKey(item.credential)!) }}</p>
                <p v-if="getCredentialReasonKey(item.credential)" class="task-credential-reason" data-detail-credential-reason>{{ t('download_list.credential_reason.label') }}: {{ getCredentialReasonText(item.credential) }}</p>
              </section>

            </div>
            <div v-else>                <dl class="attempt-diagnostics">
                  <template v-if="getCredentialSourceKey(item.credential)"><dt>{{ t('download_list.credential_source.label') }}</dt><dd data-detail-credential-source>{{ t(getCredentialSourceKey(item.credential)!) }}</dd></template>
                  <template v-if="getCredentialReasonKey(item.credential)"><dt>{{ t('download_list.credential_reason.label') }}</dt><dd data-detail-credential-reason>{{ getCredentialReasonText(item.credential) }}</dd></template>
                  <template v-for="(value, key) in getAttemptDiagnostics(item)" :key="key"><dt>{{ t(`download_list.diagnostics.${key}`) }}</dt><dd>{{ key === 'phase' ? getStatusText(item) : value === 'unknown' || value === null ? t('download_list.diagnostics.unknown') : key === 'authMode' ? t(`download_list.details.${value}`) : value }}</dd></template>
                </dl></div>
          </section>

          <!-- Logs region -->
          <Transition name="logs-panel">
            <div
              v-if="isLogsExpanded(item.rowId)"
              class="logs-panel"
              :id="`task-logs-${item.rowId}`"
              role="region"
              :aria-label="t('download_list.logs.title')"
            >
              <div class="logs-header">
                <span class="logs-title">{{ t('download_list.logs.details') }}</span>
                <div class="logs-header-actions">
                  <button
                    class="neo-button copy-logs-btn"
                    type="button"
                    :aria-label="copiedRowIds[item.rowId] ? t('download_list.logs.copied') : t('download_list.logs.copy')"
                    :title="copiedRowIds[item.rowId] ? t('download_list.logs.copied_clipboard') : t('download_list.logs.copy')"
                    @click="copyTaskLogs(item)"
                  >
                    <span v-if="copiedRowIds[item.rowId]"><NeoIcon name="check" :size="13" /> {{ t('download_list.logs.copied') }}</span>
                    <span v-else><NeoIcon name="copy" :size="13" /> {{ t('download_list.logs.copy') }}</span>
                  </button>
                  <button
                    v-if="item.debugCommand"
                    class="text-btn small"
                    type="button"
                    :aria-expanded="isCommandExpanded(item.rowId)"
                    @click="toggleCommand(item.rowId)"
                  >
                    {{ isCommandExpanded(item.rowId) ? t('download_list.actions.hide_cmd') : t('download_list.actions.show_cmd') }}
                  </button>
                  <button
                    class="neo-button small collapse-logs-btn"
                    type="button"
                    :aria-expanded="true"
                    :aria-label="t('download_list.actions.hide_log')"
                    :title="t('download_list.actions.hide_log')"
                    @click="toggleLogs(item.rowId)"
                  >
                    <NeoIcon name="chevron-up" :size="14" />
                    <span>{{ t('download_list.actions.hide_log') }}</span>
                  </button>
                </div>
              </div>

              <div v-if="item.metadata?.filename" class="filename-row" :title="item.metadata.filename">
                <NeoIcon name="file" :size="13" class="filename-icon" />
                <span class="filename-text">{{ item.metadata.filename }}</span>
              </div>
              <div v-if="isCommandExpanded(item.rowId) && item.debugCommand" class="cmd-box" role="region" :aria-label="t('download_list.logs.command')">
                <code>{{ redactSensitiveText(item.debugCommand) }}</code>
              </div>

              <div class="logs-container custom-scrollbar" role="log" aria-live="polite" :aria-label="t('download_list.logs.title')">

                <div class="redact-tip">{{ t('download_list.logs.redacted') }}</div>
                <div v-for="(log, idx) in item.logs || []" :key="idx" class="log-line" v-html="formatLogLine(redactSensitiveText(log))" />
                <div v-if="!item.logs || item.logs.length === 0" class="log-empty" role="status">
                  {{ t('download_list.logs.empty') }}
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </TransitionGroup>
    </section>

    <!-- Undo Toast Notification -->
    <Transition name="undo-toast">
      <aside
        v-if="pendingRemoval"
        class="undo-toast neo-box"
        role="status"
        aria-live="polite"
        :aria-label="t('download_list.undo.removed_title')"
      >
        <div class="undo-toast-content">
          <NeoIcon name="cross" :size="16" class="undo-icon" />
          <span class="undo-text">
            {{ t('download_list.undo.removed_prefix') }}
            <strong class="undo-title" :title="pendingRemoval.task.metadata?.title || pendingRemoval.task.title || pendingRemoval.task.url">
              {{ pendingRemoval.task.metadata?.title || pendingRemoval.task.title || pendingRemoval.task.url }}
            </strong>
          </span>
        </div>
        <div class="undo-toast-actions">
          <button class="neo-button undo-btn" type="button" @click="undoRemoval">
            <NeoIcon name="refresh" :size="14" />
            <span>{{ t('download_list.undo.undo_action') }} ({{ pendingRemoval.secondsLeft }}s)</span>
          </button>
          <button
            class="neo-button icon-only micro ghost undo-dismiss-btn"
            type="button"
            :aria-label="t('download_list.undo.dismiss')"
            :title="t('download_list.undo.dismiss')"
            @click="commitPendingRemoval"
          >
            <NeoIcon name="cross" :size="12" />
          </button>
        </div>
      </aside>
    </Transition>
  </div>
</template>

<style scoped>
.task-details-panel { padding: 16px 20px; border-top: 1px solid var(--color-border); background: var(--color-surface-subtle); }
.task-details-nav { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.task-details-nav button { min-height: 44px; padding: 8px 14px; font: inherit; font-size: 0.85rem; color: var(--color-text-muted); border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; cursor: pointer; }
.task-details-nav button[aria-pressed="true"] { color: var(--brand-foreground); background: var(--color-surface); border-color: var(--color-border-strong); font-weight: 650; }
.task-details-nav button:focus-visible { outline: 2px solid var(--brand-focus); outline-offset: 2px; }
.task-details-panel .task-options { margin-top: 0; }
.task-details-panel .attempt-diagnostics { margin: 0; color: var(--color-text); }
.task-details-panel .attempt-diagnostics dt { color: var(--color-text-muted); }

.task-options { margin-top: 12px; font-size: 0.85rem; }
.task-options h4 { margin: 0 0 12px; font-size: 0.9rem; font-weight: 650; }
.task-options-fields { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; }
.task-options-fields label { display: flex; flex-direction: column; gap: 6px; flex: 1 1 140px; min-width: 0; }
.task-options-fields input, .task-options-fields select { font: inherit; color: inherit; background: var(--color-surface); border: 1px solid var(--color-border-strong); border-radius: 8px; padding: 8px; min-height: 44px; min-width: 0; width: 100%; }
.task-options-fields input:focus-visible, .task-options-fields select:focus-visible { outline: 2px solid var(--brand-focus); outline-offset: 2px; }
.attempt-diagnostics { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; font-size: 0.8rem; }
.attempt-diagnostics dd { margin: 0; overflow-wrap: anywhere; }
.subtitle-warning { margin-top: 8px; color: var(--semantic-warning-text); }
.quality-observation {
  padding: 4px 0;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}
.quality-observation > span { display: block; }
.quality-capabilities summary { cursor: pointer; padding: 6px 0; }
.download-list-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding-bottom: var(--spacing-xl);
  container-type: inline-size;
  container-name: download-list;
}

.queue-toolbar {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: 4px 0;
  border: 0;
  box-shadow: none;
}

.toolbar-search-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.download-all-button {
  min-height: 44px;
  white-space: nowrap;
}

.search-input-shell {
  position: relative;
  flex: 1 1 220px;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 10px;
  color: var(--color-text-muted);
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 44px;
  padding: 6px 50px 6px 32px;
  font-size: 0.88rem;
  border: var(--border-width) solid var(--color-border);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
}

.queue-toolbar .search-input {
  border-width: 1px;
  box-shadow: none;
}

.search-input:focus {
  border-color: var(--color-primary);
  background-color: color-mix(in srgb, var(--color-primary), transparent 97%);
}

.search-clear-btn {
  position: absolute;
  right: 0;
  top: 50%;
  width: 44px;
  height: 44px;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color 150ms ease, background-color 150ms ease;
}

.search-clear-btn:hover {
  color: var(--color-error);
  background: var(--color-bg-hover);
}

.status-filter-pills {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 44px;
  padding: 4px 10px;
  font-size: 0.8rem;
  font-weight: 700;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}

.filter-pill:hover {
  background: var(--color-surface);
  color: var(--color-text);
  border-color: var(--color-text-muted);
}

.filter-pill.active {
  border-color: var(--color-text);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: 2px 2px 0 var(--color-border);
}

.filter-pill .pill-count {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  padding: 0 4px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-text), transparent 90%);
}

.filter-pill.active .pill-count {
  background: color-mix(in srgb, var(--color-primary), transparent 85%);
  color: var(--color-primary);
}

.filter-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-xl);
  text-align: center;
  color: var(--color-text-muted);
}

.empty-title {
  font-weight: 700;
  font-size: 1rem;
  color: var(--color-text);
}

.empty-query {
  font-family: var(--font-mono);
  color: var(--color-primary);
  margin-left: 4px;
}

.download-card.is-card-focused {
  outline: 1px solid var(--color-primary);
  outline-offset: 2px;
}

/* Unified Queue List Shell */
.unified-queue-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0;
  background: transparent;
}

.queue-empty-state {
  padding: var(--spacing-xl);
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  text-align: center;
}

.queue-rows {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.section-action-button {
  min-height: 44px;
}

.download-card {
  position: relative;
  overflow: visible;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  padding: 0;
  background: color-mix(in srgb, var(--color-secondary) 6%, var(--color-surface));
}

.download-card.task-audio {
  background: color-mix(in srgb, var(--color-accent) 6%, var(--color-surface));
}

.download-card:focus-within { z-index: 5; }

.download-card.downloading {
  border-color: var(--color-primary);
}

.download-card.completed {
  border-color: var(--color-success);
}

.download-card.error {
  border-color: var(--color-error);
}

.download-card.analyzing {
  border-color: var(--color-border);
}

.download-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-hard);
}

.card-main {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-md);
  padding: 12px var(--spacing-md);
  border: 0;
  box-shadow: none;
  background: transparent;
}

.audio-artwork {
  flex-direction: column;
  gap: 4px;
  color: var(--color-text);
}
.audio-format-label { font-size: 0.85rem; font-weight: 800; }

.status-icon-wrapper {
  width: 120px;
  height: 68px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-bg);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 1.5rem;
  flex-shrink: 0;
}

.thumbnail-wrapper {
  width: 120px;
  height: 68px;
  aspect-ratio: 16 / 9;
  border-radius: 4px;
  overflow: hidden;
  border: 2px solid var(--color-border);
  flex-shrink: 0;
  background-color: var(--color-bg);
}

.thumbnail {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s ease;
}

.thumbnail-wrapper:hover .thumbnail {
  transform: scale(1.08);
}

.info-section {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.title-wrapper {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  width: 100%;
  min-width: 0;
}

.task-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 0.75rem;
  font-weight: 800;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text);
  white-space: nowrap;
  flex-shrink: 0;
}

.task-status-badge.downloading {
  background: color-mix(in srgb, var(--color-primary), transparent 85%);
  color: var(--color-text);
  border-color: var(--color-primary);
}

.task-status-badge.completed {
  background: color-mix(in srgb, var(--color-success), transparent 85%);
  color: var(--color-text);
  border-color: var(--color-success);
}

.task-status-badge.error {
  background: color-mix(in srgb, var(--color-error), transparent 85%);
  color: var(--color-text);
  border-color: var(--color-error);
}

.task-status-badge.analyzed {
  background: color-mix(in srgb, var(--color-secondary), transparent 75%);
  color: var(--color-text);
  border-color: var(--color-border);
}

.title {
  flex: 1;
  min-width: 0;
  font-weight: 800;
  font-size: 1rem;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  color: var(--color-text);
}

.filename-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  margin-top: -4px;
  width: 100%;
}

.filename-icon {
  flex-shrink: 0;
  opacity: 0.7;
  font-size: 0.9em;
}

.filename-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
}

.speed-badge {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  background-color: var(--color-bg-alt);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  color: var(--color-primary);
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 700;
}

.metadata-row {
  display: flex;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
  align-items: center;
  color: var(--color-text-muted);
}

.metadata-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  background-color: var(--color-bg);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, color 0.2s ease;
  box-shadow: none;
}

.primary-metadata-row {
  gap: 4px 6px;
  flex-wrap: wrap;
  overflow: hidden;
}

.primary-metadata-row .metadata-chip {
  min-width: 0;
  max-width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-secondary) 12%, var(--color-surface));
  box-shadow: none;
  color: var(--color-text);
  font-size: 0.8rem;
  font-weight: 650;
  transition: none;
}

.primary-metadata-row .metadata-chip:hover {
  transform: none;
  box-shadow: none;
  border-color: var(--color-border);
  color: var(--color-text);
}

.primary-metadata-row .metadata-chip.audio-mode {
  background: color-mix(in srgb, var(--color-accent) 14%, var(--color-surface));
  border-color: var(--color-border);
  font-weight: 750;
}
.primary-metadata-row .metadata-chip.resolution { font-weight: 750; }
.primary-metadata-row .metadata-chip.filesize { background: transparent; font-weight: 400; }

.brick-icon {
  flex-shrink: 0;
  opacity: 0.8;
}

.brick-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress-track {
  width: 100%;
  height: 8px;
  background-color: var(--color-bg);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.progress-fill {
  width: 100%;
  height: 100%;
  transform-origin: left center;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform;
}

.progress-fill.progress-liquid {
  background-image: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.12) 25%,
    transparent 25%,
    transparent 50%,
    rgba(255, 255, 255, 0.12) 50%,
    rgba(255, 255, 255, 0.12) 75%,
    transparent 75%,
    transparent
  );
  background-size: 24px 24px;
  animation: progress-stripes 1.2s linear infinite;
}

.progress-fill.progress-glow-complete {
  animation: progress-complete-glow 1.8s ease-out 1;
}

@keyframes progress-stripes {
  0% {
    background-position: 0 0;
  }
  100% {
    background-position: 24px 0;
  }
}

@keyframes progress-complete-glow {
  0% {
    filter: brightness(1.6) drop-shadow(0 0 6px var(--color-success));
  }
  50% {
    filter: brightness(1.2) drop-shadow(0 0 3px var(--color-success));
  }
  100% {
    filter: brightness(1) drop-shadow(none);
  }
}

.meta-row {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-sm);
  font-size: 0.85rem;
  font-weight: 600;
}

.percentage {
  font-family: var(--font-mono);
  color: var(--color-text-muted);
}

.status-container {
  display: flex;
  align-items: center;
  gap: 6px;
}

.neo-button.micro {
  min-width: 44px;
  min-height: 44px;
  font-size: 0.9rem;
  padding: 6px;
  line-height: 1;
}

.error-banner {
  margin-top: 4px;
  padding: 10px 12px;
  background-color: color-mix(in srgb, var(--color-error), transparent 90%);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-sm);
  color: var(--color-error);
  font-size: 0.85rem;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.error-icon {
  flex-shrink: 0;
  font-size: 1.1rem;
  margin-top: 1px;
}

.error-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.error-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.error-title {
  font-weight: 700;
  line-height: 1.3;
}

.error-hint {
  font-size: 0.8rem;
  line-height: 1.4;
}

.capture-origin-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  border: var(--border-width) solid var(--color-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary), transparent 82%);
  color: var(--color-text);
  white-space: nowrap;
}

.failure-kind-chip {
  display: inline-flex;
  background: var(--color-error);
  color: var(--color-on-error);
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid currentColor;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  white-space: nowrap;
  flex-shrink: 0;
  word-break: keep-all;
}

.actions-section {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  margin-left: var(--spacing-sm);
  align-items: center;
  justify-content: flex-end;
  max-width: 100%;
}
.logs-toggle-btn {
  gap: 6px;
  color: var(--color-text-muted);
  font-weight: 700;
  box-shadow: none;
}

.neo-button.logs-toggle-btn:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
  border-color: var(--color-primary);
  color: var(--color-text);
  box-shadow: none;
}

.action-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.primary-task-action {
  min-height: 44px;
  padding: 0 12px;
  gap: 7px;
  white-space: nowrap;
  font-weight: 800;
}

.row-overflow-wrap {
  position: relative;
  flex-shrink: 0;
}

.row-overflow-trigger {
  width: 44px;
  height: 44px;
  min-width: 44px;
  padding: 0;
  font-size: 1rem;
  font-weight: 900;
  letter-spacing: 1px;
}

.row-overflow-trigger:hover {
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
  border-color: var(--color-primary);
}

.row-overflow-menu {
  position: fixed;
  z-index: 40;
  display: grid;
  gap: 2px;
  width: 210px;
  padding: 6px;
  background: var(--color-surface);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-hard);
}

.row-overflow-menu-item {
  width: 100%;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-weight: 650;
  text-align: left;
  cursor: pointer;
}

.row-overflow-menu-item:hover,
.row-overflow-menu-item:focus-visible {
  background: var(--color-bg-hover);
  border-color: var(--color-border);
  outline: none;
}

.row-overflow-menu-item.danger {
  color: var(--color-error);
}

.format-picker { position: relative; }
.format-trigger {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  list-style: none;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  transition: transform 140ms ease, background-color 150ms ease, border-color 150ms ease;
}

.format-trigger:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
  border-color: var(--color-primary);
}
.format-chevron { transform: rotate(180deg); }
.format-trigger[aria-expanded="true"] .format-chevron { transform: none; }
.format-trigger[aria-expanded="true"] { border-color: var(--color-primary); }
.format-menu {
  position: fixed;
  z-index: 80;
  width: 248px;
  max-width: calc(100vw - 48px);
  max-height: 60vh;
  overflow-y: auto;
  padding: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-hard-sm);
}
.format-group + .format-group { border-top: 1px solid var(--color-border); margin-top: 4px; padding-top: 4px; }
.format-group-heading { display: grid; gap: 2px; padding: 6px 8px; }
.format-group-heading strong { font-size: 0.85rem; }
.format-group-heading span { font-size: 0.75rem; color: var(--color-text-muted); }
.format-option {
  display: grid;
  grid-template-columns: 18px 1fr 18px;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
}
.format-option[aria-checked="true"] {
  background: color-mix(in srgb, var(--color-primary) 16%, var(--color-surface));
  border-color: var(--color-primary);
  font-weight: 800;
}
.format-option:hover { background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface)); }
.format-trigger:focus-visible, .format-option:focus-visible { outline: 2px solid var(--color-text); outline-offset: 1px; }

.neo-button {
  cursor: pointer;
  border: 2px solid var(--color-border);
  transition: transform 0.1s ease, background-color 0.1s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
}

.neo-button:hover {
  transform: translateY(-1px);
}

.neo-button:active {
  transform: translateY(1px);
  box-shadow: none;
}

.neo-button:not(.primary):not(.danger):not(.success):not(.copy-logs-btn):not(.collapse-logs-btn):not(.logs-toggle-btn) {
  background-color: var(--color-bg-alt);
}

.neo-button:not(.primary):not(.danger):not(.success):not(.copy-logs-btn):not(.collapse-logs-btn):not(.logs-toggle-btn):hover {
  background-color: var(--color-surface);
}

.neo-button.small {
  min-height: 44px;
  padding: 6px 10px;
  font-size: 0.9rem;
}

.neo-button.icon-only.small {
  width: 44px;
  min-width: 44px;
  padding: 0;
}

.neo-button.danger {
  color: var(--color-error);
  border-color: var(--color-error);
}

.neo-button.success {
  color: var(--color-success);
  border-color: var(--color-success);
}

.neo-button.ghost,
.neo-button:not(.primary):not(.danger):not(.success).ghost {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

.neo-button.ghost:hover,
.neo-button:not(.primary):not(.danger):not(.success).ghost:hover {
  background-color: var(--color-bg);
  border-color: var(--color-border);
}

.neo-button.ghost.active,
.neo-button:not(.primary):not(.danger):not(.success).ghost.active {
  background-color: var(--color-text);
  color: var(--color-bg);
}

.logs-panel {
  /* Catppuccin Mocha: a stable diagnostic surface across all app themes. */
  --ctp-base: #1e1e2e;
  --ctp-mantle: #181825;
  --ctp-surface-0: #313244;
  --ctp-surface-1: #45475a;
  --ctp-overlay-0: #6c7086;
  --ctp-subtext-0: #a6adc8;
  --ctp-text: #cdd6f4;
  --ctp-mauve: #cba6f7;
  --ctp-red: #f38ba8;
  --ctp-peach: #fab387;
  --ctp-yellow: #f9e2af;
  --ctp-green: #a6e3a1;
  --ctp-teal: #94e2d5;
  --ctp-sapphire: #74c7ec;
  --ctp-blue: #89b4fa;

  color-scheme: dark;
  border-top: 2px solid var(--ctp-surface-1);
  background-color: var(--ctp-base);
  color: var(--ctp-text);
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: 0.85rem;
}

.logs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-xs);
  flex-wrap: wrap;
}

.logs-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.logs-panel .filename-row { color: var(--ctp-subtext-0); margin: 4px 0 8px; }

.logs-title {
  font-weight: 700;
  color: var(--ctp-subtext-0);
  white-space: nowrap;
  flex-shrink: 0;
}

.logs-panel .copy-logs-btn,
.logs-panel .text-btn.small,
.logs-panel .collapse-logs-btn {
  min-height: 44px;
  border-color: var(--ctp-surface-1);
  background-color: var(--ctp-surface-0);
  color: var(--ctp-text);
  opacity: 1;
  font-weight: 700;
  box-shadow: none;
  white-space: nowrap;
  flex-shrink: 0;
}

.logs-panel .copy-logs-btn:hover,
.logs-panel .text-btn.small:hover,
.logs-panel .collapse-logs-btn:hover {
  border-color: var(--ctp-overlay-0);
  background: var(--ctp-surface-1);
  color: var(--ctp-text);
}

.logs-panel .copy-logs-btn:focus-visible,
.logs-panel .text-btn.small:focus-visible,
.logs-panel .collapse-logs-btn:focus-visible {
  outline: 2px solid var(--ctp-blue);
  outline-offset: 2px;
}

.cmd-box {
  background-color: var(--ctp-mantle);
  padding: 8px;
  border: 1px solid var(--ctp-surface-1);
  border-radius: 4px;
  margin-bottom: 8px;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--ctp-mauve);
}

.logs-container {
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--ctp-surface-0);
  border-radius: 6px;
  background: var(--ctp-mantle);
  scroll-behavior: smooth;
}

.log-line {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--ctp-text);
  word-break: break-all;
}

.log-empty {
  color: var(--ctp-overlay-0);
}

.redact-tip {
  font-size: 0.75rem;
  color: var(--ctp-yellow);
  margin-bottom: 4px;
  font-style: italic;
}

.logs-panel .custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--ctp-surface-1);
}

.logs-panel .custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--ctp-overlay-0);
}

.logs-panel-enter-active,
.logs-panel-leave-active {
  overflow: hidden;
  transition:
    max-height 180ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 160ms ease,
    transform 160ms ease;
  max-height: 520px;
}

.logs-panel-enter-from,
.logs-panel-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-4px);
}

.queue-row-enter-active,
.queue-row-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.queue-row-enter-from,
.queue-row-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.dots-animation {
  display: inline-block;
  min-width: 1.2em;
  text-align: left;
  animation: dots 1.5s infinite;
}

@keyframes dots {
  0%,
  20% {
    content: '.';
  }

  40% {
    content: '..';
  }

  60%,
  100% {
    content: '...';
  }
}

.flash-animation {
  animation: flash 2s infinite;
}

@container download-list (max-width: 999px) {
  .card-main {
    gap: var(--spacing-sm);
    padding: var(--spacing-sm);
  }

  .thumbnail-wrapper,
  .status-icon-wrapper {
    width: 96px;
    height: 54px;
  }

  .title {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.95rem;
  }

  .primary-metadata-row {
    gap: 6px;
  }

  .primary-metadata-row .metadata-chip {
    font-size: 0.75rem;
  }

  .actions-section { flex: 0 1 220px; }
}

@container download-list (max-width: 719px) {
  .card-main {
    display: grid;
    grid-template-columns: 128px minmax(0, 1fr);
    align-items: start;
    gap: var(--spacing-sm);
  }

  .thumbnail-wrapper,
  .status-icon-wrapper {
    grid-column: 1;
    grid-row: 1;
    width: 128px;
    height: 72px;
  }

  .info-section {
    grid-column: 2;
    grid-row: 1;
  }

  .title {
    display: -webkit-box;
    white-space: normal;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .actions-section {
    grid-column: 1 / -1;
    grid-row: 2;
    width: 100%;
    margin-left: 0;
    justify-content: flex-start;
  }
}

@container download-list (max-width: 519px) {
  .card-main {
    grid-template-columns: minmax(0, 1fr);
  }

  .thumbnail-wrapper,
  .status-icon-wrapper {
    grid-column: 1;
    grid-row: 1;
    width: 100%;
    height: auto;
    min-height: 72px;
    aspect-ratio: 16 / 9;
  }

  .info-section {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .actions-section {
    grid-column: 1 / -1;
    grid-row: 3;
  }
  .audio-artwork { aspect-ratio: auto; min-height: 88px; }
  .title-wrapper { flex-wrap: wrap; }
  .title { flex-basis: calc(100% - 32px); }
}

@container download-list (max-width: 719px) {
  .toolbar-search-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
  }

  .search-input-shell {
    grid-column: 1 / -1;
  }

  .status-filter-pills {
    grid-column: 1;
    flex-wrap: nowrap;
    overflow-x: auto;
  }

}

@media (prefers-reduced-motion: reduce) {
  .progress-liquid,
  .progress-glow-complete,
  .dots-animation,
  .flash-animation {
    animation: none;
  }

  .queue-section-enter-active,
  .queue-section-leave-active,
  .queue-row-enter-active,
  .queue-row-leave-active,
  .logs-panel-enter-active,
  .logs-panel-leave-active,
  .undo-toast-enter-active,
  .undo-toast-leave-active,
  .progress-fill,
  .neo-button,
  .thumbnail,
  .metadata-chip,
  .download-card {
    transition: none;
  }
}

@keyframes flash {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.6;
  }
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: var(--radius-sm);
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-muted);
}

:deep(.log-string) {
  color: var(--ctp-peach);
}

:deep(.log-error) {
  color: var(--ctp-red);
  font-weight: 700;
}

:deep(.log-warning) {
  color: var(--ctp-yellow);
  font-weight: 700;
}

:deep(.log-tag) {
  color: var(--ctp-mauve);
  font-weight: 700;
}

:deep(.log-progress) {
  color: var(--ctp-green);
  font-weight: 700;
}

:deep(.log-number) {
  color: var(--ctp-sapphire);
}

:deep(.log-url) {
  color: var(--ctp-blue);
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
}

.queue-position-badge {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 800;
  padding: 1px 6px;
  background: var(--color-bg);
  border: 1.5px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text);
  line-height: 1.2;
  flex-shrink: 0;
}

.section-action-button.confirm-danger {
  background-color: var(--color-error);
  color: var(--color-on-error);
  border-color: var(--color-border);
}

.undo-toast {
  position: fixed;
  bottom: var(--spacing-lg, 24px);
  right: var(--spacing-lg, 24px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md, 12px);
  max-width: 480px;
  min-width: 320px;
  padding: 10px 14px;
  background: var(--color-surface);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-sm, 4px);
  box-shadow: 4px 4px 0 var(--color-border);
  font-size: 0.85rem;
}

.undo-toast-content {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.undo-icon {
  color: var(--color-error);
  flex-shrink: 0;
}

.undo-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text);
}

.undo-title {
  font-weight: 700;
}

.undo-toast-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.undo-btn {
  height: 44px;
  padding: 0 10px;
  font-size: 0.8rem;
  font-weight: 700;
  background: var(--color-warning);
  color: var(--color-on-warning);
  border: 1.5px solid var(--color-border);
  box-shadow: 2px 2px 0 var(--color-border);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.undo-btn:hover {
  transform: translate(-1px, -1px);
  box-shadow: 3px 3px 0 var(--color-border);
}

.undo-btn:active {
  transform: translate(1px, 1px);
  box-shadow: 1px 1px 0 var(--color-border);
}

.undo-dismiss-btn {
  min-width: 44px !important;
  min-height: 44px !important;
  width: 44px;
  height: 44px;
  padding: 0;
}

.undo-toast-enter-active,
.undo-toast-leave-active {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
}

.undo-toast-enter-from,
.undo-toast-leave-to {
  opacity: 0;
  transform: translateY(16px) scale(0.96);
}
</style>
