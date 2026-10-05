import { describe, expect, it } from 'vitest';

import {
  migrateLegacyPlatformConfigs,
  normalizePlatformCredentialConfigs,
  resolveEffectivePlatformSource,
  resolveExtraArgsForUrl,
  updatePlatformBackupFile,
  type PlatformCredentialConfigs,
} from '../../src/application/platformCredentials';
import type { ExtraArgs } from '../../src/types';

describe('platform credential source model', () => {
  it('migration preserves the legacy effective source and grants no backup authorization', () => {
    const migrated = migrateLegacyPlatformConfigs(
      {},
      { youtube: 'edge', bilibili: 'C:/bili/bilibili_cookies.txt' },
      'chrome',
    );

    expect(migrated.youtube).toEqual({ preferred: { kind: 'browser', ref: 'edge' } });
    expect(migrated.bilibili).toEqual({
      preferred: { kind: 'file', ref: 'C:/bili/bilibili_cookies.txt' },
    });
    expect(migrated.youtube?.backup).toBeUndefined();
    expect(migrated.bilibili?.backup).toBeUndefined();
  });

  it('migration maps the single global value to one platform only', () => {
    expect(migrateLegacyPlatformConfigs({}, {}, 'chrome').youtube?.preferred).toEqual({
      kind: 'browser',
      ref: 'chrome',
    });
    expect(
      migrateLegacyPlatformConfigs({}, {}, 'C:/bili/bilibili_cookies.txt').bilibili?.preferred,
    ).toEqual({ kind: 'file', ref: 'C:/bili/bilibili_cookies.txt' });
    expect(migrateLegacyPlatformConfigs({}, {}, undefined)).toEqual({});
  });

  it('explicit none blocks legacy and global cookie fallthrough', () => {
    const configs: PlatformCredentialConfigs = { youtube: { preferred: { kind: 'none' } } };
    const resolved = resolveExtraArgsForUrl(
      { cookies: 'global-edge' } as ExtraArgs,
      { youtube: 'legacy-chrome' },
      'https://www.youtube.com/watch?v=x',
      configs,
    );

    expect(resolved.cookies).toBe('');
    expect(resolveEffectivePlatformSource('youtube', configs, { youtube: 'legacy-chrome' })).toEqual({
      kind: 'none',
    });
  });

  it('a changed backup file reference needs fresh authorization; the same reference keeps it', () => {
    const first = updatePlatformBackupFile(undefined, 'C:/a.txt', true);
    expect(first.backup).toEqual({ path: 'C:/a.txt', authorized: true });

    const changed = updatePlatformBackupFile(first, 'C:/b.txt', false);
    expect(changed.backup).toEqual({ path: 'C:/b.txt', authorized: false });

    const authorized = updatePlatformBackupFile(changed, 'C:/b.txt', true);
    expect(authorized.backup?.authorized).toBe(true);

    const sameRef = updatePlatformBackupFile(authorized, 'C:/b.txt', false);
    expect(sameRef.backup?.authorized).toBe(true);
    expect(sameRef.preferred).toEqual(changed.preferred);
  });

  it('normalization drops malformed storage and keeps unknown entry fields', () => {
    const normalized = normalizePlatformCredentialConfigs({
      youtube: { preferred: { kind: 'file', ref: '  C:/yt.txt  ' }, futureFlag: true },
      bilibili: { preferred: { kind: 'browser' } },
      junk: { preferred: { kind: 'nope', ref: 'x' } },
    });

    expect(normalized.youtube).toMatchObject({
      preferred: { kind: 'file', ref: 'C:/yt.txt' },
      futureFlag: true,
    });
    expect(normalized.bilibili).toBeUndefined();
  });

  it('keeps legacy platform strings effective when no explicit config exists', () => {
    const resolved = resolveExtraArgsForUrl(
      { cookies: 'global' } as ExtraArgs,
      { youtube: 'firefox' },
      'https://www.youtube.com/watch?v=x',
      {},
    );
    expect(resolved.cookies).toBe('firefox');
  });
});
