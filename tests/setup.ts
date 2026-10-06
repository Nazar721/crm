// Має бути ПЕРШИМ імпортом у тестовому файлі: встановлює браузерне
// середовище (localStorage/window) до завантаження модулів CRM.
type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
  readonly length: number;
};

function createStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: key => (map.has(String(key)) ? map.get(String(key))! : null),
    setItem: (key, value) => {
      const str = String(value);
      if (str.length > 2_000_000) {
        const err = new Error('QuotaExceededError') as Error & { name: string };
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(String(key), str);
    },
    removeItem: key => { map.delete(String(key)); },
    clear: () => { map.clear(); },
    key: index => Array.from(map.keys())[index] ?? null,
    get length() { return map.size; },
  };
}

const storage = createStorage();
const g = globalThis as unknown as Record<string, unknown>;

if (!g.localStorage) g.localStorage = storage;
if (!g.sessionStorage) g.sessionStorage = createStorage();
if (!g.window) {
  g.window = {
    localStorage: g.localStorage,
    sessionStorage: g.sessionStorage,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0) as unknown as number,
    cancelAnimationFrame: (id: number) => clearTimeout(id),
  };
}

export {};
