// The page's side of the PWA (PLAN-MONDE M1): the manifest and the icon declared, the Service Worker
// (src/sw.ts) registered, a notice with its button when a new build is ready, and a handle for the tools and the tests
// (`__bh.pwa`: the worker's state, the caches' figures). Not registered on the dev server's hot reload,
// in the end-to-end tests unless they ask (`sw=1`: their network blocking does not reach a worker), nor on
// the benchmark page (a cold load is what it measures).

import { t } from "./i18n";
import { assetsSeen } from "./pwa/seen";

export interface PwaStats {
  build: string;
  shell: number;
  tiles: number;
  tileBytes: number;
  tileBudget: number;
  /** the offline zones' tiles and bytes (I8a) */
  zoneTiles: number;
  zoneBytes: number;
  /** by kind (pwa/rules.ts tileKind): the tiles and bytes kept in the budgeted cache and in the zones' — the relief's
   *  grids packed (I8c) */
  kinds?: Record<string, { lru: number; lruBytes: number; zone: number; zoneBytes: number }>;
  /** the tiles served since the worker started: from a zone, from the budgeted cache, from the network — by kind, the last
   *  few asked of the network */
  served: {
    zone: number;
    lru: number;
    network: number;
    kinds?: Record<string, { zone: number; lru: number; network: number }>;
    recent?: string[];
    /** the archives' ranges cut before their end — the asker gone —, not kept (the last 32) */
    rangesCut?: string[];
  };
}

export interface Pwa {
  /** registered (null: not on this page, or unsupported) */
  readonly registration: ServiceWorkerRegistration | null;
  /** the worker in control of this page, its caches filled at least with the shell */
  ready(): Promise<boolean>;
  stats(): Promise<PwaStats | null>;
  /** empties the tiles' cache (the tools and the tests: __bh.pwa.clearTiles) */
  clearTiles(): Promise<void>;
  /** the tiles' cache's budget [bytes] (Settings › Offline): kept by the worker, its least recently served beyond it
   *  evicted at once */
  setBudget(bytes: number): Promise<void>;
  /** a new build installed and waiting: reload onto it */
  update(): void;
  readonly waiting: boolean;
  /** a message to the worker, its answer (null: no worker, or none within `timeoutMs`) */
  talk<T>(msg: object, timeoutMs?: number): Promise<T | null>;
  /** the offline zones (src/pwa-zones.ts — I8a; main.ts sets them): null with no worker */
  zones: import("./pwa-zones").Zones | null;
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
  const talk = <T>(msg: object, timeoutMs = 3000): Promise<T | null> =>
    new Promise((res) => {
      const w = navigator.serviceWorker.controller ?? pwa.registration?.active;
      if (!w) return res(null);
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => res(e.data as T);
      w.postMessage(msg, [ch.port2]);
      setTimeout(() => res(null), timeoutMs);
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
   * keeps it — the page then reloads offline whatever the precache list had. With them, the files its workers fetched
   * (src/pwa/seen.ts: the KTX2 transcoder's maps), which the page's resource timings do not list.
   */
  function warmShell() {
    const run = async () => {
      const seen = new Set<string>([new URL("./", location.href).href]);
      for (const e of performance.getEntriesByType("resource")) {
        const u = e.name;
        if (u.startsWith(location.origin) && !u.includes("/__") && !u.includes("sw.js")) seen.add(u.split("#")[0]!);
      }
      // (and what workers fetched — out of the page's timings; the first visit's transcoder may have started before the worker
      // held the page: 13 Nov 2026, three of the large maps' KTX2 lost, offline the array fell back to JPEGs never loaded)
      for (const u of assetsSeen()) if (u.startsWith(location.origin)) seen.add(u);
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
  /**
   * A new build waiting: offered with a button that runs it (its worker told to take over — skip-waiting —, the page then
   * reloaded onto it by controllerchange). Before 13 Nov 2026 a toast only said « reload the page »: no button called
   * update(), and a reload left the old worker in charge (its only tab reloaded does not activate a waiting worker —
   * measured by tests/e2e/pwa-update.e2e.test.ts; audit QA-16). « Later »: hidden, offered again at the next load.
   */
  function announce(w: ServiceWorker) {
    pwa.waiting = w;
    if (typeof document === "undefined" || document.querySelector("[data-testid=pwa-update]")) return;
    const bar = document.createElement("div");
    bar.dataset.testid = "pwa-update";
    bar.setAttribute("role", "status");
    bar.style.cssText =
      "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:10000;display:flex;gap:10px;align-items:center;" +
      "padding:8px 10px 8px 14px;border-radius:10px;background:rgba(12,16,22,.92);color:#e8eef5;font:13px/1.3 system-ui,sans-serif;" +
      "box-shadow:0 4px 18px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.12)";
    const text = document.createElement("span");
    text.textContent = t("A new version of the game is ready");
    const run = document.createElement("button");
    run.dataset.testid = "pwa-update-run";
    run.textContent = t("Reload now");
    run.style.cssText = "font:inherit;padding:5px 10px;border-radius:7px;border:0;background:#f0a830;color:#111;cursor:pointer";
    run.onclick = () => {
      run.disabled = true;
      w.postMessage({ type: "skip-waiting" });
    };
    const later = document.createElement("button");
    later.textContent = t("Later");
    later.style.cssText = "font:inherit;padding:5px 8px;border-radius:7px;border:0;background:transparent;color:#9fb0c2;cursor:pointer";
    later.onclick = () => bar.remove();
    bar.append(text, run, later);
    document.body.append(bar);
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
    setBudget: async (bytes) => {
      await talk({ type: "tile-budget", bytes }, 30_000);
    },
    update: () => pwa.waiting?.postMessage({ type: "skip-waiting" }),
    get waiting() {
      return !!pwa.waiting;
    },
    talk,
    zones: null,
  };
}
