import { redactSensitiveText } from '../utils/redactSensitiveText';
import { safeListen } from '../utils/tauri';

export type CurrentTaskNativeLogUnlisten = () => void;

export interface CurrentTaskNativeLogBridgeDeps {
  listen(
    event: string,
    handler: (payload: unknown) => void,
  ): Promise<CurrentTaskNativeLogUnlisten>;
}

const defaultDeps: CurrentTaskNativeLogBridgeDeps = {
  async listen(event, handler) {
    return safeListen<unknown>(event, (message) => handler(message.payload));
  },
};

export type CurrentTaskLogIngest = (attemptId: string, line: string) => boolean;

function parseNativeLogPayload(payload: unknown): { id: string; line: string } | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.line !== 'string') return undefined;
  return { id: record.id, line: record.line };
}

export class CurrentTaskNativeLogBridge {
  private unlisten: CurrentTaskNativeLogUnlisten | null = null;
  private releaseRequested = false;
  private installError: unknown;
  private readonly installPromise: Promise<void>;

  constructor(
    private readonly ingest: CurrentTaskLogIngest,
    private readonly deps: CurrentTaskNativeLogBridgeDeps = defaultDeps,
  ) {
    this.installPromise = this.install().catch((error) => {
      this.installError = error;
    });
  }

  async ready(): Promise<void> {
    await this.installPromise;
    if (this.installError !== undefined) {
      throw this.installError;
    }
  }

  async dispose(): Promise<void> {
    if (this.releaseRequested) {
      await this.installPromise;
      return;
    }
    this.releaseRequested = true;
    await this.installPromise;

    const unlisten = this.unlisten;
    this.unlisten = null;
    unlisten?.();
  }

  private async install(): Promise<void> {
    const unlisten = await this.deps.listen('analysis-log', (payload) => {
      const parsed = parseNativeLogPayload(payload);
      if (!parsed || this.releaseRequested) return;
      this.ingest(parsed.id, redactSensitiveText(parsed.line));
    });

    if (this.releaseRequested) {
      unlisten();
      return;
    }

    this.unlisten = unlisten;
  }
}
