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

const port = computePort();
await updateTauriConfig(port);
console.log(`Dev port set to ${port}`);

