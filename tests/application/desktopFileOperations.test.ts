import { describe, expect, it } from 'vitest';
import { createDesktopFileOperations } from '../../src/application/desktopFileOperations';

describe('desktop file operations seam', () => {
  it('owns download-directory, cookie-file and open behaviors', async () => {
    const dialogs: unknown[] = [];
    const opened: string[] = [];
    const nativeCalls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const dialogResults = [
      'C:/Downloads',
      'C:/cookies/cookies.txt',
    ];

    const operations = createDesktopFileOperations({
      openDialog: async (options) => {
        dialogs.push(options);
        return dialogResults.shift() ?? null;
      },
      openExternal: async (url) => {
        opened.push(url);
      },
      getSystemDownloadDir: async () => 'C:/Users/test/Downloads',
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        nativeCalls.push({ command, args });
        return undefined as T;
      },
    });

    await expect(operations.getSystemDownloadDirectory()).resolves.toBe('C:/Users/test/Downloads');
    await expect(operations.chooseDownloadDirectory('Select dir', 'C:/Old')).resolves.toBe('C:/Downloads');
    await expect(operations.chooseCookieFile('Select Cookies')).resolves.toBe('C:/cookies/cookies.txt');
    await operations.openExternalUrl('https://example.com/help');
    await operations.openFile('C:/Downloads/video.mp4', 'C:/Downloads');
    await operations.openFileLocation('C:/Downloads/video.mp4', 'C:/Downloads');

    expect(opened).toEqual(['https://example.com/help']);
    expect(nativeCalls).toEqual([
      {
        command: 'open_file',
        args: { path: 'C:/Downloads/video.mp4', baseDir: 'C:/Downloads' },
      },
      {
        command: 'open_file_location',
        args: { path: 'C:/Downloads/video.mp4', baseDir: 'C:/Downloads' },
      },
    ]);
    expect(dialogs).toEqual([
      { directory: true, multiple: false, title: 'Select dir', defaultPath: 'C:/Old' },
      {
        multiple: false,
        filters: [
          { name: 'Cookie Files (*.txt, *.json)', extensions: ['txt', 'json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        title: 'Select Cookies',
      },
    ]);
  });

  it('returns null when a cookie file picker is cancelled', async () => {
    const operations = createDesktopFileOperations({
      openDialog: async () => null,
      openExternal: async () => {},
      getSystemDownloadDir: async () => null,
      invoke: async <T>() => undefined as T,
    });

    await expect(operations.chooseCookieFile('Cookies')).resolves.toBeNull();
  });
});
