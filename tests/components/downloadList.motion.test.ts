import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/components/DownloadList.vue'), 'utf8');

describe('DownloadList motion safety', () => {
  it('keeps queue section transitions disabled for reduced-motion users', () => {
    expect(source).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.queue-section-enter-active[\s\S]*transition:\s*none/);
    expect(source).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.queue-section-leave-active[\s\S]*transition:\s*none/);
  });

  it('disables local animations for reduced-motion users', () => {
    expect(source).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.progress-liquid[\s\S]*animation:\s*none/);
    expect(source).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.progress-glow-complete[\s\S]*animation:\s*none/);
    expect(source).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.dots-animation[\s\S]*animation:\s*none/);
    expect(source).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.flash-animation[\s\S]*animation:\s*none/);
  });

  it('implements liquid barber-pole hazard stripes and completion glow animations', () => {
    expect(source).toMatch(/\.progress-fill\.progress-liquid\s*\{[\s\S]*?animation:\s*progress-stripes/);
    expect(source).toMatch(/@keyframes\s+progress-stripes/);
    expect(source).toMatch(/\.progress-fill\.progress-glow-complete\s*\{[\s\S]*?animation:\s*progress-complete-glow/);
    expect(source).toMatch(/@keyframes\s+progress-complete-glow/);
  });

  it('softens liquid progress stripes contrast and removes distracting flash on speed badge', () => {
    expect(source).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.12\)/);
    expect(source).not.toMatch(/class="speed-badge\s+flash-animation"/);
  });
});

describe('DownloadList log panel motion', () => {
  it('animates log panel disclosure and disables it for reduced motion', () => {
    expect(source).toMatch(/<Transition name="logs-panel">/);
    expect(source).toMatch(/\.logs-panel-enter-active,[\s\S]*\.logs-panel-leave-active[\s\S]*transition:/);
    expect(source).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.logs-panel-enter-active,[\s\S]*\.logs-panel-leave-active[\s\S]*transition:\s*none/);
  });
});
