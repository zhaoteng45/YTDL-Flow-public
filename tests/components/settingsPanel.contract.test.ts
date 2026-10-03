import { describe, expect, it } from 'vitest';
import { DEFAULT_EXTRA_ARGS } from '../../src/constants';
import { ref, nextTick } from 'vue';
import { useFilenameSettings } from '../../src/components/settingsPanel.filename';
import { readFileSync } from 'node:fs';
import zh from '../../src/locales/zh-CN.json';
import en from '../../src/locales/en-US.json';

describe('Settings filename contract', () => {
  it('does not present static engine capabilities as enabled runtime settings', () => {
    const source = readFileSync('src/components/SettingsPanel.vue', 'utf8');
    expect(source.includes('engine-features')).toBe(false);
  });
  it('labels format sorting as preferences with fallback and no forced transcoding', () => {
    for (const key of ['max_res', 'video_codec', 'audio_codec'] as const) {
      expect(zh.settings.format[key]).toContain('偏好');
      expect(en.settings.format[key]).toMatch(/preference/i);
    }
    expect(zh.settings.format.quality_helper).toMatch(/回退.*不会.*强制转码/);
    expect(en.settings.format.quality_helper).toMatch(/fall back.*never force transcoding/i);
  });
  it('describes smart analysis and download policy in both languages', () => {
    expect(zh.settings.client.smart_option).toMatch(/多客户端分析.*mweb/);
    expect(en.settings.client.smart_option).toMatch(/multi-client analysis.*mweb/i);
  });
  it('never offers raw logging or hides the redaction notice for compatibility adminMode', () => {
    const settings = readFileSync('src/components/SettingsPanel.vue', 'utf8');
    const list = readFileSync('src/components/DownloadList.vue', 'utf8');
    expect(settings.includes('handleAdminModeToggle')).toBe(false);
    expect(settings.includes('admin_mode_title')).toBe(false);
    expect(list.includes('v-if="!adminMode"')).toBe(false);
    expect(list.includes('class="redact-tip"')).toBe(true);
  });
  it('does not generate a filename from panel initialization or passive watchers', () => {
    const source = readFileSync('src/components/SettingsPanel.vue', 'utf8');
    expect(source).not.toContain('if (!extraArgs.value.filenameTemplate) updateTemplate()');
    expect(source).toContain('useFilenameSettings(extraArgs)');
    expect(source).not.toContain('watch([isRenamingEnabled');
  });
  it('uses title and uploader before the settings panel is opened', () => {
    expect(DEFAULT_EXTRA_ARGS.filenameTemplate).toBe('%(title)s - %(uploader)s.%(ext)s');
  });

  it.each(['', '%(title)s.%(ext)s', '%(upload_date)s - %(title)s.%(ext)s', ' custom %(title)s.%(ext)s '])('opening and reopening preserves saved template %j', async (template) => {
    const args = ref({ ...DEFAULT_EXTRA_ARGS, filenameTemplate: template });
    useFilenameSettings(args);
    await nextTick();
    useFilenameSettings(args);
    await nextTick();
    expect(args.value.filenameTemplate).toBe(template);
  });

  it('reflects fresh, legacy empty and title-only templates honestly', () => {
    const args = ref({ ...DEFAULT_EXTRA_ARGS });
    const editor = useFilenameSettings(args);
    expect(editor.renameOptions.value).toEqual({ title: true, uploader: true, platform: false, date: false, subLangs: false });
    for (const template of ['', '%(title)s.%(ext)s']) {
      args.value.filenameTemplate = template;
      expect(editor.renameOptions.value).toEqual({ title: true, uploader: false, platform: false, date: false, subLangs: false });
      expect(editor.effectiveTemplate.value).toBe('%(title)s.%(ext)s');
      expect(editor.isRenamingEnabled.value).toBe(true);
    }
  });

  it('keeps title-only and legacy blank naming disabled after reopening settings', () => {
    for (const template of ['', '%(title)s.%(ext)s']) {
      const args = ref({ ...DEFAULT_EXTRA_ARGS, filenameTemplate: template });
      const firstOpen = useFilenameSettings(args);
      expect(firstOpen.isRenamingEnabled.value).toBe(false);
      expect(args.value.filenameTemplate).toBe(template);

      const reopened = useFilenameSettings(args);
      expect(reopened.isRenamingEnabled.value).toBe(false);
      expect(args.value.filenameTemplate).toBe(template);
    }
  });

  it('writes explicit title-only when disabled and updates options only on user action', () => {
    const args = ref({ ...DEFAULT_EXTRA_ARGS });
    const editor = useFilenameSettings(args);
    editor.setOption('date', true);
    expect(args.value.filenameTemplate).toBe('%(title)s - %(uploader)s - %(upload_date)s.%(ext)s');
    editor.isRenamingEnabled.value = false;
    expect(args.value.filenameTemplate).toBe('%(title)s.%(ext)s');
    editor.isRenamingEnabled.value = true;
    expect(args.value.filenameTemplate).toBe('%(title)s - %(uploader)s.%(ext)s');
    editor.setOption('subLangs', true);
    expect(args.value.filenameTemplate).toBe('%(title)s - %(uploader)s [zh-Hans,en].%(ext)s');
  });
});
