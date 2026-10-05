import path from "node:path";

function computePort() {
  const now = Date.now();
  return (now % 10000) + 20000;
}

async function updateTauriConfig(port) {
  const cfgPath = path.resolve(process.cwd(), "src-tauri", "tauri.conf.json");
  const json = await Bun.file(cfgPath).json();
  json.build = json.build || {};
  json.build.devUrl = `http://localhost:${port}`;
  await Bun.write(cfgPath, JSON.stringify(json, null, 2) + "\n");
}

// Keep an existing dev server and the native window on the same endpoint.
// Randomizing a valid URL while another session is running disconnects WebView.
const currentConfig = await Bun.file(path.resolve('src-tauri', 'tauri.conf.json')).json();
let configuredPort;
try {
  const configuredUrl = new URL(currentConfig.build?.devUrl);
  if (['http:', 'https:'].includes(configuredUrl.protocol) && configuredUrl.port) {
    configuredPort = Number(configuredUrl.port);
  }
} catch {
  // A missing or invalid URL still uses the original first-run preparation.
}
if (configuredPort) {
  console.log(`Dev port preserved: ${configuredPort}`);
  process.exit(0);
}

const port = computePort();
await updateTauriConfig(port);
console.log(`Dev port set to ${port}`);

