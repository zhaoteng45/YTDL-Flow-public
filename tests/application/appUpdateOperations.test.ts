import { describe, expect, it } from 'vitest';
import { createAppUpdateOperations } from '../../src/application/appUpdateOperations';

describe('app update operations seam', () => {
  it('reports latest when no update is available', async () => {
    const operations = createAppUpdateOperations({
      check: async () => null,
      relaunch: async () => {
        throw new Error('must not relaunch');
      },
    });

    await expect(operations.run()).resolves.toEqual({ status: 'latest' });
  });

  it('owns download/install/relaunch flow and emits normalized progress', async () => {
    const progress: unknown[] = [];
    let relaunched = false;
    const operations = createAppUpdateOperations({
      check: async () => ({
        version: '2.0.0',
        downloadAndInstall: async (listener) => {
          listener({ event: 'Started', data: { contentLength: 1024 } });
        },
      }),
      relaunch: async () => {
        relaunched = true;
      },
    });

    await expect(operations.run((event) => progress.push(event))).resolves.toEqual({
      status: 'installed',
      version: '2.0.0',
    });
    expect(progress).toEqual([
      { phase: 'downloading', version: '2.0.0', totalBytes: null },
      { phase: 'downloading', version: '2.0.0', totalBytes: 1024 },
      { phase: 'restarting', version: '2.0.0' },
    ]);
    expect(relaunched).toBe(true);
  });
});
