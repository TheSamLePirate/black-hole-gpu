// The page's side of the PWA (PLAN-MONDE M1): the manifest and the icon declared, the Service Worker
// (src/sw.ts) registered, a toast when a new build is ready, and a handle for the tools and the tests
// (`__bh.pwa`: the worker's state, the caches' figures). Not registered on the dev server's hot reload,
// in the end-to-end tests unless they ask (`sw=1`: their network blocking does not reach a worker), nor on
// the benchmark page (a cold load is what it measures).

import { t } from "./i18n";

export interface PwaStats {
  build: string;
  shell: number;
  tiles: number;
  tileBytes: number;
  tileBudget: number;
}

export interface Pwa {
  /** registered (null: not on this page, or unsupported) */
  readonly registration: ServiceWorkerRegistration | null;
  /** the worker in control of this page, its caches filled at least with the shell */
  ready(): Promise<boolean>;
  stats(): Promise<PwaStats | null>;
  /** empties the tiles' cache (the tools and the tests: __bh.pwa.clearTiles) */
  clearTiles(): Promise<void>;
  /** a new build installed and waiting: reload onto it */
  update(): void;
  readonly waiting: boolean;
}

export function wantsPwa(loc: Location = location): boolean {
  if (!("serviceWorker" in navigator)) return false;
  if (/[#&]bench\b/.test(loc.hash)) return false;
  const q = new URLSearchParams(loc.search);
  if (q.has("e2e") && q.get("sw") !== "1") return false;
  if (q.get("sw") === "0") return false;
  return true;
}

export function installPwa(o: { toast: (msg: string) => void; dev?: boolean }): Pwa {
  // (the manifest and the icon, from the page: the bundler leaves them alone)
  if (!document.querySelector('link[rel="manifest"]')) {
    const l = document.createElement("link");
    l.rel = "manifest";
    l.href = "manifest.webmanifest";
    document.head.append(l);
  }
  if (!document.querySelector('link[rel="icon"]')) {
    const l = document.createElement("link");
    l.rel = "icon";
    l.type = "image/svg+xml";
    l.href = "icons/icon.svg";
    document.head.append(l);
    const a = document.createElement("link");
    a.rel = "apple-touch-icon";
    a.href = "icons/icon-192.png";
    document.head.append(a);
  }
  const pwa: { registration: ServiceWorkerRegistration | null; waiting: ServiceWorker | null } = { registration: null, waiting: null };
  let readyP: Promise<boolean> = Promise.resolve(false);
  const talk = <T>(msg: object): Promise<T | null> =>
    new Promise((res) => {
      const w = navigator.serviceWorker.controller ?? pwa.registration?.active;
      if (!w) return res(null);
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => res(e.data as T);
      w.postMessage(msg, [ch.port2]);
      setTimeout(() => res(null), 3000);
    });
  if (wantsPwa() && !o.dev) {
    readyP = (async () => {
      try {
        const reg = await navigator.serviceWorker.register("sw.js", { type: "module" });
        pwa.registration = reg;
        // (a build already waiting — the page opened again before a reload)
        if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener("statechange", () => {
            if (w.state === "installed" && navigator.serviceWorker.controller) announce(w);
          });
        });
        await navigator.serviceWorker.ready;
        // (the first visit: the worker installs but controls the page only on the next load — unless it
        // claims it, which it does on activation)
        if (!navigator.serviceWorker.controller)
          await new Promise<void>((r) => navigator.serviceWorker.addEventListener("controllerchange", () => r(), { once: true }));
        warmShell();
        return true;
      } catch (e) {
        console.warn("service worker:", e);
        return false;
      }
    })();
  }
  /**
   * The shell warmed in idle time: what this page loaded before the worker took it over (the first
   * visit: its script and styles, the scene's textures) fetched once more through the worker, which
   * keeps it — the page then reloads offline whatever the precache list had.
   */
  function warmShell() {
    const run = async () => {
      const seen = new Set<string>([new URL("./", location.href).href]);
      for (const e of performance.getEntriesByType("resource")) {
        const u = e.name;
        if (u.startsWith(location.origin) && !u.includes("/__") && !u.includes("sw.js")) seen.add(u.split("#")[0]!);
      }
      for (const u of seen) {
        try {
          if (await caches.match(u)) continue;
          await fetch(u, { cache: "no-store" });
        } catch {
          /* offline already, or gone */
        }
      }
    };
    const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o: { timeout: number }) => void }).requestIdleCallback;
    if (idle) idle(() => void run(), { timeout: 8000 });
    else setTimeout(() => void run(), 3000);
  }
  function announce(w: ServiceWorker) {
    pwa.waiting = w;
    o.toast(t("A new version is ready — reload the page to run it"));
  }
  // (the new worker claims the page: a reload onto the new build)
  let reloading = false;
  navigator.serviceWorker?.addEventListener("controllerchange", () => {
    if (pwa.waiting && !reloading) {
      reloading = true;
      location.reload();
    }
  });
  return {
    get registration() {
      return pwa.registration;
    },
    ready: () => readyP,
    stats: () => talk<PwaStats>({ type: "stats" }),
    clearTiles: async () => {
      await talk({ type: "clear-tiles" });
    },
    update: () => pwa.waiting?.postMessage({ type: "skip-waiting" }),
    get waiting() {
      return !!pwa.waiting;
    },
  };
}
