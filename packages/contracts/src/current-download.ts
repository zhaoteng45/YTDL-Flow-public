export type CurrentDownloadFormat = 'video' | 'audio' | 'mkv' | 'mp3' | 'flac' | 'm4a' | 'opus';

export interface CurrentExtraArgs {
  formatSelector?: string;
  sectionStart?: number;
  sectionEnd?: number;
  smartDecision?: import('./youtube').SmartClientDecision;
  proxy?: string;
  cookies?: string;
  userAgent?: string;
  concurrentFragments?: number;
  embedMetadata?: boolean;
  embedSubs?: boolean;
  subLangs?: string;
  sponsorblock?: boolean;
  filenameTemplate?: string;
  resolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  adminMode?: boolean;
  playerClient?: string;
  poToken?: string;
  visitorData?: string;
  writeThumbnail?: boolean;
  writeInfoJson?: boolean;
}

export interface CurrentDownloadCommand {
  /** Display label. For captured tasks this is never an executable address. */
  sourceUrl: string;
  format?: CurrentDownloadFormat;
  taskOverrideArgs?: Partial<CurrentExtraArgs>;
  rowId?: string;
  /** Opaque native capture context; present only for captured tasks. */
  captureContextId?: string;
}
