import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { THEMES } from '../../src/constants';

const storage = new Map<string, string>();

vi.stubGlobal('document', {
  documentElement: {
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
    },
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
  },
});

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
});

vi.stubGlobal('window', {});

vi.mock('../../src/utils/tauri', () => ({
  safeInvoke: vi.fn(),
  safeGetSystemDownloadDir: vi.fn(),
  safeListen: vi.fn(),
  safeOpenDialog: vi.fn(),
  safeOpenExternal: vi.fn(),
  safeReadTextFile: vi.fn(),
}));

const { useAppStore } = await import('../../src/stores/appStore');

describe('three-theme policy', () => {
  beforeEach(() => {
    storage.clear();
    setActivePinia(createPinia());
  });

  it('defaults to YTDL Clean before and after initialization without a saved preference', () => {
    const store = useAppStore();
    expect(store.theme).toBe(THEMES.MATERIAL);
    store.initTheme();

    expect(store.theme).toBe(THEMES.MATERIAL);
    expect(storage.get('theme')).toBe(THEMES.MATERIAL);
  });

  it.each(Object.values(THEMES))('preserves the valid saved internal ID %s', (theme) => {
    storage.set('theme', theme);
    const store = useAppStore();
    store.initTheme();
    expect(store.theme).toBe(theme);
    expect(storage.get('theme')).toBe(theme);
  });

  it.each(['dark', 'invalid-theme', ''])('normalizes unsupported preference %s to Clean', (saved) => {
    storage.set('theme', saved);

    const store = useAppStore();
    store.initTheme();

    expect(store.theme).toBe(THEMES.MATERIAL);
    expect(storage.get('theme')).toBe(THEMES.MATERIAL);
  });

  it('cycles only compatible theme IDs starting from Clean', () => {
    const store = useAppStore();
    store.initTheme();

    expect(store.theme).toBe(THEMES.MATERIAL);
    store.toggleTheme();
    expect(store.theme).toBe(THEMES.COBALT_BUTTER);
    store.toggleTheme();
    expect(store.theme).toBe(THEMES.FLUENT);
    store.toggleTheme();
    expect(store.theme).toBe(THEMES.MATERIAL);
  });
});
