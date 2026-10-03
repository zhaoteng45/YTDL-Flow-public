import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve('src/App.vue'), 'utf8');
const runtimeFactorySource = readFileSync(resolve('src/v2-runtime/currentTaskAppRuntime.ts'), 'utf8');

describe('CurrentTaskRuntime production Vue wiring', () => {
  it('uses the current runtime as the unconditional production task owner', () => {
    expect(appSource).not.toContain('VITE_CURRENT_TASK_GUI_PREVIEW');
    expect(appSource).not.toContain('createLegacyTaskPresentationActions');
    expect(appSource).not.toContain('legacyTaskActions');
    expect(appSource).toMatch(/const taskRuntime = createCurrentTaskAppRuntime\(/);
    expect(appSource).toMatch(/const taskActions = taskRuntime\.actions;/);
  });

  it('uses current runtime rows and never starts legacy task listeners', () => {
    expect(appSource).toMatch(/taskRuntime\.subscribeRows/);
    expect(appSource).toMatch(/taskRows\.value/);
    expect(appSource).not.toMatch(/store\.initListeners\(\)/);
    expect(appSource).toMatch(/await disposeTaskRuntimeWithRetry\(taskRuntime\)/);
  });

  it('disposes capture contexts before tearing down the task runtime', () => {
    expect(runtimeFactorySource).toMatch(
      /await capture\.stop\(\);[\s\S]*await capture\.dispose\(\);[\s\S]*await nativeLogs\.dispose\(\);[\s\S]*await runtime\.dispose\(\);/,
    );
  });

  it('waits for captured-row revocation before removing the task row', () => {
    expect(appSource).toMatch(
      /const handleTaskRemove = async \(rowId: string\)[\s\S]*await taskRuntime\.capture\.revokeRow\([\s\S]*taskActions\.remove\(rowId\)/,
    );
  });

  it('opens output folders directly from the presentation row path', () => {
    expect(appSource).toMatch(/tasks\.value\.find\(\(task\) => task\.rowId === rowId\)[\s\S]*store\.openFolder\(task\?\.path\)/);
    expect(appSource).not.toMatch(/store\.openTaskFolder\(rowId\)/);
  });

  it('builds the production runtime from the real current adapters with dynamic environment callbacks', () => {
    expect(runtimeFactorySource).toContain('new TauriDownloadEngine()');
    expect(runtimeFactorySource).toContain('new CurrentTauriMediaAnalyzer()');
    expect(runtimeFactorySource).toContain('createCurrentTaskEffectsPort()');
    expect(runtimeFactorySource).toContain('new CurrentTaskNativeLogBridge');
    expect(runtimeFactorySource).toMatch(/runtime\.tasks\.ingestLog\(attemptId, line\)/);
    expect(runtimeFactorySource).toMatch(/await nativeLogs\.dispose\(\);[\s\S]*await runtime\.dispose\(\);/);
    expect(runtimeFactorySource).toMatch(/getGlobalExtraArgs:\s*options\.getGlobalExtraArgs/);
    expect(runtimeFactorySource).toMatch(/getDownloadDir:\s*options\.getDownloadDir/);
  });
});
