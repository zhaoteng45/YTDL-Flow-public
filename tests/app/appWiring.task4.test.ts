import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TaskPresentationRow } from '../../src/application/taskPresentation';
import { getTaskSoundEffects, hasNewVisibleRows } from '../../src/appWiring.helpers';

const appSource = readFileSync(resolve('src/App.vue'), 'utf8');
const helpersSource = readFileSync(resolve('src/appWiring.helpers.ts'), 'utf8');

const TASK_LIFECYCLE_STORE_METHODS = [
  'analyzeUrls',
  'startTaskDownload',
  'cancelTask',
  'removeTask',
  'retryTaskDownload',
  'reanalyzeTask',
] as const;

describe('task 4 app wiring', () => {
  it('routes task lifecycle commands through the production CurrentTaskRuntime presentation facade', () => {
    for (const method of TASK_LIFECYCLE_STORE_METHODS) {
      expect(appSource).not.toMatch(new RegExp(`store\\.${method}\\b`));
    }

    expect(appSource).not.toMatch(/createLegacyTaskPresentationActions/);
    expect(appSource).not.toMatch(/legacyTaskActions/);
    expect(appSource).toMatch(/const taskActions = taskRuntime\.actions;/);

    expect(appSource).toMatch(/taskActions\.startDownload\(payload\.rowId, payload\.format, payload\.options\)/);
    expect(appSource).toMatch(/taskActions\.cancel\(rowId\)/);
    expect(appSource).toMatch(/taskActions\.remove\(rowId\)/);
    expect(appSource).toMatch(/taskActions\.retryDownload\(rowId\)/);
    expect(appSource).toMatch(/taskActions\.reanalyze\(rowId\)/);
    expect(appSource).toMatch(/@analyze="taskActions\.analyzeUrls"/);
    expect(appSource).not.toMatch(/@clear-completed=/);
    expect(appSource).not.toMatch(/@cancel-queued=/);
    expect(appSource).not.toMatch(/@retry-failed-downloads=/);
    expect(appSource).not.toMatch(/@flatten-playlist=/);
  });

  it('opens completed files and folders from the current presentation row path', () => {
    expect(appSource).toMatch(/handleTaskOpenFolder[\s\S]*?tasks\.value\.find[\s\S]*?store\.openFolder\(task\?\.path\)/);
    expect(appSource).not.toMatch(/store\.openTaskFolder\(rowId\)/);
    expect(appSource).toMatch(/@open-file="handleTaskOpenFile"/);
    expect(appSource).toMatch(/handleTaskOpenFile[\s\S]*?await store\.openFile\(task\?\.path\)/);
  });

  it('computes sound effects only for current-attempt terminal transitions', () => {
    expect(getTaskSoundEffects(undefined, [{ rowId: 'row-1', id: 'attempt-1', status: 'downloading' }])).toEqual([]);

    expect(getTaskSoundEffects(
      [{ rowId: 'row-1', id: 'attempt-1', status: 'downloading' }],
      [{ rowId: 'row-1', id: 'attempt-1', status: 'completed' }],
    )).toEqual(['success']);

    expect(getTaskSoundEffects(
      [{ rowId: 'row-1', id: 'attempt-1', status: 'downloading' }],
      [{ rowId: 'row-1', id: 'attempt-1', status: 'error' }],
    )).toEqual(['error']);

    expect(getTaskSoundEffects(
      [{ rowId: 'row-1', id: 'attempt-1', status: 'error' }],
      [{ rowId: 'row-1', id: 'attempt-2', status: 'completed' }],
    )).toEqual([]);
  });

  it('accepts the presentation snapshot without depending on the legacy Task type', () => {
    type WatcherSnapshot = Pick<TaskPresentationRow, 'rowId' | 'id' | 'status'>;

    const previous: WatcherSnapshot[] = [
      { rowId: 'row-1', id: 'attempt-1', status: 'downloading' },
    ];
    const current: WatcherSnapshot[] = [
      { rowId: 'row-1', id: 'attempt-1', status: 'completed' },
    ];

    expect(getTaskSoundEffects(previous, current)).toEqual(['success']);
    expect(helpersSource).not.toMatch(/from '\.\/types'/);
    expect(helpersSource).toMatch(/from '\.\/application\/taskPresentation'/);
  });

  it('detects only genuinely new visible rows for scroll-follow behavior', () => {
    expect(hasNewVisibleRows(undefined, ['row-1'])).toBe(true);
    expect(hasNewVisibleRows(['row-1'], ['row-1'])).toBe(false);
    expect(hasNewVisibleRows(['row-1'], ['row-1', 'row-2'])).toBe(true);
  });

  it('keeps one unmount cleanup registration and tears down the current task owner', () => {
    expect(appSource.match(/onUnmounted\(async \(\) => \{/g)).toHaveLength(1);
    expect(appSource).toMatch(/stopTaskRows\(\);[\s\S]*await disposeTaskRuntimeWithRetry\(taskRuntime\);/);
    expect(appSource).not.toMatch(/store\.cleanupListeners\(\)/);
  });
});
