import { afterEach, expect, test } from "bun:test";
import { gcasForget } from "../src/controller/gcas";
import { AAR, aarNew, aarStep, basketFree, gapOf, hoseDir, trailPoint } from "../src/game/aar";
import { fleet } from "../src/fleet";
import { VESSELS } from "../src/vessels";
import { cruise } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The air refuelling (game/aar.ts, controller/aar.ts): the basket's contact — locked at a walking pace, bounced off too
// fast, missed off-centre —, the fuel flowing while the hose is in its range, the breakaway past it; then flown behind
// the tanker by the jet's systems (auto), by them and the throttle (assisted), the HUD's cues alone (manual).

afterEach(() => {
  resetFlights();
  gcasForget();
});

const along = (d: number, from = trailPoint("right")) => {
  const a = hoseDir().map((x) => -x);
  return a.map((x, k) => from[k]! - x * d);
};

test("the basket: locked at a walking pace on its axis, bounced off too fast, missed off-centre; the fuel in its range", () => {
  // (a still basket — the time where its wander is nil enough — approached on its axis at 1 m/s)
  const run = (v: number, off: number[]) => {
    const s = aarNew("right", 600);
    s.cleared = true;
    const ev: string[] = [];
    for (let k = 0; k < 200; k++) {
      // (flown at the basket where it is — its bow wave's push followed)
      const tip = along(3 - (v * k) / 30, s.basket).map((x, i) => x + (off[i] ?? 0));
      ev.push(...aarStep(s, tip, 0, 1 / 30));
      if (s.phase === "contact" || ev.length) break;
    }
    return { s, ev };
  };
  const soft = run(1, [0, 0, 0]);
  expect(soft.ev).toContain("contact");
  expect(soft.s.phase).toBe("contact");
  expect(run(3.5, [0, 0, 0]).ev).toContain("toofast");
  expect(run(1, [0.7, 0, 0]).ev).toContain("rim");
  // locked: pushed 2 m in, the fuel flows — 600 kg in 30 s —, the tanks full
  const s = soft.s;
  const ev: string[] = [];
  for (let k = 0; k < 40 * 30; k++) ev.push(...aarStep(s, along(-2, s.ref), 0, 1 / 30));
  expect(ev).toContain("flow");
  expect(ev).toContain("full");
  expect(s.given).toBeCloseTo(600, 0);
  // (pushed past the hose's whip: a breakaway)
  const b = aarNew("right", 600);
  b.phase = "contact";
  expect(aarStep(b, along(-(AAR.whip + 0.5), b.ref), 0, 1 / 30)).toContain("breakaway");
  // the bow wave: the basket pushed up as the probe comes within its reach
  const free = basketFree("right", 0, null);
  const near = basketFree("right", 0, along(1));
  expect(near[2]! - free[2]!).toBeGreaterThan(0.1);
  expect(gapOf(along(4), trailPoint("right")).along).toBeCloseTo(4, 5);
});

/** A refuelling flown from a tanker set 1.5 km ahead: the stage, the phases met, the fuel taken; `input` the pilot's. */
function refuel(
  mode: "auto" | "assisted" | "manual",
  seconds: number,
  input?: (t: number, c: ReturnType<typeof cruise>["c"]) => { throttle?: number },
) {
  const { c, fly } = cruise(6000, 215, 0.7);
  c.jetToggle("ap");
  c.jetToggle("athr");
  c.s.f35AarMode = mode;
  const full = VESSELS.f35.fuelKg!;
  fleet.fuel.f35 = full - 800;
  const said: string[] = [];
  c.onRadio = (s) => said.push(s);
  c.onPilotMessage = (s) => said.push(s);
  expect(c.tankerStart({ near: true })).toMatch(/TEXACO 11/);
  const seen = new Set<string>();
  let tMax = 0,
    worst = 0,
    bank = 0,
    hoseT = 0;
  const pin = c.pilotInput.bind(c);
  let t = 0;
  c.pilotInput = (pad) => ({ ...pin(pad), ...(input?.(t, c) ?? {}) });
  fly(seconds, () => {
    t += 1 / 30;
    const A = c.aar;
    if (A) {
      seen.add(`${A.stage}:${A.s.phase}`);
      // (the tanker's bank while it refuels us — its roll-out given 10 s, if it was in a turn)
      if (A.stage === "hose" && A.leftAt === null && (hoseT += 1 / 30) > 10) {
        const q = c.combat!.world.targets.find((x) => x.id === A.tanker)!;
        bank = Math.max(bank, Math.acos(Math.min(1, q.up[2])) * (180 / Math.PI));
      }
      if (A.s.phase === "contact") {
        tMax = Math.max(tMax, A.s.takeup);
        worst = Math.max(worst, A.s.closure);
      }
    }
    return !c.aar && seen.size > 1;
  });
  c.pilotInput = pin;
  return { c, said, seen, tMax, full, bank };
}

test("auto: the jet's systems fly it — pre-contact, the contact, the fuel taken, back out, cleared to depart", () => {
  const { c, said, seen, full, bank } = refuel("auto", 400);
  console.log(`  ${[...seen].join(" → ")} · ${said.filter((s) => /TEXACO|Refuel/.test(s)).join(" · ")}`);
  expect(seen.has("hose:contact")).toBe(true);
  expect(said.some((s) => /fuel flowing/.test(s))).toBe(true);
  expect(said.some((s) => /transfer complete/.test(s))).toBe(true);
  expect(said.some((s) => /cleared to depart/.test(s))).toBe(true);
  expect(c.aar ?? null).toBeNull();
  // (the 800 kg taken, less what was burnt flying to it and back)
  expect(fleet.fuel.f35!).toBeGreaterThan(full - 400);
  expect(c.gcas?.escape ?? null).toBeNull();
  // (the tanker held straight and level while it refuels: no turn, no disconnect for it)
  expect(bank).toBeLessThan(1);
}, 300_000);

test("assisted: held on the basket's line, the throttle closes — forward in, back out once full", () => {
  // (the pilot: forward once cleared until locked and the hose some 2 m in; then nothing; back once full)
  const { said, seen, bank } = refuel("assisted", 400, (_t, c) => {
    const A = c.aar as (NonNullable<typeof c.aar> & { backing?: boolean }) | null | undefined;
    if (!A || A.stage !== "hose") return {};
    if (A.s.full || A.leftAt !== null) return { throttle: -1 };
    if (A.s.phase === "contact") return { throttle: A.s.takeup < 2 ? 0.8 : 0 };
    // (missed — the tip past the basket —: back out to pre-contact, then in again)
    const along = gapOf(A.s.tip, A.s.basket).along;
    if (along < 0) A.backing = true;
    if (A.backing && along > AAR.astern) A.backing = false;
    if (A.backing) return { throttle: -1 };
    return { throttle: A.s.cleared ? 0.7 : 0 };
  });
  console.log(`  ${[...seen].join(" → ")} · ${said.filter((s) => /TEXACO/.test(s)).join(" · ")}`);
  expect(seen.has("hose:contact")).toBe(true);
  expect(said.some((s) => /transfer complete/.test(s))).toBe(true);
  expect(said.some((s) => /breakaway/.test(s))).toBe(false);
  expect(bank).toBeLessThan(1);
  expect(said.some((s) => /turning/.test(s))).toBe(false);
}, 300_000);
