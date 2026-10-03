import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appStorage, STORAGE_KEYS } from '../../src/utils/storage';

describe('appStorage utility', () => {
  const mockStorage = new Map<string, string>();

  beforeEach(() => {
    mockStorage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mockStorage.set(key, value);
      },
      removeItem: (key: string) => {
        mockStorage.delete(key);
      },
      clear: () => {
        mockStorage.clear();
      },
    });
  });

  it('provides well-known key constants', () => {
    expect(STORAGE_KEYS.EXTRA_ARGS).toBe('extraArgs');
    expect(STORAGE_KEYS.DOWNLOAD_DIR).toBe('downloadDir');
    expect(STORAGE_KEYS.THEME).toBe('theme');
    expect(STORAGE_KEYS.BILI_USER_INFO).toBe('biliUserInfo');
  });

  it('reads and writes string values safely', () => {
    expect(appStorage.getString(STORAGE_KEYS.THEME, 'default')).toBe('default');
    appStorage.set(STORAGE_KEYS.THEME, 'pokemon');
    expect(appStorage.getString(STORAGE_KEYS.THEME)).toBe('pokemon');
    expect(mockStorage.get('theme')).toBe('pokemon');
  });

  it('reads and writes JSON object values safely', () => {
    const defaultVal = { count: 0 };
    expect(appStorage.get(STORAGE_KEYS.EXTRA_ARGS, defaultVal)).toEqual(defaultVal);

    const payload = { audioOnly: true, quality: '1080p' };
    appStorage.set(STORAGE_KEYS.EXTRA_ARGS, payload);
    expect(mockStorage.get('extraArgs')).toBe(JSON.stringify(payload));
    expect(appStorage.get(STORAGE_KEYS.EXTRA_ARGS, defaultVal)).toEqual(payload);
  });

  it('handles corrupted JSON safely without throwing', () => {
    mockStorage.set('extraArgs', '{ malformed json :: ');
    const fallback = { safe: true };
    const result = appStorage.get('extraArgs', fallback);
    expect(result).toEqual(fallback);
  });

  it('removes keys properly', () => {
    appStorage.set('testKey', 'value');
    expect(mockStorage.has('testKey')).toBe(true);
    appStorage.remove('testKey');
    expect(mockStorage.has('testKey')).toBe(false);
  });
});
