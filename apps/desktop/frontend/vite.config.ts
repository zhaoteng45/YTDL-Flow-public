import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * Opt-in React v2 frontend.
 *
 * The default product frontend stays the Vue app at the repo root; this package
 * is loaded by the additive `src-tauri/tauri.v2.conf.json` overlay and by the
 * standalone preview dev server.
 */
const v2RuntimeDir = fileURLToPath(new URL('../../../src/v2-runtime', import.meta.url));

const DEV_PORT = 19021;

function createNativeSmokeReportPlugin(): Plugin | null {
  if (process.env.VITE_V2_SMOKE !== '1') {
    return null;
  }

  const reportPath = process.env.VITE_V2_SMOKE_REPORT_PATH;
  if (!reportPath) {
    throw new Error('VITE_V2_SMOKE_REPORT_PATH is required in smoke mode');
  }

  return {
    name: 'ytdl-v2-product-smoke-report',
    configureServer(server) {
      server.middlewares.use('/__ytdl_v2_smoke_report', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        const maxBytes = 1024 * 1024;

        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.statusCode = 413;
            res.end('Report too large');
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });

        req.on('end', () => {
          if (size > maxBytes || res.writableEnded) {
            return;
          }

          try {
            const body = Buffer.concat(chunks).toString('utf8');
            JSON.parse(body);
            fs.mkdirSync(path.dirname(reportPath), { recursive: true });
            fs.writeFileSync(reportPath, body, 'utf8');
            res.statusCode = 204;
            res.end();
          } catch (error) {
            console.error('[native-smoke] failed to persist report', error);
            res.statusCode = 500;
            res.end('Failed to persist report');
          }
        });
      });
    },
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [react(), tailwindcss(), createNativeSmokeReportPlugin()],
  resolve: {
    alias: {
      '@v2-runtime': v2RuntimeDir,
    },
  },
  server: {
    port: DEV_PORT,
    strictPort: true,
    host: false,
  },
});
