import type {
  CaptureClaimOutcome,
  CapturedResourceSummary,
  CaptureSessionInfo,
  CaptureSessionStatus,
} from '../../contracts/src';
import type { CapturePort } from '../src/capture-port';

export interface FakeCapturePortOptions {
  browserName?: string;
}

/**
 * Deterministic in-memory CapturePort used by Application tests.
 *
 * It mirrors the native contract that matters for tests: explicit start/stop,
 * sanitized summaries only, claims that consume a discovered resource and a
 * claim outcome that is typed instead of string-matched.
 */
export class FakeCapturePort implements CapturePort {
  private readonly listeners = new Set<(resources: readonly CapturedResourceSummary[]) => void>();
  private readonly sessionListeners = new Set<(status: CaptureSessionStatus) => void>();
  private readonly resources: CapturedResourceSummary[] = [];
  private readonly claimedContextIds = new Set<string>();
  private readonly browserName: string;
  private session: CaptureSessionInfo | null = null;
  private sequence = 0;
  private contextSequence = 0;

  constructor(options: FakeCapturePortOptions = {}) {
    this.browserName = options.browserName ?? 'msedge';
  }

  async start(): Promise<CaptureSessionInfo> {
    if (this.session) {
      throw new Error('capture session already active');
    }
    this.sequence = 0;
    this.resources.length = 0;
    this.session = {
      captureId: `capture-${this.contextSequence + 1}`,
      browserName: this.browserName,
      profileIsolated: true,
    };
    this.publish();
    return this.session;
  }

  async stop(): Promise<void> {
    this.session = null;
    this.resources.length = 0;
    this.publish();
  }

  async list(): Promise<CapturedResourceSummary[]> {
    return this.resources.map((resource) => ({ ...resource }));
  }

  async claim(resourceId: string): Promise<CaptureClaimOutcome> {
    if (!this.session) {
      return { type: 'captureInactive' };
    }
    const index = this.resources.findIndex((resource) => resource.resourceId === resourceId);
    if (index === -1) {
      return { type: 'notFound' };
    }

    const [resource] = this.resources.splice(index, 1);
    if (resource.requiresAuthenticatedReplay) {
      this.resources.splice(index, 0, resource);
      return { type: 'authenticatedReplayRequired' };
    }

    this.contextSequence += 1;
    const contextId = `context-${this.contextSequence}`;
    this.claimedContextIds.add(contextId);
    this.publish();
    return { type: 'claimed', contextId, resource: { ...resource } };
  }

  async release(contextId: string): Promise<void> {
    this.claimedContextIds.delete(contextId);
  }

  async revoke(contextId: string): Promise<void> {
    this.claimedContextIds.delete(contextId);
  }

  subscribe(listener: (resources: readonly CapturedResourceSummary[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.resources.map((resource) => ({ ...resource })));
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeSession(listener: (status: CaptureSessionStatus) => void): () => void {
    this.sessionListeners.add(listener);
    listener(this.sessionStatus());
    return () => {
      this.sessionListeners.delete(listener);
    };
  }

  private sessionStatus(): CaptureSessionStatus {
    return this.session
      ? {
          active: true,
          captureId: this.session.captureId,
          browserName: this.session.browserName,
        }
      : { active: false };
  }

  /** Test-only seeding of a sanitized discovery result. */
  emitResource(input: Omit<CapturedResourceSummary, 'captureId' | 'resourceNumber'>): void {
    if (!this.session) {
      throw new Error('cannot emit a resource without an active capture session');
    }
    this.sequence += 1;
    this.resources.push({
      ...input,
      captureId: this.session.captureId,
      resourceNumber: this.sequence,
    });
    this.publish();
  }

  activeContextCount(): number {
    return this.claimedContextIds.size;
  }

  private publish(): void {
    const snapshot = this.resources.map((resource) => ({ ...resource }));
    for (const listener of this.listeners) {
      listener(snapshot);
    }
    const status = this.sessionStatus();
    for (const listener of this.sessionListeners) {
      listener(status);
    }
  }
}
