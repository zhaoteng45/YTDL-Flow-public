import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(resolve('src/main.ts'), 'utf8');
const appSource = readFileSync(resolve('src/App.vue'), 'utf8');
const systemThemeStyles = readFileSync(resolve('src/styles-system-themes.css'), 'utf8');

describe('Fluent and Material system theme layouts', () => {
  it('loads system-theme refinements after the shared theme stylesheet', () => {
    const base = mainSource.indexOf("import './styles.css'");
    const systems = mainSource.indexOf("import './styles-system-themes.css'");
    expect(base).toBeGreaterThanOrEqual(0);
    expect(systems).toBeGreaterThan(base);
  });

  it('gives Fluent a Windows-style navigation pane shell instead of Neo card geometry', () => {
    expect(systemThemeStyles).toMatch(/:root\[data-theme="fluent"\][\s\S]*?--fluent-pane-width:\s*360px/);
    expect(systemThemeStyles).toMatch(/:root\[data-theme="fluent"\] \.app-layout\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*var\(--fluent-pane-width\) minmax\(0, 1fr\)/);
    expect(systemThemeStyles).toMatch(/:root\[data-theme="fluent"\] \.sidebar-panel\s*\{[\s\S]*?box-shadow:\s*none;/);
    expect(systemThemeStyles).toMatch(/:root\[data-theme="fluent"\] \.settings-container\s*\{[\s\S]*?grid-template-columns:\s*220px minmax\(0, 1fr\)/);
    expect(systemThemeStyles).toMatch(/:root\[data-theme="fluent"\] \.settings-tabs\s*\{[\s\S]*?flex-direction:\s*column;/);
  });

  it('gives Material an adaptive content + supporting-pane composition', () => {
    expect(systemThemeStyles).toMatch(/:root\[data-theme="material"\][\s\S]*?--md-sys-color-primary:\s*var\(--brand-primary\)/);
    expect(systemThemeStyles).toMatch(/:root\[data-theme="material"\] \.app-layout\s*\{[\s\S]*?grid-template-areas:\s*"content support"/);
    expect(systemThemeStyles).toMatch(/:root\[data-theme="material"\] \.main-content\s*\{[\s\S]*?grid-area:\s*content;/);
    expect(systemThemeStyles).toMatch(/:root\[data-theme="material"\] \.sidebar\s*\{[\s\S]*?grid-area:\s*support;/);
    expect(systemThemeStyles).toMatch(/:root\[data-theme="material"\] \.settings-tabs\s*\{[\s\S]*?flex-direction:\s*column;/);
    expect(systemThemeStyles).toMatch(/:root\[data-theme="material"\] \.tab-btn\.active\s*\{[\s\S]*?background:\s*var\(--md-sys-color-primary-container\);/);
  });

  it('adapts both desktop-specific layouts down to a single-column experience', () => {
    expect(systemThemeStyles).toMatch(/@media \(max-width:\s*1180px\)[\s\S]*?:root\[data-theme="material"\] \.app-layout[\s\S]*?grid-template-areas:\s*"support"[\s\S]*?"content"/);
    expect(systemThemeStyles).toMatch(/@media \(max-width:\s*900px\)[\s\S]*?:root\[data-theme="fluent"\] \.app-layout[\s\S]*?grid-template-columns:\s*1fr/);
  });

  it('scopes settings dialog geometry so nested auth and QR dialogs keep their own sizing', () => {
    expect(appSource).toMatch(/class="modal-content settings-modal-content"/);
    expect(systemThemeStyles).toMatch(/:root\[data-theme="fluent"\] \.settings-modal-content\s*\{/);
    expect(systemThemeStyles).toMatch(/:root\[data-theme="material"\] \.settings-modal-content\s*\{/);
    expect(systemThemeStyles).not.toMatch(/:root\[data-theme="fluent"\] \.modal-content\s*\{/);
    expect(systemThemeStyles).not.toMatch(/:root\[data-theme="material"\] \.modal-content\s*\{/);
  });

  it('keeps completed cards structurally neutral while success remains a local semantic', () => {
    expect(systemThemeStyles).toMatch(/:root\[data-theme="fluent"\] \.download-card\.completed\s*\{[\s\S]*?border-color:\s*rgba\(0, 0, 0, 0\.07\);/);
    expect(systemThemeStyles).toMatch(/:root\[data-theme="material"\] \.download-card\.completed\s*\{[\s\S]*?border-color:\s*var\(--md-sys-color-outline-variant\);/);
  });

  it('preserves the project 44px minimum hit target in system themes', () => {
    expect(systemThemeStyles).toMatch(/:root\[data-theme="fluent"\] \.header-actions \.header-control\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(systemThemeStyles).toMatch(/:root\[data-theme="fluent"\] \.tab-btn\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(systemThemeStyles).toMatch(/:root\[data-theme="material"\] \.header-actions \.header-control\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(systemThemeStyles).toMatch(/:root\[data-theme="material"\] \.filter-pill\s*\{[\s\S]*?min-height:\s*44px;/);
  });

  it('keeps interaction motion explicit and disables decorative Material empty-state floating', () => {
    expect(systemThemeStyles).not.toContain('transition: all');
    expect(systemThemeStyles).toMatch(/:root\[data-theme="material"\] \.empty-icon \.icon-folder::after\s*\{[\s\S]*?animation:\s*none;/);
  });
});
