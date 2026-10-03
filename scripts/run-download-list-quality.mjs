import { runUiMatrix } from './ui-matrix-runner.mjs';

await runUiMatrix({
  harnessPath: '/tests/ui/download-list-quality.html',
  resultGlobal: '__YTDL_QUALITY__',
  outDirName: 'ui-quality-fix-green',
  screenshotName: 'quality.png',
});
