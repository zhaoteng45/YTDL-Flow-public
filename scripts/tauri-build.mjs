import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

export function normalizeCiValue(value) {
  if (value === '1') return 'true';
  if (value === '0') return 'false';
  return value;
}

export function prependRuntimeBinToPath(env, executablePath = process.execPath) {
  const runtimeDir = path.dirname(executablePath);
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const currentPath = env[pathKey] ?? '';
  env[pathKey] = currentPath
    ? `${runtimeDir}${path.delimiter}${currentPath}`
    : runtimeDir;
  return env;
}

const WINDOWS_PATHEXT = [
  '.COM',
  '.EXE',
  '.BAT',
  '.CMD',
  '.VBS',
  '.VBE',
  '.JS',
  '.JSE',
  '.WSF',
  '.WSH',
  '.MSC',
  '.CPL',
];

export function ensureWindowsPathExt(env, platform = process.platform) {
  if (platform !== 'win32') return env;

  const current = (env.PATHEXT ?? '')
    .split(';')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const merged = [...WINDOWS_PATHEXT];
  for (const value of current) {
    if (!merged.includes(value)) merged.push(value);
  }
  env.PATHEXT = merged.join(';');
  return env;
}

function main() {
  const env = { ...process.env };
  const normalizedCi = normalizeCiValue(env.CI);
  if (normalizedCi === undefined) {
    delete env.CI;
  } else {
    env.CI = normalizedCi;
  }
  prependRuntimeBinToPath(env);
  ensureWindowsPathExt(env);

  const result = spawnSync(
    process.execPath,
    ['x', 'tauri', 'build', ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env,
    },
  );

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

if (import.meta.main) {
  main();
}
