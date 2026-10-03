import { execSync } from 'node:child_process';
import process from 'node:process';

export function parseTargetArg(args = process.argv.slice(2)) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg.startsWith('--target=')) {
      const value = arg.slice('--target='.length).trim();
      if (!value) {
        throw new Error('Missing value for --target');
      }
      return value;
    }

    if (arg === '--target') {
      const value = args[i + 1]?.trim();
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --target');
      }
      return value;
    }
  }

  return null;
}

export function getHostTargetTriple() {
  const candidates = [
    'rustc -vV',
    process.env.USERPROFILE ? `"${process.env.USERPROFILE}\\.cargo\\bin\\rustc.exe" -vV` : null,
    process.env.HOME ? `"${process.env.HOME}/.cargo/bin/rustc" -vV` : null,
  ].filter(Boolean);

  for (const cmd of candidates) {
    try {
      const output = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      const match = output.match(/host: (.+)/);
      if (match) return match[1].trim();
    } catch {
      // try next candidate
    }
  }
  return null;
}

export function resolveTargetTriple(options = {}) {
  const {
    args = process.argv.slice(2),
    env = process.env,
    requireExplicitTarget = false,
    fallbackToHost = true,
  } = options;

  const cliTarget = parseTargetArg(args);
  if (cliTarget) {
    return { triple: cliTarget, source: 'cli', sourceLabel: 'cli', hostTriple: null };
  }

  const envTarget = env.TAURI_TARGET_TRIPLE?.trim();
  if (envTarget) {
    return { triple: envTarget, source: 'env', sourceLabel: 'env', hostTriple: null };
  }

  if (requireExplicitTarget) {
    throw new Error('Explicit target is required. Pass --target <triple> or set TAURI_TARGET_TRIPLE.');
  }

  if (!fallbackToHost) {
    return { triple: null, source: 'missing', sourceLabel: 'missing', hostTriple: null };
  }

  const hostTriple = getHostTargetTriple();
  return {
    triple: hostTriple,
    source: 'host',
    sourceLabel: 'host fallback',
    hostTriple,
  };
}

export function getTargetPlatform(triple) {
  if (!triple) {
    return null;
  }

  if (triple.includes('windows')) {
    return 'win32';
  }

  if (triple.includes('apple-darwin')) {
    return 'darwin';
  }

  if (triple.includes('linux')) {
    return 'linux';
  }

  return null;
}

export function getTargetArchitecture(triple) {
  if (!triple) {
    return null;
  }

  if (triple.startsWith('x86_64-')) {
    return 'x64';
  }

  if (triple.startsWith('aarch64-')) {
    return 'arm64';
  }

  if (triple.startsWith('i686-') || triple.startsWith('i586-')) {
    return 'ia32';
  }

  if (triple.startsWith('armv7-')) {
    return 'arm';
  }

  return null;
}

export function getTripleFacts(triple) {
  return {
    triple,
    platform: getTargetPlatform(triple),
    architecture: getTargetArchitecture(triple),
  };
}

export function getHostFacts() {
  const triple = getHostTargetTriple();

  return {
    triple,
    platform: process.platform,
    architecture: getTargetArchitecture(triple) ?? process.arch,
  };
}

export function assertExplicitTargetMatchesHostTriple({
  scriptName,
  triple,
  source,
  hostTriple = getHostTargetTriple(),
}) {
  if (source === 'host') {
    return;
  }

  if (!hostTriple) {
    throw new Error('Could not determine host triple for target compatibility checks.');
  }

  if (triple !== hostTriple) {
    throw new Error(
      `Explicit target ${triple} does not match host triple ${hostTriple}. ` +
      `${scriptName} cannot use host-derived binaries for a different target triple.`
    );
  }
}
