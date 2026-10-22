// The A320's flight deck (docs/PLAN-A320.md, A5 — scripts/build-a320-cockpit.py → assets/a320/a320-cockpit.bin,
// src/a320/deck.ts): the mesh as built (its rig, its controls, its objects, its displays' cells), the properties the
// flight gives it (the gear lever's travel, the thrust levers, the autobrake's lights), and its rig moving what they
// move (the side stick aft, a light shown or hidden).
import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { DeckPoser, type DeckInputs, type DeckMesh, parseDeck } from "../src/a320/deck";
import { leverAngle } from "../src/a320/fadec";
import { partCount, rigMatrices } from "../src/a320/rig";

const load = async (): Promise<DeckMesh> => {
  const b = gunzipSync(new Uint8Array(await Bun.file("assets/a320/a320-cockpit.bin").arrayBuffer()));
  return parseDeck(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};
const inputs = (o: Partial<DeckInputs> = {}): DeckInputs => ({
  dt: 1 / 60,
  stick: [0, 0],
  pedals: 0,
  tiller: 0,
  gearDown: true,
  fcs: null,
  lever: 0,
  reverse: 0,
  flapLever: 0,
  speedBrake: 0,
  spoilersArmed: false,
  parkBrake: false,
  powered: true,
  ...o,
});
/** a vertex k posed by the rig's maps (rows of 3 × 4, its part's) */
const posed = (m: DeckMesh, mats: Float32Array, k: number) => {
  const p = Math.floor(m.verts[10 * k + 7]!);
  const r = 12 * p;
  const x = m.verts[10 * k]!,
    y = m.verts[10 * k + 1]!,
    z = m.verts[10 * k + 2]!;
  return [0, 1, 2].map((i) => mats[r + 4 * i]! * x + mats[r + 4 * i + 1]! * y + mats[r + 4 * i + 2]! * z + mats[r + 4 * i + 3]!);
};
/** the vertices of an object's triangles */
const verticesOf = (m: DeckMesh, name: string) => {
  const o = m.objects.indexOf(name);
  const out = new Set<number>();
  for (let t = 0; t < m.triObj.length; t++) if (m.triObj[t] === o) for (let c = 0; c < 3; c++) out.add(m.idx[3 * t + c]!);
  return [...out];
};

describe("A320 flight deck", () => {
  test("the mesh: in the nose, its rig, its controls, its displays' cells", async () => {
    const m = await load();
    // (the deck between the nose's frames: 15 to 17.5 m ahead of the reference, the eye inside it)
    expect(m.lo[2]).toBeGreaterThan(14.5);
    expect(m.hi[2]).toBeLessThan(17.6);
    expect(m.hi[0] - m.lo[0]).toBeLessThan(3.4);
    expect(m.nodes.length).toBeGreaterThan(1000);
    expect(m.controls.length).toBeGreaterThan(480);
    expect(m.triObj.length).toBe(m.idx.length / 3);
    expect(Math.max(...m.triObj)).toBeLessThan(m.objects.length);
    // (every vertex's part a node or the deck itself, every material the deck's)
    for (let i = 0; i < m.verts.length; i += 10) {
      expect(Math.floor(m.verts[i + 7]!)).toBeLessThan(partCount(m));
      expect(m.verts[i + 6]!).toBeGreaterThanOrEqual(120);
      expect(m.verts[i + 6]!).toBeLessThan(140);
    }
    for (const k of ["PFD1", "ND1", "UECAM", "LECAM", "ND2", "PFD2", "MCDU1", "MCDU2", "IESI", "DCDU1", "DCDU2"]) {
      const [u, v, w, h] = m.screens[k]!;
      expect(u + w).toBeLessThanOrEqual(1);
      expect(v + h).toBeLessThanOrEqual(1);
    }
  });

  test("the levers: the gear lever's travel, the thrust levers' angle, the autobrake's lights", async () => {
    const P = new DeckPoser();
    P.lags = (await load()).lags;
    let t = 0;
    let p = P.step(inputs({ gearDown: false, dt: 1 }));
    expect(p["controls/cockpit/gear-lever"]).toBe(0);
    // (down: pulled out, moved, pushed in — 3 at 4.5 a second)
    while (Number(p["controls/cockpit/gear-lever"]) < 3) {
      p = P.step(inputs({ gearDown: true }));
      t += 1 / 60;
    }
    expect(t).toBeCloseTo(3 / 4.5, 1);
    p = P.step(inputs({ lever: 1 }));
    expect(p["controls/cockpit/throttle-lever"]).toBeCloseTo(leverAngle(1) / 45, 6);
    p = P.step(inputs({ fcs: { autobrake: 2 } as never }));
    expect(p["controls/indicators/autobrake-med-on"]).toBe(1);
    expect(p["controls/indicators/autobrake-low-on"]).toBe(0);
  });

  test("the rig: the side stick pulled aft, a light shown by its system", async () => {
    const m = await load();
    const poser = () => Object.assign(new DeckPoser(), { lags: m.lags });
    const rest = rigMatrices(m, { ...poser().step(inputs({ dt: 1 })) }, {});
    const aft = rigMatrices(m, { ...poser().step(inputs({ dt: 1, stick: [1, 0] })) }, {});
    // (the stick's grip: its highest vertices, moved aft — the ship's z the nose)
    const vs = verticesOf(m, "sidestick_1");
    expect(vs.length).toBeGreaterThan(0);
    const top = vs.reduce((a, b) => (m.verts[10 * b + 1]! > m.verts[10 * a + 1]! ? b : a));
    const dz = posed(m, aft, top)[2]! - posed(m, rest, top)[2]!;
    expect(dz).toBeLessThan(-0.01);
    // (the autobrake's LO light: hidden at rest, shown when armed)
    const lo = verticesOf(m, "abs_low_on")[0]!;
    const part = Math.floor(m.verts[10 * lo + 7]!);
    const zero = (mats: Float32Array) => mats.slice(12 * part, 12 * part + 12).every((x) => x === 0);
    expect(zero(rest)).toBeTrue();
    const armed = rigMatrices(m, { ...poser().step(inputs({ dt: 1, fcs: { autobrake: 1 } as never })) }, {});
    expect(zero(armed)).toBeFalse();
  });
});

describe("A320 flight deck's controls (A6)", () => {
  test("Nasal: the calls of a script, its if's first branch, setprop", async () => {
    const { nasalCalls } = await import("../src/a320/deckctl");
    expect(nasalCalls("controls.gearDownSmart(1)")).toEqual([{ fn: "controls.gearDownSmart", args: [1] }]);
    const ab = nasalCalls(
      'if (systems.Autobrake.mode.getValue() != 2) {\n systems.Autobrake.arm_autobrake(2);\n} else {\n systems.Autobrake.arm_autobrake(0);\n}\nsetprop("sim/sound/oh-btn", 1);',
    );
    expect(ab.map((c) => c.fn)).toEqual(["systems.Autobrake.arm_autobrake"]);
    expect(ab[0]!.args).toEqual([2]);
    expect(nasalCalls('fcu.setNDRange(0, -1);\nsetprop("sim/sound/knb1", 1);')).toEqual([
      { fn: "fcu.setNDRange", args: [0, -1] },
      { fn: "setprop", args: ["sim/sound/knb1", 1] },
    ]);
  });

  test("the bindings: cycle, toggle, adjust (clamped, by notch), a condition", async () => {
    const { runBindings } = await import("../src/a320/deckctl");
    const P: Record<string, number | string> = { "systems/electrical/bus/dc-ess": 28 };
    const host = { call: () => false, changed: () => false };
    const cyc = [{ command: "property-cycle", property: "controls/switches/strobe", value: ["0", "0.5", "1"] }];
    runBindings(cyc, P, host);
    expect(P["controls/switches/strobe"]).toBe(0.5);
    runBindings(cyc, P, host);
    runBindings(cyc, P, host);
    expect(P["controls/switches/strobe"]).toBe(0);
    runBindings([{ command: "property-toggle", property: "/controls/switches/beacon" }], P, host);
    expect(P["controls/switches/beacon"]).toBe(1);
    const adj = [
      { command: "property-adjust", property: "controls/lighting/fcu-panel-knb", min: "0", max: "1", wrap: "false", factor: "0.05" },
    ];
    for (let i = 0; i < 30; i++) runBindings(adj, P, host, 1);
    expect(P["controls/lighting/fcu-panel-knb"]).toBe(1);
    runBindings(adj, P, host, -1);
    expect(P["controls/lighting/fcu-panel-knb"]).toBeCloseTo(0.95, 6);
    // (unpowered: the button does nothing)
    const cond = [
      {
        command: "property-toggle",
        property: "controls/gear/brake-fans",
        condition: ["greater-than-equals", ["prop", "systems/electrical/bus/dc-ess"], ["val", 25]] as never,
      },
    ];
    P["systems/electrical/bus/dc-ess"] = 0;
    runBindings(cond, P, host);
    expect(P["controls/gear/brake-fans"]).toBeUndefined();
  });

  test("the pointer on the strobe switch: clicked, flicked down, its light set in the game", async () => {
    const m = await load();
    const { DeckControls } = await import("../src/a320/deckctl");
    const { DeckPicker } = await import("../src/a320/deckpick");
    const { deckCall, deckChanged } = await import("../src/a320/deckgame");
    const poser = Object.assign(new DeckPoser(), { lags: m.lags });
    const P = poser.props;
    poser.step(inputs({ dt: 1 }));
    const settings = { navLights: false, strobeLights: false, landingLights: false, cabinLight: 1 };
    const game = {
      settings,
      craft: {
        gearDown: true,
        pilot: { throttle: 0 },
        airBrake: 0,
        groundSpoilers: false,
        a320Reverse: 0,
        a320Park: false,
        a320: null,
        onWheels: () => true,
      },
      setGear: () => {},
      flaps: () => {},
      toast: () => {},
      changed: () => {},
    };
    // (the eye at the captain's, the ray at the switch's middle)
    const eye: [number, number, number] = [0.45, 3.22, 16.193];
    // (the switch as posed: OFF, turned 30° on its hinge)
    const vs = verticesOf(m, "StrobeLtSwtch");
    const now = rigMatrices(m, P, {});
    const c = [0, 1, 2].map((k) => vs.reduce((a, v) => a + posed(m, now, v)[k]!, 0) / vs.length);
    const d = c.map((x, k) => x - eye[k]!);
    const l = Math.hypot(...d);
    const pick = new DeckPicker(m);
    const ctl = new DeckControls(m, P, {
      ray: () => ({ o: eye, d: d.map((x) => x / l) as [number, number, number] }),
      mats: () => rigMatrices(m, P, {}),
      picker: () => pick,
      call: (x) => deckCall(game, P, x),
      changed: (p, v) => deckChanged(game, P, p, v),
    });
    const t = ctl.move(0, 0);
    expect(t?.kind).toBe("control");
    expect(ctl.control(ctl.hover)!.label).toBe("Strobe lights switch");
    // (a click: OFF → AUTO — lit in the game —, then the wheel down: back)
    ctl.down(0, 0);
    ctl.up(true);
    expect(P["controls/switches/strobe"]).toBe(0.5);
    expect(settings.strobeLights).toBeTrue();
    expect(ctl.wheel(1)).toBeTrue();
    expect(P["controls/switches/strobe"]).toBe(0);
    expect(settings.strobeLights).toBeFalse();
  }, 30_000);

  test("the game's answers: the autobrake's buttons toggle, the ND's range, what is wired", async () => {
    const m = await load();
    const { deckCall, deckWired } = await import("../src/a320/deckgame");
    const A = { autobrake: 0 };
    const game = {
      settings: { navLights: false, strobeLights: false, landingLights: false, cabinLight: 1 },
      craft: {
        gearDown: true,
        pilot: { throttle: 0 },
        airBrake: 0,
        groundSpoilers: false,
        a320Reverse: 0,
        a320Park: false,
        a320: A as never,
        onWheels: () => true,
      },
      setGear: () => {},
      flaps: () => {},
      toast: () => {},
      changed: () => {},
    };
    const P: Record<string, number | string> = { "instrumentation/efis/inputs/range-nm": 40 };
    deckCall(game, P, { fn: "systems.Autobrake.arm_autobrake", args: [2] });
    expect(A.autobrake).toBe(2);
    deckCall(game, P, { fn: "systems.Autobrake.arm_autobrake", args: [2] });
    expect(A.autobrake).toBe(0);
    deckCall(game, P, { fn: "fcu.setNDRange", args: [0, 1] });
    expect(P["instrumentation/efis/inputs/range-nm"]).toBe(80);
    const by = (label: string) => m.controls.find((c) => c.label === label)!;
    expect(deckWired(by("Landing gear"))).toBeTrue();
    expect(deckWired(by("Flaps"))).toBeTrue();
    expect(deckWired(by("Parking brake"))).toBeTrue();
    expect(deckWired(by("ADR1 pushbutton"))).toBeFalse();
  });
});
