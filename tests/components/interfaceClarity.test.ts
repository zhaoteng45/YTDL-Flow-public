import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(name, 'utf8');

describe('ordinary user interface clarity', () => {
  it('keeps keyboard actions available without a persistent cheat sheet', () => {
    const source = read('src/components/DownloadList.vue');
    expect(source).not.toContain('<div class="kbd-shortcuts-tip"');
    const locale = JSON.parse(read('src/locales/zh-CN.json'));
    expect(locale.input.analyze_btn).not.toContain('Ctrl');
    expect(locale.download_list.filter.search_placeholder).not.toContain('聚焦');
  });
  it('uses the same primary action role for downloading and revealing a completed file', () => {
    const source = read('src/components/DownloadList.vue');
    expect(source).toMatch(/getPrimaryTaskAction\(item\) === 'open-folder'[\s\S]*?class="neo-button primary primary-task-action"/);
  });
  it('centers each theme label independently of icons and check marks', () => {
    const source = read('src/components/ThemeSelector.vue');
    expect(source).toMatch(/\.selector-trigger\s*\{[\s\S]*?grid-template-columns: 20px minmax\(0, 1fr\) 20px;/);
    expect(source).toMatch(/\.dropdown-item\s*\{[\s\S]*?grid-template-columns: 20px minmax\(0, 1fr\) 20px;/);
    expect(source).toMatch(/\.item-label\s*\{[\s\S]*?text-align: center;/);
  });
});
