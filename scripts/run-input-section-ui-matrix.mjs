import { runUiMatrix } from './ui-matrix-runner.mjs';

await runUiMatrix({
  harnessPath: '/tests/ui/input-section-state-matrix.html',
  resultGlobal: '__YTDL_INPUT_UI_MATRIX__',
  outDirName: 'input-section-ui-matrix',
  screenshotName: 'final-petrol-420.png',
});
