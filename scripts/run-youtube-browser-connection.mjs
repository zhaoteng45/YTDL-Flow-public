import { runUiMatrix } from './ui-matrix-runner.mjs';

for (const [width, height] of [[360, 640], [720, 600], [1360, 900]]) {
  await runUiMatrix({
    harnessPath: '/tests/ui/youtube-browser-connection.html',
    resultGlobal: '__YTDL_YOUTUBE_CONNECTION__',
    outDirName: `youtube-browser-connection/${width}x${height}`,
    screenshotName: 'connection.png',
    viewportWidth: width,
    viewportHeight: height,
  });
}
