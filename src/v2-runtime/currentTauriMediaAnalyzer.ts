import type {
  CurrentAnalysisMedia,
  CurrentAnalysisRequest,
} from '../../packages/contracts/src';
import type { CurrentMediaAnalyzer } from '../../packages/application/src';
import type { YouTubeFormatCapability } from '../../packages/contracts/src';
import { isTauri, safeInvoke } from '../utils/tauri';

interface CurrentTauriMediaAnalyzerDeps {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  isNativeRuntime(): boolean;
}

const defaultDeps: CurrentTauriMediaAnalyzerDeps = {
  invoke(command, args) {
    return safeInvoke(command, args);
  },
  isNativeRuntime() {
    return isTauri();
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string') {
    throw new Error(`Invalid native metadata field: ${field}`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`Invalid native metadata field: ${field}`);
  }
  return value;
}

function optionalNumber(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid native metadata field: ${field}`);
  }
  return value;
}

export class CurrentTauriMediaAnalyzer implements CurrentMediaAnalyzer {
  constructor(private readonly deps: CurrentTauriMediaAnalyzerDeps = defaultDeps) {}

  async analyze(request: CurrentAnalysisRequest): Promise<CurrentAnalysisMedia> {
    if (!this.deps.isNativeRuntime()) {
      throw new Error('Current analysis requires the Tauri native runtime');
    }

    const sourceUrl = request.sourceUrl;
    const captureContextId = request.captureContextId;
    if ((sourceUrl === undefined) === (captureContextId === undefined)) {
      throw new Error(
        'Invalid analysis target: exactly one of sourceUrl / captureContextId is required',
      );
    }

    if (captureContextId !== undefined) {
      return this.analyzeCaptured(captureContextId, request);
    }

    const response = await this.deps.invoke('get_video_metadata', {
      url: sourceUrl,
      extraArgs: request.extraArgs ?? {},
      id: request.attemptId,
    });

    if (!isRecord(response)) {
      throw new Error('Invalid native metadata response: expected object');
    }

    const media: CurrentAnalysisMedia = {
      title: requireString(response, 'title'),
      thumbnail: requireString(response, 'thumbnail'),
      duration: requireString(response, 'duration'),
      channel: requireString(response, 'channel'),
      url: requireString(response, 'url'),
    };

    if (media.url !== request.sourceUrl) {
      throw new Error('Invalid native metadata response: source URL mismatch');
    }

    const resolution = optionalString(response, 'resolution');
    const width = optionalNumber(response, 'width');
    const height = optionalNumber(response, 'height');
    const videoCodec = optionalString(response, 'videoCodec');
    const audioCodec = optionalString(response, 'audioCodec');
    const filesize = optionalString(response, 'filesize');
    const filename = optionalString(response, 'filename');

    if (resolution !== undefined) media.resolution = resolution;
    if (width !== undefined) media.width = width;
    if (height !== undefined) media.height = height;
    if (videoCodec !== undefined) media.videoCodec = videoCodec;
    if (audioCodec !== undefined) media.audioCodec = audioCodec;
    if (filesize !== undefined) media.filesize = filesize;
    if (filename !== undefined) media.filename = filename;

    const requestedResolution = optionalString(response, 'requestedResolution');
    const observedMaxHeight = optionalNumber(response, 'observedMaxHeight');
    if (requestedResolution !== undefined) media.requestedResolution = requestedResolution;
    if (observedMaxHeight !== undefined) media.observedMaxHeight = observedMaxHeight;
    if (response.availableFormats !== undefined && response.availableFormats !== null) {
      if (!Array.isArray(response.availableFormats)) throw new Error('Invalid native metadata field: availableFormats');
      media.availableFormats = response.availableFormats.map((value): YouTubeFormatCapability => {
        if (!isRecord(value) || typeof value.usable !== 'boolean') throw new Error('Invalid native format');
        const format: YouTubeFormatCapability = { formatId: requireString(value, 'formatId'), usable: value.usable };
        for (const field of ['width', 'height', 'fps', 'filesize', 'filesizeApprox', 'bitrate'] as const) {
          const number = optionalNumber(value, field);
          if (number !== undefined) format[field] = number;
        }
        for (const field of ['dynamicRange', 'vcodec', 'acodec', 'protocol', 'ext', 'language'] as const) {
          const text = optionalString(value, field);
          if (text !== undefined) format[field] = text;
        }
        if (value.hasDrm !== undefined && value.hasDrm !== null) {
          if (typeof value.hasDrm !== 'boolean') throw new Error('Invalid native format DRM flag');
          format.hasDrm = value.hasDrm;
        }
        return format;
      });
    }
    if (response.smartDecision !== undefined && response.smartDecision !== null) {
      const decision = response.smartDecision;
      if (!isRecord(decision) || typeof decision.playerClient !== 'string' || !decision.playerClient.trim()
        || decision.playerClient === 'smart' || typeof decision.maxHeight !== 'number' || !Number.isFinite(decision.maxHeight)
        || (decision.authMode !== 'anonymous' && decision.authMode !== 'cookies')
        || (decision.potMode !== 'generated' && decision.potMode !== 'provided' && decision.potMode !== 'unknown')
        || typeof decision.reason !== 'string'
        || (decision.clearSessionInputs !== undefined && typeof decision.clearSessionInputs !== 'boolean')) {
        throw new Error('Invalid native metadata field: smartDecision');
      }
      media.smartDecision = {
        playerClient: decision.playerClient,
        maxHeight: decision.maxHeight,
        authMode: decision.authMode,
        potMode: decision.potMode,
        reason: decision.reason,
        ...(typeof decision.clearSessionInputs === 'boolean' ? { clearSessionInputs: decision.clearSessionInputs } : {}),
      };
    }

    if (response.entries !== undefined && response.entries !== null) {
      throw new Error('Playlist metadata is not supported; provide a single video URL');
    }

    return media;
  }

  private async analyzeCaptured(
    captureContextId: string,
    request: CurrentAnalysisRequest,
  ): Promise<CurrentAnalysisMedia> {
    const response = await this.deps.invoke('get_video_metadata', {
      captureContextId,
      extraArgs: request.extraArgs ?? {},
      id: request.attemptId,
    });

    if (!isRecord(response)) {
      throw new Error('Invalid native metadata response: expected object');
    }

    const media: CurrentAnalysisMedia = {
      title: requireString(response, 'title'),
      thumbnail: requireString(response, 'thumbnail'),
      duration: requireString(response, 'duration'),
      channel: requireString(response, 'channel'),
      url: requireString(response, 'url'),
    };

    // The captured label is display-only; an executable address here would be a
    // naked-URL fallback and is rejected.
    if (/:\/\//.test(media.url)) {
      throw new Error('Invalid native metadata response for a captured resource: executable url');
    }

    const resolution = optionalString(response, 'resolution');
    const width = optionalNumber(response, 'width');
    const height = optionalNumber(response, 'height');
    const videoCodec = optionalString(response, 'videoCodec');
    const audioCodec = optionalString(response, 'audioCodec');
    const filesize = optionalString(response, 'filesize');
    const filename = optionalString(response, 'filename');

    if (resolution !== undefined) media.resolution = resolution;
    if (width !== undefined) media.width = width;
    if (height !== undefined) media.height = height;
    if (videoCodec !== undefined) media.videoCodec = videoCodec;
    if (audioCodec !== undefined) media.audioCodec = audioCodec;
    if (filesize !== undefined) media.filesize = filesize;
    if (filename !== undefined) media.filename = filename;

    return media;
  }
}
