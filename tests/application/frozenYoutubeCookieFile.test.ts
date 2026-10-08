import { describe, expect, it, vi } from 'vitest';
import type { DownloadStartRequest } from '../../packages/contracts/src';
import { validateFrozenYouTubeCookieFile } from '../../src/application/platformCredentials';
import { getDownloadRecovery } from '../../src/application/downloadRecovery';

const ytUrl = 'https://www.youtube.com/watch?v=fixture';
const fileRef = 'C:/fixtures/youtube-file.txt';
function request(url = ytUrl, cookies: string | undefined = fileRef): DownloadStartRequest {
  return {
    taskId: 'fixture-attempt',
    downloadType: 'video',
    sourceUrl: url,
    extraArgs: { cookies },
  };
}

describe('A11 frozen YouTube file preflight', () => {
  it('checks only the frozen file reference and accepts an imported file', async () => {
    const inspectCookieFile = vi.fn(async () => ({ state: 'imported' as const, total: 2, matching: 2, fresh: 2 }));
    await validateFrozenYouTubeCookieFile(request(), { inspectCookieFile });
    expect(inspectCookieFile).toHaveBeenCalledExactlyOnceWith(fileRef, 'https://www.youtube.com/');
  });

  it.each(['invalid', 'expired', 'mismatch'] as const)('fails closed on a %s file with a safe error', async (state) => {
    const inspectCookieFile = vi.fn(async () => ({ state, total: 2, matching: 0, fresh: 0 }));
    await expect(validateFrozenYouTubeCookieFile(request(), { inspectCookieFile })).rejects.toThrow('COOKIE_FILE_REANALYSIS_REQUIRED');
    expect(inspectCookieFile).toHaveBeenCalledTimes(1);
  });

  it('hides native exceptions instead of leaking the file path into the error', async () => {
    const inspectCookieFile = vi.fn(async (): Promise<never> => { throw new Error('sensitive local path'); });
    await expect(validateFrozenYouTubeCookieFile(request(), { inspectCookieFile })).rejects.toThrow(/^COOKIE_FILE_REANALYSIS_REQUIRED$/);
  });

  it('routes invalid queued file errors to credential settings instead of a blind download retry', () => {
    expect(getDownloadRecovery('COOKIE_FILE_REANALYSIS_REQUIRED')).toMatchObject({
      kind: 'cookieFile', action: 'credentials',
    });
  });

  it('skips browsers, anonymous, another platform and captured contexts', async () => {
    const inspectCookieFile = vi.fn(async () => ({ state: 'imported' as const, total: 2, matching: 2, fresh: 2 }));
    const operations = { inspectCookieFile };
    await validateFrozenYouTubeCookieFile(request(ytUrl, 'edge'), operations);
    await validateFrozenYouTubeCookieFile(request(ytUrl, ''), operations);
    await validateFrozenYouTubeCookieFile(request('https://www.bilibili.com/video/BV1', fileRef), operations);
    await validateFrozenYouTubeCookieFile({ taskId: 'captured', downloadType: 'video', captureContextId: 'opaque', extraArgs: { cookies: fileRef } }, operations);
    expect(inspectCookieFile).not.toHaveBeenCalled();
  });
});
