export type TaskDetailView = 'options' | 'diagnostics';
export function nextTaskDetailView(current: TaskDetailView | undefined, canConfigure: boolean): TaskDetailView {
  return !canConfigure ? 'diagnostics' : current ?? 'options';
}
