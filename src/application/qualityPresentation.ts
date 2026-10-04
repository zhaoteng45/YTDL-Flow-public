import type { VideoMetadata } from '../types';

export function qualityMessage(metadata: Pick<VideoMetadata, 'observedMaxHeight' | 'smartDecision' | 'width' | 'height'>, requested?: string) {
  const observed = metadata.observedMaxHeight ?? 0;
  const ceiling = Number.parseInt(requested ?? '', 10);
  if ((!Number.isFinite(ceiling) || ceiling <= observed) && metadata.width && metadata.height &&
      metadata.height > metadata.width && metadata.height === observed) {
    return { key: 'download_list.quality.observed_portrait', params: { resolution: `${metadata.width}×${metadata.height}` } };
  }
  return Number.isFinite(ceiling) && ceiling > observed
    ? { key: 'download_list.quality.request_limited', params: { requested: ceiling, observed } }
    : { key: 'download_list.quality.observed', params: { observed } };
}
