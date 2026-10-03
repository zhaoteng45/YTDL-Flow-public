import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/utils/tauri.ts'), 'utf8');

describe('Tauri web-preview mocks', () => {
  it('returns render-safe values for settings data', () => {
    expect(source).toMatch(/cmd === 'get_binaries_info'[\s\S]*ytdlp: 'Web Preview'/);
  });
});
