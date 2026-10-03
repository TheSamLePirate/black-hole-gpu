// The browser's storage, safely: private modes, full quotas and blocked site data throw on access —
// every read falls back, every write says whether it took. One place instead of a try/catch per use.

export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  /** false when the browser refused (private mode, quota) */
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing stored, nothing to remove */
    }
  },
  /** the parsed JSON, or the fallback (missing, unreadable, or not JSON) */
  getJSON<T>(key: string, fallback: T): T {
    const raw = store.get(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  setJSON(key: string, v: unknown): boolean {
    return store.set(key, JSON.stringify(v));
  },
};
