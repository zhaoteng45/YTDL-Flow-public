import type { TaskPresentationRow } from './taskPresentation';
import { redactSensitiveText } from '../utils/redactSensitiveText';
export function getAttemptDiagnostics(row: TaskPresentationRow) {
  const all = row.logs.map(redactSensitiveText).join('\n');
  const started = all.lastIndexOf('[Attempt] phase=started');
  const text = started < 0 ? all : all.slice(started);
  const lastMatch = (pattern: RegExp) => { const matches = [...text.matchAll(pattern)]; return matches[matches.length - 1]; };
  const start = lastMatch(/\[Attempt\] phase=started client=([\w-]+) auth=(cookies|anonymous)/g);
  const terminal = lastMatch(/\[Attempt\] phase=finished exitCode=(-?\d+|unknown)/g);
  const format = lastMatch(/Downloading \d+ format\(s\):\s*([\w+.-]+)/g)?.[1];
  return {
    attemptId: row.id,
    phase: row.status,
    client: start?.[1] ?? 'unknown',
    authMode: start?.[2] ?? 'unknown',
    exitCode: terminal && terminal[1] !== 'unknown' ? Number(terminal[1]) : null,
    format: format ?? 'unknown',
    ...(row.errorMsg ? { reason: redactSensitiveText(row.errorMsg) } : {}),
  };
}
