import { DEFAULT_EXTRA_ARGS } from '../constants';
import type { ExtraArgs } from '../types';

/** Historical codec defaults were persisted without provenance; never guess intent. */
export function resolveQualitySettings(saved: Partial<ExtraArgs>, preferenceVersion = 0) {
  return {
    settings: { ...DEFAULT_EXTRA_ARGS, ...saved },
    needsCodecConfirmation: preferenceVersion < 3 && saved.videoCodec === 'h265' && saved.audioCodec === 'aac',
  };
}
