import { runUiMatrix } from './ui-matrix-runner.mjs';

for (const tab of ['general', 'output', 'advanced', 'tools']) {
  await runUiMatrix({
    harnessPath: `/tests/ui/settings-ia-candidate.html?tab=${tab}&theme=light`,
    resultGlobal: '__YTDL_SETTINGS_CANDIDATE__',
    outDirName: `settings-ia-candidate-${tab}`,
    screenshotName: `${tab}.png`,
    timeoutMs: 60000,
  });
}
