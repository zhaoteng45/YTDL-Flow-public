import { describe, expect, it } from 'vitest';

import {
  CAPTURE_FORBIDDEN_EXTRA_ARGS,
  stripCaptureForbiddenExtraArgs,
} from '../src/capture-extra-args';

describe('capture ExtraArgs isolation', () => {
  it('never passes network identity fields into a captured task', () => {
    const stripped = stripCaptureForbiddenExtraArgs({
      cookies: 'edge',
      proxy: 'http://127.0.0.1:7890',
      poToken: 'web+token',
      visitorData: 'visitor',
      playerClient: 'smart',
      userAgent: 'Mozilla/5.0',
      resolution: '1080',
      filenameTemplate: '%(title)s.%(ext)s',
    });

    expect(stripped).toEqual({
      resolution: '1080',
      filenameTemplate: '%(title)s.%(ext)s',
    });
    for (const field of CAPTURE_FORBIDDEN_EXTRA_ARGS) {
      expect(Object.keys(stripped)).not.toContain(field);
    }
  });

  it('keeps non-network preferences and tolerates absent input', () => {
    expect(
      stripCaptureForbiddenExtraArgs({
        embedMetadata: true,
        sponsorblock: true,
        writeInfoJson: true,
        audioCodec: 'mp3',
      }),
    ).toEqual({
      embedMetadata: true,
      sponsorblock: true,
      writeInfoJson: true,
      audioCodec: 'mp3',
    });
    expect(stripCaptureForbiddenExtraArgs(undefined)).toEqual({});
  });
});
