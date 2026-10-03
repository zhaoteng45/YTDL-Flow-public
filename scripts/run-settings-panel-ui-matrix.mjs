import { runUiMatrix } from './ui-matrix-runner.mjs';

await runUiMatrix({
  harnessPath: '/tests/ui/settings-panel-state-matrix.html',
  resultGlobal: '__YTDL_SETTINGS_UI_MATRIX__',
  outDirName: 'settings-panel-ui-matrix',
  screenshotName: 'final-petrol-720.png',
  timeoutMs: 120000,
  ...(process.argv.includes('--capture-themes') ? {
    outDirName: 'native-ui-round-three-settings',
    auditCases: ['cobalt-butter', 'fluent', 'material'].map(theme => ({
      name: `${theme}-settings.png`, width: 1920, height: 1080, query: `?theme=${theme}`,
    })),
  } : {}),
});
