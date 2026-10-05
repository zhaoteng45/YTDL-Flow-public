import { execFileSync } from 'node:child_process';

export function localOnlyReason(file, bytes = 0) {
  if (/^(?:\.agents|\.codex|\.opencode|\.ai-bridge|\.scratch|node_modules|dist)\//.test(file)) return 'local tooling or generated output';
  if (/^(?:AGENTS\.md|skills-lock\.json|DESIGN_DOCS_PROMPT_TEMPLATE\.md)$/.test(file)) return 'local agent configuration';
  if (/^(?:CONTEXT|DESIGN|DESIGN_LANGUAGE_GUIDE|PRODUCT)\.md$/.test(file) ||
      (/^docs\//.test(file) && ![
        'docs/release-ci.md', 'docs/RELEASE_INSTALLER_NOTES.md',
        'docs/reference/runtime-redistribution-audit-20261004.md',
      ].includes(file))) return 'internal documentation';
  if (file === '.cargo/config.toml') return 'local development cache configuration';
  if (/^tests\/ui\/.*\.prototype\.html$/.test(file)) return 'throwaway design prototype';
  if (/(?:^|\/)(?:target|__pycache__)\//.test(file) || /\.(?:exe|dll|msi|zip|7z|log|tmp|pyc)$/i.test(file)) return 'build artifact or cache';
  if (bytes > 50 * 1024 * 1024) return 'file exceeds 50 MiB';
  return null;
}

if (import.meta.main) {
  // Read index objects: unstaged edits and missing working files cannot change
  // what is about to be committed. A clean CI checkout has the same index as HEAD.
  const entries = execFileSync('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8' })
    .split('\0').filter(Boolean).map(entry => {
      const tab = entry.indexOf('\t');
      const [, oid, stage] = entry.slice(0, tab).split(' ');
      return { oid, stage, file: entry.slice(tab + 1) };
    });
  const sizes = entries.length ? execFileSync('git', ['cat-file', '--batch-check=%(objectsize)'], {
    encoding: 'utf8', input: entries.map(entry => entry.oid).join('\n') + '\n',
  }).trim().split(/\r?\n/) : [];
  const failures = entries.flatMap(({ file, stage }, index) => {
    if (stage !== '0') return [`${file}: unresolved index conflict`];
    const bytes = Number(sizes[index]);
    if (!Number.isSafeInteger(bytes) || bytes < 0) return [`${file}: cannot read staged object size`];
    const reason = localOnlyReason(file, bytes);
    return reason ? [`${file}: ${reason} (staged size: ${bytes} bytes)`] : [];
  });
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log(`Repository content PASS (${entries.length} staged source/configuration files)`);
}
