import { runUiMatrix } from './ui-matrix-runner.mjs';

await runUiMatrix({
  harnessPath: '/tests/ui/app-shell-audit.html',
  resultGlobal: '__YTDL_APP_SHELL_AUDIT__',
  outDirName: 'final-app-shell-audit',
  screenshotName: 'app-shell.png',
  timeoutMs: 60000,
});