import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type LocaleTree = Record<string, string | LocaleTree>;

const zh = JSON.parse(readFileSync(resolve('src/locales/zh-CN.json'), 'utf8')) as LocaleTree;
const en = JSON.parse(readFileSync(resolve('src/locales/en-US.json'), 'utf8')) as LocaleTree;

const flattenKeys = (value: LocaleTree, prefix = ''): string[] => Object.entries(value).flatMap(([key, child]) => {
  const path = prefix ? `${prefix}.${key}` : key;
  return typeof child === 'string' ? [path] : flattenKeys(child, path);
});

describe('locale parity', () => {
  it('keeps zh-CN and en-US key sets aligned', () => {
    expect(flattenKeys(en).sort()).toEqual(flattenKeys(zh).sort());
  });

  it('keeps the English bundle free of untranslated Chinese UI copy', () => {
    // Product theme names are deliberately Chinese in both locales.
    const { theme_material, theme_fluent, theme_cobalt_butter, ...appCopy } = en.app as LocaleTree;
    expect([theme_material, theme_fluent, theme_cobalt_butter]).toEqual(['蓝宝石', '酒红', '石墨']);
    expect(JSON.stringify({ ...en, app: appCopy })).not.toMatch(/[\u3400-\u9fff]/u);
  });

  it('does not retain removed task-batch UI copy', () => {
    const flattenedZh = flattenKeys(zh);
    expect(flattenedZh).not.toContain('download_list.undo.removed_batch_count');
    expect(flattenedZh).not.toContain('download_list.selection.selected_count');
    expect(flattenedZh).not.toContain('download_list.actions.download_all_analyzed_count');

    const zhText = JSON.stringify(zh);
    const enText = JSON.stringify(en);
    expect(zhText).not.toContain('批量解析');
    expect(zhText).not.toContain('批量下载');
    expect(enText).not.toMatch(/Batch (Analyze|Download)/);
    expect(zhText).not.toContain('文本文件');
    expect(zhText).not.toContain('Node.js');
    expect(zhText).toContain('Bun');
    expect(enText).not.toMatch(/text file/i);
    expect(enText).toContain('Bun');
  });
});
