import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/App.vue'), 'utf8');

describe('App shell layout rebalance', () => {
  it('widens the desktop sidebar to give operation controls room', () => {
    expect(source).toMatch(/\.sidebar\s*\{[\s\S]*width:\s*420px;/);
  });

  it('uses an empty-state shell and compact card instead of letting the placeholder fill the whole workspace', () => {
    expect(source).toMatch(/<section[^>]*class="empty-state-shell"[^>]*>[\s\S]*<div class="empty-state neo-box">/);
    expect(source).toMatch(/\.empty-state-shell\s*\{[\s\S]*justify-content:\s*center;/);
    expect(source).toMatch(/\.empty-state\s*\{[\s\S]*max-width:\s*640px;/);
    expect(source).toMatch(/\.empty-state\s*\{[\s\S]*padding:\s*32px 28px;/);
  });

  it('keeps empty-state decoration secondary to the title and single primary action', () => {
    expect(source).toMatch(/\.empty-icon\s*\{[\s\S]*width:\s*96px;/);
    expect(source).toMatch(/\.empty-icon\s*\{[\s\S]*height:\s*96px;/);
    expect(source).not.toMatch(/animation:\s*float/);
    expect(source).toMatch(/<div class="empty-actions">[\s\S]*<button class="neo-button ghost"/);
  });

  it('keeps the operational header focused on product identity and controls', () => {
    expect(source).not.toContain('class="dedication-badge"');
    expect(source).not.toContain('Designed for');
    expect(source).not.toContain('dedicationIcon');
  });

  it('uses restrained tool-like header logo and metadata badge typography instead of poster banner styling', () => {
    const logoBlock = source.match(/\.logo\s*\{([^}]*)\}/)?.[1] ?? '';
    const badgeBlock = source.match(/\.badge\s*\{([^}]*)\}/)?.[1] ?? '';
    const headerBlock = source.match(/\.header\s*\{([^}]*)\}/)?.[1] ?? '';

    // Header border must not be an overwhelming 4px thick line
    expect(headerBlock).not.toMatch(/border-bottom:\s*4px solid/);
    expect(headerBlock).toMatch(/border-bottom:\s*(?:1px|2px) solid var\(--color-border\);/);

    // Logo should be tool-like (1.35rem ~ 1.65rem), not an oversized 2.25rem banner
    expect(logoBlock).not.toMatch(/font-size:\s*2\.25rem;/);
    expect(logoBlock).toMatch(/font-size:\s*(?:1\.[3-6][0-9]?rem|max\(1\.[3-6][0-9]?rem,[^)]+\));/);
    expect(logoBlock).not.toMatch(/text-shadow:\s*2px 2px 0/);
    expect(logoBlock).toMatch(/text-transform:\s*none;/);

    // Version badge should be subtle metadata, not a heavy yellow poster block
    expect(badgeBlock).not.toMatch(/background-color:\s*var\(--color-secondary\);/);
    expect(badgeBlock).not.toMatch(/box-shadow:\s*2px 2px 0 0/);
  });

  it('keeps one main landmark and wraps the header before it can overflow', () => {
    expect(source).toMatch(/<div class="container">/);
    expect(source.match(/<main\b/g) ?? []).toHaveLength(1);
    expect(source).toMatch(/@media \(max-width: 1024px\) \{[\s\S]*?\.header\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
  });

  it('keeps Resource Capture code available while hiding its sidebar entry', () => {
    expect(source).toContain("import CapturePanel from './components/CapturePanel.vue';");
    expect(source).toContain('const resourceCaptureVisible = false;');
    expect(source).toMatch(
      /<div v-if="resourceCaptureVisible" class="neo-box sidebar-panel glass-panel capture-sidebar-panel">[\s\S]*?<CapturePanel :capture="taskRuntime\.capture" \/>/
    );
  });
});
