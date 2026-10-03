import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { disposeTaskRuntimeWithRetry } from '../../src/appWiring.helpers';

const appSource = readFileSync(resolve('src/App.vue'), 'utf8');

describe('candidate runtime disposal barrier', () => {
  it('retries one transient disposal failure before returning', async () => {
    const dispose = vi.fn()
      .mockRejectedValueOnce(new Error('cancel transport unavailable'))
      .mockResolvedValueOnce(undefined);

    await disposeTaskRuntimeWithRetry({ dispose });

    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the first disposal succeeds', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);

    await disposeTaskRuntimeWithRetry({ dispose });

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('surfaces the final error after the bounded retry is exhausted', async () => {
    const dispose = vi.fn().mockRejectedValue(new Error('still unavailable'));

    await expect(disposeTaskRuntimeWithRetry({ dispose })).rejects.toThrow('still unavailable');
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('releases the canonical row subscription before async disposal without a retired click listener', () => {
    const stopRows = appSource.indexOf('stopTaskRows()');
    const disposalAwait = appSource.indexOf('await disposeTaskRuntimeWithRetry(taskRuntime)');

    expect(stopRows).toBeGreaterThan(-1);
    expect(stopRows).toBeLessThan(disposalAwait);
    expect(appSource).not.toContain('globalClickHandler');
  });
});
