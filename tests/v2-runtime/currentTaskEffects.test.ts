import { describe, expect, it } from 'vitest';

import type { CurrentTaskbarProjection } from '../../packages/application/src';
import { createCurrentTaskEffectsPort } from '../../src/v2-runtime/currentTaskEffects';

describe('current Tauri task effects adapter', () => {
  it('maps taskbar effects without initializing retired terminal audio', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const port = createCurrentTaskEffectsPort({
      invoke: async (command, args) => {
        calls.push({ command, args });
        return true;
      },
    });

    const taskbar: CurrentTaskbarProjection = { progress: 75, status: 'normal' };

    await port.setTaskbar(taskbar);
    await port.playSuccess();
    await port.playError();

    expect(calls).toEqual([
      { command: 'set_taskbar_progress', args: taskbar },
    ]);
    expect(Object.keys(port).sort()).toEqual([
      'playError',
      'playSuccess',
      'setTaskbar',
    ]);
  });
});
