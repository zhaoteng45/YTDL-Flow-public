import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/components/InputSection.vue'), 'utf8');

describe('InputSection layout safeguards', () => {
  it('keeps the textarea as a single control with absolute-positioned utility buttons inside the shell', () => {
    expect(source).toMatch(/<div class="input-field-shell">[\s\S]*<textarea[^>]*class="neo-input neo-textarea"[\s\S]*<div class="input-actions">/);
    expect(source).toMatch(/\.input-field-shell\s*\{[\s\S]*position:\s*relative;/);
    expect(source).toMatch(/\.input-actions\s*\{[\s\S]*position:\s*absolute;/);
    expect(source).toMatch(/\.input-actions\s*\{[\s\S]*top:\s*(?:8px|10px|12px);/);
    expect(source).toMatch(/\.input-actions\s*\{[\s\S]*right:\s*(?:8px|10px|12px);/);
  });

  it('reserves enough right padding for the utility buttons without overlaying placeholder text', () => {
    expect(source).toMatch(/\.neo-textarea\s*\{[\s\S]*padding-right:\s*(?:108px|112px|116px|120px);/);
    expect(source).toMatch(/\.neo-textarea\s*\{[\s\S]*word-break:\s*break-word;/);
    expect(source).toMatch(/\.neo-textarea\s*\{[\s\S]*overflow-wrap:\s*anywhere;/);
  });

  it('keeps utility buttons visually refined with accessible >=44px hit targets', () => {
    expect(source).toMatch(/\.ui-ghost-button\s*\{[\s\S]*min-height:\s*44px;/);
    expect(source).toMatch(/\.ui-ghost-button\s*\{[\s\S]*min-width:\s*44px;/);
    // Not using heavy block background or 2px thick border
    expect(source).not.toMatch(/\.ui-ghost-button\s*\{[\s\S]*border:\s*2px solid/);
    expect(source).toMatch(/\.ui-ghost-button\s*\{[\s\S]*border:\s*1px solid/);
  });

  it('defines restrained sans-serif typography for the textarea placeholder', () => {
    expect(source).toMatch(/\.neo-textarea::placeholder\s*\{[\s\S]*font-family:\s*var\(--font-sans/);
    expect(source).toMatch(/\.neo-textarea::placeholder\s*\{[\s\S]*line-height:\s*1\.[4-6]/);
  });
});
