import type { ExtraArgs } from './types';

export const THEMES = {
  // Keep the historical value for persisted-setting compatibility.
  COBALT_BUTTER: 'cobalt-butter',
  FLUENT: 'fluent',
  MATERIAL: 'material',
} as const;

export type AppTheme = typeof THEMES[keyof typeof THEMES];

export const THEME_OPTIONS = [
  { value: THEMES.MATERIAL, label: '蓝宝石' },
  { value: THEMES.FLUENT, label: '酒红' },
  { value: THEMES.COBALT_BUTTER, label: '石墨' },
] as const;

export const DEFAULT_EXTRA_ARGS: ExtraArgs = {
  proxy: '',
  cookies: '',
  userAgent: '',
  concurrentFragments: 4,
  embedMetadata: true,
  embedSubs: true,
  subLangs: 'zh-Hans,en',
  sponsorblock: true,
  filenameTemplate: '%(title)s - %(uploader)s.%(ext)s',
  resolution: 'best',
  videoCodec: 'auto',
  audioCodec: 'auto',
  adminMode: false,
  playerClient: 'smart', // Sequential capability scan; download retains its winner.
  poToken: '',
  visitorData: '',
  writeThumbnail: false,
  writeInfoJson: false,
};
