import { afterEach, describe, expect, test } from "bun:test";
import { CARRIER, LANDING, readDeck, toDeck } from "../src/game/carrier";
import { putDeck } from "../src/controller/carriers";
import { axisOf, gradePass, HOOK, newTrapRun, wireCaught } from "../src/game/trap";
import { applyF35Variant } from "../src/f35/variant";
import { fleet } from "../src/fleet";
import { VESSELS } from "../src/vessels";
import { setPlatforms } from "../src/system/our-surface";
import { cruise } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The F-35C on the Ford (docs/PLAN-AVIATION-AAA.md, M3; game/trap.ts, controller/trap.ts): its hook catching a wire
// as it crosses it on the deck, the LSO's grade of a pass; launched by the bow catapult, off at 72 m/s over the deck
// and climbing; from 9 km off, the autopilot onto the angled deck's axis, down the glide path, the hook catching a
// wire, stopped within the arresting gear's run, graded; with its hook up, a bolter — round again, trapped.

afterEach(() => {
  resetFlights();
  setPlatforms("earth", []);
  applyF35Variant("B");
  delete (fleet.fuel as Record<string, number>).f35;
});

const D = Math.PI / 180;
const L = LANDING.ford!;
const A = axisOf(L);
const deckY = CARRIER.ford.deck;
/** A deck point s along the landing axis from the aim [m], e across it to port, h over the deck. */
const onAxis = (s: number, e = 0, h = 0.3): [number, number, number] => [
  L.aim[0] + A.ax[0] * s + A.across[0] * e,
  deckY + h,
  L.aim[1] + A.ax[1] * s + A.across[1] * e,
];

describe("the wires and the grade", () => {
  test("a wire caught crossing it on the deck, within the landing area; none in the air, none off its width", () => {
    const [w1, w2, w3] = A.wires;
    console.log(`  the wires ${A.wires.map((w) => w.toFixed(1)).join(", ")} m along the axis from the hook's aim`);
    expect(wireCaught("ford", onAxis(w1! - 1), onAxis(w1! + 1))).toBe(1);
    expect(wireCaught("ford", onAxis(w2! - 1), onAxis(w2! + 1))).toBe(2);
    expect(wireCaught("ford", onAxis(w3! - 1), onAxis(w3! + 1))).toBe(3);
    expect(wireCaught("ford", onAxis(w2! - 1, 0, HOOK.reach + 1), onAxis(w2! + 1, 0, HOOK.reach + 1))).toBe(0);
    expect(wireCaught("ford", onAxis(w2! - 1, L.half + 2), onAxis(w2! + 1, L.half + 2))).toBe(0);
    expect(wireCaught("ford", onAxis(w2! + 1), onAxis(w2! - 1))).toBe(0);
  });

  test("the LSO's grades: on the ball, a little off, low in close, low at the ramp; a bolter, a wave-off", () => {
    const pass = (w: ReturnType<typeof newTrapRun>["worst"], wire: number) => ({ ...newTrapRun("ford"), worst: w, wire });
    expect(gradePass(pass({ X: [0.1, 0.5], IM: [0.2, 0.8], IC: [0.1, 1], AR: [0.15, 0.5] }, 2))).toBe("_OK_");
    expect(gradePass(pass({ X: [0.4, 1], IM: [0.4, 1], IC: [0.3, 2], AR: [-0.3, 1] }, 1))).toBe("OK");
    expect(gradePass(pass({ X: [0.7, 2], IM: [0.6, 2], IC: [0.4, 2], AR: [0.3, 2] }, 3))).toBe("Fair");
    expect(gradePass(pass({ X: [0, 0], IM: [0, 0], IC: [-0.9, 2], AR: [-0.5, 2] }, 1))).toBe("No grade");
    expect(gradePass(pass({ X: [0, 0], IM: [0, 0], IC: [-0.6, 2], AR: [-1.2, 2] }, 1))).toBe("Cut");
    expect(gradePass(pass({ X: [0, 0], IM: [0, 0], IC: [0, 0], AR: [0, 0] }, 0))).toBe("B");
    expect(gradePass({ ...pass({ X: [0, 0], IM: [0, 0], IC: [0, 0], AR: [0, 0] }, 0), phase: "waveoff" })).toBe("WO");
  });
});

/** The F-35C over the sea off the Ford (put 9 km ahead of it, crossing its track) or near it. */
async function setUp(hs: number, fuel: number, ahead = 9000) {
  putDeck("ford", readDeck(await Bun.file("assets/carriers/ford.deck.bin").arrayBuffer()));
  applyF35Variant("C");
  const run = cruise(300, 140, 0.4);
  const { c } = run;
  c.jetToggle("ap");
  c.jetToggle("athr");
  fleet.fuel.f35 = fuel;
  c.seaHs = hs;
  const g = c.geoNow()!;
  c.carrierSpawn("ford", {
    lat: g.lat + (ahead * Math.cos(g.track)) / 111_195,
    lon: g.lon + (ahead * Math.sin(g.track)) / (111_195 * Math.cos(g.lat * D)),
    heading: g.track / D + 40,
    speed: 14.4,
  });
  c.carrierStep();
  const radio: string[] = [];
  c.onRadio = (s) => radio.push(s);
  return { ...run, radio };
}

describe("the catapult", () => {
  test("full tanks, the bow cat: run up, fired — off at 72 m/s over the deck —, climbing away", async () => {
    const { c, fly, radio } = await setUp(1.5, 8960, 0);
    expect(VESSELS.f35.name).toBe("F-35C");
    const said = c.catLaunch(0)!;
    let lowest = Infinity;
    let t = 0;
    let off = Number.NaN;
    while (t < 20) {
      fly(0.25);
      t += 0.25;
      if (Number.isNaN(off) && c.catRun?.phase === "airborne") off = t;
      if (!Number.isNaN(off)) lowest = Math.min(lowest, c.geoNow()!.alt);
    }
    const g = c.geoNow()!;
    console.log(
      `  ${said}: off after ${off} s, ${lowest.toFixed(1)} m over the sea at the lowest; ${t} s on, ${g.alt.toFixed(0)} m, climbing ${g.vs.toFixed(1)} m/s at ${(c.airFlight.last?.speed ?? 0).toFixed(0)} m/s\n    ${radio.join("\n    ")}`,
    );
    expect(off).toBeGreaterThan(3);
    expect(off).toBeLessThan(7);
    expect(lowest).toBeGreaterThan(10);
    expect(g.alt).toBeGreaterThan(60);
    expect(g.vs).toBeGreaterThan(3);
  }, 60_000);
});

describe("the recovery on the wires", () => {
  /** Flown until trapped (or `tMax` s): the LSO's grade, the wire, how far the hook ran past it, the radio. */
  function fly(c: Awaited<ReturnType<typeof setUp>>["c"], step: (s: number) => void, tMax: number) {
    let t = 0;
    let at: [number, number, number] | null = null;
    while (t < tMax) {
      step(0.25);
      t += 0.25;
      if (c.trapWire && !at) at = toDeck(c.carrierNow()[0]!.P, c.netOwn()!.p);
      if (c.trapLast && c.trapLast.wire && !c.trapRun && !c.trapWire) break;
    }
    const end = toDeck(c.carrierNow()[0]!.P, c.netOwn()!.p);
    return { t, ran: at ? Math.hypot(end[0] - at[0], end[2] - at[2]) : Number.NaN };
  }

  test("from 9 km off in a 1.5 m sea: onto the axis, down the glide path, a wire caught, stopped within the gear's run, graded", async () => {
    const s = await setUp(1.5, 3000);
    const said = s.c.trapLand("ford")!;
    const r = fly(s.c, s.fly, 400);
    const last = s.c.trapLast!;
    console.log(
      `  ${said}: trapped in ${r.t} s — the ${last.wire}-wire, ${r.ran.toFixed(0)} m to a stop — ${last.grade}\n    ${s.radio.join("\n    ")}`,
    );
    expect(last.wire).toBeGreaterThan(0);
    expect(r.ran).toBeLessThan(HOOK.run + 10);
    expect(["_OK_", "OK", "Fair"]).toContain(last.grade);
    expect(s.c.landed).toBe(true);
  }, 120_000);

  test("its hook up: a bolter — off, round again —; down, trapped on the next pass", async () => {
    const s = await setUp(1, 3000);
    s.c.hookUp = true;
    s.c.trapLand("ford");
    let t = 0;
    while (t < 300 && s.c.trapRun?.phase !== "bolter") s.fly(0.25), (t += 0.25);
    const bolter = s.c.trapRun?.phase === "bolter";
    s.c.hookUp = false;
    const r = fly(s.c, s.fly, 500);
    const last = s.c.trapLast!;
    console.log(
      `  a bolter after ${t} s; round again, trapped ${r.t} s later — the ${last.wire}-wire, ${last.grade}\n    ${s.radio.join("\n    ")}`,
    );
    expect(bolter).toBe(true);
    expect(s.radio.some((x) => /bolter/i.test(x))).toBe(true);
    expect(last.wire).toBeGreaterThan(0);
  }, 180_000);
});
