import type { VideoMetadata } from '../types';

export function qualityMessage(metadata: Pick<VideoMetadata, 'observedMaxHeight' | 'smartDecision'>, requested?: string) {
  const observed = metadata.observedMaxHeight ?? 0;
  const ceiling = Number.parseInt(requested ?? '', 10);
  return Number.isFinite(ceiling) && ceiling > observed
    ? { key: 'download_list.quality.request_limited', params: { requested: ceiling, observed } }
    : { key: 'download_list.quality.observed', params: { observed } };
}
