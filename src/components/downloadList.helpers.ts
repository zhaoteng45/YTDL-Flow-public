import type { CurrentFailureKind, CurrentTaskActions } from '../../packages/contracts/src';
import type { TaskPresentationRow, TaskPresentationStatus } from '../application/taskPresentation';
import type { DownloadFormat } from '../types';
import { captureFailureMessageKey } from './capturePanel.helpers';

export { isAudioFormat } from '../application/taskPresentation';

export type TaskActions = CurrentTaskActions;

export const classifyTaskFailure = (
  task: TaskPresentationRow,
): CurrentFailureKind | undefined => task.failureKind;

export const getTaskActions = (task: TaskPresentationRow): CurrentTaskActions => task.actions;

export type PrimaryTaskAction =
  | 'download'
  | 'cancel'
  | 'retry-download'
  | 'reanalyze'
  | 'open-folder'
  | null;

export type RowOverflowAction = 'reanalyze' | 'open-file' | 'remove';

export const getPrimaryTaskAction = (
  task: TaskPresentationRow,
): PrimaryTaskAction => {
  const actions = getTaskActions(task);
  if (actions.canStartDownload) return 'download';
  if (actions.canCancel) return 'cancel';
  if (actions.canRetryDownload) return 'retry-download';
  if (actions.canReanalyze) return 'reanalyze';
  if (actions.canOpenFolder && task.path) return 'open-folder';
  return null;
};

export const getRowOverflowActions = (
  task: TaskPresentationRow,
): readonly RowOverflowAction[] => {
  const actions = getTaskActions(task);
  const primary = getPrimaryTaskAction(task);
  const overflow: RowOverflowAction[] = [];

  if (actions.canReanalyze && primary !== 'reanalyze') {
    overflow.push('reanalyze');
  }
  if (task.status === 'completed' && task.path) {
    overflow.push('open-file');
  }
  if (actions.canRemove) {
    overflow.push('remove');
  }

  return overflow;
};

/**
 * Explicit copy for capture-context failures. A captured resource must never
 * show a vague "download failed" when the context expired or was released.
 */
export const getCaptureFailureText = (
  task: TaskPresentationRow,
  t: (key: string) => string,
): string | undefined => {
  const key = captureFailureMessageKey(task.failureCode);
  return key ? t(key) : undefined;
};

export const getAudioBadgeText = (format?: DownloadFormat): string => {
  switch (format) {
    case 'flac':
      return 'FLAC';
    case 'opus':
      return 'Opus';
    case 'm4a':
      return 'M4A (AAC)';
    case 'mp3':
      return 'MP3';
    default:
      return '';
  }
};

type Translate = (key: string) => string;

export const getDownloadListStatusText = (
  status: TaskPresentationStatus, t: Translate,
  failureKind?: CurrentFailureKind, errorMsg?: string,
) => {
  switch (status) {
    case 'pending':
      return t('download_list.status.pending');
    case 'queued':
      return t('download_list.status.queued');
    case 'downloading':
      return t('download_list.status.downloading');
    case 'processing':
      return t('download_list.status.processing');
    case 'completed':
      return t('download_list.status.completed');
    case 'error':
      // Cancellation owns the terminal classification even if earlier logs mention a network error.
      if (failureKind === 'cancelled') return t('download_list.status.cancelled');
      if (/\b(?:network error|connection (?:timed out|reset|refused)|unable to resolve|temporary failure in name resolution|ENOTFOUND|ETIMEDOUT|ECONNRESET)\b/i.test(errorMsg ?? '')) {
        return t('download_list.status.network_failed');
      }
      if (failureKind === 'analysis') return t('download_list.status.parse_failed');
      if (failureKind === 'download') return t('download_list.status.download_failed');
      return t('download_list.status.unknown_error');
    case 'analyzing':
      return t('app.analyzing') || 'Analyzing...';
    case 'analyzed': {
      const analyzedText = t('download_list.status.analyzed');
      return analyzedText === 'download_list.status.analyzed' ? 'Ready to download' : analyzedText;
    }
    default:
      return status;
  }
};

export interface ErrorStateOptions {
  youtubeMessages?: Record<string, string>;
  fallback?: string;
  filesystemTitle?: string;
  filesystemAction?: string;
}

export const parseDownloadErrorMessage = (
  errorMsg?: string,
  optionsOrFallback: string | ErrorStateOptions = 'Unknown Error',
) => {
  const options: ErrorStateOptions =
    typeof optionsOrFallback === 'string'
      ? { fallback: optionsOrFallback }
      : optionsOrFallback;

  const fallback = options.fallback || 'Unknown Error';

  if (!errorMsg) {
    return {
      title: fallback,
      hint: '',
    };
  }

  const diagnosticCode = errorMsg.match(/\b(JS_RUNTIME_FAILURE|COOKIE_REFRESH_REQUIRED|AUTH_REQUIRED|SMART_DECISION_REQUIRED|SMART_NO_USABLE_FORMAT):/u)?.[1];
  if (diagnosticCode && options.youtubeMessages?.[diagnosticCode]) {
    return { title: options.youtubeMessages[diagnosticCode], hint: '' };
  }

  // Normalize common low-level filesystem / permission errors for user-facing UI
  if (
    errorMsg.includes('unable to open for writing') ||
    errorMsg.includes('Permission denied') ||
    errorMsg.includes('Errno 13')
  ) {
    const pathMatch = errorMsg.match(/Permission denied:\s*['"]?([^'"]+)['"]?/i);
    let extractedPath = pathMatch ? pathMatch[1].trim() : '';
    if (extractedPath) {
      extractedPath = extractedPath.replace(/\\\\/g, '\\');
    }
    const defaultTitle = options.filesystemTitle || '无法写入下载文件';
    const baseAction = options.filesystemAction || '请检查下载目录权限或磁盘空间';
    return {
      title: defaultTitle,
      hint: extractedPath ? `${baseAction} (${extractedPath})` : baseAction,
    };
  }

  const [title, ...hintParts] = errorMsg.split(' - ');

  // Clean double-escaped backslashes in user-facing message if present
  const cleanedTitle = (title || fallback).replace(/\\\\/g, '\\');
  const cleanedHint = hintParts.join(' - ').replace(/\\\\/g, '\\');

  return {
    title: cleanedTitle,
    hint: cleanedHint,
  };
};

export const shouldShowNumericProgress = (status: TaskPresentationStatus) => {
  return status === 'downloading';
};
