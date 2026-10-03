import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { collectNpmLicenses } from '../../scripts/lib/npm-license-collection.mjs';

it('collects transitive licenses from an isolated dependency tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'ytdl-npm-license-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', dependencies: { first: '1' } }));
  const first = join(root, 'node_modules/first');
  const second = join(first, 'node_modules/second');
  mkdirSync(second, { recursive: true });
  writeFileSync(join(first, 'package.json'), JSON.stringify({ name: 'first', version: '1', license: 'MIT', dependencies: { second: '1' } }));
  writeFileSync(join(second, 'package.json'), JSON.stringify({ name: 'second', version: '1', license: 'ISC' }));
  writeFileSync(join(first, 'LICENSE'), 'Copyright First\nMIT');
  writeFileSync(join(second, 'LICENSE'), 'Copyright Second\nISC');
  const packages = collectNpmLicenses(root, join(root, 'out'));
  expect(packages.map((item: { name: string }) => item.name)).toEqual(['first', 'second']);
});

it('does not exempt third-party packages merely because their name resembles a workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'ytdl-npm-external-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', dependencies: { external: '1' } }));
  const dependency = join(root, 'node_modules/external');
  mkdirSync(dependency, { recursive: true });
  writeFileSync(join(dependency, 'package.json'), JSON.stringify({ name: '@ytdl-flow/external', version: '1', license: 'MIT' }));
  expect(() => collectNpmLicenses(root, join(root, 'out'))).toThrow(/Missing license/);
});
