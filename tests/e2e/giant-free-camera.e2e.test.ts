import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The free camera into the giants' clouds (PLAN-PLANETES-AAA P11): no craft, the camera 3 000 km over Jupiter's clouds near
// the Great Red Spot, then over Saturn's at 42° N, looking straight down, the forward key held (its speed's multiplier held
// at 1 — no travel boost) and the world stepped a thirtieth of a second at a time. Before: the keys' speed went as the
// height over the giant's sphere — its equatorial radius, 170 km over Jupiter's clouds at 12° S, thousands over Saturn's at
// 42° N —, the camera stalled there at a metre a second. Now: under 1 bar within ~40 s, stopped at the deep's floor
// (a hundredth of the radius under the 1 bar ellipsoid), no place lost on the way.
// Duration: ~1 min on this Mac
// Done when: both giants' descents read.

afterAll(stopServer);

const SPOTS = [
  { id: "jupiter", scene: "Jupiter: from orbit", at: [-12, 128.5], floorKm: -715 },
  { id: "saturn", scene: "Saturn: the rings from above", at: [42, 0], floorKm: -600 },
];

test.skipIf(!E2E)(
  "the free camera flies down into Jupiter's and Saturn's clouds, and stops at their deep floor",
  async () => {
    const app = await App.boot({ width: 1280, height: 720, hash: `scene=${encodeURIComponent("Jupiter: from orbit")}` });
    try {
      for (const g of SPOTS) {
        await app.js(`(() => { __bh.presets.zzf = { ...__bh.presets[${JSON.stringify(g.scene)}], target: "${g.id}", ship: false, fov: 60,
          pose: { body: "${g.id}", altKm: 3000, at: [${g.at}], aim: [${g.at}] } }; __bh.game.preset("zzf"); return 1; })()`);
        await app.settled();
        const path = await app.js<(number | null)[]>(`(() => { const c = __bh.camera, out = []; __bh.freeze(true);
          for (let s = 0; s < 40; s++) { for (let i = 0; i < 30; i++) { c.codes.add("KeyW"); c.flySpeed = 1; c.moveHeld = 0; __bh.step(1 / 30); }
            const g = __bh.sys.geodetic(); out.push(g && g.body === "${g.id}" ? g.altM / 1e3 : null); }
          c.codes.delete("KeyW"); __bh.freeze(false); return out; })()`);
        console.log(`  ${g.id}: ${path.map((h) => (h === null ? "—" : h.toFixed(0))).join(" ")} km`);
        // (always over this giant, a number)
        expect(path.every((h) => h !== null && Number.isFinite(h))).toBe(true);
        const hs = path as number[];
        // (under 1 bar within the 40 s; not stalled over the clouds — the old stall: 170 km over Jupiter's)
        expect(hs.findIndex((h) => h < 0)).toBeGreaterThanOrEqual(0);
        // (held at the deep's floor, not through it)
        expect(Math.min(...hs)).toBeGreaterThan(g.floorKm - 150);
        expect(hs[hs.length - 1]!).toBeLessThan(-100);
      }
    } finally {
      app.close();
    }
  },
  600_000,
);
