import fs from 'node:fs';
import path from 'node:path';
import { fileSha256 } from './lib/release-evidence.mjs';

const root = path.resolve(process.argv[2]);
const fixture = path.join(root, 'fixture.mp4');
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  fetch(request) {
    if (new URL(request.url).pathname !== '/fixture.mp4') return new Response(null, { status: 404 });
    return new Response(Bun.file(fixture), { headers: { 'Content-Type': 'video/mp4' } });
  },
});
fs.writeFileSync(path.join(root, 'request.json'), JSON.stringify({
  url: `http://127.0.0.1:${server.port}/fixture.mp4`, expectedSha256: fileSha256(fixture),
}));
