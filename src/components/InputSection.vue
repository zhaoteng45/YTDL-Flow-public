<script setup lang="ts">
import { ref, computed, unref, useId } from 'vue';
import { useI18n } from 'vue-i18n';

import { useAppStore } from '../stores/appStore';
import { parseUrlInput } from '../application/urlInput';
import type { PlatformConnectionEntry, CredentialPlatform } from '../application/platformCredentials';
import NeoIcon from './NeoIcon.vue';

const store = useAppStore();
const downloadDir = computed<string | null>(() => unref(store.downloadDir));
const systemDownloadDir = computed<string | null>(() => unref(store.systemDownloadDir));
const { t } = useI18n();
const inputContent = ref('');
const urlInputId = useId();
const errorMessageId = `${urlInputId}-error`;
const errorTitle = ref('');
const errorHint = ref('');
const noticeMessage = ref('');
const isDragging = ref(false);

// Computed property for error message (combines title + hint)
const error = computed({
  get: () => errorTitle.value ? { title: errorTitle.value, hint: errorHint.value } : null,
  set: (val: string | { title: string, hint: string } | null) => {
    noticeMessage.value = '';
    if (!val) {
      errorTitle.value = '';
      errorHint.value = '';
    } else if (typeof val === 'string') {
      // Parse "Title - Hint" format
      const parts = val.split(' - ');
      errorTitle.value = parts[0] || '';
      errorHint.value = parts[1] || '';
    } else {
      errorTitle.value = val.title;
      errorHint.value = val.hint;
    }
  }
});

const emit = defineEmits<{
    (e: 'analyze', urls: string[]): void;
    (e: 'connect', entry: PlatformConnectionEntry): void;
}>();

const platformSourceLabel = (platform: CredentialPlatform) => {
  const source = store.getEffectivePlatformSource(platform);
  if (source.kind === 'none' || source.kind === 'unspecified') return t('input.platform_connection.optional');
  if (source.kind === 'browser') return t('input.cookie_browser', { value: source.ref });
  return source.ref?.split(/[/\\]/).pop() || t('input.cookie_file_label');
};
const disconnectPlatform = (platform: CredentialPlatform) => {
  store.clearPlatformCookie(platform);
  if (platform === 'bilibili') store.clearBilibiliUserProfile();
};

/**
 * Multi-URL is an input convenience, not a batch domain object.
 * Paste, direct typing, clipboard append and text drop all converge on one
 * parser; every emitted URL becomes an independent normal task.
 */

const downloadDirName = computed(() => {
  if (!downloadDir.value) return t('input.save_location_default');
  // Get last folder name but keep it readable
  const parts = downloadDir.value.split(/[/\\]/);
  const name = parts.pop() || parts.pop(); // Handle trailing slash
  return name || t('input.save_location');
});

const parsedInput = computed(() => parseUrlInput(inputContent.value));
const parsedLinks = computed(() => parsedInput.value.urls);
const removeLink = (linkToRemove: string) => {
  inputContent.value = inputContent.value
    .split(/\s+/)
    .map(entry => entry.trim())
    .filter(entry => entry && entry !== linkToRemove)
    .join('\n');
};

const clearInput = () => {
  inputContent.value = '';
  errorTitle.value = '';
  errorHint.value = '';
  noticeMessage.value = '';
};

const handleAnalyze = () => {
  errorTitle.value = '';
  errorHint.value = '';
  noticeMessage.value = '';

  if (!inputContent.value.trim()) {
    errorTitle.value = t('input.error_no_link');
    errorHint.value = t('input.error_no_link_hint');
    return;
  }

  if (parsedInput.value.urls.length === 0) {
    errorTitle.value = t('input.error_invalid');
    errorHint.value = t('input.error_invalid_hint');
    return;
  }

  emit('analyze', parsedInput.value.urls);

  if (parsedInput.value.invalidEntries.length > 0) {
    noticeMessage.value = t('input.warning_invalid_ignored', {
      count: parsedInput.value.invalidEntries.length,
    });
  }
};

const formatLinks = (text: string): string => {
  // Split by whitespace (space, tab, newline) and filter empty
  // This ensures "link1 link2" becomes "link1\nlink2"
  const links = text.split(/\s+/).filter(part => part.trim().length > 0);
  if (links.length === 0) return '';
  // Join with newline and add a trailing newline for the next input
  return links.join('\n') + '\n';
};

const insertFormattedText = (formatted: string, mode: 'cursor' | 'append', textarea?: HTMLTextAreaElement) => {
  if (!formatted) return;

  errorTitle.value = '';
  errorHint.value = '';
  noticeMessage.value = '';

  if (mode === 'append') {
    inputContent.value = inputContent.value
      ? inputContent.value.trimEnd() + '\n' + formatted
      : formatted;
    return;
  }

  if (!textarea) {
    inputContent.value = inputContent.value
      ? inputContent.value.trimEnd() + '\n' + formatted
      : formatted;
    return;
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const oldVal = inputContent.value;

  inputContent.value = oldVal.substring(0, start) + formatted + oldVal.substring(end);

  setTimeout(() => {
    textarea.selectionStart = textarea.selectionEnd = start + formatted.length;
  }, 0);
};

const onPaste = (e: ClipboardEvent) => {
  // Intercept native paste
  e.preventDefault();
  const text = e.clipboardData?.getData('text/plain') || '';
  if (!text) return;

  const formatted = formatLinks(text);
  const textarea = e.target as HTMLTextAreaElement;
  insertFormattedText(formatted, 'cursor', textarea);
};

const onDragEnter = (e: DragEvent) => {
  e.preventDefault();
  isDragging.value = true;
};

const onDragLeave = (e: DragEvent) => {
  e.preventDefault();
  const rect = (e.currentTarget as HTMLElement)?.getBoundingClientRect();
  if (
    !rect ||
    e.clientX <= rect.left ||
    e.clientX >= rect.right ||
    e.clientY <= rect.top ||
    e.clientY >= rect.bottom
  ) {
    isDragging.value = false;
  }
};

const onDrop = (e: DragEvent) => {
  // Prevent default browser drop behavior (which handles text insertion)
  e.preventDefault();
  isDragging.value = false;

  const text = e.dataTransfer?.getData('text/plain') || '';
  if (!text) return;
  const formatted = formatLinks(text);
  insertFormattedText(formatted, 'append');
};

const handlePaste = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      const formatted = formatLinks(text);
      insertFormattedText(formatted, 'append');
    }
  } catch (err) {
    console.error('Failed to read clipboard', err);
    error.value = t('input.error_clipboard');
  }
};

const selectDirectory = async () => {
  try {
    await store.chooseDownloadDir(t('input.select_dir'));
  } catch (err) {
    console.error('Failed to select directory', err);
    error.value = {
      title: t('input.error_download_dir'),
      hint: t('input.error_download_dir_hint'),
    };
  }
};

const handleOpenDirectory = async () => {
  try {
    await store.openFolder(downloadDir.value || undefined);
  } catch (err) {
    console.error('Failed to open directory', err);
    error.value = {
      title: t('input.error_open_dir'),
      hint: t('input.error_open_dir_hint'),
    };
  }
};

defineExpose({
  handlePaste,
  selectDirectory
});
</script>

<template>
  <div class="input-section">
    <div class="input-wrapper">
      <label class="input-label" :for="urlInputId">{{ t('input.link_label') }}</label>
      <div class="input-field-shell">
        <textarea :id="urlInputId" v-model="inputContent" :placeholder="t('input.placeholder')" class="neo-input neo-textarea"
          :class="{ 'has-error': !!errorTitle, 'is-dragging': isDragging }" :aria-invalid="!!errorTitle" :aria-describedby="errorTitle ? errorMessageId : undefined" @keydown.enter.ctrl="handleAnalyze" @input="errorTitle = ''; errorHint = ''; noticeMessage = ''" @paste="onPaste"
          @drop="onDrop" @dragenter="onDragEnter" @dragleave="onDragLeave" @dragover.prevent="isDragging = true"></textarea>

        <div v-if="isDragging" class="drop-overlay-indicator" aria-hidden="true">
          <NeoIcon name="download" :size="28" stroke-width="2.5" />
          <span class="drop-overlay-text">{{ t('input.drop_hint') }}</span>
        </div>

        <div class="input-actions">
          <button v-if="inputContent" class="ui-ghost-button clear-btn" @click="clearInput"
            :aria-label="t('app.clear_all') || '清空'" :title="t('app.clear_all')">
            <NeoIcon name="cross" :size="15" stroke-width="2.5" />
          </button>
          <button class="ui-ghost-button paste-btn" @click="handlePaste"
            :aria-label="t('input.paste') || '粘贴'" :title="t('input.paste')">
            <NeoIcon name="paste" :size="16" />
          </button>
        </div>
      </div>
    </div>

    <!-- Link Preview Section -->
    <div v-if="parsedLinks.length > 0" class="link-preview">
      <div class="preview-header">
        <span class="preview-count">
          <NeoIcon name="link" :size="14" class="u-mr-xs" />
          {{ t('app.detected_links', { count: parsedLinks.length }) }}
        </span>
        <span class="preview-badge">{{ t('input.ready_to_analyze') }}</span>
      </div>
      <div class="link-chips custom-scrollbar">
        <div v-for="(link, idx) in parsedLinks" :key="idx" class="link-chip">
          <NeoIcon name="link" :size="12" class="chip-link-icon" />
          <span class="chip-text">{{ link }}</span>
          <button class="chip-remove" @click="removeLink(link)" :aria-label="t('input.remove_link')"
            :title="t('input.remove_link')">
            <NeoIcon name="cross" :size="12" stroke-width="2.5" />
          </button>
        </div>
      </div>
    </div>

    <button class="neo-button primary u-flex-center u-full-width analyze-btn-large btn-rebound"
      @click="handleAnalyze" :aria-label="t('input.analyze_btn') || '分析并添加'">
      <NeoIcon name="search" :size="18" stroke-width="2.5" class="svg-icon" />
      {{ t('input.analyze_btn') }}
    </button>

    <div class="controls-row">
      <div class="dir-control-group">
        <button class="input-utility-button u-flex-center action-btn dir-select-btn" @click="selectDirectory"
            :aria-label="downloadDir || t('input.default_dir')"
            :title="downloadDir || t('input.default_dir')">
          <NeoIcon name="folder" :size="18" class="svg-icon" />
          <div class="btn-content-col">
            <span class="text-primary">{{ downloadDirName }}</span>
            <span class="dir-path-text" v-if="downloadDir">{{ downloadDir }}</span>
            <span class="dir-path-text" v-else>{{ systemDownloadDir || t('input.default_download_dir') }}</span>
          </div>
        </button>
        <button class="input-utility-button icon-btn open-dir-btn" @click="handleOpenDirectory"
            :aria-label="t('input.open_dir') || '打开目录'" :title="t('input.open_dir')">
          <NeoIcon name="external" :size="16" class="svg-icon" />
        </button>
      </div>


    </div>

    <div class="platform-connections" :aria-label="t('input.platform_connection.title')">
      <div v-for="platform in (['youtube', 'bilibili'] as const)" :key="platform" class="platform-connection-row">
        <div class="platform-connection-summary cookie-path-preview" :data-cookie-path="store.getPlatformCredentialConfig(platform)?.preferred.ref" :tabindex="store.getPlatformCredentialConfig(platform)?.preferred.ref ? 0 : undefined" :title="store.getPlatformCredentialConfig(platform)?.preferred.ref">
          <strong>{{ platform === 'youtube' ? 'YouTube' : '哔哩哔哩' }}</strong>
          <span class="platform-source" :title="platformSourceLabel(platform)">{{ platformSourceLabel(platform) }}</span>
          <span v-if="store.getPlatformCredentialConfig(platform)?.preferred.ref" class="platform-source" :title="t('settings.auth.credentials_pending')">{{ t('settings.auth.credentials_pending') }}</span>
        </div>
        <div class="platform-connection-actions">
          <button class="neo-button small platform-login-button" :data-platform="platform"
            :data-connection-entry="platform === 'youtube' ? 'youtube-browser' : 'bilibili'"
            @click="emit('connect', platform === 'youtube' ? 'youtube-browser' : 'bilibili')">
            {{ platform === 'youtube' ? t('input.platform_connection.browser') : t('input.platform_connection.qr') }}
          </button>
          <button v-if="platform === 'youtube'" class="neo-button small" data-connection-entry="youtube-file"
            @click="emit('connect', 'youtube-file')">{{ t('input.platform_connection.file') }}</button>
          <button v-if="store.getPlatformCredentialConfig(platform)?.preferred.ref || store.getPlatformCredentialConfig(platform)?.backup?.path" class="input-utility-button icon-btn"
            :aria-label="t('input.platform_connection.disconnect', { platform: platform === 'youtube' ? 'YouTube' : '哔哩哔哩' })"
            @click="disconnectPlatform(platform)"><NeoIcon name="cross" :size="16" /></button>
        </div>
      </div>
    </div>

    <div v-if="errorTitle" :id="errorMessageId" class="error-msg" role="alert" aria-live="assertive">
      <div class="error-msg-title">{{ errorTitle }}</div>
      <div v-if="errorHint" class="error-msg-hint">{{ errorHint }}</div>
    </div>

    <div v-if="noticeMessage" class="notice-msg" role="status" aria-live="polite">
      {{ noticeMessage }}
    </div>
  </div>
</template>

<style scoped>
.input-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  width: 100%;
}

.input-wrapper {
  padding: var(--spacing-md);
  background: color-mix(in srgb, var(--color-primary) 4%, var(--color-surface));
  border: 1px solid var(--color-border);
  box-shadow: none;
  width: 100%;
}

.input-field-shell {
  position: relative;
  width: 100%;
}

.input-label {
  display: inline-flex;
  align-items: center;
  margin-bottom: var(--spacing-xs);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-text);
}

.neo-textarea {
  min-height: 112px;
  resize: vertical;
  padding: 14px 16px;
  padding-right: 16px;
  font-family: var(--font-mono);
  font-size: max(1rem, 16px);
  line-height: 1.6;
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface);
  transition: border-color 0.2s, box-shadow 0.2s;
  word-break: break-word;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.neo-textarea::placeholder {
  font-family: var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--color-text-muted);
  opacity: 0.75;
}

.neo-textarea:focus {
  border-color: var(--color-primary);
  background-color: color-mix(in srgb, var(--color-primary), transparent 97%);
}

.neo-textarea.is-dragging {
  border-color: var(--color-primary);
  background-color: color-mix(in srgb, var(--color-primary), transparent 94%);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary), transparent 50%);
}

.drop-overlay-indicator {
  position: absolute;
  inset: 6px;
  background: color-mix(in srgb, var(--color-surface), transparent 10%);
  backdrop-filter: blur(2px);
  border: 2px dashed var(--color-primary);
  border-radius: var(--radius-sm);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--color-primary);
  pointer-events: none;
  z-index: 10;
  animation: drop-pulse 1.2s infinite ease-in-out;
}

.drop-overlay-text {
  font-weight: 800;
  font-size: 0.95rem;
  letter-spacing: 0.5px;
}

@keyframes drop-pulse {
  0%, 100% { opacity: 0.92; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.008); }
}

.neo-input.has-error {
  border-color: var(--color-error);
  background-color: rgba(255, 107, 107, 0.05);
}

.input-actions {
  position: static;
  z-index: 2;
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
  align-items: center;
  gap: 6px;
}

.ui-ghost-button {
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-bg) 60%, var(--color-surface));
  color: var(--color-text);
  border: 1px solid color-mix(in srgb, var(--color-border) 25%, transparent);
  opacity: 0.85;
  border-radius: var(--radius-sm);
  transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease, opacity 140ms ease, transform 140ms ease, box-shadow 140ms ease;
  cursor: pointer;
}

.ui-ghost-button:hover {
  background: var(--color-surface);
  border-color: var(--color-border);
  opacity: 1;
  transform: translateY(-1px);
  box-shadow: 1px 1px 0 var(--color-shadow);
}

.ui-ghost-button:active {
  transform: translateY(1px);
  box-shadow: none;
}

.ui-ghost-button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
  opacity: 1;
}

.link-preview {
  padding: var(--spacing-sm);
  background: color-mix(in srgb, var(--color-primary) 5%, var(--color-surface));
  border: 1px solid var(--color-border);
  box-shadow: none;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-sm);
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.preview-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 700;
}

.preview-badge {
  font-size: 0.72rem;
  font-weight: 800;
  padding: 2px 6px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.link-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  max-height: 120px;
  overflow-y: auto;
}

.link-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  /* Chips can stay thin */
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  max-width: 100%;
}

.chip-link-icon {
  color: var(--color-primary);
  flex-shrink: 0;
}

.chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.chip-remove {
  border: none;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease, opacity 160ms ease, transform 160ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 160ms ease;
}

.chip-remove:hover {
  color: var(--color-error);
  background-color: var(--color-bg-hover);
}

.controls-row {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-xs);
}

.input-utility-button {
  appearance: none;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  color: var(--color-text);
  font: inherit;
  font-weight: 600;
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
}

.input-utility-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.cookie-control-group {
  display: none;
}

.action-btn {
  padding: var(--spacing-md);
  justify-content: flex-start;
  font-size: 1rem;
}

.icon {
  margin-right: 8px;
}

.text-ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}

.error-msg {
  color: var(--color-error);
  font-size: 0.9rem;
  padding: var(--spacing-md);
  background-color: var(--color-error-bg);
  border-radius: var(--radius-sm);
  border: var(--border-width) solid var(--color-error);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.notice-msg {
  color: var(--color-warning);
  font-size: 0.9rem;
  padding: var(--spacing-md);
  background-color: var(--color-warning-bg);
  border-radius: var(--radius-sm);
  border: var(--border-width) solid var(--color-warning-border);
}

.error-msg-title {
  font-weight: 700;
  margin-bottom: 2px;
}

.error-msg-hint {
  font-weight: 400;
  opacity: 0.9;
  font-size: 0.85rem;
}

.dir-control-group {
  display: flex;
  gap: var(--spacing-sm);
  width: 100%;
  align-items: stretch;
}

.dir-select-btn {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--color-primary) 4%, var(--color-surface));
  border: 1px solid var(--color-border);
  box-shadow: none;
  transition: transform 140ms ease, background-color 150ms ease, border-color 150ms ease;
}

.dir-select-btn:hover {
  transform: translateY(-1px);
  box-shadow: none;
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface));
}

.dir-select-btn:active {
  transform: translateY(1px);
  box-shadow: none;
  background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
}

.btn-content-col {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  overflow: hidden;
  flex: 1;
  min-width: 0;
  line-height: 1.2;
}

.text-primary {
  font-weight: 800;
  font-size: 1rem;
  width: 100%;
  color: var(--color-text);
  margin-bottom: 2px;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

.cookie-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 8px;
  min-width: 0;
  margin-bottom: 2px;
}

.cookie-title-row .text-primary,
.cookie-title-text {
  margin-bottom: 0;
  min-width: 0;
  width: auto;
  max-width: 100%;
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 800;
  font-size: 0.95rem;
  color: var(--color-text);
  text-align: left;
}

.pot-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  border: 1px solid currentColor;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
  white-space: nowrap;
  box-sizing: border-box;
}

.pot-status-badge.pot-ready {
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
  color: var(--color-success);
  border-color: var(--color-success);
}

.pot-status-badge.pot-idle {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border-color: var(--color-border);
}

.status-pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: currentColor;
  animation: pulse-dot 2s infinite ease-in-out;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.3; transform: scale(0.75); }
}

@media (prefers-reduced-motion: reduce) {
  .drop-overlay-indicator,
  .status-pulse-dot {
    animation: none;
  }
}

.dir-path-text {
  font-size: 0.8rem;
  color: var(--color-text);
  opacity: 0.75;
  font-weight: 500;
  width: 100%;
  text-align: left;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}



.svg-icon {
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}

.open-dir-btn,
.file-cookies-btn,
.clear-cookies-btn {
  flex-shrink: 0;
  min-width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  padding: 0;
  background: color-mix(in srgb, var(--color-primary) 4%, var(--color-surface));
  color: var(--color-text);
  border: 1px solid var(--color-border);
  box-shadow: none;
  transition: transform 140ms ease, background-color 150ms ease, border-color 150ms ease;
}

.open-dir-btn:hover,
.file-cookies-btn:hover,
.clear-cookies-btn:hover {
  transform: translateY(-1px);
  box-shadow: none;
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface));
}

.open-dir-btn:active,
.file-cookies-btn:active,
.clear-cookies-btn:active {
  transform: translateY(1px);
  box-shadow: none;
  background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
}

/* Removed advanced-section styles */
.analyze-btn-large {
  padding: 14px 20px;
  font-size: 1.2rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 1px;
  border: 3px solid var(--color-border);
  box-shadow: 6px 6px 0 var(--color-shadow);
  transition: transform 150ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 150ms ease, background-color 150ms ease;
  margin-top: 4px;
}

.analyze-btn-large:hover {
  transform: translate(-3px, -3px);
  box-shadow: 9px 9px 0 var(--color-shadow);
  background-color: var(--color-primary-hover);
}

.analyze-btn-large:active {
  transform: translate(2px, 2px);
  box-shadow: 2px 2px 0 var(--color-shadow);
}

.analyze-btn-large .icon {
  font-size: 1.4em;
  margin-right: 10px;
}
</style>
