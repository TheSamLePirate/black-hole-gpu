import { afterEach, expect, test } from "bun:test";
import { RING, RPM, ringG, ringRateFor } from "../src/controller/ring";
import { alertsOf } from "../src/ui/hud/alerts";
import { CameraController } from "../src/controls";
import { fleet, fleetStart } from "../src/fleet";
import { defaultSettings, presets } from "../src/settings";
import { M_SECONDS } from "../src/units";
import { setSceneTime } from "../src/wormhole";

// PLAN-VAISSEAUX X2a: the Endurance's ring — the whole craft turned about its axis for the crew's weight (ω² r, 30 m),
// the turn asked by a revolution a minute (⇧[ ⇧]) and held by its thrusters; the HUD's advisory.

const activePose = fleet.activePose;
afterEach(() => {
  fleet.activePose = activePose;
  fleetStart(0, "ranger");
});

test("the weight in the ring: 5 rpm at 30 m is 0.84 g; 1 g asks 5.5 rpm", () => {
  expect(ringG(5 * RPM, 30)).toBeCloseTo(0.839, 3);
  expect(ringRateFor(1, 30) / RPM).toBeCloseTo(5.46, 2);
});

test("the HUD: an advisory while it turns, a caution past 7 rpm, the turn asked shown while it spins up", () => {
  const base = {
    path: null,
    landed: false,
    surface: null,
    air: null,
    ergo: false,
    region: "home",
    r: 0,
    photon: 0,
    isco: 0,
    auto: "none",
    target: "earth",
    engine: { fuel: null },
    animate: true,
    fmtM: () => "",
  } as never;
  const al = (ring: unknown) => alertsOf({ ...(base as object), ring } as never).find((a) => a.id === "ring");
  expect(al({ rpm: 0, g: 0, asked: null })).toBeUndefined();
  expect(al({ rpm: 2.4, g: 0.19, asked: 5 })).toMatchObject({ level: "advisory", text: "RING 2.4 RPM → 5 · 0.19 G" });
  expect(al({ rpm: 8, g: 2.15, asked: 8 })).toMatchObject({ level: "caution" });
});

test("flying the Endurance: five ⇧] spin it up to 5 rpm, held; ⇧[ to 0 stops it", () => {
  setSceneTime(0);
  const starts = fleetStart(0, "endurance");
  const s = {
    ...defaultSettings(),
    ...presets["Earth: the Endurance, 800 km up"]!,
    vessel: "endurance" as const,
    timeSpeed: 1 / M_SECONDS,
    animate: true,
  };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  fleet.activePose = () => c.activePoseNow();
  c.time = 0;
  c.setPilot(true);
  c.newFlight();
  c.flyFrom(starts.endurance);
  c.settleMount();
  c.sync();
  const fly = (sec: number) => {
    for (let i = 0; i < sec * 30; i++) {
      c.flyShip(1 / 30, null as never);
      if (Number.isFinite(c.shipTime)) c.time = c.shipTime;
    }
  };
  let said = "";
  for (let k = 0; k < 5; k++) said = c.ringSet(1);
  expect(said).toMatch(/5 rpm asked — 0.84 g/);
  let t = 0;
  while (t < 300 && Math.abs(c.ringInfo()!.rpm - 5) > 0.05) {
    fly(1);
    t++;
  }
  const r = c.ringInfo()!;
  console.log(`  spun up to ${r.rpm.toFixed(2)} rpm (${r.g.toFixed(2)} g) in ${t} s`);
  expect(Math.abs(r.rpm - 5)).toBeLessThan(0.06);
  fly(20);
  expect(Math.abs(c.ringInfo()!.rpm - 5)).toBeLessThan(0.06);
  // (its other axes still: the turn about its axis only)
  expect(Math.hypot(c.pilot.omega[0], c.pilot.omega[1])).toBeLessThan(0.01);
  for (let k = 0; k < 6; k++) c.ringSet(-1);
  fly(300);
  expect(c.ringInfo()!.rpm).toBeLessThan(0.05);
  expect(RING.maxRpm).toBe(10);
}, 180_000);
