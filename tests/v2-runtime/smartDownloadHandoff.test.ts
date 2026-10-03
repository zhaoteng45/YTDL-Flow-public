import { describe, expect, it, vi } from 'vitest';
import { CurrentTauriMediaAnalyzer } from '../../src/v2-runtime/currentTauriMediaAnalyzer';
import { TauriDownloadEngine } from '../../src/v2-runtime/tauriDownloadEngine';
import { createCurrentTaskRuntime } from '../../src/v2-runtime/currentTaskRuntime';

const url = 'https://www.youtube.com/watch?v=F24wItiYYNs';
const decision = { playerClient: 'web', maxHeight: 1080, authMode: 'anonymous' as const, potMode: 'unknown' as const, reason: 'usable inventory', clearSessionInputs: true };
function setup(fail = false, authMode: 'anonymous' | 'cookies' = 'anonymous') {
  const starts: Record<string, unknown>[] = [];
  const handlers = new Map<string, (payload: unknown) => void>();
  const engine = new TauriDownloadEngine({
    async listen(event, handler) { handlers.set(event, handler); return () => handlers.delete(event); },
    async invoke(command, args) {
      if (command === 'start_download') {
        starts.push(args!);
        if (fail) throw { message: 'SMART_DECISION_REQUIRED: analyze the URL before downloading', executionMayExist: false };
      }
    },
  });
  const runtime = createCurrentTaskRuntime({
    engine,
    analyzer: new CurrentTauriMediaAnalyzer({ isNativeRuntime: () => true, async invoke() {
      return { title: 'Video', thumbnail: '', duration: '32:43', channel: 'Channel', url, smartDecision: { ...decision, authMode, clearSessionInputs: authMode === 'anonymous' }, requestedResolution: '1080', observedMaxHeight: 1080 };
    } }),
    environment: { getGlobalExtraArgs: () => ({ playerClient: 'smart', cookies: 'fixture-cookies.json', poToken: 'fixture', visitorData: 'fixture' }), getDownloadDir: () => undefined },
    effectsPort: { playSuccess: vi.fn(), playError: vi.fn(), setTaskbar: vi.fn() },
    downloadServiceOptions: { settlementDelayMs: 0 },
  });
  return { runtime, starts, handlers };
}
describe('native SMART download handoff', () => {
  it('keeps cookies for a winner that requires the analyzed cookie identity', async () => {
    const { runtime, starts } = setup(false, 'cookies');
    try {
      const handle = runtime.tasks.analyze(url);
      await handle.result;
      await runtime.tasks.start(handle.rowId);
      await vi.waitFor(() => expect(starts).toHaveLength(1));
      expect(starts[0].extraArgs).toMatchObject({ playerClient: 'web', cookies: 'fixture-cookies.json', smartDecision: { authMode: 'cookies' } });
    } finally { await runtime.dispose(); }
  });
  it('preserves the native winner through the real analyzer, runtime, engine and retry', async () => {
    const { runtime, starts, handlers } = setup();
    try {
      const handle = runtime.tasks.analyze(url);
      await handle.result;
      expect(runtime.listRows()[0].metadata).toMatchObject({ smartDecision: decision, observedMaxHeight: 1080, requestedResolution: '1080' });
      await runtime.tasks.start(handle.rowId);
      await vi.waitFor(() => expect(starts).toHaveLength(1));
      expect(starts[0].extraArgs).toMatchObject({ playerClient: 'web', smartDecision: decision, cookies: '', poToken: '', visitorData: '' });
      handlers.get('download-result')?.({ id: starts[0].id, outcome: 'failed', error: 'network' });
      await runtime.tasks.retry(handle.rowId);
      await vi.waitFor(() => expect(starts).toHaveLength(2));
      expect(starts[1].extraArgs).toMatchObject({ playerClient: 'web', smartDecision: decision, cookies: '' });
    } finally { await runtime.dispose(); }
  });
  it('shows the terminal failure in the log panel even when native execution produced no log event', async () => {
    const { runtime } = setup(true);
    try {
      const handle = runtime.tasks.analyze(url);
      await handle.result;
      await runtime.tasks.start(handle.rowId);
      await vi.waitFor(() => expect(runtime.listRows()[0].status).toBe('error'));
      expect(runtime.listRows()[0].status).toBe('error');
      expect(runtime.listRows()[0].logs.join('\n')).toContain('SMART_DECISION_REQUIRED');
    } finally { await runtime.dispose(); }
  });
});
