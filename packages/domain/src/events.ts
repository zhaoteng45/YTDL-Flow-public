export type DomainEvent =
  | { type: 'TaskCreated'; taskId: string }
  | { type: 'TaskQueued'; taskId: string }
  | { type: 'TaskStarted'; taskId: string }
  | { type: 'ProgressUpdated'; taskId: string; progress: number }
  | { type: 'TaskCompleted'; taskId: string }
  | { type: 'TaskFailed'; taskId: string; error: string }
  | { type: 'TaskCancelled'; taskId: string };
