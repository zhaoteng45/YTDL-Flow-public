import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { toTaskViewModel } from '../features/downloads/task-view-model';
import { ProductSection } from '../features/product/ProductSection';
import { DownloadsPage } from '../pages/DownloadsPage';
import type { AppRuntime } from '../runtime/create-app-runtime';

export interface AppProps {
  runtime: AppRuntime;
}

export function App({ runtime }: AppProps) {
  const controller = runtime.controller;
  const state = useSyncExternalStore(
    useCallback((listener: () => void) => controller.subscribe(listener), [controller]),
    () => controller.getState(),
  );

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  const taskViewModels = state.tasks.map((task) =>
    toTaskViewModel(task, {
      cancelPending: state.cancelPending[task.id] === true,
      cancelError: state.cancelErrors[task.id],
    }),
  );

  return (
    <main className="neo-shell">
      <div className="neo-workbench">
        <header className="neo-header">
          <div>
            <p className="neo-kicker">YTDL-Flow v2</p>
            <p className="neo-brand-title">本地媒体下载</p>
          </div>
          <div className="neo-badge">本地处理</div>
        </header>

        <ProductSection
          state={state}
          canCreateDownload={controller.canCreateDownload()}
          onInputChange={(value) => controller.setInput(value)}
          onAnalyze={() => void controller.analyze()}
          onDownload={(selection) => void controller.createDownload(selection)}
        />

        <DownloadsPage
          tasks={taskViewModels}
          onCancel={(taskId) => void controller.cancelTask(taskId)}
        />
      </div>
    </main>
  );
}
