import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const storeSource = readFileSync(resolve('src/stores/appStore.ts'), 'utf8');
const appSource = readFileSync(resolve('src/App.vue'), 'utf8');

describe('user initiated native action error visibility', () => {
  it('does not swallow download-directory or open-folder failures in the store adapter', () => {
    expect(storeSource).toMatch(/Failed to choose directory:[\s\S]*?throw e;/);
    expect(storeSource).toMatch(/Open folder failed:[\s\S]*?throw e;/);
  });

  it('awaits open-folder actions and exposes an app-level alert on failure', () => {
    expect(appSource).toMatch(/const actionNotice = ref\(''\)/);
    expect(appSource).toMatch(/const handleTaskOpenFolder = async/);
    expect(appSource).toMatch(/await store\.openFolder\(task\?\.path\)/);
    expect(appSource).not.toMatch(/await store\.openTaskFolder/);
    expect(appSource).toMatch(/actionNotice\.value = t\('app\.open_folder_failed'/);
    expect(appSource).toMatch(/v-if="actionNotice"[^>]*role="alert"/);
  });

  it('awaits open-file actions and exposes an app-level alert on failure', () => {
    expect(storeSource).toMatch(/Open file failed:[\s\S]*?throw e;/);
    expect(appSource).toMatch(/const handleTaskOpenFile = async/);
    expect(appSource).toMatch(/await store\.openFile\(task\?\.path\)/);
    expect(appSource).toMatch(/actionNotice\.value = t\('app\.open_file_failed'/);
    expect(appSource).not.toMatch(/handleTaskPreview|closePreview|stopMediaPreview/);
  });

  it('awaits task lifecycle commands and exposes rejected actions through the app-level alert', () => {
    expect(appSource).toMatch(/const handleTaskDownload = async[\s\S]*?await taskActions\.startDownload/);
    expect(appSource).toMatch(/const handleTaskRetryDownload = async[\s\S]*?await taskActions\.retryDownload/);
    expect(appSource).toMatch(/const handleTaskReanalyze = async[\s\S]*?await taskActions\.reanalyze/);
    expect(appSource).toContain("t('download_list.summary.failed')");
  });

  it('observes typed cancel outcomes instead of discarding cancel rejection or stale not-cancellable results', () => {
    expect(appSource).toMatch(/const handleTaskCancel = async/);
    expect(appSource).toMatch(/await taskActions\.cancel\(rowId\)/);
    expect(appSource).toMatch(/outcome\.type === 'cancel-rejected'/);
    expect(appSource).toMatch(/outcome\.type === 'not-cancellable'/);
  });
});
