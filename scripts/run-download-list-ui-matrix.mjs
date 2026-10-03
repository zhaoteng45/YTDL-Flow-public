import { runUiMatrix } from './ui-matrix-runner.mjs';

await runUiMatrix({
  harnessPath: '/tests/ui/download-list-state-matrix.html',
  outDirName: 'download-list-ui-matrix',
  screenshotName: 'final-petrol-960.png',
});
