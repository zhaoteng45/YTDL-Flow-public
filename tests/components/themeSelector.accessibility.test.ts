import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const selectorSource = readFileSync(resolve('src/components/ThemeSelector.vue'), 'utf8');
const constantsSource = readFileSync(resolve('src/constants.ts'), 'utf8');
const appSource = readFileSync(resolve('src/App.vue'), 'utf8');
const stylesSource = readFileSync(resolve('src/styles.css'), 'utf8');
const systemStylesSource = readFileSync(resolve('src/styles-system-themes.css'), 'utf8');
const experienceStylesSource = readFileSync(resolve('src/styles-theme-experience.css'), 'utf8');
const allStyles = `${stylesSource}\n${systemStylesSource}\n${experienceStylesSource}`;

describe('ThemeSelector accessibility and retained theme coverage', () => {
  it('exposes exactly Clean, Fluent, and Graphite through compatible IDs', () => {
    expect(constantsSource).toContain("COBALT_BUTTER: 'cobalt-butter'");
    expect(constantsSource).toContain("FLUENT: 'fluent'");
    expect(constantsSource).toContain("MATERIAL: 'material'");

    expect(selectorSource).toContain("value: THEMES.COBALT_BUTTER, label: 'app.theme_cobalt_butter'");
    expect(selectorSource).toContain("value: THEMES.FLUENT, label: 'app.theme_fluent'");
    expect(selectorSource).toContain("value: THEMES.MATERIAL, label: 'app.theme_material'");

    for (const removed of [
      'NEO_BRUTALISM',
      'BLUE_CORAL',
      'TEAL_BUTTER',
      'DARK',
      'CODEX',
      'MORANDI',
      'CYBER',
      'POKEMON',
      'PING_PONG',
      'PAPER_PLANE',
      'NATURAL_TAUPE',
      'NATURAL_OLIVE',
    ]) {
      expect(constantsSource).not.toMatch(new RegExp(`\\b${removed}:`));
      expect(selectorSource).not.toContain(`THEMES.${removed}`);
    }
  });

  it('keeps the legacy cobalt-butter slot neutral and flat, with shared brand ownership', () => {
    const block = stylesSource.match(/\[data-theme=["']cobalt-butter["']\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(block).toContain('--color-bg: var(--neutral-canvas);');
    expect(block).toContain('--color-surface: var(--neutral-surface);');
    expect(block).toContain('--color-text: var(--neutral-text-primary);');
    expect(block).not.toContain('--color-primary:');
    expect(block).not.toContain('--color-accent:');

    const primaryRule = stylesSource.match(/\[data-theme="cobalt-butter"\] \.neo-button\.primary\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(primaryRule).toContain('box-shadow: none;');
    expect(primaryRule).not.toContain('var(--color-secondary)');
  });

  it('keeps Graphite muted text at WCAG AA contrast on working and subtle surfaces', () => {
    const block = stylesSource.match(/\[data-theme=["']cobalt-butter["']\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const readToken = (name: string) => {
      const value = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
      expect(value, `missing --${name} in Graphite`).toBeTruthy();
      return value!;
    };

    const srgbLuminance = (hex: string) => {
      const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
      const linear = channels.map((channel) => (
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4
      ));
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };

    const contrast = (a: string, b: string) => {
      const [lighter, darker] = [srgbLuminance(a), srgbLuminance(b)].sort((x, y) => y - x);
      return (lighter + 0.05) / (darker + 0.05);
    };

    const muted = readToken('neutral-text-secondary');
    expect(contrast(muted, readToken('neutral-surface'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(muted, readToken('neutral-surface-subtle'))).toBeGreaterThanOrEqual(4.5);
  });

  it('owns brand and semantic values once and intentionally pairs secondary foreground', () => {
    expect(stylesSource).toContain('--brand-primary: #2457A7;');
    expect(stylesSource).toContain('--color-on-secondary: var(--neutral-text-primary);');
    expect(stylesSource).toContain('--semantic-busy-bg: var(--semantic-info-bg);');
    expect(systemStylesSource).not.toMatch(/--color-(?:primary|success|warning|error):\s*#/);
    expect(experienceStylesSource).not.toMatch(/--color-(?:primary|accent):\s*#/);
  });

  it('scrolls the keyboard-active theme option into view', () => {
    expect(selectorSource).toMatch(/ref="listboxRef"/);
    expect(selectorSource).toMatch(/scrollIntoView\(\{\s*block:\s*'nearest'/);
    expect(selectorSource).toMatch(/watch\(\[isOpen, focusedIndex\]/);
  });

  it('shares the same header-control interaction primitive as the settings trigger', () => {
    expect(selectorSource).toMatch(/class="selector-trigger header-control"/);
    expect(appSource).toMatch(/class="neo-button icon-btn settings-toggle header-control"/);
    expect(stylesSource).toMatch(/\.header-actions \.header-control\s*\{[\s\S]*?box-shadow:\s*var\(--shadow-hard-sm\);/);
    expect(selectorSource).not.toMatch(/\.selector-trigger:hover\s*\{/);
  });

  it('announces the current theme and keyboard-active option', () => {
    expect(selectorSource).toMatch(/role="combobox"/);
    expect(selectorSource).toMatch(/:aria-label="t\('app\.current_theme', \{ theme: t\(currentTheme\.label\) \}\)"/);
    expect(selectorSource).toMatch(/:aria-activedescendant="activeDescendant"/);
    expect(selectorSource).toMatch(/:aria-controls="listboxId"/);
  });

  it('preserves accessible high contrast on active dropdown options', () => {
    expect(selectorSource).toMatch(/\.dropdown-item\.active\s*\{[^}]*color:\s*var\(--color-on-primary/);
  });

  it('protects version badge legibility across retained theme backgrounds', () => {
    expect(appSource).toMatch(/\.badge\s*\{[^}]*color:\s*var\(--color-on-secondary/);
  });

  it('keeps Material danger and primary button taxonomy isolated', () => {
    expect(allStyles).toMatch(/(?:\:root)?\[data-theme="material"\] \.neo-button\.danger/);
    expect(allStyles).toMatch(/(?:\:root)?\[data-theme="material"\] \.neo-button\.primary/);
  });

  it('restricts dropdown menu height and supports scrolling without text clipping', () => {
    expect(selectorSource).toMatch(/\.dropdown-menu\s*\{[\s\S]*?max-height:\s*\d+px;/);
    expect(selectorSource).toMatch(/\.dropdown-menu\s*\{[\s\S]*?overflow-y:\s*auto;/);
    expect(selectorSource).toMatch(/\.dropdown-menu\s*\{[\s\S]*?min-width:\s*2/);
  });

  it('keeps global semantic button tokens wired for primary, danger, and success', () => {
    expect(stylesSource).toMatch(/\.neo-button\.primary\s*\{[\s\S]*?background-color:\s*var\(--color-primary\);/);
    expect(stylesSource).toMatch(/\.neo-button\.primary\s*\{[\s\S]*?color:\s*var\(--color-on-primary\);/);
    expect(stylesSource).toMatch(/\.neo-button\.primary:hover:not\(:disabled\)[\s\S]*?background-color:\s*var\(--color-primary-hover\);/);
    expect(stylesSource).toMatch(/\.neo-button\.danger\s*\{[\s\S]*?color:\s*var\(--color-error\);/);
    expect(stylesSource).toMatch(/\.neo-button\.success\s*\{[\s\S]*?color:\s*var\(--color-success\);/);
  });
});
