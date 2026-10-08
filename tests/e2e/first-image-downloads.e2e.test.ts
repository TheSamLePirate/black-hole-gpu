import { afterAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// What the first image waits for (PLAN-MONDE M3): a scene away from the Earth and from Jupiter downloads
// neither the Earth's medium maps (22.7 MB) nor Jupiter's moons' ephemeris (JUP365, 4.1 MB) before its
// first image — both come after it, ahead of need; a scene at Jupiter waits for JUP365 before it is
// placed. Before: every scene's first image waited behind all of them (at 20 Mbit/s, 11.1 s against 5.5–6.1).

interface Seen {
  first: number;
  files: { name: string; end: number }[];
}

const seen = (app: App) =>
  app.js<Seen>(`({ first: __bh.renderer.firstFrameDoneAt,
    files: performance.getEntriesByType("resource").map((e) => ({ name: e.name, end: e.responseEnd })) })`);

describe.skipIf(!E2E)("what the first image waits for", () => {
  afterAll(stopServer);

  test("at Gargantua: the Earth's maps and JUP365 after the first image, then fetched", async () => {
    const app = await App.boot({ width: 640, height: 400, hash: `scene=${encodeURIComponent("Ranger: approaching Gargantua")}` });
    try {
      await app.waitFor("__bh.renderer.firstFrameDoneAt > 0", 90_000);
      // (JUP365 2 s after the first image, the Earth's maps 3 s after it)
      await app.waitFor(
        `performance.getEntriesByType("resource").some((e) => e.name.includes("jup365")) &&
         performance.getEntriesByType("resource").some((e) => /med-up-.*\\.ktx2|day-med\\/up/.test(e.name))`,
        60_000,
      );
      const s = await seen(app);
      const before = s.files.filter((f) => f.end <= s.first).map((f) => f.name);
      expect(before.some((n) => n.includes("de440"))).toBe(true);
      expect(before.some((n) => n.includes("jup365"))).toBe(false);
      expect(before.some((n) => /med-(up|dn|ft|bk|lf|rt)-/.test(n))).toBe(false);
    } finally {
      app.close();
    }
  }, 180_000);

  test("at Jupiter: JUP365 in before the scene is placed", async () => {
    const app = await App.boot({ width: 640, height: 400, hash: `scene=${encodeURIComponent("Io: Jupiter in the sky")}` });
    try {
      await app.waitFor("__bh.renderer.firstFrameDoneAt > 0", 90_000);
      const s = await seen(app);
      expect(s.files.filter((f) => f.end <= s.first).some((f) => f.name.includes("jup365"))).toBe(true);
    } finally {
      app.close();
    }
  }, 180_000);
});
