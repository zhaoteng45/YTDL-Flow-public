import { describe, expect, it } from 'vitest';
import { formatLogLine } from '../../src/utils/logFormatter';

describe('console timestamp presentation', () => {
  it('separates a supplied timestamp while preserving process and severity highlighting', () => {
    const html = formatLogLine('[12:03:04.125] [download] ERROR: failed');
    expect(html).toContain('class="log-timestamp"');
    expect(html).toContain('[12:03:04.125]');
    expect(html).toContain('class="log-tag"');
    expect(html).toContain('class="log-error"');
  });
  it('does not invent a timestamp for lines without one', () => {
    expect(formatLogLine('[download] ready')).not.toContain('log-timestamp');
  });
  it('keeps supplied markup inert', () => {
    expect(formatLogLine('12:03:04 <img src=x onerror=alert(1)>')).not.toContain('<img');
  });
});
