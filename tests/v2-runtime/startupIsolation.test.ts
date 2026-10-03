import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

interface GraphEdge {
  from: string;
  specifier: string;
}

interface GraphResult {
  files: Set<string>;
  bareSpecifiers: Set<string>;
  unresolved: GraphEdge[];
}

const RESOLUTION_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.vue'];

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function collectSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /import\s+(?:type\s+)?[\s\S]*?from\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /export\s+(?:type\s+)?[\s\S]*?from\s*['"]([^'"]+)['"]/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        specifiers.push(match[1]);
      }
    }
  }

  return specifiers;
}

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string;

  if (specifier.startsWith('@v2-runtime/')) {
    base = path.join(repoRoot, 'src', 'v2-runtime', specifier.slice('@v2-runtime/'.length));
  } else if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }

  const candidates = [
    base,
    ...RESOLUTION_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...RESOLUTION_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function walkGraph(entry: string): GraphResult {
  const files = new Set<string>();
  const bareSpecifiers = new Set<string>();
  const unresolved: GraphEdge[] = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || files.has(file)) {
      continue;
    }
    files.add(file);

    const source = readFileSync(file, 'utf8');
    for (const specifier of collectSpecifiers(source)) {
      const resolved = resolveSpecifier(specifier, file);
      if (!resolved) {
        if (specifier.startsWith('.')) {
          unresolved.push({ from: file, specifier });
        } else {
          bareSpecifiers.add(specifier);
        }
        continue;
      }
      queue.push(resolved);
    }
  }

  return { files, bareSpecifiers, unresolved };
}

function relative(files: Set<string>): string[] {
  return [...files].map((file) => toPosix(path.relative(repoRoot, file))).sort();
}

describe('opt-in React startup isolation', () => {
  const reactEntry = path.join(repoRoot, 'apps', 'desktop', 'frontend', 'src', 'main.tsx');
  const graph = walkGraph(reactEntry);
  const graphFiles = relative(graph.files);

  it('resolves the React entry graph without unresolved relative imports', () => {
    expect(graph.unresolved).toEqual([]);
    expect(graphFiles).toContain('apps/desktop/frontend/src/main.tsx');
  });

  it('never imports the legacy Vue runtime, TaskQueue or legacy stores', () => {
    const forbiddenFiles = ['src/App.vue', 'src/main.ts', 'src/i18n.ts', 'src/stores/appStore.ts'];
    for (const forbidden of forbiddenFiles) {
      expect(graphFiles).not.toContain(forbidden);
    }

    for (const file of graphFiles) {
      expect(file.startsWith('src/stores/')).toBe(false);
      expect(file.startsWith('src/queue/')).toBe(false);
      expect(file.startsWith('src/components/')).toBe(false);
    }

    for (const bare of ['vue', 'pinia', 'vue-i18n', '@vueuse/core']) {
      expect([...graph.bareSpecifiers]).not.toContain(bare);
    }
  });

  it('loads the React runtime composition and the shared Tauri adapters', () => {
    expect(graphFiles).toContain('apps/desktop/frontend/src/runtime/create-app-runtime.ts');
    expect(graphFiles).toContain('src/v2-runtime/tauriDownloadEngine.ts');
    expect(graphFiles).toContain('src/v2-runtime/tauriMediaAnalyzer.ts');
  });

  it('gates preview fixtures behind a dev-only guard', () => {
    const source = readFileSync(reactEntry, 'utf8');
    expect(source).toContain("import.meta.env.VITE_V2_SMOKE === '1'");
    expect(source).toContain('import.meta.env.DEV');
    expect(source).toContain('loadPreviewTasks');
    expect(source).toContain('createNativeAppRuntime');
  });

  it('keeps the default Vue entry on the legacy runtime and smoke rail', () => {
    const vueEntry = readFileSync(path.join(repoRoot, 'src', 'main.ts'), 'utf8');
    expect(vueEntry).toContain("import('./App.vue')");
    expect(vueEntry).toContain("import('pinia')");
    expect(vueEntry).toContain("import.meta.env.VITE_V2_SMOKE === '1'");
    expect(vueEntry).toContain('runNativeSmoke');
  });

  it('keeps exactly one TauriDownloadEngine implementation', () => {
    const searchRoots = ['src', 'packages', 'apps', 'tests'];
    const definitions: string[] = [];

    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === 'target' ||
          entry.name.startsWith('.')
        ) {
          continue;
        }
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(fullPath);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) {
          continue;
        }
        const source = readFileSync(fullPath, 'utf8');
        if (/class\s+TauriDownloadEngine\b/.test(source)) {
          definitions.push(toPosix(path.relative(repoRoot, fullPath)));
        }
      }
    };

    for (const root of searchRoots) {
      visit(path.join(repoRoot, root));
    }

    expect(definitions).toEqual(['src/v2-runtime/tauriDownloadEngine.ts']);
  });
});
