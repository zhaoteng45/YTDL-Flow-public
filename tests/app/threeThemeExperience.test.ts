import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(resolve('src/main.ts'), 'utf8');
const appSource = readFileSync(resolve('src/App.vue'), 'utf8');
const baseStyles = readFileSync(resolve('src/styles.css'), 'utf8');
const experienceStyles = readFileSync(resolve('src/styles-theme-experience.css'), 'utf8');

describe('three-theme experience reconstruction', () => {
  it('loads the experience layer after base and system theme styles', () => {
    const base = mainSource.indexOf("import './styles.css'");
    const systems = mainSource.indexOf("import './styles-system-themes.css'");
    const experience = mainSource.indexOf("import './styles-theme-experience.css'");

    expect(base).toBeGreaterThanOrEqual(0);
    expect(systems).toBeGreaterThan(base);
    expect(experience).toBeGreaterThan(systems);
  });

  it('keeps the operational header focused on brand and app controls', () => {
    expect(appSource).not.toContain('class="dedication-badge"');
    expect(appSource).not.toContain('dedicationIcon');
    expect(appSource).not.toContain('Designed for');
  });

  it('defines shared low-cost motion tokens and reduced-motion behavior', () => {
    expect(experienceStyles).toContain('--motion-fast: 110ms;');
    expect(experienceStyles).toContain('--motion-standard: 160ms;');
    expect(experienceStyles).toContain('--motion-spatial: 220ms;');
    expect(experienceStyles).toContain('--ease-tactile: cubic-bezier(0.23, 1, 0.32, 1);');
    expect(experienceStyles).toContain('--ease-emphasized: cubic-bezier(0.2, 0, 0, 1);');
    expect(experienceStyles).not.toContain('transition: all');
    expect(experienceStyles).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('gives all three themes a deliberate home, settings, and console treatment', () => {
    for (const theme of ['cobalt-butter', 'fluent', 'material']) {
      expect(experienceStyles).toMatch(new RegExp(`:root\\[data-theme="${theme}"\\] \\.app-layout\\s*\\{`));
      expect(experienceStyles).toMatch(new RegExp(`:root\\[data-theme="${theme}"\\] \\.settings-container\\s*\\{`));
      expect(experienceStyles).toMatch(new RegExp(`:root\\[data-theme="${theme}"\\] \\.logs-panel\\s*\\{`));
    }
  });

  it('uses vertical desktop settings navigation for all supported themes', () => {
    const sharedNav = experienceStyles.match(
      /:root:is\(\[data-theme="cobalt-butter"\], \[data-theme="fluent"\], \[data-theme="material"\]\) \.settings-tabs\s*\{([^}]*)\}/,
    )?.[1] ?? '';

    expect(sharedNav).toContain('flex-direction: column;');
  });

  it('bounds log paint and disables expensive large-pane blur', () => {
    expect(experienceStyles).toMatch(/\.logs-panel\s*\{[\s\S]*?contain:\s*(?:layout\s+)?paint;/);

    const appLayoutBlocks = [...experienceStyles.matchAll(/\.app-layout\s*\{([^}]*)\}/g)].map((match) => match[1]);
    expect(appLayoutBlocks.length).toBeGreaterThanOrEqual(3);
    for (const block of appLayoutBlocks) {
      const blur = block.match(/backdrop-filter:\s*([^;]+);/)?.[1]?.trim();
      if (blur) expect(blur).toBe('none');
    }
  });

  it('keeps the base stylesheet theme-agnostic except for the custom Petrol theme', () => {
    const themeIds = [...baseStyles.matchAll(/data-theme=["']([^"']+)["']/g)].map((match) => match[1]);
    expect([...new Set(themeIds)]).toEqual(['cobalt-butter']);
  });

  it('keeps theme motion transform/opacity based for spatial changes', () => {
    expect(experienceStyles).toMatch(/\.logs-panel-enter-active,[\s\S]*?transition:[\s\S]*?opacity/);
    expect(experienceStyles).toMatch(/\.logs-panel-enter-from,[\s\S]*?transform:/);
    expect(experienceStyles).not.toMatch(/transition:[^;]*(?:width|height|top|left|margin)/);
  });
});
