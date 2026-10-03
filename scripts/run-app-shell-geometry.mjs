import { runUiMatrix } from './ui-matrix-runner.mjs';

const themes = ['cobalt-butter', 'fluent', 'material'];
if (process.argv.includes('--menu-edge')) {
  const auditCases = themes.flatMap(theme => ['zh-CN', 'en-US'].flatMap(locale => ['format', 'more'].map(menu => ({
    name: `${theme}-${locale}-${menu}-edge.png`, width: 1276, height: 567,
    query: `?theme=${theme}&locale=${locale}&menu=${menu}`,
  }))));
  await runUiMatrix({ harnessPath: '/tests/ui/download-menu-edge.html', resultGlobal: '__YTDL_MENU_EDGE__',
    outDirName: process.argv.includes('--smoke') ? 'native-ui-round-five-menu-smoke' : 'native-ui-round-five-menu-edge',
    auditCases: process.argv.includes('--smoke') ? auditCases.slice(0, 2) : auditCases, timeoutMs: 60000 });
  process.exit(process.exitCode ?? 0);
}
// CSS content viewport = physical desktop / OS scaling (rounded down).
// CDP models DPR, not Windows work-area insets or WebView2 font rasterization.
const scalingMatrix = [
  [1280, 720, [100]], [1366, 768, [100, 125]],
  [1536, 864, [100, 125, 150]], [1600, 900, [100, 125, 150]],
  [1920, 1080, [100, 125, 150, 175]],
  [2560, 1440, [100, 125, 150, 175, 200]],
  [3840, 2160, [150, 175, 200, 225, 250, 300]],
].flatMap(([w, h, scales]) => scales.map(scale => ({
  width: Math.floor(w * 100 / scale), height: Math.floor(h * 100 / scale),
  deviceScaleFactor: scale / 100, physicalResolution: `${w}x${h}`,
  windowsScaling: `${scale}%`, suffix: `${w}x${h}-at-${scale}`,
  approximation: 'CDP DPR + logical viewport; Windows titlebar/taskbar excluded',
})));
const windowMatrix = [900, 1100, 1280, 1440, 1600].flatMap(width =>
  [640, 720, 768, 900, 1080].map(height => ({ width, height, suffix: `${width}x${height}`,
    deviceScaleFactor: 1, approximation: 'logical non-maximized browser content viewport' })));
// Include native work-area allowance for the user’s 4K @300% desktop.
windowMatrix.push({ width: 1280, height: 640, deviceScaleFactor: 3, suffix: '4k-300-insets',
  physicalResolution: '3840x2160', windowsScaling: '300%', approximation: 'CDP DPR; 80 CSS px work-area allowance' });
const smoke = process.argv.includes('--smoke');
const settingsOnly = process.argv.includes('--settings');
const stressOnly = process.argv.includes('--stress');
const nativeEmpty = process.argv.includes('--native-empty');
const nativeSizes = [[1276, 567], [1280, 568], [1280, 640], [1280, 720]].map(([width, height]) => ({
  width, height, deviceScaleFactor: 3, suffix: `${width}x${height}-native-client`,
  approximation: 'Round 4 measured native client regression, browser equivalent only',
}));
const sizes = nativeEmpty ? nativeSizes : settingsOnly || stressOnly ? [] : smoke ? [windowMatrix[0], windowMatrix.at(-1), scalingMatrix[2], scalingMatrix[5]] : [...scalingMatrix, ...windowMatrix, ...nativeSizes];
const auditCases = (nativeEmpty ? ['material'] : themes).flatMap(theme => sizes.flatMap(size =>
  (nativeEmpty ? ['empty'] : ['empty', 'active']).map(state => ({ ...size, name: `${theme}-${state}-${size.suffix}.png`,
    query: `?theme=${theme}&state=${state}` }))));
if (stressOnly) {
  for (const theme of themes) for (const [width, height] of [[900, 640], [1280, 640]]) auditCases.push({
    name: `${theme}-active-stress-${width}x${height}.png`, width, height,
    query: `?theme=${theme}&state=active&capture=stress` });
}
if (!smoke && !stressOnly && !nativeEmpty) {
  for (const theme of themes) for (const [width, height] of [[900, 640], [1280, 640], [1280, 720], [1920, 1080]]) {
    auditCases.push({ name: `${theme}-settings-${width}x${height}.png`, width, height,
      deviceScaleFactor: 1, approximation: 'logical browser settings viewport',
      query: `?theme=${theme}&state=empty&capture=settings` });
  }
}
await runUiMatrix({ harnessPath: '/tests/ui/app-shell-geometry.html', resultGlobal: '__YTDL_SHELL_GEOMETRY__',
  outDirName: nativeEmpty ? 'native-ui-round-five-empty' : stressOnly ? 'native-ui-round-four-stress' : settingsOnly ? 'native-ui-round-four-settings-frame' : smoke ? 'native-ui-round-four-smoke' : 'native-ui-round-four-geometry',
  screenshotName: 'final.png', auditCases, timeoutMs: 60000 });
