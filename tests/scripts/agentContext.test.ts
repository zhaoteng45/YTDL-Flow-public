import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = resolve('scripts/check-agent-context.mjs');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createFixture(status: string | null, legacyTask = 'LEGACY-TASK') {
  const root = mkdtempSync(join(os.tmpdir(), 'agent-context-'));
  tempDirs.push(root);

  writeFileSync(join(root, 'AGENTS.md'), '# fixture\n');
  writeFileSync(join(root, 'skills-lock.json'), JSON.stringify({ skills: { 'codebase-design': {} } }));

  const routing = join(root, 'docs', 'agents', 'skill-routing.md');
  mkdirSync(dirname(routing), { recursive: true });
  writeFileSync(routing, '# routing\n');

  const skill = join(root, '.agents', 'skills', 'codebase-design', 'SKILL.md');
  mkdirSync(dirname(skill), { recursive: true });
  writeFileSync(skill, '---\nname: codebase-design\ndescription: fixture\n---\n');

  const legacy = join(root, '.ai-bridge', 'current-workflow.md');
  mkdirSync(dirname(legacy), { recursive: true });
  writeFileSync(
    legacy,
    `# legacy\nTask: ${legacyTask}\nStatus: CHANGES_REQUIRED\nActive Workflow:\n- diagnosing-bugs\n`,
  );

  const legacyActive = join(root, '.ai-bridge', 'tasks', 'active', 'legacy.md');
  mkdirSync(dirname(legacyActive), { recursive: true });
  writeFileSync(legacyActive, `---\ntask_id: ${legacyTask}\n---\n`);

  if (status !== null) {
    writeFileSync(join(root, '.ai-bridge', 'STATUS.md'), status);
  }

  return root;
}

function runCheck(root: string) {
  return spawnSync('bun', [scriptPath], {
    cwd: root,
    encoding: 'utf8',
  });
}

const validStatus = (lineEnding = '\n') =>
  [
    '---',
    'task: LIGHTWEIGHT-001',
    'status: active',
    'writer: sol',
    'human_gate: not_required',
    'updated_at: 2026-09-20T17:10:00+08:00',
    '---',
    '',
    '# Current Task',
    '',
    'Goal:',
    'fixture',
    '',
    'Workflow:',
    'codebase-design',
    '',
    'Next:',
    'continue',
    '',
  ].join(lineEnding);

describe('agent context lightweight STATUS reader', () => {
  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ])('reads the fixed STATUS template with %s endings', (_name, eol) => {
    const root = createFixture(validStatus(eol));
    const result = runCheck(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Task [LIGHTWEIGHT-001]');
    expect(result.stdout).toContain('Workflow [codebase-design]');
    expect(result.stdout).toContain('Status [active]');
    expect(result.stdout).not.toContain('LEGACY-TASK');
  });

  it('fails closed when STATUS is missing even if legacy state exists', () => {
    const root = createFixture(null);
    const result = runCheck(root);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('missing .ai-bridge/STATUS.md');
    expect(result.stdout).not.toContain('LEGACY-TASK');
  });

  it.each([
    ['malformed frontmatter', '---\ntask LIGHTWEIGHT-001\n---\n\nWorkflow:\ncodebase-design\n'],
    [
      'invalid status',
      validStatus().replace('status: active', 'status: READY_FOR_REVIEW'),
    ],
    ['missing workflow', validStatus().replace('Workflow:\ncodebase-design\n', '')],
    ['missing required field', validStatus().replace('writer: sol\n', '')],
  ])('rejects %s without falling back to legacy authority', (_name, status) => {
    const root = createFixture(status);
    const result = runCheck(root);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('Context   : ❌');
    expect(result.stdout).not.toContain('LEGACY-TASK');
  });

  it('accepts readable non-active states without treating them as completion gates', () => {
    for (const state of ['idle', 'review', 'blocked'] as const) {
      const task = state === 'idle' ? 'none' : 'LIGHTWEIGHT-001';
      const workflow = state === 'idle' ? 'none' : 'codebase-design';
      const status = validStatus()
        .replace('task: LIGHTWEIGHT-001', `task: ${task}`)
        .replace('status: active', `status: ${state}`)
        .replace('writer: sol', 'writer: none')
        .replace('Workflow:\ncodebase-design', `Workflow:\n${workflow}`);

      const root = createFixture(status);
      const result = runCheck(root);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`Status [${state}]`);
    }
  });
});
