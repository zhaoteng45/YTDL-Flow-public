import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/release.mjs');
const directories: string[] = [];
const versionFiles = ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'ytdl-release-test-'));
  directories.push(cwd);
  mkdirSync(join(cwd, 'src-tauri'));
  writeFileSync(join(cwd, 'package.json'), '{"name":"fixture","version":"1.2.3"}\n');
  writeFileSync(join(cwd, 'src-tauri/tauri.conf.json'), '{"version":"1.2.3"}\n');
  writeFileSync(join(cwd, 'src-tauri/Cargo.toml'), '[package]\nname = "fixture"\nversion = "1.2.3"\n\n[dependencies]\nother = "1.2.3"\n');
  writeFileSync(join(cwd, 'src-tauri/Cargo.lock'), 'version = 4\n\n[[package]]\nname = "other"\nversion = "1.2.3"\n\n[[package]]\nname = "fixture"\nversion = "1.2.3"\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Release Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  const read = (file: string) => readFileSync(join(cwd, file), 'utf8');
  const run = (version: string) => spawnSync('bun', [script, version], { cwd, encoding: 'utf8', timeout: 10000 });
  return { cwd, git, read, run };
}
afterEach(() => {
  for (const cwd of directories.splice(0)) rmSync(cwd, { recursive: true, force: true });
});

describe('release preparation CLI', () => {
  it.skipIf(process.platform !== 'win32')('accepts equivalent Windows drive casing at the repository root', () => {
    const f = fixture();
    const result = spawnSync('bun', [script, '1.2.4'], { cwd: f.cwd.replace(/^[A-Z]:/, drive => drive.toLowerCase()), encoding: 'utf8', timeout: 10000 });
    expect(result.status, result.stderr).toBe(0);
  });
  it('fails the CI version check when the root lock version is stale', () => {
    const f = fixture();
    writeFileSync(join(f.cwd, 'src-tauri/Cargo.lock'), f.read('src-tauri/Cargo.lock').replace('name = "fixture"\nversion = "1.2.3"', 'name = "fixture"\nversion = "1.2.2"'));
    const result = spawnSync('bun', [resolve('scripts/check-versions.mjs')], { cwd: f.cwd, encoding: 'utf8', timeout: 10000 });
    expect(result.status).toBe(1);
  });
  it.each(['1.2.3', '1.2.2', '01.2.4', '1.2.4-beta', '1.2.4;echo nope'])('rejects invalid or non-increasing version %s without mutation', version => {
    const f = fixture();
    const before = versionFiles.map(f.read);
    const head = f.git('rev-parse', 'HEAD');
    expect(f.run(version).status).not.toBe(0);
    expect(versionFiles.map(f.read)).toEqual(before);
    expect(f.git('rev-parse', 'HEAD')).toBe(head);
    expect(f.git('tag', '--list')).toBe('');
  });
  it.each([false, true])('rejects dirty work (staged=%s) without changing versions', staged => {
    const f = fixture();
    writeFileSync(join(f.cwd, 'unrelated.txt'), 'keep my work');
    if (staged) f.git('add', 'unrelated.txt');
    const before = versionFiles.map(f.read);
    const status = f.git('status', '--porcelain');
    expect(f.run('1.2.4').stderr).toContain('Worktree must be clean');
    expect(versionFiles.map(f.read)).toEqual(before);
    expect(f.git('status', '--porcelain')).toBe(status);
  });
  it('rejects an existing tag before modifying files', () => {
    const f = fixture();
    f.git('tag', 'v1.2.4');
    const before = versionFiles.map(f.read);
    expect(f.run('1.2.4').stderr).toContain('Release tag already exists');
    expect(versionFiles.map(f.read)).toEqual(before);
  });
  it('prints help without changing the repository', () => {
    const f = fixture();
    const before = versionFiles.map(f.read);
    expect(f.run('--help').status).toBe(0);
    expect(versionFiles.map(f.read)).toEqual(before);
    expect(f.git('status', '--porcelain')).toBe('');
  });
  it('preserves inspectable changes and creates no tag when commit fails', () => {
    const f = fixture();
    writeFileSync(join(f.cwd, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const head = f.git('rev-parse', 'HEAD');
    const result = f.run('1.2.4');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Git step failed: Creating release commit');
    expect(f.git('rev-parse', 'HEAD')).toBe(head);
    expect(f.git('tag', '--list')).toBe('');
    expect(f.git('diff', '--cached', '--name-only').split('\n').sort()).toEqual([...versionFiles].sort());
  });
  it('does not tag a commit changed by a Git hook', () => {
    const f = fixture();
    writeFileSync(join(f.cwd, '.git/hooks/pre-commit'), '#!/bin/sh\nprintf "unexpected" > extra.txt\ngit add extra.txt\n', { mode: 0o755 });
    const result = f.run('1.2.4');
    expect(result.status).not.toBe(0);
    expect(f.git('tag', '--list')).toBe('');
  });
  it('rejects a stale Cargo lock before mutation', () => {
    const f = fixture();
    writeFileSync(join(f.cwd, 'src-tauri/Cargo.lock'), f.read('src-tauri/Cargo.lock').replace('name = "fixture"\nversion = "1.2.3"', 'name = "fixture"\nversion = "1.2.2"'));
    f.git('add', '.');
    f.git('commit', '-qm', 'stale lock');
    const before = versionFiles.map(f.read);
    expect(f.run('1.2.4').stderr).toContain('Current version files do not match');
    expect(versionFiles.map(f.read)).toEqual(before);
  });
  it('commits all four version files and tags the exact resulting commit', () => {
    const f = fixture();
    const result = f.run('1.2.4');
    expect(result.status, result.stderr).toBe(0);
    expect(f.read('src-tauri/Cargo.lock')).toContain('name = "fixture"\nversion = "1.2.4"');
    expect(f.read('src-tauri/Cargo.lock')).toContain('name = "other"\nversion = "1.2.3"');
    expect(f.read('src-tauri/Cargo.toml')).toContain('other = "1.2.3"');
    expect(f.git('show', '--format=', '--name-only', 'HEAD').split('\n').sort()).toEqual([...versionFiles].sort());
    expect(f.git('rev-parse', 'v1.2.4')).toBe(f.git('rev-parse', 'HEAD'));
    expect(f.git('status', '--porcelain')).toBe('');
  });
});
