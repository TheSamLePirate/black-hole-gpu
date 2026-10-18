import { afterEach, expect, test } from "bun:test";
import { groundGuard, kosGuard, kosLimit } from "../src/game/spaceguard";
import { alertsOf } from "../src/ui/hud/alerts";
import { CameraController } from "../src/controls";
import { fleet, fleetSpinStart, fleetStart } from "../src/fleet";
import { lin } from "../src/math/vec3";
import { defaultSettings, presets } from "../src/settings";
import { C_MPS, M_SECONDS } from "../src/units";
import { setSceneTime } from "../src/wormhole";
import { overPlace, resetFlights, TRANQUILITY } from "./helpers/flight";

// PLAN-VAISSEAUX X1b: a spacecraft's automatic protections — the ground foreseen on the engines (a caution, then the
// hover), the keep-out sphere (a caution, then station keeping); armed in the assisted levels and the realistic one
// with the setting, never in the manual one.

const activePose = fleet.activePose;
afterEach(() => {
  fleet.activePose = activePose;
  resetFlights();
  fleetStart(0, "ranger");
});

test("the ground: a safe descent nothing, a fast one low a caution then the action; a crash speed needed", () => {
  // (the Lander on the Moon: thrust 3× its weight)
  const g = 1.62;
  expect(groundGuard(500, 2, 3, g, 4.5).level).toBe("none");
  expect(groundGuard(3000, 40, 3, g, 4.5).level).toBe("none");
  // (40 m/s down: 290 m to stop at 90 % of the thrust — a caution at 600 m, the action at 400)
  expect(groundGuard(600, 40, 3, g, 4.5).level).toBe("warn");
  expect(groundGuard(400, 40, 3, g, 4.5).level).toBe("act");
  // (no thrust to stop it: still the action — the hover gives what it has)
  expect(groundGuard(1000, 30, 0.5, g, 4.5).level).toBe("act");
});

test("the keep-out sphere: its limit 1 m/s at 200 m, 0.1 m/s at 10 m; a caution at 1.5×, the action at 2×", () => {
  expect(kosLimit(200)).toBeCloseTo(1.05, 9);
  expect(kosLimit(10)).toBeCloseTo(0.1, 9);
  expect(kosGuard(250, 5).level).toBe("none");
  expect(kosGuard(100, 0.5).level).toBe("none");
  expect(kosGuard(100, 0.9).level).toBe("warn");
  expect(kosGuard(100, 1.3).level).toBe("act");
  expect(kosGuard(100, -3).level).toBe("none");
});

test("the HUD's alerts: a caution, a warning taken over, a warning not armed", () => {
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
  const al = (spaceGuard: unknown) => alertsOf({ ...(base as object), spaceGuard } as never);
  expect(al({ kind: "ground", level: "warn", armed: true, rate: 30, dist: 400, limit: 150 })[0]).toMatchObject({
    id: "guard-ground",
    level: "caution",
  });
  expect(al({ kind: "ground", level: "act", armed: true, rate: 30, dist: 200, limit: 150 })[0]!.text).toMatch(/AUTO-PROTECTION · GROUND/);
  expect(al({ kind: "kos", level: "act", armed: false, rate: 1.3, dist: 100, limit: 0.55 })[0]!.text).toMatch(/^CLOSING 1.3/);
});

test("falling at the Moon: the Lander hovers by itself above the ground (realistic, armed); manual: it crashes", () => {
  const run = (level: "realistic" | "manual") => {
    const { c, fly, msgs } = overPlace("moon", TRANQUILITY.lat, TRANQUILITY.lon, 2.5, false, "lander");
    c.s.spaceAssist = level;
    let warned = false;
    fly(120, () => {
      if (c.spaceGuard?.level === "warn") warned = true;
      return c.landed || c.pilot.auto === "hover" || msgs.some((m) => /crash|collapsed|tipped/i.test(m));
    });
    const sf = c.surfaceInfo() as { alt?: number; vVert?: number };
    if (c.pilot.auto === "hover") fly(30);
    const end = c.surfaceInfo() as { alt?: number; vVert?: number };
    return {
      warned,
      auto: c.pilot.auto,
      at: sf.alt ?? 0,
      v: sf.vVert ?? 0,
      end,
      crashed: msgs.some((m) => /crash|collapsed|tipped/i.test(m)),
      msgs,
    };
  };
  const a = run("realistic");
  console.log(
    `  realistic: caution ${a.warned}, ${a.auto} at ${a.at.toFixed(0)} m, ${(-a.v).toFixed(0)} m/s down → after 30 s ${(a.end.alt ?? 0).toFixed(0)} m, ${(a.end.vVert ?? 0).toFixed(1)} m/s`,
  );
  expect(a.warned).toBe(true);
  expect(a.auto).toBe("hover");
  expect(a.crashed).toBe(false);
  expect(a.end.alt ?? 0).toBeGreaterThan(5);
  expect(Math.abs(a.end.vVert ?? 9)).toBeLessThan(3);
  const m = run("manual");
  console.log(`  manual: ${m.crashed ? "crashed" : m.auto} · ${m.msgs.at(-1)}`);
  expect(m.auto).toBe("none");
  expect(m.crashed).toBe(true);
}, 180_000);

test("closing on the Endurance at 2 m/s inside 200 m: held by itself, short of it", () => {
  setSceneTime(0);
  const starts = fleetSpinStart(0, { rpm: 0, rangerM: 150 });
  fleet.active = "ranger";
  const s = {
    ...defaultSettings(),
    ...presets["Earth: the Endurance tumbling, 300 km up"]!,
    vessel: "ranger" as const,
    timeSpeed: 1 / M_SECONDS,
    animate: true,
  };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  fleet.activePose = () => c.activePoseNow();
  const msgs: string[] = [];
  c.onPilotMessage = (m) => msgs.push(m);
  c.time = 0;
  c.setPilot(true);
  c.newFlight();
  const r = starts.ranger;
  // (towards the port: the Ranger's rear hatch faces it — backwards along its nose)
  const g0 = (() => {
    c.flyFrom(r);
    c.settleMount();
    c.sync();
    return c.dockGeometry()!;
  })();
  c.flyFrom({ ...r, V: lin(r.V, 1, g0.a, -2 / C_MPS) });
  c.settleMount();
  c.sync();
  c.pilot.auto = "none";
  let minRange = Infinity;
  for (let i = 0; i < 30 * 120; i++) {
    c.flyShip(1 / 30, null as never);
    if (Number.isFinite(c.shipTime)) c.time = c.shipTime;
    minRange = Math.min(minRange, c.dockGeometry()?.range ?? Infinity);
  }
  const g = c.dockGeometry()!;
  console.log(
    `  ${msgs.find((m) => /Auto-protection/.test(m))} · nearest ${minRange.toFixed(1)} m · now ${g.range.toFixed(1)} m, ${Math.hypot(...g.vrel).toFixed(3)} m/s`,
  );
  expect(c.pilot.auto as string).toBe("keep");
  expect(msgs.some((m) => /Auto-protection: closing/.test(m))).toBe(true);
  expect(minRange).toBeGreaterThan(50);
  expect(Math.hypot(...g.vrel)).toBeLessThan(0.05);
}, 180_000);
