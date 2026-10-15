import { afterEach, describe, expect, test } from "bun:test";
import { CARRIER, type CarrierId, deckHeight, readDeck, toDeck } from "../src/game/carrier";
import { putDeck } from "../src/controller/carriers";
import { bowEnd, STO_LANE, VL_SPOT } from "../src/game/deckland";
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
  delete (fleet.fuel as Record<string, number>).f35;
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

/** From 9 km off, the recovery on `k` in a sea of `hs` [m]; what the LSO said, how it settled and stayed. */
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
  // (still on the deck once the engine is down to idle: from 5 s after the touchdown to 20 — before, it spools down
  // and the craft settles on its brakes, a few metres)
  const where = () => toDeck(c.carrierNow()[0]!.P, c.netOwn()!.p);
  const w0 = where();
  fly(5);
  const w5 = where();
  fly(15);
  const w1 = where();
  return {
    c,
    said,
    radio,
    t,
    last: c.deckLast,
    settle: Math.hypot(w5[0] - w0[0], w5[2] - w0[2]),
    drift: Math.hypot(w1[0] - w5[0], w1[2] - w5[2]),
  };
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
        `  ${r.said}: down in ${r.t} s, ${Math.hypot(tc.dx, tc.dz).toFixed(2)} m off the spot at ${tc.sink.toFixed(2)} m/s — ${tc.grade}; settled ${r.settle.toFixed(2)} m on its brakes, then ${r.drift.toFixed(2)} m in 15 s\n    ${r.radio.join("\n    ")}`,
      );
      expect(tc).toBeTruthy();
      expect(Math.hypot(tc.dx, tc.dz)).toBeLessThan(2.5);
      expect(tc.sink).toBeLessThan(2.5);
      expect(tc.grade).toBe("OK");
      expect(r.c.landed).toBe(true);
      expect(r.settle).toBeLessThan(6);
      expect(r.drift).toBeLessThan(0.5);
      expect(r.radio.some((s) => s.includes("Cleared to land"))).toBe(true);
    }, 120_000);
});

/** Set down on `k`'s take-off lane with `fuel` [kg], the take-off engaged and flown: what it said, where it left
 *  the deck, how low it went, where it was at its end. */
async function launch(k: CarrierId, hs: number, fuel: number, mode?: "short" | "vertical") {
  const M = await deck(k);
  putDeck(k, M);
  const { c, fly } = cruise(300, 140, 0.4);
  c.seaHs = hs;
  const g = c.geoNow()!;
  c.carrierSpawn(k, { lat: g.lat, lon: g.lon, heading: 30, speed: CARRIER[k].speed });
  c.carrierStep();
  const [x, z] = STO_LANE[k];
  c.carrierLand(k, { x, z });
  fleet.fuel.f35 = fuel;
  const radio: string[] = [];
  c.onRadio = (s) => radio.push(s);
  const said = c.deckTakeoff(mode)!;
  const bow = bowEnd(M, x, z);
  let off = Number.NaN;
  let lowest = Infinity;
  let t = 0;
  while (c.stoRun && t < 120) {
    fly(0.25);
    t += 0.25;
    const l = toDeck(c.carrierNow()[0]!.P, c.netOwn()!.p);
    if (Number.isNaN(off) && c.stoRun && c.stoRun.phase !== "convert" && !c.rolling && !c.ourLanded) off = l[2];
    if (!Number.isNaN(off)) lowest = Math.min(lowest, c.geoNow()!.alt);
  }
  const end = c.geoNow()!;
  const V = c.airFlight.last?.speed ?? 0;
  console.log(
    `  ${said}: off ${(off - z).toFixed(0)} m down the deck (${(bow - z).toFixed(0)} m clear), ${lowest.toFixed(0)} m over the sea at the lowest; ${t} s on, ${end.alt.toFixed(0)} m, ${V.toFixed(0)} m/s, STOVL ${c.stovl.on ? "on" : "off"}\n    ${radio.join("\n    ")}`,
  );
  return { c, said, off, bow, z, lowest, end, V };
}

describe("the take-off from a deck", () => {
  for (const [k, hs] of [
    ["ford", 2],
    ["implacable", 3],
  ] as const)
    test(`a short one from the ${k}'s lane, full tanks, in a ${hs} m sea: off before the bow, climbing, conventional past 100 m/s`, async () => {
      const r = await launch(k, hs, 6125);
      expect(r.said).toContain("Short take-off from");
      expect(r.off).toBeLessThan(r.bow);
      expect(r.lowest).toBeGreaterThan(5);
      expect(r.c.stoRun ?? null).toBeNull();
      expect(r.c.stovl.on).toBe(false);
      expect(r.end.alt).toBeGreaterThan(40);
    }, 120_000);

  test("from the Kiev's short deck, full tanks: refused — its run too short, too heavy to rise vertically", async () => {
    const r = await launch("kiev", 1.5, 6125);
    expect(r.said).toContain("too heavy to rise vertically");
    expect(r.c.stoRun ?? null).toBeNull();
  }, 120_000);

  test("from the Kiev, light: a short one on its 150 m", async () => {
    const r = await launch("kiev", 1.5, 1800);
    expect(r.said).toContain("Short take-off from");
    expect(r.off).toBeLessThan(r.bow);
    expect(r.c.stovl.on).toBe(false);
  }, 120_000);

  test("from the Kiev, light, a vertical one asked: up off the deck, away, conventional past 100 m/s", async () => {
    const r = await launch("kiev", 1.5, 1800, "vertical");
    expect(r.said).toContain("Vertical take-off from");
    // (straight up where it stood, never below the deck after)
    expect(Math.abs(r.off - r.z)).toBeLessThan(10);
    expect(r.lowest).toBeGreaterThan(CARRIER.kiev.deck - 1);
    expect(r.end.alt).toBeGreaterThan(40);
    expect(r.c.stoRun ?? null).toBeNull();
    expect(r.c.stovl.on).toBe(false);
    expect(r.V).toBeGreaterThan(95);
  }, 120_000);
});
