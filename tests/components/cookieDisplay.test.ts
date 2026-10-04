import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('compact cookie display', () => {
  it('shows the filename once in the home control and exposes full path on focus', () => {
    const source = readFileSync('src/components/InputSection.vue', 'utf8');
    expect(source).toContain(':data-cookie-path="extraArgs.cookies || undefined"');
    expect(source).toContain(': cookieFileName }}');
    expect(source).not.toContain('class="dir-path-text cookie-active-path"');
  });
  it('keeps logout separate from an ellipsized credential name', () => {
    const source = readFileSync('src/components/SettingsPanel.vue', 'utf8');
    expect(source).toContain('class="user-badge cookie-path-preview"');
    expect(source).toContain(':data-cookie-path="platformCookies.youtube"');
    expect(source).toContain('class="cookie-connection-name"');
    expect(source).toContain('.logged-in-state > button');
  });
});
