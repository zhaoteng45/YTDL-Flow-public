/** Capability observed by the current probe, never a claim about the source limit. */
export interface SmartClientDecision {
  playerClient: string;
  maxHeight: number;
  authMode: 'anonymous' | 'cookies';
  potMode: 'generated' | 'provided' | 'unknown';
  reason: string;
  clearSessionInputs?: boolean;
}

export interface YouTubeFormatCapability {
  formatId: string;
  language?: string;
  width?: number;
  height?: number;
  fps?: number;
  dynamicRange?: string;
  vcodec?: string;
  acodec?: string;
  protocol?: string;
  ext?: string;
  filesize?: number;
  filesizeApprox?: number;
  bitrate?: number;
  hasDrm?: boolean;
  usable: boolean;
}

export interface YouTubeDiagnostic {
  cookieState: 'stale' | 'notUsed' | 'unknown';
  runtimeState: 'unknown' | 'succeeded' | 'failed';
  potState: 'unknown' | 'generated' | 'provided';
}

export interface YouTubeClientCapability {
  playerClient: string;
  observedMaxHeight: number;
  formats: YouTubeFormatCapability[];
  diagnostic: YouTubeDiagnostic;
  failure?: string;
}
