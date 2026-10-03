import { runUiMatrix } from './ui-matrix-runner.mjs';

for (const tab of ['general', 'output', 'advanced', 'tools']) {
  await runUiMatrix({
    harnessPath: `/tests/ui/settings-ia-candidate.html?tab=${tab}&theme=light&width=360`,
    resultGlobal: '__YTDL_SETTINGS_CANDIDATE__',
    outDirName: `settings-ia-candidate-${tab}-360`,
    screenshotName: `${tab}-360.png`,
    timeoutMs: 60000,
  });
}
