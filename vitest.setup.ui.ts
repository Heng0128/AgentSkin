// vitest setup for ui project — provides a minimal in-memory localStorage.

const store = new Map<string, string>();

const localStorageMock: Storage = {
  get length() {
    return store.size;
  },
  clear() {
    store.clear();
  },
  getItem(key: string): string | null {
    return store.has(key) ? store.get(key)! : null;
  },
  key(_index: number): string | null {
    return null;
  },
  removeItem(key: string) {
    store.delete(key);
  },
  setItem(key: string, value: string) {
    store.set(key, String(value));
  },
};

if (typeof globalThis.window === 'undefined') {
  // @ts-expect-error — attach for vitest node environment where window may not exist
  globalThis.window = {} as Window;
}

(globalThis.window as Window).localStorage = localStorageMock;
(globalThis as Record<string, unknown>).localStorage = localStorageMock;
