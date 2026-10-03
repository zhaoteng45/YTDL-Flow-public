import type { TaskViewModel } from '../features/downloads/task-view-model';

export interface DownloadsPageProps {
  tasks: TaskViewModel[];
  onCancel(taskId: string): void;
}

export function DownloadsPage({ tasks, onCancel }: DownloadsPageProps) {
  return (
    <section className="downloads-section" aria-labelledby="downloads-title">
      <div className="downloads-heading">
        <div>
          <p className="neo-kicker">下载队列</p>
          <h2 id="downloads-title" className="downloads-title">
            下载任务
          </h2>
        </div>
        <span className="neo-count">{tasks.length} 个任务</span>
      </div>

      {tasks.length === 0 ? (
        <div className="neo-box empty-state">
          <p className="empty-state-title">还没有下载任务</p>
          <p className="empty-state-copy">粘贴链接并开始下载后，任务会显示在这里。</p>
        </div>
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <li key={task.id} className="neo-box task-card" data-status={task.status}>
              <div className="task-card-head">
                <div className="task-copy">
                  <p className="task-source">{task.sourceUrl}</p>
                  <p className="task-status">{task.statusLabel}</p>
                </div>
                <div className="task-actions">
                  <span className="task-progress-label">{task.progressLabel}</span>
                  {task.canCancel ? (
                    <button
                      type="button"
                      className="neo-button task-cancel"
                      disabled={task.cancelPending}
                      aria-label={`取消任务 ${task.sourceUrl}`}
                      onClick={() => onCancel(task.id)}
                    >
                      {task.cancelPending ? '取消中…' : '取消'}
                    </button>
                  ) : null}
                </div>
              </div>
              <progress
                className="neo-progress"
                value={task.progress}
                max={100}
                aria-label={`${task.statusLabel} ${task.progressLabel}`}
              />
              {task.failureReason ? (
                <p className="neo-error">失败原因：{task.failureReason}</p>
              ) : null}
              {task.cancelErrorMessage ? (
                <p className="neo-error">取消失败：{task.cancelErrorMessage}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
