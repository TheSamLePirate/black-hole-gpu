import { afterEach, describe, expect, test } from "bun:test";
import { CARRIER, type CarrierId, deckHeight, readDeck, toDeck } from "../src/game/carrier";
import { putDeck } from "../src/controller/carriers";
import { VL_SPOT } from "../src/game/deckland";
import { fleet } from "../src/fleet";
import { setPlatforms } from "../src/system/our-surface";
import { cruise } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The F-35B's recovery on a carrier (docs/PLAN-AVIATION-AAA.md, M3; game/deckland.ts, controller/deckland.ts): its
// landing spots flat; too heavy to hover, refused; from 9 km off the carrier's quarter at 300 m, the autopilot up
// the port side, slowed to a hover alongside, across, down on the spot of a deck pitching in the sea, graded by
// the LSO; set down, it stays there.

afterEach(() => {
  resetFlights();
  setPlatforms("earth", []);
  fleet.fuel.f35 = undefined as never;
});

const D = Math.PI / 180;
const deck = async (k: CarrierId) => readDeck(await Bun.file(`assets/carriers/${k}.deck.bin`).arrayBuffer());

describe("the landing spots", () => {
  test("each flat over 16 m about it, on the flight deck", async () => {
    for (const k of ["ford", "kiev", "implacable"] as const) {
      const M = await deck(k);
      const [x, z] = VL_SPOT[k];
      let lo = Infinity,
        hi = -Infinity;
      for (let dx = -8; dx <= 8; dx += 2)
        for (let dz = -8; dz <= 8; dz += 2) {
          const h = deckHeight(M, x + dx, z + dz);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      console.log(`  ${CARRIER[k].name}: the spot ${x}, ${z} — ${lo.toFixed(2)}…${hi.toFixed(2)} m`);
      expect(hi - lo).toBeLessThan(0.6);
      expect(Math.abs(lo - CARRIER[k].deck)).toBeLessThan(1.5);
    }
  });
});

/** From 9 km off, the recovery on `k` in a sea of `hs` [m]; what the LSO said, where it stood 20 s after. */
async function recover(k: CarrierId, hs: number, fuel = 1800) {
  putDeck(k, await deck(k));
  const { c, fly } = cruise(300, 140, 0.4);
  c.jetToggle("ap");
  c.jetToggle("athr");
  c.seaHs = hs;
  fleet.fuel.f35 = fuel;
  const g = c.geoNow()!;
  const ahead = 9000;
  c.carrierSpawn(k, {
    lat: g.lat + (ahead * Math.cos(g.track)) / 111_195,
    lon: g.lon + (ahead * Math.sin(g.track)) / (111_195 * Math.cos(g.lat * D)),
    heading: g.track / D + 40,
    speed: CARRIER[k].speed,
  });
  c.carrierStep();
  const radio: string[] = [];
  c.onRadio = (s) => radio.push(s);
  const said = c.deckLand(k);
  let t = 0;
  while (c.deckRun && t < 400) {
    fly(1);
    t++;
  }
  const where = () => toDeck(c.carrierNow()[0]!.P, c.netOwn()!.p);
  const w0 = where();
  fly(20);
  const w1 = where();
  return { c, said, radio, t, last: c.deckLast, drift: Math.hypot(w1[0] - w0[0], w1[2] - w0[2]) };
}

describe("the recovery", () => {
  test("too heavy to hover: refused, the fuel to burn said", async () => {
    putDeck("ford", await deck("ford"));
    const { c } = cruise(300, 140, 0.4);
    const g = c.geoNow()!;
    c.carrierSpawn("ford", { lat: g.lat + 0.05, lon: g.lon, heading: 0, speed: 14.4 });
    c.carrierStep();
    const said = c.deckLand("ford")!;
    console.log(`  full tanks: ${said}`);
    expect(said).toContain("too heavy");
    expect(c.deckRun ?? null).toBeNull();
  });

  for (const [k, hs] of [
    ["ford", 2],
    ["kiev", 1.5],
    ["implacable", 3],
  ] as const)
    test(`on the ${k}, its deck pitching in a ${hs} m sea: alongside, across, down on the spot, graded; it stays there`, async () => {
      const r = await recover(k, hs);
      const tc = r.last!;
      console.log(
        `  ${r.said}: down in ${r.t} s, ${Math.hypot(tc.dx, tc.dz).toFixed(2)} m off the spot at ${tc.sink.toFixed(2)} m/s — ${tc.grade}; 20 s after, ${r.drift.toFixed(2)} m on\n    ${r.radio.join("\n    ")}`,
      );
      expect(tc).toBeTruthy();
      expect(Math.hypot(tc.dx, tc.dz)).toBeLessThan(2.5);
      expect(tc.sink).toBeLessThan(2.5);
      expect(tc.grade).toBe("OK");
      expect(r.c.landed).toBe(true);
      expect(r.drift).toBeLessThan(3);
      expect(r.radio.some((s) => s.includes("Cleared to land"))).toBe(true);
    }, 120_000);
});
