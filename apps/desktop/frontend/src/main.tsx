import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import {
  createNativeAppRuntime,
  createPreviewAppRuntime,
  type AppRuntime,
} from './runtime/create-app-runtime';
import './styles/index.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root element');
}

if (import.meta.env.VITE_V2_SMOKE === '1') {
  const { runProductSmoke } = await import('./smoke/product-smoke');
  await runProductSmoke();
} else {
  const runtime = await createRuntime();
  createRoot(root).render(
    <StrictMode>
      <App runtime={runtime} />
    </StrictMode>,
  );
}

async function createRuntime(): Promise<AppRuntime> {
  if (import.meta.env.DEV) {
    const { loadPreviewTasks } = await import('./dev/load-preview-tasks');
    const tasks = await loadPreviewTasks();
    if (tasks) {
      return createPreviewAppRuntime(tasks);
    }
  }

  return createNativeAppRuntime();
}
