import type { ExtraArgs } from '../types';

export interface PlatformCookieProfiles {
  youtube?: string;
  bilibili?: string;
}

export type CredentialPlatform = 'youtube' | 'bilibili';

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

export function resolveExtraArgsForUrl(
  globalExtraArgs: ExtraArgs,
  profiles: PlatformCookieProfiles,
  sourceUrl: string,
): ExtraArgs {
  const resolved: ExtraArgs = { ...globalExtraArgs };
  const platform = detectCredentialPlatform(sourceUrl);
  const platformCookies = platform ? profiles[platform]?.trim() : undefined;

  if (platformCookies) {
    resolved.cookies = platformCookies;
  }

  return resolved;
}
