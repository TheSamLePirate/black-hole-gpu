import { expect, test } from "bun:test";
import { Capcom, type CapcomInput } from "../src/game/capcom";

// PLAN-TARS T3: mission control — its lines on the flight's moments, read from the flight's state; Houston
// after the light's delay (none past a minute), silent through the plasma's blackout and on Gargantua's side.

const base: CapcomInput = {
  now: 0,
  side: "ours",
  stage: "orbit",
  mode: "flight",
  callsign: "Ranger",
  orbit: { apKm: 410, peKm: 395 },
  entry: null,
  site: null,
  final: null,
  plasma: 0,
  stopped: false,
  docked: false,
  grade: null,
  failed: false,
  lightS: 0,
  warp: 1,
};

/** A flight, frame by frame: the lines said (their ids, speakers and when they arrive). */
function fly(frames: Partial<CapcomInput>[]) {
  const c = new Capcom();
  const out: { id: string; speaker: string; at: number; text: string }[] = [];
  frames.forEach((f, k) => {
    for (const x of c.update({ ...base, now: k * 100, ...f }))
      out.push({ id: x.line.id!, speaker: x.line.speaker, at: x.at, text: x.line.text });
  });
  return { c, out };
}

test("lift-off, a good orbit, the escape: Houston's, with the light's delay", () => {
  const { out } = fly([
    { mode: "landed", stage: "ground" },
    { mode: "flight", stage: "air" },
    { stage: "air" },
    { stage: "orbit", lightS: 0.002 },
    { stage: "escape", lightS: 1.3 },
  ]);
  expect(out.map((x) => x.id)).toEqual(["liftoff", "orbit", "escape"]);
  expect(out[1]!.text).toBe("Ranger, Houston. Good orbit: 410 by 395 kilometres.");
  // (from the Moon's distance, 1.3 s late)
  expect(out[2]!.at - 400).toBeCloseTo(1300, 6);
});

test("the blackout: warned as it begins, silent in it, 'how do you read' after — what was said meanwhile after that", () => {
  const { out, c } = fly([
    { stage: "entry", entry: "entry", plasma: 0 },
    { stage: "entry", entry: "entry", plasma: 0.2 },
    { stage: "entry", entry: "entry", plasma: 0.6 },
    { stage: "entry", entry: "entry", plasma: 0.7, docked: false, failed: false, mode: "flight" },
    { stage: "entry", entry: "entry", plasma: 0.8, docked: true },
    { stage: "entry", entry: "entry", plasma: 0.1, docked: true },
  ]);
  expect(c.blackout).toBe(false);
  expect(out.map((x) => x.id)).toEqual(["los-warn", "aos", "dock"]);
  // (the line held in the blackout: on its way 4 s after it ends, behind the call)
  expect(out[2]!.at).toBeGreaterThanOrEqual(500 + 4000);
});

test("the tower on the final: the runway and the wind, at once; the wheels stopped: a word on the grade", () => {
  const { out } = fly([
    { stage: "approach", entry: "glide", site: "Edwards Air Force Base", final: null },
    { stage: "approach", entry: "glide", site: "Edwards Air Force Base", final: { rwy: 220, wind: { from: 235, u10: 5 } } },
    { stage: "approach", entry: "glide", site: "Edwards Air Force Base", final: { rwy: 220, wind: null } },
    { mode: "landed", stage: "ground", stopped: false, grade: null, site: "Edwards Air Force Base" },
    { mode: "landed", stage: "ground", stopped: true, grade: "A", site: "Edwards Air Force Base" },
    { mode: "landed", stage: "ground", stopped: true, grade: "A", site: "Edwards Air Force Base" },
  ]);
  expect(out.map((x) => [x.id, x.speaker])).toEqual([
    ["cleared", "tower"],
    ["wheels", "mission"],
  ]);
  expect(out[0]!.text).toBe("Ranger, Edwards Air Force Base tower. Runway 22, wind 240 at 10 knots, cleared to land.");
  expect(out[1]!.text).toBe("Ranger, Houston. Wheels stop. Textbook.");
});

test("Gargantua's side: the signal lost going in, nothing from Houston there, found again coming home", () => {
  const { out } = fly([
    { side: "ours" },
    { side: "throat" },
    { side: "gargantua", stage: "kerr", docked: true },
    { side: "gargantua", stage: "kerr", failed: true },
    { side: "ours", stage: "orbit" },
  ]);
  expect(out.map((x) => x.id)).toEqual(["lost", "home"]);
});

test("too far for the radio: Mars's 12 minutes at real time — nothing from Houston; docking said near", () => {
  expect(fly([{ lightS: 720 }, { lightS: 720, docked: true }]).out).toEqual([]);
  expect(fly([{}, { docked: true }, { docked: false }]).out.map((x) => x.id)).toEqual(["dock", "undock"]);
});
