export type ManagedTool = 'ytdlp' | 'ffmpeg' | 'bun';

export interface ToolchainInfo {
  ytdlp: string;
  ffmpeg: string;
  bun: string;
}

export type NativeInvoker = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export interface ToolchainOperations {
  inspectHealth(): Promise<ToolHealth>;
  checkZombieProcesses(): Promise<number>;
  killZombieProcesses(): Promise<number>;
  checkDependencies(): Promise<boolean>;
  getAppVersion(): Promise<string>;
  getBinariesInfo(): Promise<ToolchainInfo>;
  updateTool(tool: ManagedTool): Promise<string>;
}

export type ToolHealth = { state: 'ready'; zombieCount: number } | { state: 'busy'; activeOperations: number };

const UPDATE_COMMANDS: Record<ManagedTool, string> = {
  ytdlp: 'update_ytdlp',
  ffmpeg: 'update_ffmpeg',
  bun: 'update_bun',
};

export function createToolchainOperations(invoke: NativeInvoker): ToolchainOperations {
  return {
    inspectHealth: () => invoke<ToolHealth>('inspect_tool_health'),
    checkZombieProcesses: () => invoke<number>('check_zombie_processes'),
    killZombieProcesses: () => invoke<number>('kill_zombies'),
    checkDependencies: () => invoke<boolean>('check_dependencies'),
    getAppVersion: () => invoke<string>('get_app_version'),
    getBinariesInfo: () => invoke<ToolchainInfo>('get_binaries_info'),
    updateTool: (tool) => {
      const command = UPDATE_COMMANDS[tool];
      if (!command) {
        return Promise.reject(new Error(`Unsupported managed tool: ${String(tool)}`));
      }
      return invoke<string>(command);
    },
  };
}
