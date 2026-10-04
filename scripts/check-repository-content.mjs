import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

export function localOnlyReason(file, bytes = 0) {
  if (/^(?:\.agents|\.codex|\.opencode|\.ai-bridge|\.scratch|node_modules|dist)\//.test(file)) return 'local tooling or generated output';
  if (/^(?:AGENTS\.md|skills-lock\.json|DESIGN_DOCS_PROMPT_TEMPLATE\.md)$/.test(file)) return 'local agent configuration';
  if (/(?:^|\/)(?:target|__pycache__)\//.test(file) || /\.(?:exe|dll|msi|zip|7z|log|tmp|pyc)$/i.test(file)) return 'build artifact or cache';
  if (bytes > 50 * 1024 * 1024) return 'file exceeds 50 MiB';
  return null;
}

if (import.meta.main) {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const failures = files.flatMap(file => {
    const reason = localOnlyReason(file, statSync(file).size);
    return reason ? [`${file}: ${reason}`] : [];
  });
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log(`Repository content PASS (${files.length} tracked source/configuration files)`);
}
