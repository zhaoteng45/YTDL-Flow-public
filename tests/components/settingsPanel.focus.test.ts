import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/components/SettingsPanel.vue'), 'utf8');

describe('SettingsPanel modal focus management', () => {
  it('opens on common format and quality settings before advanced controls', () => {
    expect(source).toMatch(/const activeTab = ref(?:<SettingsTab>)?\('format'\);/);
  });
  it('declares its close event contract', () => {
    expect(source).toMatch(/defineEmits<\{ close: \[\] \}>\(\)/);
  });

  it('traps Tab inside both login dialogs', () => {
    expect(source).toMatch(/@keydown\.tab\.stop="trapTabKey\(youtubeModalRef, \$event\)"/);
    expect(source).toMatch(/@keydown\.tab\.stop="trapTabKey\(biliModalRef, \$event\)"/);
    expect(source).toMatch(/FOCUSABLE_SELECTOR/);
    expect(source).toMatch(/last\.focus\(\)/);
  });

  it('moves focus into the dialog on open and restores it on close', () => {
    expect(source).toMatch(/watch\(showYouTubeModal/);
    expect(source).toMatch(/watch\(showBiliQr/);
    expect(source).toMatch(/focusFirstInModal/);
    expect(source).toMatch(/releaseModalFocus/);
    expect(source).toMatch(/lastFocusedElement\?\.focus/);
  });

  it('keeps dialog semantics and escape dismissal intact', () => {
    expect(source.match(/role="dialog"/g) ?? []).toHaveLength(2);
    expect(source.match(/aria-modal="true"/g) ?? []).toHaveLength(2);
    expect(source).toMatch(/@keydown\.escape\.stop="showYouTubeModal = false"/);
    expect(source).toMatch(/@keydown\.escape\.stop="closeBiliQr"/);
  });

  it('exposes an accessible name and full keyboard tab semantics for settings controls', () => {
    expect(source).toMatch(/id="settings-dialog-title"/);
    expect(source).toMatch(/:aria-label="t\('settings\.close'\)"/);
    expect(source).toMatch(/class="settings-tabs"[^>]*role="tablist"/);
    expect(source.match(/role="tab"/g) ?? []).toHaveLength(4);
    expect(source.match(/:aria-selected="activeTab ===/g) ?? []).toHaveLength(4);
    expect(source.match(/:aria-pressed="activeTab ===/g) ?? []).toHaveLength(4);
    expect(source.match(/role="tabpanel"/g) ?? []).toHaveLength(4);
    expect(source).toMatch(/const handleSettingsTabKeydown/);
    expect(source.match(/@keydown="handleSettingsTabKeydown/g) ?? []).toHaveLength(4);
  });

  it('keeps tablist aria orientation and arrow-key behavior aligned with the rendered direction', () => {
    expect(source).toMatch(/:aria-orientation="settingsTabOrientation"/);
    expect(source).toMatch(/settingsTabOrientation\.value === 'vertical'/);
    expect(source).toContain("'ArrowUp'");
    expect(source).toContain("'ArrowDown'");
    expect(source).toMatch(/ResizeObserver/);
  });

  it('keeps nested authentication dialogs bounded and scrollable in short windows', () => {
    expect(source).toMatch(/\.auth-modal\s*\{[\s\S]*?max-height:/);
    expect(source).toMatch(/\.auth-body\s*\{[\s\S]*?overflow-y:\s*auto;/);
    expect(source).toMatch(/\.qr-modal\s*\{[\s\S]*?max-height:/);
  });

  it('keeps settings tabs visibly interactive on hover without turning them into cards', () => {
    expect(source).toMatch(
      /\.tab-btn:hover\s*\{[\s\S]*?background:[^;]*color-mix\([^;]*var\(--color-primary\)[^;]*\);[\s\S]*?border-bottom-color:\s*var\(--color-primary\);/
    );
  });

  it('uses NeoIcon vector components across tabs, close buttons, and section headers', () => {
    expect(source).toMatch(/import NeoIcon from '\.\/NeoIcon\.vue'/);
    expect(source).toMatch(/<NeoIcon name="gear" :size="14" class="tab-icon"/);
    expect(source).toMatch(/<NeoIcon name="tv" :size="14" class="tab-icon"/);
    expect(source).toMatch(/<NeoIcon name="zap" :size="14" class="tab-icon"/);
    expect(source).toMatch(/<NeoIcon name="disk" :size="14" class="tab-icon"/);
    expect(source).toMatch(/<NeoIcon name="cross"/);
    expect(source).not.toMatch(/<span class="icon">📺<\/span>/);
    expect(source).not.toMatch(/<span class="warning-icon">⚠️<\/span>/);
    expect(source).not.toMatch(/<span class="success-icon">✅<\/span>/);
    expect(source).not.toMatch(/<h4>🎭/);
    expect(source).not.toMatch(/<h4>🔔/);
    expect(source).not.toMatch(/<h4>🗄️/);
  });
});
