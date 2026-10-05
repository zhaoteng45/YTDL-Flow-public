import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('public test discovery', () => {
  it('retains product and script tests while excluding local Agent helpers', () => {
    // Keep the exclusion observable on CI, where local helpers are absent.
    const agentDirectory = path.resolve('tests/agents');
    mkdirSync(agentDirectory, { recursive: true });
    const fixture = mkdtempSync(path.join(agentDirectory, 'discovery-'));
    try {
      writeFileSync(path.join(fixture, 'local.test.ts'), "import { it } from 'vitest'; it('local fixture', () => {});");
      const files: { file: string }[] = JSON.parse(execFileSync('bunx', ['vitest', 'list', '--json', '--filesOnly'], { encoding: 'utf8' }));
      const paths = files.map(({ file }) => file.replaceAll('\\', '/'));
      expect(paths.some(file => file.endsWith('/tests/scripts/repositoryContent.test.ts'))).toBe(true);
      expect(paths.some(file => file.includes('/tests/components/'))).toBe(true);
      expect(paths.filter(file => file.includes('/tests/agents/') || file.endsWith('/tests/scripts/agentContext.test.ts'))).toEqual([]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
