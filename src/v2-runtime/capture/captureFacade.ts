import type {
  CaptureClaimOutcome,
  CapturedResourceSummary,
  CaptureSessionStatus,
  CurrentCapturedTaskRef,
} from '../../../packages/contracts/src';
import {
  createCaptureImportFlow,
  type CaptureImportResult,
  type CapturePort,
} from '../../../packages/application/src';
import type { CurrentTaskRuntime } from '../currentTaskRuntime';
import { TauriCaptureAdapter } from './tauriCaptureAdapter';

/**
 * UI-facing Resource Capture facade.
 *
 * It owns no task state: it starts/stops discovery, publishes sanitized
 * summaries and hands a claimed opaque context to CurrentTaskService through
 * the captured-input seam.
 */
export interface CaptureFacade {
  start(openUrl?: string): Promise<void>;
  stop(): Promise<void>;
  importResource(resourceId: string): Promise<CaptureImportResult>;
  revokeRow(row: { capture?: CurrentCapturedTaskRef }): Promise<void>;
  dispose(): Promise<void>;
  list(): Promise<CapturedResourceSummary[]>;
  subscribeResources(listener: (resources: readonly CapturedResourceSummary[]) => void): () => void;
  subscribeSession(listener: (status: CaptureSessionStatus) => void): () => void;
}

export interface CaptureFacadeDependencies {
  runtime: Pick<CurrentTaskRuntime, 'tasks'>;
  port?: CapturePort;
}

export function createCaptureFacade(dependencies: CaptureFacadeDependencies): CaptureFacade {
  const port = dependencies.port ?? new TauriCaptureAdapter();
  const flow = createCaptureImportFlow({
    capture: port,
    analyzeCaptured: (input) => dependencies.runtime.tasks.analyzeCaptured(input),
  });

  return {
    async start(openUrl?: string) {
      await port.start(openUrl);
    },
    async stop() {
      await port.stop();
    },
    async importResource(resourceId: string) {
      return flow.importResource(resourceId);
    },
    async revokeRow(row: { capture?: CurrentCapturedTaskRef }) {
      await flow.revokeRow(row);
    },
    async dispose() {
      await port.dispose();
    },
    async list() {
      return port.list();
    },
    subscribeResources(listener) {
      return port.subscribe(listener);
    },
    subscribeSession(listener) {
      return port.subscribeSession(listener);
    },
  };
}

/** Re-exported so callers can render typed claim rejections. */
export type { CaptureClaimOutcome };
