import type { TaskPayload } from '@ytdl-flow/contracts';
import {
  DownloadProductService,
  DownloadService,
  TaskQueryService,
} from '@ytdl-flow/application';
import { DownloadQueue } from '@ytdl-flow/domain';
import { TauriDownloadEngine } from '@v2-runtime/tauriDownloadEngine';
import { TauriMediaAnalyzer } from '@v2-runtime/tauriMediaAnalyzer';

import { ApplicationProductApplicationAdapter } from '../api/application-product-adapter';
import { StaticProductApplicationAdapter } from '../api/static-product-application-adapter';
import { ProductFlowController } from '../features/product/product-flow-controller';

/**
 * Composition root for the opt-in React v2 runtime.
 *
 * Runtime and services are created exactly once here, never during render or
 * inside a recurring effect. The controller exposes the read/poll lifecycle to
 * React without letting components touch Tauri or Application internals.
 */
export interface AppRuntime {
  readonly controller: ProductFlowController;
  dispose(): void;
}

export function createNativeAppRuntime(): AppRuntime {
  const queue = new DownloadQueue();
  const engine = new TauriDownloadEngine();
  const downloads = new DownloadService(queue, engine);
  const product = new DownloadProductService({
    analyzer: new TauriMediaAnalyzer(),
    downloads,
  });
  const api = new ApplicationProductApplicationAdapter(product, new TaskQueryService(queue));

  return {
    controller: new ProductFlowController({ api }),
    dispose: () => downloads.dispose(),
  };
}

export function createPreviewAppRuntime(tasks: readonly TaskPayload[]): AppRuntime {
  const api = new StaticProductApplicationAdapter(tasks);

  return {
    controller: new ProductFlowController({ api }),
    dispose: () => {},
  };
}
