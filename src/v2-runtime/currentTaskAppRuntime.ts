import type { CurrentExtraArgs } from '../../packages/contracts/src';
import {
  createCurrentTaskRuntime,
  type CurrentTaskRuntime,
  type CurrentTaskRuntimeOptions,
} from './currentTaskRuntime';
import { CurrentTauriMediaAnalyzer } from './currentTauriMediaAnalyzer';
import { TauriDownloadEngine } from './tauriDownloadEngine';
import { createCurrentTaskEffectsPort } from './currentTaskEffects';
import { CurrentTaskNativeLogBridge } from './currentTaskNativeLogs';
import { createCaptureFacade, type CaptureFacade } from './capture/captureFacade';
import type { PrepareCurrentAnalysis } from '../../packages/application/src/current-analysis-service';

export interface CurrentTaskAppRuntimeOptions {
  getGlobalExtraArgs(sourceUrl?: string): CurrentExtraArgs;
  getAnalysisExtraArgs?: PrepareCurrentAnalysis;
  validateDownloadCredential?: CurrentTaskRuntimeOptions['environment']['validateDownloadCredential'];
  getDownloadDir(): string | undefined;
}

export interface CurrentTaskAppRuntime extends CurrentTaskRuntime {
  readonly capture: CaptureFacade;
}

/**
 * Production Vue task runtime composition root.
 * Owns the Tauri download engine, analyzer, effects, native task-log bridge and
 * the thin Resource Capture facade (which owns no task state).
 */
export function createCurrentTaskAppRuntime(
  options: CurrentTaskAppRuntimeOptions,
): CurrentTaskAppRuntime {
  const runtime = createCurrentTaskRuntime({
    engine: new TauriDownloadEngine(),
    analyzer: new CurrentTauriMediaAnalyzer(),
    environment: {
      getGlobalExtraArgs: options.getGlobalExtraArgs,
      getAnalysisExtraArgs: options.getAnalysisExtraArgs,
      validateDownloadCredential: options.validateDownloadCredential,
      getDownloadDir: options.getDownloadDir,
    },
    effectsPort: createCurrentTaskEffectsPort(),
  });
  const nativeLogs = new CurrentTaskNativeLogBridge((attemptId, line) =>
    runtime.tasks.ingestLog(attemptId, line),
  );
  void nativeLogs.ready().catch((error) => {
    console.error('[CurrentTaskAppRuntime] Native log listener failed:', error);
  });

  const capture = createCaptureFacade({ runtime });

  return {
    ...runtime,
    capture,
    async dispose() {
      // Stop discovery and release native capture material before the task
      // runtime goes away; claimed contexts are revoked natively on stop/exit.
      try {
        await capture.stop();
      } catch (error) {
        console.error('[CurrentTaskAppRuntime] Capture stop failed:', error);
      }
      await capture.dispose();
      await nativeLogs.dispose();
      await runtime.dispose();
    },
  };
}
