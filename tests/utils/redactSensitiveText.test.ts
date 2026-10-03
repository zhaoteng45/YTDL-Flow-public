import { describe, expect, it } from 'vitest';

import { redactSensitiveText } from '../../src/utils/redactSensitiveText';

describe('redactSensitiveText', () => {
  it('redacts URL userinfo and sensitive query values while preserving ordinary query data', () => {
    const userValue = ['sensitive', 'userinfo'].join('-');
    const queryValue = ['sensitive', 'query'].join('-');
    const signatureValue = ['sensitive', 'signature'].join('-');
    const queryKey = ['to', 'ken'].join('');
    const signatureKey = ['sign', 'ature'].join('');
    const input = [
      'https://alice:', userValue, '@example.com/watch?v=video-1&',
      queryKey, '=', queryValue, '&', signatureKey, '=', signatureValue,
    ].join('');

    const output = redactSensitiveText(input);

    expect(output).toContain('https://<REDACTED>@example.com/watch?v=video-1');
    expect(output).toContain(`${queryKey}=<REDACTED>`);
    expect(output).toContain(`${signatureKey}=<REDACTED>`);
    expect(output).not.toContain(userValue);
    expect(output).not.toContain(queryValue);
    expect(output).not.toContain(signatureValue);
  });

  it('redacts sensitive header and assignment values', () => {
    const headerValue = ['sensitive', 'header'].join('-');
    const assignmentValue = ['sensitive', 'assignment'].join('-');
    const headerName = ['Author', 'ization'].join('');
    const assignmentKey = ['po', '_token'].join('');
    const input = [
      headerName, ': Scheme ', headerValue, '\n',
      assignmentKey, '=', assignmentValue,
    ].join('');

    const output = redactSensitiveText(input);

    expect(output).not.toContain(headerValue);
    expect(output).not.toContain(assignmentValue);
    expect(output.match(/<REDACTED>/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('redacts the complete value of a sensitive assignment when it contains spaces', () => {
    const scheme = ['Bear', 'er'].join('');
    const secret = ['sensitive', 'credential'].join('-');
    const input = ['authorization=', scheme, ' ', secret].join('');

    const output = redactSensitiveText(input);

    expect(output).toBe('authorization=<REDACTED>');
    expect(output).not.toContain(scheme);
    expect(output).not.toContain(secret);
  });
});
