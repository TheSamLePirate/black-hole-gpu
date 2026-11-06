import { afterAll, expect, test } from "bun:test";
import { installNetActivity, netKind, netSnapshot } from "../src/system/net-activity";

// The network's light's counts (net-activity.ts): a request counted in flight from its call to its body read, failures,
// rate limits (429), aborts, the Service Worker's cache hits (x-kerr-cache) — and the kinds by URL.

let gate: () => void = () => {};
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/slow") await new Promise<void>((r) => (gate = r));
    if (u.pathname === "/fail") return new Response("no", { status: 500 });
    if (u.pathname === "/limit") return new Response("slow down", { status: 429 });
    if (u.pathname === "/cached") return new Response("x".repeat(10), { headers: { "x-kerr-cache": "lru" } });
    return new Response(new Uint8Array(1000));
  },
});
// (the native fetch under the wrapper: another file of the run may have left its stub in globalThis — earth-tiles.test's
// never answers —; it is put back after)
const before = globalThis.fetch;
afterAll(() => {
  server.stop(true);
  globalThis.fetch = before;
});
const at = (p: string) => `http://localhost:${server.port}${p}`;

test("kinds by URL", () => {
  expect(netKind("https://data.geopf.fr/wms-r?LAYERS=ELEVATION")).toBe("ign");
  expect(netKind("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/1/2.png")).toBe("relief");
  expect(netKind("https://gibs.earthdata.nasa.gov/wmts/x")).toBe("photos");
  expect(netKind("https://tiles.openfreemap.org/planet/1/2/3.pbf")).toBe("scenery");
  expect(netKind("https://api.open-meteo.com/v1/forecast")).toBe("weather");
});

test("a request in flight until its body is read; failures, 429s, aborts, cache hits", async () => {
  globalThis.fetch = Bun.fetch as typeof fetch;
  installNetActivity("test");
  const s0 = netSnapshot();
  // (in flight while the server holds it, still while its body is unread, done once read)
  const p = fetch(at("/slow"));
  await Bun.sleep(20);
  expect(netSnapshot().inflight).toBe(s0.inflight + 1);
  gate();
  const r = await p;
  expect(netSnapshot().inflight).toBe(s0.inflight + 1);
  await r.arrayBuffer();
  let s = netSnapshot();
  expect(s.inflight).toBe(s0.inflight);
  expect(s.done).toBe(s0.done + 1);
  expect(s.bytes - s0.bytes).toBe(1000);
  // (an HTTP error: failed at once, its body left; a 429: failed and limited)
  await fetch(at("/fail"));
  await fetch(at("/limit"));
  s = netSnapshot();
  expect(s.failed).toBe(s0.failed + 2);
  expect(s.limited).toBe(s0.limited + 1);
  expect(s.failAt).toBeGreaterThan(0);
  // (aborted before its answer: aborted, not failed)
  const ctl = new AbortController();
  const q = fetch(at("/slow"), { signal: ctl.signal }).catch(() => null);
  await Bun.sleep(20);
  ctl.abort();
  await q;
  gate();
  s = netSnapshot();
  expect(s.aborted).toBe(s0.aborted + 1);
  expect(s.failed).toBe(s0.failed + 2);
  // (the Service Worker's cache: counted as cached)
  await (await fetch(at("/cached"))).text();
  s = netSnapshot();
  expect(s.cached).toBe(s0.cached + 1);
  expect(s.inflight).toBe(s0.inflight);
});
