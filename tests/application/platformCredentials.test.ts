import { describe, expect, it } from 'vitest';

import {
  inferLegacySourceKind,
  migrateLegacyPlatformConfigs,
  normalizePlatformCredentialConfigs,
  resolveEffectivePlatformSource,
  resolveExtraArgsForUrl,
  updatePlatformBackupFile,
  type PlatformCredentialConfig,
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

  it('migration keeps a global browser on YouTube only and never assigns an ambiguous global file', () => {
    expect(migrateLegacyPlatformConfigs({}, {}, 'chrome').youtube?.preferred).toEqual({
      kind: 'browser',
      ref: 'chrome',
    });
    expect(migrateLegacyPlatformConfigs({}, {}, 'chrome').bilibili).toBeUndefined();
    expect(migrateLegacyPlatformConfigs({}, {}, undefined)).toEqual({});
    for (const globalFile of [
      'C:/bili/bilibili_cookies.txt',
      'C:/Users/me/cookies.txt',
      'cookies.txt',
      'exports/yt.json',
      'C:/x/COOKIES.TXT',
    ]) {
      expect(migrateLegacyPlatformConfigs({}, {}, globalFile)).toEqual({});
    }
  });

  it('an unassigned global cookie file is not dispatched to YouTube or Bilibili without explicit config', () => {
    const globalArgs = { cookies: 'C:/bili/bilibili_cookies.txt', proxy: 'p' } as ExtraArgs;
    const youtube = resolveExtraArgsForUrl(globalArgs, {}, 'https://www.youtube.com/watch?v=x', {});
    const bilibili = resolveExtraArgsForUrl(globalArgs, {}, 'https://www.bilibili.com/video/BV1', {});
    expect(youtube.cookies).toBe('');
    expect(bilibili.cookies).toBe('');
    expect(bilibili.proxy).toBe('p');
    expect(
      resolveExtraArgsForUrl(globalArgs, {}, 'https://example.com/video.mp4', {}).cookies,
    ).toBe('C:/bili/bilibili_cookies.txt');
  });

  it('recognizes bare relative cookie files of any letter case as files and never as browser names', () => {
    for (const file of ['cookies.txt', 'COOKIES.TXT', 'cookies.json', 'COOKIES.JSON', 'Cookies.Json']) {
      expect(inferLegacySourceKind(file), file).toBe('file');
    }
    for (const browser of ['chrome', 'edge', 'firefox']) {
      expect(inferLegacySourceKind(browser), browser).toBe('browser');
    }
  });

  it('a bare relative global cookie json is never migrated to a platform and never dispatched to YouTube or Bilibili', () => {
    for (const globalFile of ['cookies.json', 'COOKIES.JSON']) {
      expect(migrateLegacyPlatformConfigs({}, {}, globalFile), globalFile).toEqual({});
      const globalArgs = { cookies: globalFile, proxy: 'p' } as ExtraArgs;
      const youtube = resolveExtraArgsForUrl(globalArgs, {}, 'https://www.youtube.com/watch?v=x', {});
      const bilibili = resolveExtraArgsForUrl(globalArgs, {}, 'https://www.bilibili.com/video/BV1', {});
      expect(youtube.cookies, globalFile).toBe('');
      expect(bilibili.cookies, globalFile).toBe('');
      expect(bilibili.proxy).toBe('p');
      expect(resolveExtraArgsForUrl(globalArgs, {}, 'https://example.com/video.mp4', {}).cookies).toBe(globalFile);
      expect(globalArgs.cookies).toBe(globalFile);
    }
  });

  it('an unassigned global browser keeps its pre-existing compatibility while an unassigned global file is cleared', () => {
    const browserArgs = { cookies: 'chrome', proxy: 'p' } as ExtraArgs;
    const configs = migrateLegacyPlatformConfigs({}, {}, browserArgs.cookies);
    expect(resolveExtraArgsForUrl(browserArgs, {}, 'https://www.youtube.com/watch?v=x', configs).cookies).toBe('chrome');
    expect(resolveExtraArgsForUrl(browserArgs, {}, 'https://www.bilibili.com/video/BV1', configs).cookies).toBe('chrome');
    expect(resolveExtraArgsForUrl(browserArgs, {}, 'https://www.bilibili.com/video/BV1', {}).proxy).toBe('p');
    expect(resolveExtraArgsForUrl(browserArgs, {}, 'https://example.com/video.mp4', {}).cookies).toBe('chrome');
    expect(
      resolveExtraArgsForUrl({ cookies: 'chrome' } as ExtraArgs, {}, 'https://www.bilibili.com/video/BV1', {
        bilibili: { preferred: { kind: 'none' } },
      }).cookies,
    ).toBe('');
  });

  it('explicit platform sources win over an unassigned global cookie file', () => {
    const configs: PlatformCredentialConfigs = {
      youtube: { preferred: { kind: 'file', ref: 'C:/yt/cookies.txt' } },
      bilibili: { preferred: { kind: 'browser', ref: 'edge' } },
    };
    const globalArgs = { cookies: 'C:/Users/me/cookies.txt' } as ExtraArgs;
    expect(resolveExtraArgsForUrl(globalArgs, {}, 'https://youtu.be/x', configs).cookies).toBe('C:/yt/cookies.txt');
    expect(resolveExtraArgsForUrl(globalArgs, {}, 'https://www.bilibili.com/video/BV1', configs).cookies).toBe('edge');
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

  it('normalization keeps unknown fields inside preferred and backup', () => {
    const normalized = normalizePlatformCredentialConfigs({
      youtube: {
        preferred: { kind: 'browser', ref: 'edge', pinned: true },
        backup: { path: 'C:/a.txt', authorized: true, note: 'same-file' },
      },
    });
    expect(normalized.youtube).toEqual({
      preferred: { kind: 'browser', ref: 'edge', pinned: true },
      backup: { path: 'C:/a.txt', authorized: true, note: 'same-file' },
    });
  });

  it('backup updates keep unknown config fields and nested objects without mutating the input', () => {
    const config = {
      preferred: { kind: 'browser', ref: 'edge', pinned: true },
      futureFlag: 'keep',
      backup: { path: 'C:/a.txt', authorized: true, note: 'same-file' },
    } as PlatformCredentialConfig;
    const snapshot = structuredClone(config);

    const sameRef = updatePlatformBackupFile(config, 'C:/a.txt', false);
    expect(sameRef).toMatchObject({
      futureFlag: 'keep',
      preferred: { kind: 'browser', ref: 'edge', pinned: true },
      backup: { path: 'C:/a.txt', authorized: true, note: 'same-file' },
    });

    const changed = updatePlatformBackupFile(config, 'C:/b.txt', false);
    expect(changed).toMatchObject({
      futureFlag: 'keep',
      preferred: { kind: 'browser', ref: 'edge', pinned: true },
      backup: { path: 'C:/b.txt', authorized: false },
    });

    const cleared = updatePlatformBackupFile(config, '  ', true);
    expect(cleared).toEqual({
      futureFlag: 'keep',
      preferred: { kind: 'browser', ref: 'edge', pinned: true },
    });
    expect(cleared).not.toHaveProperty('backup');
    expect(config).toEqual(snapshot);
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
