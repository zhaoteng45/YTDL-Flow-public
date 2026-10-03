import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe('Tauri IPC command parity', () => {
  it('registers every literal frontend invoke command in the Rust generate_handler', () => {
    const frontendFiles = walk(resolve('src')).filter((path) => /\.(ts|vue)$/.test(path));
    const invoked = new Set<string>();
    const invokePattern = /(?:safeInvoke|(?<![\w.])invoke|deps\.invoke)\s*(?:<[^>]+>)?\(\s*['"]([a-z0-9_]+)['"]/g;

    for (const file of frontendFiles) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(invokePattern)) {
        invoked.add(match[1]);
      }
    }

    const rust = readFileSync(resolve('src-tauri/src/lib.rs'), 'utf8');
    const handlerBlock = rust.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1] ?? '';
    const registered = new Set(
      [...handlerBlock.matchAll(/\b([a-z][a-z0-9_]+)\b/g)].map((match) => match[1]),
    );

    const missing = [...invoked].filter((command) => !registered.has(command)).sort();
    expect(missing).toEqual([]);
  });
});
