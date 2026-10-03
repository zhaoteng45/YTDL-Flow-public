<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  CapturedResourceSummary,
  CaptureSessionStatus,
} from '../../packages/contracts/src';
import type { CaptureFacade } from '../v2-runtime/capture/captureFacade';
import {
  buildCaptureCandidateViewModels,
  captureClaimRejectionKey,
  captureFailureMessageKey,
} from './capturePanel.helpers';
import NeoIcon from './NeoIcon.vue';

const props = defineProps<{
  capture: CaptureFacade;
}>();

const { t } = useI18n();

const resources = ref<CapturedResourceSummary[]>([]);
const sessionStatus = ref<CaptureSessionStatus>({ active: false });
const busy = ref(false);
const notice = ref('');

const stopResources = props.capture.subscribeResources((next) => {
  resources.value = [...next];
});
const stopSession = props.capture.subscribeSession((status) => {
  sessionStatus.value = { ...status };
  if (!status.active && status.reason === 'browser-closed') {
    notice.value = t('capture.browser_closed');
  }
});

onUnmounted(() => {
  stopResources();
  stopSession();
});

const candidates = computed(() => buildCaptureCandidateViewModels(resources.value));
const isActive = computed(() => sessionStatus.value.active);

const runningLabel = computed(() =>
  isActive.value
    ? t('capture.running', {
        browser: sessionStatus.value.browserName ?? t('capture.browser_default'),
      })
    : t('capture.idle'),
);

const startCapture = async () => {
  if (busy.value) return;
  busy.value = true;
  notice.value = '';
  try {
    await props.capture.start();
  } catch (error) {
    notice.value = t('capture.start_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    busy.value = false;
  }
};

const stopCapture = async () => {
  if (busy.value) return;
  busy.value = true;
  notice.value = '';
  try {
    await props.capture.stop();
  } catch (error) {
    notice.value = t('capture.stop_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    busy.value = false;
  }
};

const importCandidate = async (resourceId: string) => {
  if (busy.value) return;
  busy.value = true;
  notice.value = '';
  try {
    const result = await props.capture.importResource(resourceId);
    if (result.type === 'rejected') {
      const key = captureClaimRejectionKey(result.outcome);
      if (key) notice.value = t(key);
      return;
    }
    if (result.type === 'import-failed') {
      notice.value = t('capture.import_failed', { error: result.error.message });
    }
  } catch (error) {
    notice.value = t('capture.import_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    busy.value = false;
  }
};

defineExpose({ captureFailureMessageKey });
</script>

<template>
  <div class="capture-panel">
    <div class="capture-status" role="status" aria-live="polite">
      <span class="status-dot" :class="{ active: isActive }" aria-hidden="true"></span>
      <span>{{ runningLabel }}</span>
    </div>

    <p class="capture-hint">{{ t('capture.isolation_hint') }}</p>

    <div class="capture-actions">
      <button
        type="button"
        class="neo-button primary small"
        :disabled="busy || isActive"
        @click="startCapture"
      >
        <NeoIcon name="search" :size="14" class="svg-icon" />
        <span>{{ t('capture.start') }}</span>
      </button>
      <button
        type="button"
        class="neo-button small"
        :disabled="busy || !isActive"
        @click="stopCapture"
      >
        <NeoIcon name="cross" :size="14" class="svg-icon" />
        <span>{{ t('capture.stop') }}</span>
      </button>
    </div>

    <p v-if="notice" class="capture-notice" role="alert">{{ notice }}</p>

    <ul v-if="candidates.length > 0" class="capture-list">
      <li v-for="candidate in candidates" :key="candidate.resourceId" class="capture-item">
        <div class="capture-item-head">
          <span class="capture-number">{{ candidate.number }}</span>
          <span class="capture-site">{{ candidate.siteLabel }}</span>
          <span class="capture-kind">{{ candidate.mediaLabel }}</span>
        </div>
        <div class="capture-item-meta">
          <span class="capture-mime">{{ candidate.mimeType }}</span>
          <span v-if="candidate.sizeLabel">{{ candidate.sizeLabel }}</span>
          <span v-if="candidate.detailLabel">{{ candidate.detailLabel }}</span>
        </div>
        <button
          type="button"
          class="neo-button small"
          :disabled="busy || candidate.requiresAuthenticatedReplay || !candidate.phase1Executable"
          @click="importCandidate(candidate.resourceId)"
        >
          <span>{{ t(candidate.actionLabelKey) }}</span>
        </button>
      </li>
    </ul>

    <p v-else-if="isActive" class="capture-empty">{{ t('capture.empty') }}</p>
  </div>
</template>

<style scoped>
.capture-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.capture-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--color-text-secondary, var(--color-text));
}

.status-dot {
  width: 10px;
  height: 10px;
  border: var(--border-width) solid var(--color-border);
  border-radius: 50%;
  background: var(--color-bg-alt);
  flex: none;
}

.status-dot.active {
  background: var(--color-primary);
}

.capture-hint {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--color-text-secondary, var(--color-text));
}

.capture-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs, 6px);
}

.capture-notice {
  margin: 0;
  padding: 6px 8px;
  font-size: 0.78rem;
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-sm, 4px);
  background: var(--color-bg-alt);
  color: var(--color-error, var(--color-text));
}

.capture-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs, 6px);
  max-height: 320px;
  overflow-y: auto;
}

.capture-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-sm, 4px);
  background: var(--color-surface);
}

.capture-item-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.capture-number {
  font-weight: 800;
  color: var(--color-primary);
}

.capture-site {
  font-weight: 600;
  word-break: break-all;
}

.capture-kind {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-sm, 4px);
}

.capture-item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 0.72rem;
  color: var(--color-text-secondary, var(--color-text));
}

.capture-mime {
  word-break: break-all;
}

.capture-empty {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-text-secondary, var(--color-text));
}
</style>
