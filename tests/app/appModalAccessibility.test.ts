import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/App.vue'), 'utf8');

describe('App modal accessibility', () => {
  it('gives the settings dialog labels and modal semantics', () => {
    expect(source).toMatch(/id="settings-dialog"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-labelledby="settings-dialog-title"/);
  });

  it('moves focus into settings, traps Tab, and restores focus', () => {
    expect(source).toMatch(/watch\(showSettings/);
    expect(source).toMatch(/focusFirstInModal/);
    expect(source).toMatch(/trapTabKey/);
    expect(source).toMatch(/settingsReturnFocus \?\? settingsTriggerRef\.value/);
  });

  it('removes background content from interaction while a modal is open', () => {
    expect(source.match(/:inert="isModalOpen"/g) ?? []).toHaveLength(4);
  });

  it('keeps notification native wiring behind the store/application seam', () => {
    expect(source).toContain('await store.initNotificationI18n({');
    expect(source).not.toContain("safeInvoke as invoke");
    expect(source).not.toContain("@tauri-apps/api/core");
  });

  it('uses NeoIcon vector components across shell controls and warnings', () => {
    expect(source).toMatch(/import NeoIcon from '\.\/components\/NeoIcon\.vue'/);
    expect(source).toMatch(/<NeoIcon name="gear" :size="18"/);
    expect(source).toMatch(/<NeoIcon name="warn" :size="18"/);
    expect(source).toMatch(/<NeoIcon name="sliders" :size="18"/);
    expect(source).toMatch(/<NeoIcon name="paste" :size="16"/);
    expect(source).not.toMatch(/<span aria-hidden="true">✕<\/span>/);
  });
});
