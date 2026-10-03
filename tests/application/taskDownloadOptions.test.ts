import { describe, expect, it } from 'vitest';
import { displayFormats, resolveTaskDownloadOptions } from '../../src/application/taskDownloadOptions';
const formats = [
  { formatId: '137-hls', width: 1920, height: 1080, fps: 30, vcodec: 'h264', acodec: 'none', ext: 'mp4', protocol: 'm3u8_native', usable: true },
  { formatId: '137', width: 1920, height: 1080, fps: 30, vcodec: 'h264', acodec: 'none', ext: 'mp4', protocol: 'https', usable: true },
  { formatId: '299', width: 1920, height: 1080, fps: 60, vcodec: 'h264', acodec: 'none', ext: 'mp4', protocol: 'https', usable: true },
  { formatId: '140', vcodec: 'none', acodec: 'aac', ext: 'm4a', protocol: 'https', usable: true },
];
describe('per-task format and section options', () => {
  it('keeps different audio languages available', () => {
    const audio = formats[3];
    expect(displayFormats([{ ...audio, language: 'en' }, { ...audio, formatId: '140-zh', language: 'zh' }], true)).toHaveLength(2);
  });
  it('deduplicates equivalent transports without collapsing different frame rates', () => {
    expect(displayFormats(formats, false).map(f => f.formatId)).toEqual(['299', '137']);
  });
  it('resolves an available video stream with audio and a time section', () => {
    expect(resolveTaskDownloadOptions({ formatId: '137', start: '1:00', end: '1:10' }, formats, 'video')).toEqual({ formatSelector: '137+bestaudio', sectionStart: 60, sectionEnd: 70 });
  });
  it('uses the selected audio format without adding another stream', () => {
    expect(resolveTaskDownloadOptions({ formatId: '140' }, formats, 'mp3')).toEqual({ formatSelector: '140' });
  });
  it.each([{ start: '1:90' }, { start: '-1' }, { start: '10', end: '5' }, { formatId: '137;bad' }, { formatId: 'missing' }])('rejects invalid or stale task options', options => {
    expect(() => resolveTaskDownloadOptions(options, formats, 'video')).toThrow();
  });
});
