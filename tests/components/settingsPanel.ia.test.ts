import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/components/SettingsPanel.vue'), 'utf8');
const zh = JSON.parse(readFileSync(resolve('src/locales/zh-CN.json'), 'utf8'));
const en = JSON.parse(readFileSync(resolve('src/locales/en-US.json'), 'utf8'));

function tabSlice(tab: 'general' | 'format' | 'advanced' | 'tools') {
  const order = ['general', 'format', 'advanced', 'tools'] as const;
  const marker = `v-if="activeTab === '${tab}'" class="tab-pane`;
  const start = source.indexOf(marker);
  const nextTab = order[order.indexOf(tab) + 1];
  const nextMarker = nextTab ? `v-if="activeTab === '${nextTab}'" class="tab-pane` : '';
  const end = nextTab ? source.indexOf(nextMarker, start + 1) : source.indexOf('<!-- YouTube Login Modal -->', start);
  if (start < 0 || end < 0) throw new Error(`Unable to isolate ${tab} tab`);
  return source.slice(start, end);
}

describe('SettingsPanel information architecture', () => {
  it('renames the Format tab to Output in both locales', () => {
    expect(zh.settings.tabs.format).toBe('输出');
    expect(en.settings.tabs.format).toBe('Output');
  });

  it('keeps General focused on accounts/login and notifications only', () => {
    const general = tabSlice('general');
    expect(general).toMatch(/settings\.auth\.title/);
    expect(general).toMatch(/settings\.notifications\.title/);
    expect(general).not.toMatch(/settings\.renaming\.title/);
    expect(general).not.toMatch(/settings\.health\.title/);
    expect(general).not.toMatch(/settings\.client\.title/);
    expect(general).not.toMatch(/settings\.environment\.title/);
  });

  it('moves naming and all output/post-processing controls into four compact Output groups', () => {
    const output = tabSlice('format');
    expect(output).toMatch(/settings\.renaming\.title/);
    expect(output).toMatch(/settings\.format\.quality_title/);
    expect(output).toMatch(/settings\.output\.postprocess_title/);
    expect(output).toMatch(/settings\.format\.subtitles_title/);
    expect(output).toMatch(/settings\.format\.sponsorblock_title/);
    expect(output).toMatch(/settings\.archive\.title/);
    expect(output).toMatch(/settings\.format\.metadata_title/);
    expect(output.match(/class="setting-group"/g) ?? []).toHaveLength(4);
  });

  it('groups Advanced into download performance and network compatibility only', () => {
    const advanced = tabSlice('advanced');
    expect(advanced).toMatch(/settings\.advanced\.performance_title/);
    expect(advanced).toMatch(/settings\.advanced\.concurrency_title/);
    expect(advanced).toMatch(/settings\.advanced\.compatibility_title/);
    expect(advanced).toMatch(/settings\.advanced\.proxy_title/);
    expect(advanced).toMatch(/settings\.advanced\.ua_title/);
    expect(advanced).toMatch(/settings\.client\.title/);
    expect(advanced).not.toMatch(/settings\.health\.title/);
    expect(advanced.match(/class="setting-group"/g) ?? []).toHaveLength(2);
  });

  it('keeps YouTube expert parameters behind progressive disclosure without changing their models', () => {
    const advanced = tabSlice('advanced');
    expect(advanced).toMatch(/<details class="expert-disclosure"/);
    expect(advanced).toMatch(/<summary[\s\S]*?settings\.client\.expert_title/);
    expect(advanced).toMatch(/v-model="extraArgs\.poToken"/);
    expect(advanced).toMatch(/v-model="extraArgs\.visitorData"/);
    expect(advanced).toMatch(/v-if="\['web', 'ios'\]\.includes\(extraArgs\.playerClient \|\| ''\)"/);
  });

  it('consolidates app update, toolchain/environment status, and system health in Tools', () => {
    const tools = tabSlice('tools');
    expect(tools).toMatch(/settings\.app_update\.title/);
    expect(tools).toMatch(/settings\.tools\.title/);
    expect(tools).toMatch(/settings\.environment\.copy_info/);
    expect(tools).toMatch(/settings\.environment\.load_failed/);
    expect(tools).toMatch(/settings\.health\.title/);
    expect(tools).toMatch(/killZombies/);
  });

  it('keeps Tools flat instead of nesting tool cards inside setting groups', () => {
    const tools = tabSlice('tools');
    expect(tools.match(/class="settings-tool-row/g) ?? []).toHaveLength(4);
    expect(tools).not.toMatch(/class="tool-card/);
    expect(tools).not.toMatch(/neo-box-inset/);
    expect(source).toMatch(/\.settings-tool-row\s*\{/);
  });
});
