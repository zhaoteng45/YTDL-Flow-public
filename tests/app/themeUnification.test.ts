import { describe, expect, it } from 'vitest';
import { THEME_OPTIONS } from '../../src/constants';
import zh from '../../src/locales/zh-CN.json';
import en from '../../src/locales/en-US.json';

describe('Independent palette display names with compatible persisted IDs', () => {
  it('lists Clean first and retains every existing ID', () => {
    expect(THEME_OPTIONS).toEqual([
      { value: 'material', label: '蓝宝石' },
      { value: 'fluent', label: '酒红' },
      { value: 'cobalt-butter', label: '石墨' },
    ]);
  });

  it.each([zh, en])('uses the same product theme names in both locales', (messages) => {
    expect(messages.app.theme_material).toBe('蓝宝石');
    expect(messages.app.theme_fluent).toBe('酒红');
    expect(messages.app.theme_cobalt_butter).toBe('石墨');
  });
});
