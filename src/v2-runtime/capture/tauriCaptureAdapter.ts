import type {
  CaptureClaimOutcome,
  CapturedResourceSummary,
  CaptureSessionInfo,
  CaptureSessionStatus,
} from '../../../packages/contracts/src';
import {
  parseCaptureClaimOutcome,
  parseCapturedResourceSummaries,
  parseCaptureSessionInfo,
  parseCaptureSessionStatus,
  type CapturePort,
} from '../../../packages/application/src';
import { safeInvoke, safeListen } from '../../utils/tauri';

interface CaptureAdapterDeps {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  listen(event: string, handler: (payload: unknown) => void): Promise<() => void>;
  isNativeRuntime(): boolean;
}

const defaultDeps: CaptureAdapterDeps = {
  invoke(command, args) {
    return safeInvoke(command, args);
  },
  async listen(event, handler) {
    return safeListen<unknown>(event, (message) => handler(message.payload));
  },
  isNativeRuntime() {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  },
};

/**
 * Native Resource Capture adapter.
 *
 * Every payload is validated by the frontend-safe guards before it can reach
 * Vue state: a raw URL, query string, Cookie, Authorization or unexpected
 * native field fails closed instead of rendering.
 */
export class TauriCaptureAdapter implements CapturePort {
  private readonly listeners = new Set<(resources: CapturedResourceSummary[]) => void>();
  private readonly sessionListeners = new Set<(status: CaptureSessionStatus) => void>();
  private unlisten: (() => void) | null = null;
  private unlistenSession: (() => void) | null = null;
  private listenPromise: Promise<void> | null = null;
  private sessionListenPromise: Promise<void> | null = null;
  private lastSnapshot: CapturedResourceSummary[] = [];
  private sessionStatus: CaptureSessionStatus = { active: false };

  constructor(private readonly deps: CaptureAdapterDeps = defaultDeps) {}

  async start(openUrl?: string): Promise<CaptureSessionInfo> {
    this.assertNative();
    const payload = await this.deps.invoke('capture_start', {
      openUrl: openUrl ?? null,
    });
    return parseCaptureSessionInfo(payload);
  }

  async stop(): Promise<void> {
    this.assertNative();
    await this.deps.invoke('capture_stop');
  }

  async list(): Promise<CapturedResourceSummary[]> {
    this.assertNative();
    const payload = await this.deps.invoke('capture_list');
    this.lastSnapshot = parseCapturedResourceSummaries(payload);
    return this.lastSnapshot.map((resource) => ({ ...resource }));
  }

  async claim(resourceId: string): Promise<CaptureClaimOutcome> {
    this.assertNative();
    const payload = await this.deps.invoke('capture_claim', { resourceId });
    return parseCaptureClaimOutcome(payload);
  }

  async release(contextId: string): Promise<void> {
    this.assertNative();
    await this.deps.invoke('capture_release', { contextId });
  }

  async revoke(contextId: string): Promise<void> {
    this.assertNative();
    await this.deps.invoke('capture_revoke', { contextId });
  }

  async dispose(): Promise<void> {
    this.assertNative();
    await this.deps.invoke('capture_dispose');
  }

  subscribe(listener: (resources: readonly CapturedResourceSummary[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.lastSnapshot.map((resource) => ({ ...resource })));
    void this.ensureListening();

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.releaseListener();
      }
    };
  }

  subscribeSession(listener: (status: CaptureSessionStatus) => void): () => void {
    this.sessionListeners.add(listener);
    listener(this.sessionStatus);
    void this.ensureSessionListening();
    return () => {
      this.sessionListeners.delete(listener);
      if (this.sessionListeners.size === 0) {
        this.releaseSessionListener();
      }
    };
  }

  private async ensureSessionListening(): Promise<void> {
    if (this.sessionListenPromise || this.sessionListeners.size === 0) return;
    this.sessionListenPromise = this.deps
      .listen('capture-session', (payload) => {
        // Session publication fails closed as well.
        let status: CaptureSessionStatus;
        try {
          status = parseCaptureSessionStatus(payload);
        } catch (error) {
          console.error('[TauriCaptureAdapter] Rejected a capture session update', error);
          return;
        }
        this.sessionStatus = status;
        for (const listener of this.sessionListeners) {
          listener({ ...status });
        }
      })
      .then((unlisten) => {
        if (this.sessionListeners.size === 0) {
          unlisten();
          this.sessionListenPromise = null;
          return;
        }
        this.unlistenSession = unlisten;
      })
      .catch((error) => {
        this.sessionListenPromise = null;
        console.error('[TauriCaptureAdapter] Failed to install the session listener', error);
      });
    await this.sessionListenPromise;
  }

  private assertNative(): void {
    if (!this.deps.isNativeRuntime()) {
      throw new Error('Resource Capture requires the native runtime');
    }
  }

  private async ensureListening(): Promise<void> {
    if (this.listenPromise || this.listeners.size === 0) return;
    this.listenPromise = this.deps
      .listen('capture-resources', (payload) => {
        // Publications fail closed: an unsafe or malformed native payload is
        // dropped and logged instead of reaching Vue state or crashing the app.
        let resources: CapturedResourceSummary[];
        try {
          resources = parseCapturedResourceSummaries(payload);
        } catch (error) {
          console.error('[TauriCaptureAdapter] Rejected a capture update', error);
          return;
        }
        this.lastSnapshot = resources;
        for (const listener of this.listeners) {
          listener(resources.map((resource) => ({ ...resource })));
        }
      })
      .then((unlisten) => {
        if (this.listeners.size === 0) {
          unlisten();
          this.listenPromise = null;
          return;
        }
        this.unlisten = unlisten;
      })
      .catch((error) => {
        this.listenPromise = null;
        console.error('[TauriCaptureAdapter] Failed to install the capture listener', error);
      });
    await this.listenPromise;
  }

  private releaseListener(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.listenPromise = null;
  }

  private releaseSessionListener(): void {
    this.unlistenSession?.();
    this.unlistenSession = null;
    this.sessionListenPromise = null;
  }
}
