import { test, expect } from "bun:test";
import { presets } from "../src/settings";
import { PRESET_INFO, SCENE_GROUPS } from "../src/ui/schema";
import { loading } from "../src/loading";

test("every scene has its gallery card (title, blurb, glyph, group)", () => {
  const groups = new Set(SCENE_GROUPS.map((g) => g.id));
  for (const name of Object.keys(presets)) {
    const i = PRESET_INFO[name];
    expect(i, name).toBeDefined();
    expect(i!.description.length, name).toBeGreaterThan(10);
    expect(groups.has(i!.group), name).toBe(true);
  }
  // (no card for a scene that no longer exists)
  for (const name of Object.keys(PRESET_INFO)) expect(presets[name], name).toBeDefined();
});

test("the loading tracker: weights, bytes, indeterminate stages, failures", async () => {
  loading.stage("t-a", "A", { weight: 1 });
  loading.stage("t-b", "B", { weight: 3, indeterminate: true, eta: 1 });
  const now = performance.now();
  expect(loading.fracOf(loading.list().find((s) => s.id === "t-a")!, now)).toBe(0);
  // an indeterminate stage eases up but never reaches 1 on its own
  const b = loading.list().find((s) => s.id === "t-b")!;
  expect(loading.fracOf(b, now + 1e6)).toBeLessThan(1);
  expect(loading.fracOf(b, now + 1e6)).toBeGreaterThan(0.9);
  loading.set("t-a", 0.5);
  loading.set("t-a", 0.2); // (never backwards)
  expect(loading.list().find((s) => s.id === "t-a")!.frac).toBe(0.5);

  // a counted download (a local server with a Content-Length)
  const body = new Uint8Array(200_000);
  const server = Bun.serve({ port: 0, fetch: () => new Response(body, { headers: { "content-length": String(body.length) } }) });
  try {
    loading.stage("t-c", "C");
    const res = await loading.fetch(`http://localhost:${server.port}/x`, "t-c");
    expect((await res.arrayBuffer()).byteLength).toBe(body.length);
    const c = loading.list().find((s) => s.id === "t-c")!;
    expect(c.loaded).toBe(body.length);
    expect(c.total).toBe(body.length);
    expect(c.frac).toBeCloseTo(0.92, 5);
  } finally {
    server.stop(true);
  }

  await expect(loading.track("t-d", "D", Promise.reject(new Error("nope")))).rejects.toThrow("nope");
  expect(loading.list().find((s) => s.id === "t-d")!.state).toBe("failed");
  await loading.track("t-a", "A", Promise.resolve(1));
  loading.done("t-b");
  loading.done("t-c");
  expect(loading.pending.filter((s) => s.id.startsWith("t-")).length).toBe(0);
  expect(loading.progress()).toBe(1);
});
