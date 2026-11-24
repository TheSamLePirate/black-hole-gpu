// Cross-origin isolation for the Linux OBC's multi-CPU (src/obc/isolation.ts): only for a player who asked for it — the
// kerr_coi cookie read the same way by nginx, the dev server and the Service Worker — so the game without the OBC is served
// as before; and the OpenRouter sign-in still comes back when the page is isolated (its popup's handle reads closed at once).

import { expect, test } from "bun:test";
import { connect, openRouterKey } from "../src/ai/openrouter";
import { COI_COOKIE, coiCookieValue, coiWanted, withCoi } from "../src/obc/isolation";

test("the kerr_coi cookie: read among others; absent, 1, 0 — and the dev server's forcing", () => {
  expect(coiCookieValue(null)).toBeNull();
  expect(coiCookieValue("a=1; b=2")).toBeNull();
  expect(coiCookieValue(`a=1; ${COI_COOKIE}=1; b=2`)).toBe("1");
  expect(coiCookieValue(`${COI_COOKIE}=0`)).toBe("0");
  expect(coiCookieValue(`${COI_COOKIE}=yes`)).toBeNull();
  // (a cookie whose name only ends the same: not ours)
  expect(coiCookieValue("xkerr_coi=1")).toBeNull();
  expect(coiWanted(null)).toBe(false);
  expect(coiWanted(`${COI_COOKIE}=1`)).toBe(true);
  expect(coiWanted(`${COI_COOKIE}=0`)).toBe(false);
  expect(coiWanted(null, "1")).toBe(true);
  expect(coiWanted(`${COI_COOKIE}=1`, "0")).toBe(false);
});

test("withCoi: the two headers set or removed, Vary: Cookie kept, the rest untouched", async () => {
  const plain = new Response("page", { headers: { "content-type": "text/html", vary: "Accept-Encoding" } });
  // (not wanted, none there: the same response)
  expect(withCoi(plain, false)).toBe(plain);
  const on = withCoi(new Response("page", { headers: { "content-type": "text/html", vary: "Accept-Encoding" } }), true);
  expect(on.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  expect(on.headers.get("cross-origin-embedder-policy")).toBe("credentialless");
  expect(on.headers.get("vary")).toBe("Accept-Encoding, Cookie");
  expect(on.headers.get("content-type")).toBe("text/html");
  expect(await on.text()).toBe("page");
  // (a page cached while isolated, the player's "no" since: the headers taken off)
  const off = withCoi(on, false);
  expect(off.headers.has("cross-origin-opener-policy")).toBe(false);
  expect(off.headers.has("cross-origin-embedder-policy")).toBe(false);
});

test("nginx, the dev server and the Service Worker isolate by the cookie, never unconditionally", async () => {
  const nginx = await Bun.file("deploy/nginx.conf").text();
  expect(nginx).toMatch(/map \$cookie_kerr_coi \$kerr_coop/);
  expect(nginx).toMatch(/map \$cookie_kerr_coi \$kerr_coep/);
  expect(nginx).toContain("add_header Cross-Origin-Opener-Policy $kerr_coop always;");
  expect(nginx).toContain("add_header Cross-Origin-Embedder-Policy $kerr_coep always;");
  expect(nginx).not.toMatch(/Cross-Origin-(Opener|Embedder)-Policy "(same-origin|credentialless|require-corp)"/);
  const server = await Bun.file("server.ts").text();
  expect(server).toContain('coiWanted(req.headers.get("cookie"), coiForce)');
  expect(server).not.toMatch(/headers\.set\("Cross-Origin-(Opener|Embedder)-Policy"/);
  const sw = await Bun.file("src/sw.ts").text();
  expect(sw).toContain("withCoi(res, coiWanted(");
  expect(sw).not.toMatch(/headers\.set\("Cross-Origin-(Opener|Embedder)-Policy"/);
});

/** A window opening the sign-in popup: its handle closed at once (what an isolated page sees), the code posted later. */
function signIn(isolated: boolean) {
  const listeners = new Set<(e: MessageEvent) => void>();
  const win = {
    crossOriginIsolated: isolated,
    location: { href: "https://samlepirate.org/", origin: "https://samlepirate.org" },
    open: () => ({ closed: true }),
    addEventListener: (_: string, f: (e: MessageEvent) => void) => listeners.add(f),
    removeEventListener: (_: string, f: (e: MessageEvent) => void) => listeners.delete(f),
  };
  const fetchFn = (async () => Response.json({ key: "sk-or-v1-0123456789isolated" })) as unknown as typeof fetch;
  return connect(win as unknown as Window, fetchFn);
}

test("OpenRouter sign-in, page isolated: the code that comes back through the BroadcastChannel after the popup 'closed' is taken", async () => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  const pending = signIn(true);
  // (past the 1.5 s an ordinary page waits after its popup closed)
  await Bun.sleep(2600);
  const bc = new BroadcastChannel("kerr-openrouter-oauth");
  bc.postMessage({ type: "kerr-openrouter", code: "CODE" });
  bc.close();
  expect(await pending).toBe("sk-or-v1-0123456789isolated");
  openRouterKey.clear();
}, 10_000);

test("OpenRouter sign-in, page not isolated: a popup closed without a code is given up as before", async () => {
  const t0 = performance.now();
  expect(await signIn(false)).toBeNull();
  expect(performance.now() - t0).toBeLessThan(4000);
}, 10_000);
