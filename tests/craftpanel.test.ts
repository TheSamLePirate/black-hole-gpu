import { afterEach, expect, test } from "bun:test";
import { descentPanel, hoverCall, hoverSeconds, mothershipPanel } from "../src/game/craftpanel";
import { hudKindOf } from "../src/game/hudkind";
import { CameraController } from "../src/controls";
import { fleet, fleetStart } from "../src/fleet";
import { defaultSettings, presets } from "../src/settings";
import { M_SECONDS } from "../src/units";
import { setSceneTime } from "../src/wormhole";
import { overPlace, resetFlights, TRANQUILITY } from "./helpers/flight";

// PLAN-VAISSEAUX X4: each spacecraft its own HUD — the Lander's descent panel (H, Ḣ, the speeds forward and across, the
// hover's seconds, Apollo's « 60 » and « 30 » calls), the Endurance's mothership panel (ring, ports, mass, tanks); the
// space HUD over an airless world (not the aircraft's).

const id = (s: string) => s;
const activePose = fleet.activePose;
afterEach(() => {
  fleet.activePose = activePose;
  resetFlights();
  fleetStart(0, "ranger");
});

test("the descent panel: the hover's seconds (Δv over the weight), their tones; the calls at 60 and 30 s", () => {
  expect(hoverSeconds(162, 1.62)).toBeCloseTo(100, 9);
  const P = descentPanel({ h: 120, hDot: -2, vFwd: 1.5, vLat: -0.3, dvLeft: 81, g: 1.62, tank: 0.07 }, id);
  expect(P.title).toBe("DESCENT");
  expect(P.rows.find((r) => r.label === "HOVER")).toMatchObject({ value: "50 s", tone: "warn" });
  expect(P.rows.find((r) => r.label === "PROPELLANT")).toMatchObject({ value: "7 %", tone: "bad" });
  expect(hoverCall(61, 59)).toBe(60);
  expect(hoverCall(31, 29.9)).toBe(30);
  expect(hoverCall(59, 40)).toBeNull();
});

test("the mothership panel: the ring, each port free or docked, the mass, the tanks", () => {
  const P = mothershipPanel(
    {
      rpm: 5,
      g: 0.84,
      ports: [
        { name: "hub, fore", docked: "Ranger" },
        { name: "hub, aft", docked: null },
      ],
      massKg: 940_000,
      tanks: [{ name: "Endurance", share: 0.96 }],
    },
    id,
  );
  expect(P.rows.map((r) => [r.label, r.value])).toEqual([
    ["RING", "5.0 rpm · 0.84 g"],
    ["HUB, FORE", "Ranger"],
    ["HUB, AFT", "free"],
    ["MASS", "940 t"],
    ["ENDURANCE", "96 %"],
  ]);
});

test("over an airless world the flight phase shows the space HUD, low the approach's — never the aircraft's", () => {
  expect(hudKindOf({ stage: "air", mode: null, final: false, low: false, airless: true })).toBe("space");
  expect(hudKindOf({ stage: "air", mode: null, final: false, low: true, airless: true })).toBe("approach");
  expect(hudKindOf({ stage: "air", mode: null, final: false, low: false })).toBe("atmo");
});

test("the Lander 3 km over the Moon: its DESCENT panel; the Endurance flown with the Ranger docked: its MOTHERSHIP panel", () => {
  const { c } = overPlace("moon", TRANQUILITY.lat, TRANQUILITY.lon, 3, true, "lander");
  c.flyShip(1 / 30, null as never);
  const d = c.flightInfo().craftPanel!;
  expect(d.title).toBe("DESCENT");
  expect(d.rows[0]!.label).toBe("H");
  // (its landing radar — PLAN-RADAR-AAA, RD4's leftover —: 3 km up, level: both locks, its height the probes')
  const lr = c.flightInfo().landRadar!;
  expect(lr.alt && lr.vel).toBe(true);
  expect(lr.h!).toBeGreaterThan(2500);
  expect(lr.h!).toBeLessThan(3500);
  // (level: the belly down — the slant along it the height)
  expect(lr.slant! / lr.h!).toBeLessThan(1.02);
  expect(d.rows.find((r) => r.label === "LR")?.value).toBe("ALT · VEL");
  // the Endurance: its own panel (the Ranger on its fore port)
  setSceneTime(0);
  const starts = fleetStart(0, "endurance");
  const s = {
    ...defaultSettings(),
    ...presets["Earth: the Endurance, 800 km up"]!,
    vessel: "endurance" as const,
    timeSpeed: 1 / M_SECONDS,
    animate: true,
  };
  const e = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  fleet.activePose = () => e.activePoseNow();
  e.time = 0;
  e.setPilot(true);
  e.newFlight();
  e.flyFrom(starts.endurance);
  e.settleMount();
  e.sync();
  e.flyShip(1 / 30, null as never);
  const m = e.flightInfo().craftPanel!;
  console.log(
    `  ${d.title}: ${d.rows.map((r) => `${r.label} ${r.value}`).join(" · ")}\n  ${m.title}: ${m.rows.map((r) => `${r.label} ${r.value}`).join(" · ")}`,
  );
  expect(m.title).toBe("ENDURANCE");
  expect(m.rows.find((r) => r.label === "HUB, FORE")!.value).toBe("Ranger");
}, 60_000);
