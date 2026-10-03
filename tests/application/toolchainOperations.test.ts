import { describe, expect, it } from 'vitest';
import { createToolchainOperations } from '../../src/application/toolchainOperations';

describe('toolchain operations seam', () => {
  it('returns typed busy health while retaining genuine inspection errors', async () => {
    const operations = createToolchainOperations(async <T>() => ({ state: 'busy', activeOperations: 2 }) as T);
    await expect(operations.inspectHealth()).resolves.toEqual({ state: 'busy', activeOperations: 2 });
    const failed = createToolchainOperations(async () => { throw new Error('inspection denied'); });
    await expect(failed.inspectHealth()).rejects.toThrow('inspection denied');
  });
  it('hides native command names behind user-level toolchain operations', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const responses: Record<string, unknown> = {
      check_zombie_processes: 2,
      kill_zombies: 2,
      check_dependencies: true,
      get_app_version: '1.2.3',
      get_binaries_info: { ytdlp: '2026.09.21', ffmpeg: '7.1', bun: '1.4.2' },
      update_ytdlp: 'yt-dlp updated',
      update_ffmpeg: 'ffmpeg updated',
      update_bun: 'bun updated',
    };

    const operations = createToolchainOperations(async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return responses[command] as T;
    });

    await expect(operations.checkZombieProcesses()).resolves.toBe(2);
    await expect(operations.killZombieProcesses()).resolves.toBe(2);
    await expect(operations.checkDependencies()).resolves.toBe(true);
    await expect(operations.getAppVersion()).resolves.toBe('1.2.3');
    await expect(operations.getBinariesInfo()).resolves.toEqual(responses.get_binaries_info);
    await expect(operations.updateTool('ytdlp')).resolves.toBe('yt-dlp updated');
    await expect(operations.updateTool('ffmpeg')).resolves.toBe('ffmpeg updated');
    await expect(operations.updateTool('bun')).resolves.toBe('bun updated');
    await expect(operations.updateTool('deno' as never)).rejects.toThrow(/unsupported managed tool/i);

    expect(calls.map((call) => call.command)).toEqual([
      'check_zombie_processes',
      'kill_zombies',
      'check_dependencies',
      'get_app_version',
      'get_binaries_info',
      'update_ytdlp',
      'update_ffmpeg',
      'update_bun',
    ]);
  });
});
