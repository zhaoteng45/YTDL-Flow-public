// src/utils/storage.ts
/**
 * 统一持久化存储门面（Storage Seam）
 * 提供类型安全、JSON 自动序列化/反序列化及异常防护
 */

export const STORAGE_KEYS = {
  EXTRA_ARGS: 'extraArgs',
  QUALITY_PREFERENCES_VERSION: 'qualityPreferencesVersion',
  DOWNLOAD_DIR: 'downloadDir',
  THEME: 'theme',
  BILI_USER_INFO: 'biliUserInfo',
  PLATFORM_COOKIES: 'platformCookies',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

function getRawStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }
  return null;
}

export const appStorage = {
  /**
   * 读取 JSON 对象或基本类型，解析失败或不存在时返回 defaultValue
   */
  get<T>(key: StorageKey | string, defaultValue: T): T {
    const rawStorage = getRawStorage();
    if (!rawStorage) return defaultValue;

    try {
      const raw = rawStorage.getItem(key);
      if (raw === null) return defaultValue;

      if (typeof defaultValue === 'string') {
        return raw as unknown as T;
      }

      return JSON.parse(raw) as T;
    } catch (e) {
      console.error(`[storage] Failed to parse key "${key}":`, e);
      return defaultValue;
    }
  },

  /**
   * 读取纯字符串值
   */
  getString(key: StorageKey | string, defaultValue: string | null = null): string | null {
    const rawStorage = getRawStorage();
    if (!rawStorage) return defaultValue;

    try {
      const raw = rawStorage.getItem(key);
      return raw !== null ? raw : defaultValue;
    } catch (e) {
      console.error(`[storage] Failed to read string key "${key}":`, e);
      return defaultValue;
    }
  },

  /**
   * 写入值（对象自动 JSON.stringify，字符串直接存储）
   */
  set<T>(key: StorageKey | string, value: T): void {
    const rawStorage = getRawStorage();
    if (!rawStorage) return;

    try {
      if (typeof value === 'string') {
        rawStorage.setItem(key, value);
      } else {
        rawStorage.setItem(key, JSON.stringify(value));
      }
    } catch (e) {
      console.error(`[storage] Failed to write key "${key}":`, e);
    }
  },

  /**
   * 删除键
   */
  remove(key: StorageKey | string): void {
    const rawStorage = getRawStorage();
    if (!rawStorage) return;

    try {
      rawStorage.removeItem(key);
    } catch (e) {
      console.error(`[storage] Failed to remove key "${key}":`, e);
    }
  },
};
