import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const globalStyles = readFileSync(resolve('src/styles.css'), 'utf8');
const experienceStyles = readFileSync(resolve('src/styles-theme-experience.css'), 'utf8');
const appSource = readFileSync(resolve('src/App.vue'), 'utf8');
const settingsSource = readFileSync(resolve('src/components/SettingsPanel.vue'), 'utf8');
const themeSelectorSource = readFileSync(resolve('src/components/ThemeSelector.vue'), 'utf8');

describe('reduced-motion accessibility', () => {
  it('does not globally collapse every animation to a near-zero duration', () => {
    expect(globalStyles).not.toMatch(/animation-duration:\s*0\.01ms/);
    expect(experienceStyles).not.toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/);
  });

  it('disables supported-theme spatial and modal motion at the owning selector', () => {
    expect(experienceStyles).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.modal-overlay[\s\S]*animation:\s*none/,
    );
    expect(experienceStyles).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.logs-panel-enter-active[\s\S]*transition-duration:\s*0\.01ms/,
    );
    expect(appSource).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.modal-overlay,[\s\S]*animation:\s*none/);
    expect(settingsSource).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.qr-scan-line,[\s\S]*animation:\s*none/);
    expect(themeSelectorSource).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.dropdown-menu[\s\S]*animation:\s*none/);
  });
});
