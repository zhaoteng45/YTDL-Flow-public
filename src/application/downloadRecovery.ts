export type DownloadRecoveryAction = 'reanalyze' | 'credentials' | 'directory' | 'retry' | 'wait' | 'format' | 'none';
export interface DownloadRecovery {
  kind: string;
  action: DownloadRecoveryAction;
  messageKey: string;
}

// Ordered by specificity; a 403 alone does not prove cookies are expired.
const rules: readonly [RegExp, string, DownloadRecoveryAction][] = [
  [/COOKIE_FILE_REANALYSIS_REQUIRED/i, 'cookieFile', 'credentials'],
  [/SMART_DECISION_REQUIRED|SMART_NO_USABLE_FORMAT|JS_RUNTIME_FAILURE/i, 'decision', 'reanalyze'],
  [/failed to decrypt|DPAPI|secretstorage/i, 'cookieDecrypt', 'credentials'],
  [/could not copy .*cookie database|cookie database.*locked/i, 'cookieLocked', 'credentials'],
  [/COOKIE_REFRESH_REQUIRED|AUTH_REQUIRED|sign in to (?:confirm|watch)|login.required|cookies are no longer valid|private video|members.only/i, 'authentication', 'credentials'],
  [/requested format.*not available/i, 'format', 'reanalyze'],
  [/ENOSPC|no space left|disk.*full|磁盘空间不足/i, 'disk', 'directory'],
  [/EACCES|EPERM|permission denied|unable to open for writing|access is denied|拒绝访问/i, 'permission', 'directory'],
  [/HTTP Error 429|too many requests/i, 'rateLimit', 'wait'],
  [/HTTP Error 403|forbidden/i, 'blocked', 'reanalyze'],
  [/DRM protected|known to use DRM/i, 'protected', 'none'],
  [/postprocessing|conversion failed|invalid data found when processing/i, 'processing', 'format'],
  [/connection.*(?:reset|timed out|aborted)|read timed out|HTTP Error 5\d\d|resolve host|getaddrinfo|ECONN|DNS/i, 'network', 'retry'],
];

export function getDownloadRecovery(error?: string): DownloadRecovery | undefined {
  if (!error?.trim()) return undefined;
  for (const [pattern, kind, action] of rules) {
    if (pattern.test(error)) return { kind, action, messageKey: kind === 'cookieFile' ? 'download_list.recovery.authentication' : `download_list.recovery.${kind}` };
  }
  return { kind: 'unknown', action: 'retry', messageKey: 'download_list.recovery.unknown' };
}
