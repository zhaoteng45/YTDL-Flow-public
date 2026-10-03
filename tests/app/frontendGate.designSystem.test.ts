import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(path), 'utf8');

const globalStyles = read('src/styles.css');
const inputSource = read('src/components/InputSection.vue');
const settingsSource = read('src/components/SettingsPanel.vue');
const themeSelectorSource = read('src/components/ThemeSelector.vue');
const zh = JSON.parse(read('src/locales/zh-CN.json')) as Record<string, unknown>;
const en = JSON.parse(read('src/locales/en-US.json')) as Record<string, unknown>;

describe('pre-Human-Gate design-system hardening', () => {
  it('defines shared button modifiers globally for consumers outside DownloadList scoped CSS', () => {
    expect(globalStyles).toMatch(/\.neo-button\.small\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(globalStyles).toMatch(/\.neo-button\.icon-only\.small\s*\{[\s\S]*?width:\s*44px;/);
    expect(globalStyles).toMatch(/\.neo-button\.micro\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(globalStyles).toMatch(/\.neo-button\.ghost\s*\{/);
    expect(globalStyles).toMatch(/\.neo-button\.danger\s*\{/);
    expect(globalStyles).toMatch(/\.neo-button\.success\s*\{/);
  });

  it('uses design tokens instead of component-local hard-coded shadow colors', () => {
    expect(inputSource).not.toMatch(/box-shadow:[^;]*var\(--color-text\)/);
    expect(inputSource).toMatch(/\.analyze-btn-large\s*\{[\s\S]*?box-shadow:[^;]*var\(--color-shadow\)/);
  });

  it('does not animate every ThemeSelector property implicitly', () => {
    expect(themeSelectorSource).not.toMatch(/transition:\s*all\b/);
  });

  it('keeps Settings close controls at least 44px square', () => {
    expect(settingsSource).toMatch(/\.close-btn\s*\{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/);
  });

  it('localizes the InputSection ready-to-analyze badge in both supported locales', () => {
    expect(inputSource).toContain("t('input.ready_to_analyze')");
    expect(inputSource).not.toContain('>就绪待分析<');
    expect((zh.input as Record<string, unknown>)?.ready_to_analyze).toBeTypeOf('string');
    expect((en.input as Record<string, unknown>)?.ready_to_analyze).toBeTypeOf('string');
  });
});
