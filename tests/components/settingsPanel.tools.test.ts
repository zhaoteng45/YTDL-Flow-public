import { describe, expect, it } from 'vitest';
import { createToolOperationQueue, toolVersionDisplay } from '../../src/components/settingsPanel.tools';

describe('settings tool operations', () => {
  it('coalesces duplicate requests and waits for version activity before inspecting health', async () => {
    const run = createToolOperationQueue();
    const calls: string[] = [];
    let release!: () => void;
    const versions = run('versions', async () => { calls.push('versions'); await new Promise<void>(resolve => { release = resolve; }); });
    const duplicate = run('versions', async () => { throw new Error('duplicate'); });
    const health = run('health', async () => { calls.push('health'); return 'ready'; });
    expect(duplicate).toBe(versions);
    await Promise.resolve();
    expect(calls).toEqual(['versions']);
    release();
    await versions;
    expect(await health).toBe('ready');
    expect(calls).toEqual(['versions', 'health']);
  });
  it('continues after a failed query and permits an explicit retry', async () => {
    const run = createToolOperationQueue();
    await expect(run('versions', async () => { throw new Error('unavailable'); })).rejects.toThrow('unavailable');
    expect(await run('health', async () => 'ready')).toBe('ready');
    expect(await run('versions', async () => 'installed')).toBe('installed');
  });
  it('distinguishes unavailable versions and retains complete build details', () => {
    for (const value of ['', 'Unknown', 'Not Found', ' unknown ']) expect(toolVersionDisplay(value).available).toBe(false);
    expect(toolVersionDisplay('9.0.2-essentials_build-www.gyan.dev')).toEqual({available: true, label: '9.0.2', full: '9.0.2-essentials_build-www.gyan.dev'});
    expect(toolVersionDisplay('2026.08.19').label).toBe('2026.08.19');
  });
  it('keeps prerelease identity visible instead of reporting a stable release', () => {
    expect(toolVersionDisplay('1.4.3-canary.12').label).toBe('1.4.3-canary.12');
    expect(toolVersionDisplay('2026.10.04-nightly').label).toBe('2026.10.04-nightly');
  });
});
