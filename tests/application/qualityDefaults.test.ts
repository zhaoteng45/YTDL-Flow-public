import { describe, expect, it } from 'vitest';
import { DEFAULT_EXTRA_ARGS } from '../../src/constants';
import { resolveQualitySettings } from '../../src/application/qualitySettings';

describe('best quality settings migration', () => {
  it('uses codec auto for new profiles without overwriting saved preferences', () => {
    expect(DEFAULT_EXTRA_ARGS).toMatchObject({ resolution: 'best', videoCodec: 'auto', audioCodec: 'auto' });
    expect(resolveQualitySettings({}).settings).toMatchObject({ videoCodec: 'auto', audioCodec: 'auto' });
    const legacy = resolveQualitySettings({ videoCodec: 'h265', audioCodec: 'aac' });
    expect(legacy.settings).toMatchObject({ videoCodec: 'h265', audioCodec: 'aac' });
    expect(legacy.needsCodecConfirmation).toBe(true);
    expect(resolveQualitySettings({ videoCodec: 'av1', audioCodec: 'opus' }).needsCodecConfirmation).toBe(false);
    expect(resolveQualitySettings({ videoCodec: 'h265', audioCodec: 'aac' }, 3).needsCodecConfirmation).toBe(false);
  });
});
