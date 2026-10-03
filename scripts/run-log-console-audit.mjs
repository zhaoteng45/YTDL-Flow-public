import { runUiMatrix } from './ui-matrix-runner.mjs';
const auditCases = ['cobalt-butter', 'fluent', 'material'].flatMap(theme =>
  [[900, 640], [1280, 720], [1600, 900]].flatMap(([width, height]) => [false, true].map(admin => ({
    name: `${theme}-${width}-admin-${admin}.png`, width, height,
    query: `?theme=${theme}&admin=${admin}&locale=${admin ? 'en-US' : 'zh-CN'}`,
  }))),
);
await runUiMatrix({ harnessPath: '/tests/ui/log-console-audit.html', resultGlobal: '__YTDL_LOG_AUDIT__',
   outDirName: 'native-ui-round-four-logs', auditCases, timeoutMs: 60000 });
