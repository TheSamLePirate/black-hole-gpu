import { afterEach, describe, expect, test } from "bun:test";
import { CARRIER, carrierPose, deckHeight, readDeck, toDeck } from "../src/game/carrier";
import { meatball, putDeck } from "../src/controller/carriers";
import { LANDING } from "../src/game/carrier";
import { setPlatforms } from "../src/system/our-surface";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import { GEAR } from "../src/landing";
import { cruise } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The carriers at sea (docs/PLAN-AVIATION-AAA.md, M2; game/carrier.ts, controller/carriers.ts): their decks' maps
// (their flight decks at their freeboard, their islands above); their course on the clock; the F-35B set on the
// Ford's deck, steaming at 28 kt in a sea, carried along with it; dropped onto it, it lands and stays.

afterEach(() => {
  resetFlights();
  setPlatforms("earth", []);
});

const D = Math.PI / 180;
const deck = async (k: "ford" | "kiev" | "implacable") => readDeck(await Bun.file(`assets/carriers/${k}.deck.bin`).arrayBuffer());

describe("the decks", () => {
  test("each flight deck at its freeboard over the waterline amidships; the Ford's island higher, starboard", async () => {
    for (const k of ["ford", "kiev", "implacable"] as const) {
      const M = await deck(k);
      // (aft of amidships on the centreline, the landing area: the flight deck)
      const h = deckHeight(M, k === "ford" ? 8 : 0, -0.3 * CARRIER[k].len);
      console.log(`  ${CARRIER[k].name}: deck ${h.toFixed(1)} m over the waterline (${M.nx} × ${M.nz} m)`);
      expect(Math.abs(h - CARRIER[k].deck)).toBeLessThan(1.5);
    }
    const F = await deck("ford");
    // (the island: on its starboard side — x < 0 — aft of amidships, tens of metres over the deck)
    let island = 0;
    for (let z = -130; z < 0; z += 2) for (let x = -45; x < -15; x += 1) island = Math.max(island, deckHeight(F, x, z) || 0);
    expect(island).toBeGreaterThan(CARRIER.ford.deck + 15);
  });

  test("its course: a minute at its speed along its heading, its heave and pitch small in a 2 m sea", () => {
    const sp = { kind: "ford" as const, lat: 40, lon: -35, heading: 60 * D, speed: 14.4, t0: 1_800_000_000, seed: 3 };
    const a = carrierPose(sp, sp.t0, 2),
      b = carrierPose(sp, sp.t0 + 60, 2);
    const d = Math.hypot(...[0, 1, 2].map((i) => b.p[i]! - a.p[i]!));
    expect(Math.abs(d - 14.4 * 60)).toBeLessThan(3);
    expect(Math.abs(Math.hypot(...a.v) - 14.4)).toBeLessThan(0.5);
    let pitch = 0;
    for (let t = 0; t < 120; t += 0.5) {
      const P = carrierPose(sp, sp.t0 + t, 2);
      const g = cartToGeodetic(WGS84_A, WGS84_F, P.p);
      const U = [Math.cos(g.lat) * Math.cos(g.lon), Math.cos(g.lat) * Math.sin(g.lon), Math.sin(g.lat)];
      pitch = Math.max(pitch, Math.abs(Math.asin(P.bow[0] * U[0]! + P.bow[1] * U[1]! + P.bow[2] * U[2]!)) / D);
    }
    console.log(`  the Ford in a 2 m sea: pitching ${pitch.toFixed(2)}° at most`);
    expect(pitch).toBeLessThan(1.5);
  });
});

describe("on the Ford's deck", () => {
  test("set down aft of its island, steaming at 28 kt in a 2 m sea: carried along with it a minute, where it was set", async () => {
    putDeck("ford", await deck("ford"));
    const run = cruise(500, 150, 0.3);
    const { c, fly } = run;
    c.s.vessel = "f35";
    c.seaHs = 2;
    const g = c.geoNow()!;
    c.carrierSpawn("ford", { lat: g.lat, lon: g.lon, heading: 30, speed: 14.4 });
    c.carrierStep();
    const said = c.carrierLand("ford", { x: 5, z: -60, facing: -10 });
    console.log(`  ${said}`);
    expect(said).toContain("deck");
    const where = () => {
      const o = c.netOwn()!;
      const P = c.carrierNow()[0]!.P;
      return toDeck(P, o.p);
    };
    // (its heading on the deck [°] and its top's tilt off the deck's normal [°]: set, then carried — not turned)
    const att = () => {
      const o = c.netOwn()!;
      const P = c.carrierNow()[0]!.P;
      const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
      return [
        (Math.atan2(-dot(o.fwd, P.port), dot(o.fwd, P.bow)) * 180) / Math.PI,
        (Math.acos(Math.min(1, dot(o.up, P.up))) * 180) / Math.PI,
      ];
    };
    const w0 = where();
    let worst = 0;
    for (let k = 0; k < 60; k++) {
      fly(1);
      const [yaw, tilt] = att();
      worst = Math.max(worst, Math.abs(yaw! + 10), tilt!);
    }
    console.log(`  its heading on the deck −10° and level to ${worst.toFixed(2)}° at worst`);
    expect(worst).toBeLessThan(0.2);
    const w1 = where();
    const drift = Math.hypot(w1[0] - w0[0], w1[2] - w0[2]);
    console.log(
      `  after a minute: ${drift.toFixed(2)} m from where it was set on the deck, ${(w1[1] - w0[1]).toFixed(2)} m up; landed ${c.landed}; the carrier ${(14.4 * 60).toFixed(0)} m on`,
    );
    expect(c.landed).toBe(true);
    expect(drift).toBeLessThan(0.5);
    expect(Math.abs(w1[1] - w0[1])).toBeLessThan(0.5);
  }, 60_000);

  test("dropped from 3 m over the deck steaming at 28 kt, gear down: its gear meets the moving deck, it comes to rest and stays there", async () => {
    putDeck("ford", await deck("ford"));
    const { c, fly } = cruise(500, 150, 0.3);
    c.s.vessel = "f35";
    c.seaHs = 1.5;
    const g = c.geoNow()!;
    c.carrierSpawn("ford", { lat: g.lat, lon: g.lon, heading: 120, speed: 14.4 });
    c.carrierStep();
    c.carrierLand("ford", { x: 8, z: -40, drop: 3 });
    c.pilot.throttle = 0;
    c.pilot.engineNow = 0;
    const where = () => toDeck(c.carrierNow()[0]!.P, c.netOwn()!.p);
    const w0 = where();
    fly(20);
    const w1 = where();
    const top = deckHeight(await deck("ford"), w1[0], w1[2]);
    const drift = Math.hypot(w1[0] - w0[0], w1[2] - w0[2]);
    console.log(
      `  dropped 3 m: after 20 s ${drift.toFixed(2)} m from under where it was let go, its reference ${(w1[1] - top).toFixed(2)} m over the deck (the gear's ${GEAR} m); landed ${c.landed}`,
    );
    expect(Math.abs(w1[1] - top - GEAR)).toBeLessThan(0.6);
    expect(drift).toBeLessThan(3);
  }, 60_000);
});

describe("the meatball", () => {
  test("on the glide path: the ball on the datum; a degree high: four cells up; astern only", () => {
    const L = LANDING.ford!;
    const a = (L.angle * Math.PI) / 180;
    const at = (d: number, dh: number) => {
      const h = d * Math.tan(((L.glide + dh) * Math.PI) / 180);
      return [L.aim[0] - Math.sin(a) * d, CARRIER.ford.deck + h, L.aim[1] - Math.cos(a) * d];
    };
    const on = meatball("ford", at(1200, 0))!;
    const high = meatball("ford", at(1200, 1))!;
    const ahead = meatball("ford", [L.aim[0] + 200 * Math.sin(a), 60, L.aim[1] + 200 * Math.cos(a)])!;
    console.log(
      `  on the path ${on.error.toFixed(3)}°, a degree high ${high.error.toFixed(2)}° (${(high.error / 0.25).toFixed(1)} cells); ahead of it seen ${ahead.seen}`,
    );
    expect(Math.abs(on.error)).toBeLessThan(0.01);
    expect(Math.abs(high.error - 1)).toBeLessThan(0.02);
    expect(on.seen).toBe(true);
    expect(ahead.seen).toBe(false);
    expect(meatball("kiev", [0, 50, -500])).toBeNull();
  });
});
