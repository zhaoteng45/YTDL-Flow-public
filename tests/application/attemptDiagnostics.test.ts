import { describe, expect, it } from 'vitest';
import { getAttemptDiagnostics } from '../../src/application/attemptDiagnostics';
import type { TaskPresentationRow } from '../../src/application/taskPresentation';
const row = (logs: string[]): TaskPresentationRow => ({ id: 'attempt-2', rowId: 'row-1', url: 'https://example.com/video', status: 'error', progress: 0, logs, cancelRequested: false, actions: { canCancel: false, canRemove: true, canStartDownload: false, canRetryDownload: true, canReanalyze: false, canOpenFolder: false } });
describe('attempt diagnostics', () => {
  it('does not carry the first process exit code into a running fallback process', () => {
    const task = { ...row(['[Attempt] phase=started client=web auth=cookies', '[info] x: Downloading 1 format(s): 137+140', '[Attempt] phase=finished exitCode=1', '[Attempt] phase=started client=web auth=cookies']), status: 'downloading' as const };
    expect(getAttemptDiagnostics(task)).toMatchObject({ exitCode: null, format: 'unknown' });
  });
  it('shows effective execution identity and the real selected formats and exit code', () => {
    expect(getAttemptDiagnostics(row(['[Attempt] phase=started client=web_safari auth=cookies', '[info] F24wItiYYNs: Downloading 1 format(s): 137+140', '[Attempt] phase=finished exitCode=1']))).toMatchObject({ attemptId: 'attempt-2', client: 'web_safari', authMode: 'cookies', format: '137+140', exitCode: 1 });
  });
  it('does not fabricate an exit code or authentication success when startup failed', () => {
    expect(getAttemptDiagnostics(row(['[ERROR] SMART_DECISION_REQUIRED']))).toMatchObject({ exitCode: null, authMode: 'unknown' });
  });
});
