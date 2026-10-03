import type { YouTubeFormatCapability } from '../../packages/contracts/src';
import type { ExtraArgs, DownloadFormat } from '../types';
export interface TaskDownloadOptions { formatId?: string; start?: string; end?: string }
export function displayFormats(formats: readonly YouTubeFormatCapability[], audio: boolean) {
  const groups = new Map<string, YouTubeFormatCapability>();
  for (const f of formats) {
    if (!f.usable || f.hasDrm || !f.formatId || (audio ? f.vcodec !== 'none' || !f.acodec || f.acodec === 'none' : !f.vcodec || f.vcodec === 'none')) continue;
    const key = JSON.stringify([f.width, f.height, f.fps, f.dynamicRange, f.vcodec, f.acodec, f.ext, f.bitrate, f.language]);
    const previous = groups.get(key);
    if (!previous || (['https', 'http'].includes(f.protocol ?? '') && !['https', 'http'].includes(previous.protocol ?? ''))) groups.set(key, f);
  }
  return [...groups.values()].sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.fps ?? 0) - (a.fps ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0) || a.formatId.localeCompare(b.formatId));
}
function seconds(input?: string): number | undefined {
  if (!input?.trim()) return undefined;
  const parts = input.trim().split(':');
  if (parts.length > 3 || parts.some(p => !/^\d+(?:\.\d+)?$/.test(p)) || parts.slice(1).some(p => Number(p) >= 60)) throw new Error('TASK_SECTION_INVALID');
  const total = parts.reduce((value, part) => value * 60 + Number(part), 0);
  if (!Number.isFinite(total)) throw new Error('TASK_SECTION_INVALID');
  return total;
}
export function resolveTaskDownloadOptions(options: TaskDownloadOptions, formats: readonly YouTubeFormatCapability[], format: DownloadFormat): Partial<ExtraArgs> {
  const result: Partial<ExtraArgs> = {};
  if (options.formatId) {
    const audio = ['audio', 'mp3', 'm4a', 'flac', 'opus'].includes(format);
    const selected = formats.find(f => f.formatId === options.formatId && f.usable && !f.hasDrm);
    if (!selected || !/^[\w.-]+$/.test(selected.formatId) || (audio ? selected.vcodec !== 'none' : !selected.vcodec || selected.vcodec === 'none')) throw new Error('TASK_FORMAT_UNAVAILABLE');
    result.formatSelector = selected.formatId + (!audio && selected.acodec === 'none' ? '+bestaudio' : '');
  }
  const start = seconds(options.start);
  const end = seconds(options.end);
  if (end !== undefined && end <= (start ?? 0)) throw new Error('TASK_SECTION_INVALID');
  if (start !== undefined || end !== undefined) {
    result.sectionStart = start ?? 0;
    if (end !== undefined) result.sectionEnd = end;
  }
  return result;
}
