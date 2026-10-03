export interface VideoMetadata {
  availableFormats?: import('@ytdl-flow/contracts').YouTubeFormatCapability[];
  requestedResolution?: string;
  smartDecision?: import('@ytdl-flow/contracts').SmartClientDecision;
  clientCapabilities?: import('@ytdl-flow/contracts').YouTubeClientCapability[];
  youtubeDiagnostic?: import('@ytdl-flow/contracts').YouTubeDiagnostic;
  observedMaxHeight?: number;
  title: string;
  thumbnail: string;
  duration: string;
  channel: string;
  url: string; // 原始 URL，用于下载
  resolution?: string;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  filesize?: string;
  filename?: string;
}

// IPC 事件负载类型
export interface DownloadProgressPayload {
  id: string;
  progress: number;
  speed: string;
  status: string; // 后端传来的是 String; 实际词表: 'downloading' | 'processing' | 'completed' | 'error'
  filePath?: string;
}

export type DownloadResultStatus = 'completed' | 'failed' | 'cancelled';

export interface DownloadResultPayload {
  id: string;
  outcome: DownloadResultStatus;
  error?: string | null;
  filePath?: string | null;
}

export interface ExtraArgs {
  formatSelector?: string;
  sectionStart?: number;
  sectionEnd?: number;
  smartDecision?: import('@ytdl-flow/contracts').SmartClientDecision;
  proxy?: string;
  cookies?: string;
  userAgent?: string;
  concurrentFragments?: number;
  embedMetadata?: boolean;
  embedSubs?: boolean;
  subLangs?: string; // e.g. "en,zh-Hans" or "all"
  sponsorblock?: boolean;
  filenameTemplate?: string; // e.g. "%(title)s - %(uploader)s.%(ext)s"
  resolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  adminMode?: boolean;
  playerClient?: string; // 'web', 'android', 'ios' or custom
  poToken?: string;
  visitorData?: string;
  writeThumbnail?: boolean;
  writeInfoJson?: boolean;
}

export interface AnalysisLogPayload {
  id: string;
  line: string;
}

export type FailureKind = 'analysis' | 'download' | 'cancelled' | 'unknown';
export type DownloadFormat = 'video' | 'audio' | 'mkv' | 'mp3' | 'flac' | 'm4a' | 'opus';

export interface Task {
  id: string;
  url: string;
  status: 'analyzing' | 'analyzed' | 'queued' | 'pending' | 'downloading' | 'processing' | 'completed' | 'error';
  metadata?: VideoMetadata;
  progress: number;
  speed?: string;
  totalSize?: string;
  logs: string[];

  title?: string;
  showLogs?: boolean;
  debugCommand?: string;
  showCommand?: boolean;
  errorMsg?: string;
  selectedFormat?: DownloadFormat;
  /** Settings resolved for this analysis attempt; later UI changes must not drift the task. */
  baseExtraArgsSnapshot?: ExtraArgs;
  overrideArgs?: Partial<ExtraArgs>;
  path?: string;
  downloadType?: DownloadFormat;

  rowId: string;
  failureKind?: FailureKind;
  lastActiveStatus?: 'analyzing' | 'analyzed' | 'queued' | 'pending' | 'downloading' | 'processing';
  cancelRequested?: boolean;
  queuedAt?: number;
  updatedAt?: number;
  /** 最近一次进度/日志事件时间，看门狗据此判定僵死 */
  lastActivityAt?: number;
  lastTerminalAt?: number;
  orderSeq?: number;
}
