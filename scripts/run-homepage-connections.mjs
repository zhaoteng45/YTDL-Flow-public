import { runUiMatrix } from './ui-matrix-runner.mjs';
for (const [width, height] of [[360, 640], [720, 600], [1360, 900]]) {
  await runUiMatrix({ harnessPath: '/tests/ui/homepage-connections.html', resultGlobal: '__YTDL_HOMEPAGE_CONNECTIONS__', outDirName: `homepage-connections/${width}x${height}`, screenshotName: 'homepage.png', viewportWidth: width, viewportHeight: height });
}
