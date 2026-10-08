import type { CurrentAnalysisMedia } from './current-analysis';
import type { CaptureContextFailureCode, CapturedMediaKind } from './capture';
import type { CurrentDownloadFormat, CurrentExtraArgs } from './current-download';

export type CurrentTaskStatus =
  | 'analyzing'
  | 'analyzed'
  | 'queued'
  | 'pending'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'error';

export type CurrentFailureKind =
  | 'analysis'
  | 'download'
  | 'cancelled'
  | 'unknown';

export type CurrentTaskFailureCode =
  | 'pending-start-timeout'
  | CaptureContextFailureCode;

/**
 * Captured-input reference. Carries only the opaque context id plus sanitized
 * display metadata; never a raw URL, Cookie or Authorization value.
 */
export interface CurrentCapturedTaskRef {
  readonly contextId: string;
  readonly siteLabel: string;
  readonly mediaKind: CapturedMediaKind;
}

export interface CurrentTaskActions {
  readonly canCancel: boolean;
  readonly canRemove: boolean;
  readonly canOpenFolder: boolean;
  readonly canStartDownload: boolean;
  readonly canRetryDownload: boolean;
  readonly canReanalyze: boolean;
}

/** Safe attempt diagnostics: no cookie values, file paths or native messages. */
export interface CurrentCredentialSelection {
  source: 'browser' | 'file' | 'anonymous';
  reason: 'browser-ok' | 'file-ok' | 'backup-file' | 'unconfigured' | 'browser-unavailable' | 'backup-not-authorized' | 'backup-unavailable' | 'preferred-file-unavailable' | 'smart-anonymous';
  browserFailure?: 'invalid_browser' | 'locked' | 'permission_denied' | 'not_found' | 'decrypt_failed' | 'execution_failed';
  fileFailure?: 'invalid' | 'expired' | 'mismatch' | 'unreadable';
}

export interface CurrentTaskRow {
  readonly rowId: string;
  readonly attemptId: string;
  readonly sourceUrl: string;
  readonly status: CurrentTaskStatus;
  /** Monotonic presentation-order key owned by CurrentTaskService. */
  readonly orderKey: number;
  readonly metadata?: Readonly<CurrentAnalysisMedia>;
  readonly credential?: Readonly<CurrentCredentialSelection>;
  readonly capture?: CurrentCapturedTaskRef;
  readonly selectedFormat?: CurrentDownloadFormat;
  readonly taskOverrideArgs?: Readonly<Partial<CurrentExtraArgs>>;
  readonly failureKind?: CurrentFailureKind;
  readonly failureReason?: string;
  readonly failureCode?: CurrentTaskFailureCode;
  readonly cancelRequested: boolean;
  readonly progress: number;
  readonly speed?: string;
  readonly finalPath?: string;
  readonly logs: readonly string[];
  readonly debugCommand?: string;
  readonly actions: CurrentTaskActions;
}
