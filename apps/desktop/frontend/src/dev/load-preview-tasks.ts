import type { TaskPayload } from '@ytdl-flow/contracts';

import { StaticTaskApplicationAdapter } from '../api/static-task-application-adapter';
import { previewTasks } from './preview-tasks';

const previewThemes = new Set([
  'light',
  'dark',
  'codex',
  'morandi',
  'cyber',
  'pokemon',
  'fluent',
  'material',
  'pingpong',
  'paper-plane',
  'natural_taupe',
  'natural_olive',
]);

export async function loadPreviewTasks(): Promise<TaskPayload[] | undefined> {
  const params = new URLSearchParams(window.location.search);
  if (params.get('fixture') !== 'tasks') {
    return undefined;
  }

  const requestedTheme = params.get('theme');
  if (requestedTheme && previewThemes.has(requestedTheme)) {
    document.documentElement.dataset.theme = requestedTheme;
  }

  const api = new StaticTaskApplicationAdapter(previewTasks);
  return api.listTasks();
}
