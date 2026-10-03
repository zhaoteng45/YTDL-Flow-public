import type { AnalyzedMedia } from '../../packages/contracts/src';
import { MediaAnalysisError } from '../../packages/application/src/media-analyzer';
import { redactSensitiveText } from '../utils/redactSensitiveText';
import { isTauri, safeInvoke } from '../utils/tauri';

interface TauriMediaAnalyzerDeps {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  isNativeRuntime(): boolean;
  createRequestId(): string;
}

const defaultDeps: TauriMediaAnalyzerDeps = {
  invoke(command, args) {
    return safeInvoke(command, args);
  },
  isNativeRuntime() {
    return isTauri();
  },
  createRequestId() {
    return `analyze-${crypto.randomUUID()}`;
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const UNKNOWN_CHANNEL = 'Unknown Channel';
const UNKNOWN_DURATION = 'Unknown';

function readOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return redactSensitiveText(error.message || error.name);
  }
  return typeof error === 'string' && error.trim().length > 0
    ? redactSensitiveText(error)
    : '原生元数据命令失败';
}

/**
 * Concrete Application metadata adapter for TICKET-010.
 *
 * It calls the existing `get_video_metadata` command, validates the native
 * response, rejects playlist results and converts the legacy VideoMetadata
 * DTO into the narrow product read model. The native DTO never reaches React.
 */
export class TauriMediaAnalyzer {
  constructor(private readonly deps: TauriMediaAnalyzerDeps = defaultDeps) {}

  async analyze(sourceUrl: string): Promise<AnalyzedMedia> {
    if (!this.deps.isNativeRuntime()) {
      throw new MediaAnalysisError(
        'native-runtime-unavailable',
        '当前环境未运行在 Tauri 原生容器中，无法解析链接',
      );
    }

    let response: unknown;
    try {
      response = await this.deps.invoke('get_video_metadata', {
        url: sourceUrl,
        extraArgs: null,
        id: this.deps.createRequestId(),
      });
    } catch (error) {
      throw new MediaAnalysisError('metadata-command-failed', describeError(error));
    }

    return this.toAnalyzedMedia(response, sourceUrl);
  }

  private toAnalyzedMedia(response: unknown, sourceUrl: string): AnalyzedMedia {
    if (!isRecord(response)) {
      throw new MediaAnalysisError('invalid-native-response', '原生元数据响应格式不正确');
    }

    if (response.entries !== undefined && response.entries !== null) {
      throw new MediaAnalysisError(
        'playlist-not-supported',
        '当前版本仅支持单个视频链接，暂不支持播放列表',
      );
    }

    const title = readOptionalText(response.title);
    if (!title) {
      throw new MediaAnalysisError('invalid-native-response', '原生元数据缺少有效标题');
    }

    if (response.url !== sourceUrl) {
      throw new MediaAnalysisError('invalid-native-response', '原生元数据与请求链接不一致');
    }

    for (const field of ['channel', 'duration', 'thumbnail'] as const) {
      const value = response[field];
      if (value !== undefined && value !== null && typeof value !== 'string') {
        throw new MediaAnalysisError('invalid-native-response', `原生元数据字段类型不正确：${field}`);
      }
    }

    const channel = readOptionalText(response.channel);
    const duration = readOptionalText(response.duration);
    const thumbnail = readOptionalText(response.thumbnail);

    return {
      sourceUrl,
      title,
      ...(channel && channel !== UNKNOWN_CHANNEL ? { channel } : {}),
      ...(duration && duration !== UNKNOWN_DURATION ? { durationLabel: duration } : {}),
      ...(thumbnail ? { thumbnailUrl: thumbnail } : {}),
    };
  }
}
