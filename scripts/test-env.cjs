// Глобальне середовище для тестів: локальне сховище браузера (у пам'яті).
function createStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(String(key)) ? map.get(String(key)) : null; },
    setItem(key, value) {
      // Імітація квоти: не даємо записати надто великі значення.
      const str = String(value);
      if (str.length > 2_000_000) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(String(key), str);
    },
    removeItem(key) { map.delete(String(key)); },
    clear() { map.clear(); },
    key(index) { return Array.from(map.keys())[index] ?? null; },
    get length() { return map.size; },
  };
}

const storage = createStorage();

globalThis.localStorage = storage;
globalThis.window = {
  localStorage: storage,
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(cb) { return setTimeout(() => cb(Date.now()), 0); },
  cancelAnimationFrame(id) { clearTimeout(id); },
};
globalThis.sessionStorage = createStorage();
globalThis.navigator = globalThis.navigator || { userAgent: 'node-test' };
