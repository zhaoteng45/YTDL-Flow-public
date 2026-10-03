import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/components/InputSection.vue'), 'utf8');

describe('InputSection hierarchy and labeling', () => {
  it('provides an explicit label for the textarea', () => {
    expect(source).toMatch(/<label[^>]*class="input-label"[^>]*:for="urlInputId"/);
    expect(source).toMatch(/<textarea[^>]*:id="urlInputId"/);
    expect(source).toMatch(/const urlInputId = useId\(\);/);
  });

  it('renders the analyze button before helper control groups in the main flow', () => {
    const analyzeIndex = source.indexOf('class="neo-button primary u-flex-center u-full-width analyze-btn-large btn-rebound"');
    const controlsIndex = source.indexOf('<div class="controls-row">');

    expect(analyzeIndex).toBeGreaterThan(-1);
    expect(controlsIndex).toBeGreaterThan(-1);
    expect(analyzeIndex).toBeLessThan(controlsIndex);
  });

  it('keeps cookie authentication controls out of the default homepage hierarchy', () => {
    expect(source).toMatch(/\.cookie-control-group\s*\{[\s\S]*?display:\s*none;/);
  });

  it('keeps nested input utilities at Level B instead of card-inside-card elevation', () => {
    const inputWrapper = source.match(/\.input-wrapper\s*\{([^}]*)\}/)?.[1] ?? '';
    const linkPreview = source.match(/\.link-preview\s*\{([^}]*)\}/)?.[1] ?? '';
    const directory = source.match(/\.dir-select-btn\s*\{([^}]*)\}/)?.[1] ?? '';
    const utilityIcon = source.match(/\.open-dir-btn,[\s\S]*?\.clear-cookies-btn\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(inputWrapper).toMatch(/border:\s*1px solid var\(--color-border\)/);
    expect(inputWrapper).toMatch(/box-shadow:\s*none/);
    expect(linkPreview).toMatch(/box-shadow:\s*none/);
    expect(directory).toMatch(/border:\s*1px solid var\(--color-border\)/);
    expect(directory).toMatch(/box-shadow:\s*none/);
    expect(utilityIcon).toMatch(/border:\s*1px solid var\(--color-border\)/);
    expect(utilityIcon).toMatch(/box-shadow:\s*none/);

    expect(source).toMatch(
      /\.dir-select-btn:hover\s*\{[\s\S]*?transform:\s*translateY\(-1px\);[\s\S]*?border-color:\s*var\(--color-primary\);/
    );
    expect(source).toMatch(
      /\.open-dir-btn:hover,[\s\S]*?\.clear-cookies-btn:hover\s*\{[\s\S]*?transform:\s*translateY\(-1px\);[\s\S]*?border-color:\s*var\(--color-primary\);/
    );
  });
});
