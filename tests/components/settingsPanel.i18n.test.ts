import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const settingsSource = readFileSync(resolve('src/components/SettingsPanel.vue'), 'utf8');
const zh = JSON.parse(readFileSync(resolve('src/locales/zh-CN.json'), 'utf8')) as Record<string, unknown>;
const en = JSON.parse(readFileSync(resolve('src/locales/en-US.json'), 'utf8')) as Record<string, unknown>;

// settings.history.clear_confirm / clear_failed are intentionally not asserted:
// the Download History/SQLite feature was removed by user scope (2026-09-24 Architecture Diet).
const requiredKeys = [
  'settings.browser.detected_suffix',
  'settings.tools.update_result',
  'settings.tools.update_failed',
  'settings.common.copied',
  'settings.common.copy_failed',
  'settings.browser.scanning',
  'settings.browser.auto_matched',
  'settings.browser.no_usable_cookies',
  'settings.client.smart_option',
  'settings.client.android_option',
  'settings.client.web_option',
  'settings.client.ios_option',
  'settings.client.tv_option',
  'settings.client.po_token_badge',
  'settings.client.po_token_placeholder',
  'settings.client.po_token_hint',
  'settings.client.optional',
  'settings.client.visitor_data_placeholder',
  'settings.client.expert_title',
  'settings.client.expert_hint',
  'settings.renaming.advanced_template',
  'settings.renaming.advanced_template_hint',
  'settings.renaming.insert_variable',
  'settings.output.postprocess_title',
  'settings.advanced.performance_title',
  'settings.advanced.compatibility_title',
  'settings.browser.switch_to_file_hint',
  'settings.browser.detect_failed',
  'settings.auth.connected_as',
  'settings.youtube_auth.title',
  'settings.youtube_auth.description',
  'settings.youtube_auth.browser_tab',
  'settings.youtube_auth.file_tab',
  'settings.youtube_auth.browser_policy_note',
  'settings.youtube_auth.login_step',
  'settings.youtube_auth.open_login',
  'settings.youtube_auth.browser_step',
  'settings.youtube_auth.browser_select_label',
  'settings.youtube_auth.auto_scan_title',
  'settings.youtube_auth.auto_match',
  'settings.youtube_auth.uncommon_browser_tip',
  'settings.youtube_auth.extension_step',
  'settings.youtube_auth.store_suffix',
  'settings.youtube_auth.export_step',
  'settings.youtube_auth.choose_file_step',
  'settings.youtube_auth.file_placeholder',
  'settings.youtube_auth.file_path_label',
  'settings.youtube_auth.cancel',
  'settings.youtube_auth.confirm',
  'settings.environment.title',
  'settings.environment.copy_info',
  'settings.environment.not_detected',
  'settings.environment.detecting',
] as const;

const forbiddenSourceFragments = [
  ' (已检测)',
  '更新结果',
  '更新失败',
  // History/SQLite was removed by user scope (2026-09-24 Architecture Diet): these strings
  // must stay gone, and no settings.history.* locale key is required to exist.
  '确定要清空所有 SQLite 下载历史记录吗？（本地已下载的文件不会被删除）',
  '清空历史失败',
  '已复制',
  '复制失败',
  '正在扫描可用浏览器...',
  '已自动匹配',
  '未检测到可用 Cookies',
  '智能 (推荐/自动选择最优)',
  'Android (稳定/1080p)',
  'Web (高画质/易403)',
  'iOS (高画质/需Token)',
  'TV (嵌入式设备)',
  'title="可选">可选/推荐自动',
  '(可选)</label>',
  'placeholder="输入 Visitor Data..."',
  '<h4>环境组件检测</h4>',
  "copyStatus || '复制信息'",
  "|| '未检测到'",
  '<span>正在检测环境组件...</span>',
] as const;

function getPath(root: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (typeof value !== 'object' || value === null) return undefined;
    return (value as Record<string, unknown>)[key];
  }, root);
}

describe('SettingsPanel i18n regression', () => {
  it('does not keep selected hard-coded Chinese UI strings in component source', () => {
    for (const fragment of forbiddenSourceFragments) {
      expect(settingsSource.includes(fragment), fragment).toBe(false);
    }
    expect(settingsSource).not.toMatch(/[一-龥]/);
  });

  it('defines every selected key in both locales', () => {
    for (const key of requiredKeys) {
      const zhValue = getPath(zh, key);
      const enValue = getPath(en, key);
      expect(typeof zhValue, key).toBe('string');
      expect(typeof enValue, key).toBe('string');
      expect(String(zhValue).trim().length, key).toBeGreaterThan(0);
      expect(String(enValue).trim().length, key).toBeGreaterThan(0);
    }
  });
});
