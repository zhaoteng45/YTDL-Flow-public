import type { ExtraArgs } from '../types';

export interface PlatformCookieProfiles {
  youtube?: string;
  bilibili?: string;
}

export type CredentialPlatform = 'youtube' | 'bilibili';
export type PlatformConnectionEntry = 'youtube-browser' | 'youtube-file' | 'bilibili';

export function detectCredentialPlatform(sourceUrl: string): CredentialPlatform | undefined {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase().replace(/\.$/, '');
    if (
      host === 'youtu.be' ||
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtube-nocookie.com' ||
      host.endsWith('.youtube-nocookie.com')
    ) {
      return 'youtube';
    }
    if (
      host === 'bilibili.com' ||
      host.endsWith('.bilibili.com') ||
      host === 'b23.tv' ||
      host.endsWith('.b23.tv')
    ) {
      return 'bilibili';
    }
  } catch {
    // Non-URL input falls through to generic settings.
  }
  return undefined;
}

export const CREDENTIAL_PLATFORMS: readonly CredentialPlatform[] = ['youtube', 'bilibili'];

/** Canonical target used to scope a platform cookie file to its own domain. */
export const PLATFORM_CANONICAL_URL: Record<CredentialPlatform, string> = {
  youtube: 'https://www.youtube.com/',
  bilibili: 'https://www.bilibili.com/',
};

export type PlatformCredentialSourceKind = 'browser' | 'file' | 'none';

export interface PlatformCredentialSource {
  kind: PlatformCredentialSourceKind;
  /** Browser name or cookie file path. Absent for `none`. */
  ref?: string;
}

export interface PlatformBackupFile {
  path: string;
  authorized: boolean;
}

export interface PlatformCredentialConfig {
  preferred: PlatformCredentialSource;
  backup?: PlatformBackupFile;
}

export type PlatformCredentialConfigs = Partial<Record<CredentialPlatform, PlatformCredentialConfig>>;

export type PlatformFileImportFailure = 'invalid' | 'expired' | 'mismatch' | 'unreadable';

export type PlatformFileImportResult =
  | { ok: true; state: 'imported' }
  | { ok: false; state: PlatformFileImportFailure };

export type EffectivePlatformSource =
  | { kind: 'browser' | 'file'; ref: string }
  | { kind: 'none' }
  | { kind: 'unspecified' };

const SOURCE_KINDS: readonly PlatformCredentialSourceKind[] = ['browser', 'file', 'none'];

/** A path-like legacy value is a cookies file; everything else is a browser name. */
export function inferLegacySourceKind(value: string): 'browser' | 'file' {
  const trimmed = value.trim();
  if (/[\\/]/.test(trimmed) || /\.txt$/i.test(trimmed)) return 'file';
  return 'browser';
}

/** Drops malformed platform string preferences instead of trusting them. */
export function normalizePlatformCookieProfiles(raw: unknown): PlatformCookieProfiles {
  const result: PlatformCookieProfiles = {};
  if (!raw || typeof raw !== 'object') return result;
  const record = raw as Record<string, unknown>;
  for (const platform of CREDENTIAL_PLATFORMS) {
    const value = record[platform];
    if (typeof value === 'string' && value.trim()) result[platform] = value.trim();
  }
  return result;
}

function normalizeSource(raw: unknown): PlatformCredentialSource | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const kind = (raw as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !SOURCE_KINDS.includes(kind as PlatformCredentialSourceKind)) {
    return undefined;
  }
  if (kind === 'none') return { kind: 'none' };
  const ref = (raw as { ref?: unknown }).ref;
  if (typeof ref !== 'string' || !ref.trim()) return undefined;
  return { kind: kind === 'file' ? 'file' : 'browser', ref: ref.trim() };
}

/**
 * Normalizes persisted platform configs. Malformed entries and unknown preferred
 * kinds are dropped rather than trusted; unknown entry fields are preserved so
 * future preference fields survive a round-trip.
 */
export function normalizePlatformCredentialConfigs(raw: unknown): PlatformCredentialConfigs {
  const result: PlatformCredentialConfigs = {};
  if (!raw || typeof raw !== 'object') return result;
  const record = raw as Record<string, unknown>;
  for (const platform of CREDENTIAL_PLATFORMS) {
    const entry = record[platform];
    if (!entry || typeof entry !== 'object') continue;
    const preferred = normalizeSource((entry as { preferred?: unknown }).preferred);
    if (!preferred) continue;
    const normalized: PlatformCredentialConfig = { ...(entry as object), preferred };
    const backup = (entry as { backup?: unknown }).backup;
    if (backup && typeof backup === 'object') {
      const path = (backup as { path?: unknown }).path;
      if (typeof path === 'string' && path.trim()) {
        normalized.backup = {
          path: path.trim(),
          authorized: (backup as { authorized?: unknown }).authorized === true,
        };
      } else {
        delete normalized.backup;
      }
    } else {
      delete normalized.backup;
    }
    result[platform] = normalized;
  }
  return result;
}

/**
 * Legacy migration preserves the old effective source and never grants backup
 * authorization. An explicit platform config (including explicit `none`) always
 * wins, so a disconnected platform cannot be resurrected by old globals.
 */
export function migrateLegacyPlatformConfigs(
  configs: PlatformCredentialConfigs,
  legacyProfiles: PlatformCookieProfiles,
  globalCookies: string | undefined,
): PlatformCredentialConfigs {
  const result: PlatformCredentialConfigs = { ...configs };
  const global = globalCookies?.trim();
  for (const platform of CREDENTIAL_PLATFORMS) {
    if (result[platform]) continue;
    const legacy = legacyProfiles[platform]?.trim();
    if (legacy) {
      result[platform] = { preferred: { kind: inferLegacySourceKind(legacy), ref: legacy } };
      continue;
    }
    if (!global) continue;
    // Only the platform the old single global value belonged to keeps its source.
    const target: CredentialPlatform = global.toLowerCase().includes('bilibili_cookies')
      ? 'bilibili'
      : 'youtube';
    if (target === platform) {
      result[platform] = { preferred: { kind: inferLegacySourceKind(global), ref: global } };
    }
  }
  return result;
}

/**
 * Resolves the preferred source for one platform. Explicit config wins over the
 * legacy string map; an explicit `none` blocks global fallthrough, while an
 * unspecified platform keeps the historical global behavior.
 */
export function resolveEffectivePlatformSource(
  platform: CredentialPlatform,
  configs: PlatformCredentialConfigs,
  legacyProfiles: PlatformCookieProfiles,
): EffectivePlatformSource {
  const config = configs[platform];
  if (config) {
    if (config.preferred.kind === 'none') return { kind: 'none' };
    if (config.preferred.ref) return { kind: config.preferred.kind, ref: config.preferred.ref };
  }
  const legacy = legacyProfiles[platform]?.trim();
  if (legacy) return { kind: inferLegacySourceKind(legacy), ref: legacy };
  return { kind: 'unspecified' };
}

/**
 * Replaces the backup file reference. A changed reference needs fresh
 * authorization; the same reference retains an already accepted authorization.
 */
export function updatePlatformBackupFile(
  config: PlatformCredentialConfig | undefined,
  path: string,
  authorized: boolean,
): PlatformCredentialConfig {
  const preferred = config?.preferred ?? { kind: 'none' };
  const normalized = path.trim();
  if (!normalized) return { preferred };
  const sameRef = config?.backup?.path === normalized;
  const nextAuthorized = sameRef
    ? config?.backup?.authorized === true || authorized === true
    : authorized === true;
  return { preferred, backup: { path: normalized, authorized: nextAuthorized } };
}

export function resolveExtraArgsForUrl(
  globalExtraArgs: ExtraArgs,
  profiles: PlatformCookieProfiles,
  sourceUrl: string,
  configs: PlatformCredentialConfigs = {},
): ExtraArgs {
  const resolved: ExtraArgs = { ...globalExtraArgs };
  const platform = detectCredentialPlatform(sourceUrl);
  if (!platform) return resolved;
  const source = resolveEffectivePlatformSource(platform, configs, profiles);

  if (source.kind === 'none') {
    // Explicit disconnect must not fall through to a legacy global cookie value.
    resolved.cookies = '';
  } else if (source.kind !== 'unspecified') {
    resolved.cookies = source.ref;
  }

  return resolved;
}
