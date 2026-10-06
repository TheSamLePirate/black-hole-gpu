// The browser's storage, safely: private modes, full quotas and blocked site data throw on access —
// every read falls back, every write says whether it took. One place instead of a try/catch per use.

/** the build's place in the site (scripts/build-pages.ts: KERR_SUBPATH — the CI's preview under test/; empty at the root) */
declare const __KERR_SUBPATH__: string;
const SUBPATH = typeof __KERR_SUBPATH__ === "string" ? __KERR_SUBPATH__ : "";

/**
 * A key of this app's: a preview deployed under the site shares its origin, so its storage — its saves,
 * settings, tier and diagnostics under their own prefix, not the site's (whose keys, at the root, are
 * unchanged).
 */
export const storageKey = (key: string, subpath = SUBPATH) => (subpath ? `${subpath}/${key}` : key);

export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(storageKey(key));
    } catch {
      return null;
    }
  },
  /** false when the browser refused (private mode, quota) */
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(storageKey(key), value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(storageKey(key));
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
