import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync('src/App.vue', 'utf8');
const styles = readFileSync('src/styles-theme-experience.css', 'utf8');

describe('empty workspace presentation contract', () => {
  it('projects the canonical row count as explicit empty/active workspace state', () => {
    expect(app).toContain(':data-workspace-state="tasks.length === 0 ? \'empty\' : \'active\'"');
    expect(app).not.toContain(':has(.empty-state)');
  });
  it.each(['cobalt-butter', 'fluent', 'material'])('%s has separate bounded empty and active composition', (theme) => {
    expect(styles).toContain(`:root[data-theme="${theme}"] .app-layout[data-workspace-state="empty"]`);
    expect(styles).toContain(`:root[data-theme="${theme}"] .app-layout[data-workspace-state="active"]`);
  });
  it('reserves the primary action for the composer and labels clipboard as paste', () => {
    expect(app).toMatch(/class="empty-actions"[\s\S]*?class="neo-button ghost"/);
    expect(app).toContain("t('input.paste')");
    expect(app).toContain('workspace-guide');
  });
  it('settings switches animate explicit low-cost properties', () => {
    const settings = readFileSync('src/components/SettingsPanel.vue', 'utf8');
    expect(settings).not.toMatch(/transition:\s*\.4s;/);
  });
});
