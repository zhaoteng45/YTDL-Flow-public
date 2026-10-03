import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

function resolvePackage(name, from) {
  // Bun's isolated linker puts transitive dependencies beside the real package,
  // rather than in the checkout's top-level node_modules.
  let current = fs.realpathSync(from);
  while (true) {
    const candidate = path.join(current, 'node_modules', name, 'package.json');
    if (fs.existsSync(candidate)) return fs.realpathSync(path.dirname(candidate));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const require = createRequire(path.join(from, 'package.json'));
  try {
    return path.dirname(fs.realpathSync(require.resolve(`${name}/package.json`)));
  } catch {
    throw new Error(`Cannot resolve production dependency ${name}`);
  }
}

export function collectNpmLicenses(root, output, supplements = {}) {
  const seen = new Set();
  const packages = [];
  const visit = (dir, include) => {
    dir = fs.realpathSync(dir);
    if (seen.has(dir)) return;
    seen.add(dir);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (include && !pkg.name?.startsWith('@ytdl-flow/')) {
      const names = fs.readdirSync(dir).filter((name) => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name));
      const files = names.filter((name) => fs.statSync(path.join(dir, name)).isFile());
      const supplement = supplements[`${pkg.name}@${pkg.version}`];
      if ((!files.length && !supplement) || !pkg.license) throw new Error(`Missing license metadata/text: ${pkg.name}@${pkg.version}`);
      const destination = `${pkg.name.replace(/[^a-z0-9._-]/gi, '_')}@${pkg.version}`;
      fs.mkdirSync(path.join(output, destination), { recursive: true });
      for (const name of files) fs.copyFileSync(path.join(dir, name), path.join(output, destination, name));
      if (supplement) {
        fs.copyFileSync(supplement, path.join(output, destination, 'UPSTREAM-LICENSE'));
        files.push('UPSTREAM-LICENSE');
      }
      packages.push({ name: pkg.name, version: pkg.version, license: pkg.license, files: files.map((name) => `${destination}/${name}`) });
    }
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      visit(resolvePackage(name, dir), true);
    }
    for (const name of Object.keys(pkg.optionalDependencies ?? {})) {
      // Optional packages absent on this target are not shipped. When present,
      // licensing errors still fail instead of being swallowed.
      let resolved;
      try { resolved = resolvePackage(name, dir); } catch { continue; }
      visit(resolved, true);
    }
  };
  visit(root, false);
  return packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}
