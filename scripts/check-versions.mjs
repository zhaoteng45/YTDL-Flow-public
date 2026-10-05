import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf-8'));
}

function readToml(path) {
  return Bun.TOML.parse(readFileSync(resolve(root, path), 'utf-8'));
}

try {
  const pkg = readJson('package.json');
  const tauriConf = readJson('src-tauri/tauri.conf.json');
  const cargo = readToml('src-tauri/Cargo.toml').package;
  const roots = readToml('src-tauri/Cargo.lock').package.filter(item => item.name === cargo.name);
  if (roots.length !== 1) throw new Error('Expected exactly one root package in Cargo.lock');

  const vPkg = pkg.version;
  const vTauri = tauriConf.version;
  const vCargo = cargo.version;
  const vLock = roots[0].version;

  console.log(`Package: ${vPkg}`);
  console.log(`Tauri:   ${vTauri}`);
  console.log(`Cargo:   ${vCargo}`);
  console.log(`Lock:    ${vLock}`);

  if (!vPkg || vPkg !== vTauri || vPkg !== vCargo || vPkg !== vLock) {
    console.error('❌ Versions do not match!');
    process.exit(1);
  }

  console.log('✅ Versions match.');
} catch (e) {
  console.error(e);
  process.exit(1);
}
