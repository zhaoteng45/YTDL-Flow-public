import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve('src/App.vue'), 'utf8');
const inputSource = readFileSync(resolve('src/components/InputSection.vue'), 'utf8');
const ciSource = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');

const storeSource = readFileSync(resolve('src/stores/appStore.ts'), 'utf8');

describe('pinia access regression coverage', () => {
  it('avoids .value access on proxy-unwrapped store properties and retires audio', () => {
    expect(appSource).not.toMatch(/storeToRefs\(store as any\)/);
    expect(inputSource).not.toMatch(/storeToRefs\(store as any\)/);
    expect(existsSync(resolve('src/utils/audio.ts'))).toBe(false);

    expect(appSource).not.toMatch(/store\.[A-Za-z0-9_]+\.value/);
    expect(inputSource).not.toMatch(/store\.[A-Za-z0-9_]+\.value/);

    expect(appSource).toMatch(/unref\(store\.extraArgs\)/);
    expect(inputSource).toMatch(/unref\(store\.extraArgs\)/);
    expect(storeSource).not.toMatch(/audioManager/);
    expect(appSource).toContain(':model-value="theme"');
    expect(inputSource).toMatch(/extraArgs\.value\.cookies/);
  });
});

describe('desktop packaging smoke workflow', () => {
  it('stays on windows packaging with an explicit windows target', () => {
    expect(ciSource).toMatch(/desktop-packaging-smoke:[\s\S]*runs-on:\s+windows-latest/);
    expect(ciSource).toMatch(/desktop-packaging-smoke:[\s\S]*targets:\s+x86_64-pc-windows-msvc/);
    expect(ciSource).toMatch(/bun scripts\/mock-sidecars\.mjs --target x86_64-pc-windows-msvc/);
    expect(ciSource).toMatch(/bun scripts\/setup-sidecars\.mjs --target x86_64-pc-windows-msvc/);
    expect(ciSource).toMatch(/bun run tauri:build --target x86_64-pc-windows-msvc/);
    expect(ciSource).not.toMatch(/desktop-packaging-smoke:[\s\S]*runs-on:\s+ubuntu/);
    expect(ciSource).not.toMatch(/desktop-packaging-smoke:[\s\S]*x86_64-unknown-linux-gnu/);
  });
});
