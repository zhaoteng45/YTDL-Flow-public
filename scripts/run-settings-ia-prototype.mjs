import { runUiMatrix } from './ui-matrix-runner.mjs';

const cases = [
  ['A-general', '/tests/ui/settings-ia-prototype.html?variant=A&tab=general'],
  ['A-output', '/tests/ui/settings-ia-prototype.html?variant=A&tab=output'],
  ['A-advanced', '/tests/ui/settings-ia-prototype.html?variant=A&tab=advanced'],
  ['A-tools', '/tests/ui/settings-ia-prototype.html?variant=A&tab=tools'],
  ['B', '/tests/ui/settings-ia-prototype.html?variant=B'],
  ['C', '/tests/ui/settings-ia-prototype.html?variant=C'],
];

for (const [name, harnessPath] of cases) {
  await runUiMatrix({
    harnessPath,
    resultGlobal: '__YTDL_SETTINGS_PROTOTYPE__',
    outDirName: `settings-ia-prototype-${name.toLowerCase()}`,
    screenshotName: `${name.toLowerCase()}.png`,
    timeoutMs: 60000,
  });
}
