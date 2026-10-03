import type { AnalyzedMedia } from '../../contracts/src';

/**
 * Narrow Application metadata port. Metadata analysis is a stateless
 * pre-task use case: no repository, no analysis entity and no analysis
 * state machine exist for Stage 3.
 */
export interface MediaAnalyzer {
  analyze(sourceUrl: string): Promise<AnalyzedMedia>;
}

export type MediaAnalysisErrorCode =
  | 'metadata-command-failed'
  | 'invalid-native-response'
  | 'playlist-not-supported'
  | 'native-runtime-unavailable';

/**
 * Adapters reject with this error so the product use case can translate
 * native failures into ErrorPayload without leaking DTO/runtime details.
 */
export class MediaAnalysisError extends Error {
  readonly code: MediaAnalysisErrorCode;

  constructor(code: MediaAnalysisErrorCode, message: string) {
    super(message);
    this.name = 'MediaAnalysisError';
    this.code = code;
  }
}
