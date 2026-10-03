import type { NativeInvoker } from './toolchainOperations';

export interface FileDialogFilter {
  name: string;
  extensions: string[];
}

export interface FileDialogOptions {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: FileDialogFilter[];
}

interface DesktopFileDependencies {
  openDialog(options: FileDialogOptions): Promise<string | string[] | null>;
  openExternal(url: string): Promise<void>;
  getSystemDownloadDir(): Promise<string | null>;
  invoke: NativeInvoker;
}

export interface DesktopFileOperations {
  getSystemDownloadDirectory(): Promise<string | null>;
  chooseDownloadDirectory(title: string, defaultPath?: string): Promise<string | null>;
  chooseCookieFile(title: string): Promise<string | null>;
  openExternalUrl(url: string): Promise<void>;
  openFile(path: string, baseDir?: string): Promise<void>;
  openFileLocation(path: string, baseDir?: string): Promise<void>;
}

function singlePath(value: string | string[] | null): string | null {
  return typeof value === 'string' ? value : null;
}

export function createDesktopFileOperations(
  deps: DesktopFileDependencies,
): DesktopFileOperations {
  return {
    getSystemDownloadDirectory: () => deps.getSystemDownloadDir(),
    async chooseDownloadDirectory(title, defaultPath) {
      return singlePath(await deps.openDialog({
        directory: true,
        multiple: false,
        title,
        defaultPath,
      }));
    },
    async chooseCookieFile(title) {
      return singlePath(await deps.openDialog({
        multiple: false,
        filters: [
          { name: 'Cookie Files (*.txt, *.json)', extensions: ['txt', 'json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        title,
      }));
    },
    openExternalUrl: (url) => deps.openExternal(url),
    openFile: (path, baseDir) =>
      deps.invoke<void>('open_file', { path, baseDir }),
    openFileLocation: (path, baseDir) =>
      deps.invoke<void>('open_file_location', { path, baseDir }),
  };
}
