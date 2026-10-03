import type { CurrentExtraArgs } from './current-download';

export interface CurrentAnalysisMedia {
  availableFormats?: import('./youtube').YouTubeFormatCapability[];
  requestedResolution?: string;
  smartDecision?: import('./youtube').SmartClientDecision;
  clientCapabilities?: import('./youtube').YouTubeClientCapability[];
  youtubeDiagnostic?: import('./youtube').YouTubeDiagnostic;
  observedMaxHeight?: number;
  title: string;
  thumbnail: string;
  duration: string;
  channel: string;
  /**
   * For pasted URLs this is the analyzed URL. For captured analyses it is the
   * sanitized capture label and is never an executable address.
   */
  url: string;
  resolution?: string;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  filesize?: string;
  filename?: string;
}

/**
 * Analysis target. Exactly one of `sourceUrl` / `captureContextId` is present;
 * a sanitized display label is never accepted as an execution fallback.
 */
export interface CurrentAnalysisRequest {
  attemptId: string;
  extraArgs?: CurrentExtraArgs;
  sourceUrl?: string;
  captureContextId?: string;
}
