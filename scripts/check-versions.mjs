import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf-8'));
}

function readTomlVersion(path) {
  const content = readFileSync(resolve(root, path), 'utf-8');
  const match = content.match(/^version\s*=\s*"(.*)"/m);
  return match ? match[1] : null;
}

try {
  const pkg = readJson('package.json');
  const tauriConf = readJson('src-tauri/tauri.conf.json');
  const cargoVersion = readTomlVersion('src-tauri/Cargo.toml');

  const vPkg = pkg.version;
  const vTauri = tauriConf.version;
  const vCargo = cargoVersion;

  console.log(`Package: ${vPkg}`);
  console.log(`Tauri:   ${vTauri}`);
  console.log(`Cargo:   ${vCargo}`);

  if (vPkg !== vTauri || vPkg !== vCargo) {
    console.error('❌ Versions do not match!');
    process.exit(1);
  }

  console.log('✅ Versions match.');
} catch (e) {
  console.error(e);
  process.exit(1);
}
