import type {
  CapturedMediaKind,
  CurrentAnalysisMedia,
  CurrentFailureKind,
  CurrentTaskActions,
  CurrentTaskFailureCode,
  CurrentTaskRow,
  CurrentCredentialSelection,
} from '../../packages/contracts/src';
import type { DownloadFormat } from '../types';
import { redactSensitiveText } from '../utils/redactSensitiveText';

export type TaskPresentationStatus = CurrentTaskRow['status'];

export interface TaskPresentationCaptureRef {
  readonly contextId: string;
  readonly siteLabel: string;
  readonly mediaKind: CapturedMediaKind;
}

export interface TaskPresentationRow {
  readonly id: string;
  readonly rowId: string;
  readonly url: string;
  readonly status: TaskPresentationStatus;
  readonly metadata?: Readonly<CurrentAnalysisMedia>;
  readonly credential?: Readonly<CurrentCredentialSelection>;
  readonly capture?: TaskPresentationCaptureRef;
  readonly progress: number;
  readonly speed?: string;
  readonly totalSize?: string;
  readonly logs: readonly string[];
  readonly title?: string;
  readonly debugCommand?: string;
  readonly errorMsg?: string;
  readonly failureCode?: CurrentTaskFailureCode;
  readonly selectedFormat?: DownloadFormat;
  readonly path?: string;
  readonly failureKind?: CurrentFailureKind;
  readonly cancelRequested: boolean;
  readonly orderKey?: number;
  readonly queuedAt?: number;
  readonly updatedAt?: number;
  readonly lastTerminalAt?: number;
  readonly actions: CurrentTaskActions;
}

const PRESENTATION_AUDIO_FORMATS: ReadonlySet<DownloadFormat> = new Set([
  'audio',
  'mp3',
  'flac',
  'm4a',
  'opus',
]);

/**
 * UI-only audio-format classification for presentation badges.
 * Mirrors the engine vocabulary so the Vue presentation layer does not import
 * engine helpers just to decide whether a row shows audio metadata.
 */
export const isAudioFormat = (format?: DownloadFormat): boolean =>
  format !== undefined && PRESENTATION_AUDIO_FORMATS.has(format);

function finalFilenameFromPath(finalPath: string): string | undefined {
  const normalized = finalPath.replace(/\\/g, '/');
  const filename = normalized.split('/').pop()?.trim();
  return filename || undefined;
}

function cloneMetadata(
  row: CurrentTaskRow,
): Readonly<CurrentAnalysisMedia> | undefined {
  if (!row.metadata) return undefined;
  if (row.status !== 'completed' || !row.finalPath) {
    return { ...row.metadata };
  }

  const { filesize: _analysisFilesize, ...metadata } = row.metadata;
  const finalFilename = finalFilenameFromPath(row.finalPath);
  return {
    ...metadata,
    ...(finalFilename ? { filename: finalFilename } : {}),
  };
}

const CREDENTIAL_REASONS_BY_SOURCE: Readonly<
  Record<CurrentCredentialSelection['source'], ReadonlySet<CurrentCredentialSelection['reason']>>
> = {
  browser: new Set(['browser-ok']),
  file: new Set(['file-ok', 'backup-file']),
  anonymous: new Set([
    'unconfigured',
    'browser-unavailable',
    'backup-not-authorized',
    'backup-unavailable',
    'preferred-file-unavailable',
    'smart-anonymous',
  ]),
};

const CREDENTIAL_BROWSER_FAILURES: ReadonlySet<
  NonNullable<CurrentCredentialSelection['browserFailure']>
> = new Set([
  'invalid_browser',
  'locked',
  'permission_denied',
  'not_found',
  'decrypt_failed',
  'execution_failed',
]);

const CREDENTIAL_FILE_FAILURES: ReadonlySet<
  NonNullable<CurrentCredentialSelection['fileFailure']>
> = new Set(['invalid', 'expired', 'mismatch', 'unreadable']);

function cloneCredential(
  credential: Readonly<CurrentCredentialSelection> | undefined,
): Readonly<CurrentCredentialSelection> | undefined {
  if (!credential) return undefined;
  const allowedReasons = CREDENTIAL_REASONS_BY_SOURCE[credential.source];
  if (!allowedReasons || !allowedReasons.has(credential.reason)) return undefined;
  const browserFailure =
    credential.browserFailure && CREDENTIAL_BROWSER_FAILURES.has(credential.browserFailure)
      ? credential.browserFailure
      : undefined;
  const fileFailure =
    credential.fileFailure && CREDENTIAL_FILE_FAILURES.has(credential.fileFailure)
      ? credential.fileFailure
      : undefined;
  return {
    source: credential.source,
    reason: credential.reason,
    ...(browserFailure ? { browserFailure } : {}),
    ...(fileFailure ? { fileFailure } : {}),
  };
}

export function toCurrentTaskPresentationRow(row: CurrentTaskRow): TaskPresentationRow {
  const logs = row.logs.map(redactSensitiveText);
  const failure = row.failureReason ? redactSensitiveText(row.failureReason) : undefined;
  if (row.status === 'error' && failure && !logs.some((line) => line.includes(failure))) {
    logs.push(`[ERROR] ${failure}`);
  }
  const credential = cloneCredential(row.credential);
  return {
    id: row.attemptId,
    rowId: row.rowId,
    url: row.sourceUrl,
    status: row.status,
    ...(row.metadata ? { metadata: cloneMetadata(row) } : {}),
    ...(credential ? { credential } : {}),
    ...(row.capture ? { capture: { ...row.capture } } : {}),
    progress: row.progress,
    ...(row.speed ? { speed: row.speed } : {}),
    logs,
    ...(row.metadata?.title ? { title: row.metadata.title } : {}),
    ...(row.debugCommand ? { debugCommand: row.debugCommand } : {}),
    ...(failure ? { errorMsg: failure } : {}),
    ...(row.failureCode ? { failureCode: row.failureCode } : {}),
    ...(row.selectedFormat ? { selectedFormat: row.selectedFormat as DownloadFormat } : {}),
    ...(row.finalPath ? { path: row.finalPath } : {}),
    failureKind: row.failureKind,
    cancelRequested: row.cancelRequested,
    orderKey: row.orderKey,
    queuedAt: undefined,
    updatedAt: undefined,
    lastTerminalAt: undefined,
    actions: row.actions,
  };
}
