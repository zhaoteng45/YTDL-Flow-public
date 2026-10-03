import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('round-three brand and passive overhead', () => {
  it('reuses the formal SVG logo in the production header', () => {
    const app = readFileSync('src/App.vue', 'utf8');
    expect(app).toContain('ytdl-flow-primary.svg');
    expect(app).toContain('class="brand-logo"');
    expect(app).not.toContain('globalClickHandler');
    expect(app).not.toContain('audioManager');
  });
  it('keeps palette literals in theme-root definitions rather than component rules', () => {
    const css = readFileSync('src/styles-theme-experience.css', 'utf8');
    for (const [, selector, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\]\s+(?:\.|body)/.test(selector)) {
        expect(declarations, selector).not.toMatch(/#[\da-fA-F]{3,8}\b|rgba?\(/);
      }
    }
  });
  it('keeps system-theme component Hex colors behind semantic roles too', () => {
    const css = readFileSync('src/styles-system-themes.css', 'utf8');
    for (const [, selector, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\]\s+(?:\.|body)/.test(selector)) expect(declarations, selector).not.toMatch(/#[\da-fA-F]{3,8}\b/);
    }
  });
});
