import { describe, expect, it } from 'vitest';

import {
  CurrentTaskNativeLogBridge,
  type CurrentTaskNativeLogBridgeDeps,
} from '../../src/v2-runtime/currentTaskNativeLogs';

type Handler = (payload: unknown) => void;

describe('CurrentTaskNativeLogBridge', () => {
  it('routes native analysis-log payloads to the current task attempt and releases the listener', async () => {
    const handlers = new Map<string, Handler>();
    const ingested: Array<{ attemptId: string; line: string }> = [];
    const deps: CurrentTaskNativeLogBridgeDeps = {
      async listen(event, handler) {
        handlers.set(event, handler);
        return () => handlers.delete(event);
      },
    };

    const bridge = new CurrentTaskNativeLogBridge(
      (attemptId, line) => {
        ingested.push({ attemptId, line });
        return true;
      },
      deps,
    );
    await bridge.ready();

    handlers.get('analysis-log')?.({ id: 'attempt-1', line: 'native output' });
    expect(ingested).toEqual([{ attemptId: 'attempt-1', line: 'native output' }]);

    await bridge.dispose();
    expect(handlers.size).toBe(0);
  });

  it('redacts sensitive URL material before native logs enter current task state', async () => {
    const handlers = new Map<string, Handler>();
    const ingested: string[] = [];
    const bridge = new CurrentTaskNativeLogBridge(
      (_attemptId, line) => {
        ingested.push(line);
        return true;
      },
      {
        async listen(event, handler) {
          handlers.set(event, handler);
          return () => handlers.delete(event);
        },
      },
    );
    await bridge.ready();

    const valueA = ['sensitive', 'a'].join('-');
    const valueB = ['sensitive', 'b'].join('-');
    const valueC = ['sensitive', 'c'].join('-');
    const line = [
      'Starting analysis for: https://alice',
      ':', valueA, '@', 'example.com/watch?v=ok&',
      'to', 'ken=', valueB, '&',
      'sign', 'ature=', valueC,
    ].join('');
    handlers.get('analysis-log')?.({ id: 'attempt-sensitive', line });

    expect(ingested).toHaveLength(1);
    expect(ingested[0]).toContain('v=ok');
    expect(ingested[0]).not.toContain(valueA);
    expect(ingested[0]).not.toContain(valueB);
    expect(ingested[0]).not.toContain(valueC);
    expect(ingested[0]).toContain('<REDACTED>');
    await bridge.dispose();
  });

  it('ignores malformed native log payloads', async () => {
    let handler: Handler | undefined;
    const ingest = (attemptId: string, line: string) => {
      throw new Error(`unexpected ingest ${attemptId} ${line}`);
    };
    const bridge = new CurrentTaskNativeLogBridge(ingest, {
      async listen(_event, next) {
        handler = next;
        return () => {};
      },
    });
    await bridge.ready();

    handler?.({ id: 42, line: 'bad' });
    handler?.({ id: 'attempt', line: null });
    handler?.('bad');

    await bridge.dispose();
  });

  it('reaps a listener that finishes installing after dispose begins', async () => {
    let finishInstall!: (unlisten: () => void) => void;
    let unlistenCalls = 0;
    const deps: CurrentTaskNativeLogBridgeDeps = {
      listen() {
        return new Promise((resolve) => {
          finishInstall = resolve;
        });
      },
    };
    const bridge = new CurrentTaskNativeLogBridge(() => true, deps);

    const disposing = bridge.dispose();
    finishInstall(() => {
      unlistenCalls += 1;
    });
    await disposing;

    expect(unlistenCalls).toBe(1);
  });
});
