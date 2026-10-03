import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const libSource = readFileSync(resolve('src-tauri/src/lib.rs'), 'utf8');

describe('single instance wiring', () => {
  it('routes second launches to the existing main window', () => {
    expect(libSource).toMatch(/tauri_plugin_single_instance::init\(/);
    expect(libSource).toMatch(/get_webview_window\("main"\)/);
    expect(libSource).toMatch(/window\.set_focus\(\)/);
  });
});
