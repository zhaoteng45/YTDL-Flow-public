import { expect, it } from 'vitest';
import { qualityMessage } from '../../src/application/qualityPresentation';
import { redactSensitiveText } from '../../src/utils/redactSensitiveText';

it('labels observed maximum and explains unmet requests without claiming a source limit', () => {
  expect(qualityMessage({ observedMaxHeight: 1080, smartDecision: { playerClient: 'mweb', maxHeight: 1080, authMode: 'anonymous', potMode: 'generated', reason: 'inventory' } }, '2160p'))
    .toEqual({ key: 'download_list.quality.request_limited', params: { requested: 2160, observed: 1080 } });
  expect(qualityMessage({ observedMaxHeight: 1080 }, 'best').key).toBe('download_list.quality.observed');
});

it('redacts exported profile/temp paths while retaining client and format diagnosis', () => {
  const log = String.raw`C:\Users\Alice\AppData\Local\Temp\ytdl_flow_cookies_123.txt client=mweb format=399+251 bun=1.4.2`;
  const redacted = redactSensitiveText(log);
  expect(redacted).not.toContain('Alice');
  expect(redacted).not.toContain('ytdl_flow_cookies_123');
  expect(redacted).toContain('399+251');
  expect(redacted).toContain('bun=1.4.2');
});
