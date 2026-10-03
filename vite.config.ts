import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import fs from "node:fs";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

function readDevPort(): number {
  try {
    const cfgPath = path.resolve("src-tauri", "tauri.conf.json");
    const raw = fs.readFileSync(cfgPath, "utf-8");
    const json = JSON.parse(raw);
    const urlStr: string = json?.build?.devUrl || "http://localhost:27891";
    const u = new URL(urlStr);
    const port = Number(u.port || 27891);
    return port > 0 ? port : 27891;
  } catch {
    return 27891;
  }
}

function createNativeSmokeReportPlugin(): Plugin | null {
  if (process.env.VITE_V2_SMOKE !== "1") {
    return null;
  }

  const reportPath = process.env.VITE_V2_SMOKE_REPORT_PATH;
  if (!reportPath) {
    throw new Error("VITE_V2_SMOKE_REPORT_PATH is required in smoke mode");
  }

  return {
    name: "ytdl-v2-native-smoke-report",
    configureServer(server) {
      server.middlewares.use("/__ytdl_v2_smoke_report", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method Not Allowed");
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        const maxBytes = 1024 * 1024;

        req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.statusCode = 413;
            res.end("Report too large");
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });

        req.on("end", () => {
          if (size > maxBytes || res.writableEnded) {
            return;
          }

          try {
            const body = Buffer.concat(chunks).toString("utf8");
            JSON.parse(body);
            fs.mkdirSync(path.dirname(reportPath), { recursive: true });
            fs.writeFileSync(reportPath, body, "utf8");
            res.statusCode = 204;
            res.end();
          } catch (error) {
            console.error("[native-smoke] failed to persist report", error);
            res.statusCode = 500;
            res.end("Failed to persist report");
          }
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue(), createNativeSmokeReportPlugin()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. modern baseline: WebView2 is evergreen Chromium, es2024 is safe
  // NOTE: Vite 8 runs on Rolldown — manualChunks only accepts function form
  build: {
    target: 'es2024',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (
            id.includes('node_modules/vue/') ||
            id.includes('node_modules/pinia/') ||
            id.includes('node_modules/vue-i18n/') ||
            id.includes('node_modules/@vueuse/')
          ) {
            return 'vendor';
          }
          if (id.includes('node_modules/qrcode/')) {
            return 'qrcode';
          }
        },
      },
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: readDevPort(),
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: readDevPort() + 1,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**", "**/edge-profile-*/**"],
    },
  },
}));
