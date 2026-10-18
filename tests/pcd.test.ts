// The F-35's panoramic display (src/f35/pcd.ts, docs/PLAN-PCD-AAA.md): its touches — the pages' arrows, the menu, a
// side shown as one portal, the keys — and its drawing in turn (one part a frame, each at its page's pace). The canvas
// is a stand-in (no OffscreenCanvas here): every drawing call accepted, nothing drawn.
import { beforeAll, expect, test } from "bun:test";

beforeAll(() => {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : () => ({ width: 10 })),
    set: (t, k, v) => ((t[k as string] = v), true),
  });
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas ??= class {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext() {
      return ctx;
    }
  };
});

const D = Math.PI / 180;
const data = () =>
  ({
    time: new Date(0),
    lat: 34.9,
    lon: -117.9,
    alt: 3000,
    agl: 2300,
    heading: 40 * D,
    pitch: 0,
    bank: 0,
    track: 40 * D,
    tas: 200,
    gs: 200,
    vs: 0,
    mach: 0.6,
    g: 1,
    gPeak: 1,
    alpha: 0.05,
    wind: null,
    throttle: 0.7,
    spool: 0.7,
    ab: 0,
    thrust: 80000,
    flow: 1,
    fuel: 6000,
    fuelFull: 8000,
    mass: 20000,
    surfaces: null,
    gear: 0,
    flaps: 0,
    brake: 0,
    onGround: false,
    stovl: null,
    liftMax: 1,
    ap: { alt: null, hdg: null, spd: null },
    fields: [],
    route: null,
    bingo: null,
    alerts: [],
  }) as import("../src/f35/pcd").PcdData;

async function pcd() {
  const { Pcd } = await import("../src/f35/pcd");
  const { PCD_W, PCD_H } = await import("../src/f35/pcd-size");
  const p = new Pcd();
  // (a touch in px)
  const at = (x: number, y: number) => p.touch(x / PCD_W, y / PCD_H);
  return { p, at };
}

test("the title's arrows step through the pages; the title opens the menu, a page chosen in it", async () => {
  const { p, at } = await pcd();
  const f = p.portals()[1]!.frame;
  expect(p.pages[1]).toBe("FCR");
  expect(at(f.x + 84, f.y + 20)).toBe("SMS");
  expect(at(f.x + 28, f.y + 20)).toBe("FCR");
  expect(at(f.x + f.w / 2, f.y + 20)).toBe("MENU");
  expect(p.menu).toBe(1);
  // (the menu's third row, first button: ENG)
  expect(at(f.x + 60, f.y + 46 + 30 + 2 * 82 + 30)).toBe("ENG");
  expect(p.pages[1]).toBe("ENG");
  expect(p.menu).toBeNull();
});

test("a side shown as one portal, twice as wide, then as two again", async () => {
  const { p, at } = await pcd();
  expect(p.portals().length).toBe(4);
  const f = p.portals()[0]!.frame;
  expect(at(f.x + f.w - 30, f.y + 20)).toBe("TSD FULL");
  const P = p.portals();
  expect(P.length).toBe(3);
  expect(P[0]!.full).toBe(true);
  expect(P[0]!.frame.w).toBeGreaterThan(2 * f.w);
  expect(at(P[0]!.frame.x + P[0]!.frame.w - 30, f.y + 20)).toBe("SPLIT");
  expect(p.portals().length).toBe(4);
});

test("the TSD's keys: its range down and up, declutter", async () => {
  const { p, at } = await pcd();
  const f = p.portals()[0]!.frame;
  const y = f.y + f.h - 20;
  expect(at(f.x + f.w * 0.1, y)).toBe("RNG 10");
  expect(at(f.x + f.w * 0.6, y)).toBe("RNG 20");
  expect(at(f.x + f.w * 0.9, y)).toBe("DCLT ON");
  expect(p.declutter).toBe(true);
  // (the label between the arrows does nothing)
  expect(at(f.x + f.w * 0.35, y)).toBeNull();
});

test("drawn in turn: one part a frame, each at its page's pace; a touched portal at once", async () => {
  const { p, at } = await pcd();
  const d = data();
  let now = 0;
  const frames: number[] = [];
  for (let i = 0; i < 120; i++) {
    frames.push(p.frame(now, () => d).length);
    now += 1000 / 60;
  }
  // (never more than one part a frame at 60 Hz; the TSD, the FCS and the flight's state at 10 Hz, the fuel at 2 Hz…)
  expect(Math.max(...frames)).toBe(1);
  const drawn = frames.reduce((a, b) => a + b, 0);
  expect(drawn).toBeGreaterThan(40);
  expect(drawn).toBeLessThan(80);
  const f = p.portals()[2]!.frame;
  at(f.x + 84, f.y + 20);
  const parts = p.frame(now, () => d);
  expect(parts.length).toBe(1);
  expect(parts[0]!.x).toBeLessThanOrEqual(f.x);
  expect(parts[0]!.x + parts[0]!.w).toBeGreaterThanOrEqual(f.x + f.w);
});

test("the radar's and the weapons' keys ask the craft (never a shot)", async () => {
  const { p, at } = await pcd();
  const asked: unknown[] = [];
  p.act = (a) => (asked.push(a), "ok");
  const fcr = p.portals()[1]!.frame,
    sms = p.portals()[2]!.frame;
  const key = (f: { x: number; y: number; w: number; h: number }, i: number, n: number) => at(f.x + ((i + 0.5) / n) * f.w, f.y + f.h - 20);
  key(fcr, 1, 6);
  key(fcr, 3, 6);
  expect(key(fcr, 5, 6)).toBe("FCR 160");
  key(sms, 0, 5);
  key(sms, 4, 5);
  expect(asked).toEqual([{ kind: "radar", mode: "TWS" }, { kind: "lock" }, { kind: "weapon", w: "aim120" }, { kind: "cm" }]);
});

test("the AP page's buttons: engaged, a selector stepped twice from the value just chosen, the ILS asked", async () => {
  const { p, at } = await pcd();
  const asked: { kind: string; set?: Record<string, number | boolean>; mode?: string }[] = [];
  p.act = (a) => (asked.push(a as never), "ok");
  p.pages[0] = "AP";
  p.draw(data(), 0);
  const f = p.portals()[0]!.frame;
  const r = { x: f.x, y: f.y + 46, w: f.w };
  at(r.x + 40, r.y + 40);
  // (the altitude's +, twice: 3 000 → 3 100 → 3 200 m)
  at(r.x + r.w - 48, r.y + 92 + 140 + 28);
  at(r.x + r.w - 48, r.y + 92 + 140 + 28);
  at(r.x + 30, r.y + 372 + 24);
  expect(asked[0]).toEqual({ kind: "ap", set: { ap: true } });
  expect(asked[1]!.set!.alt).toBeCloseTo(3100, 6);
  expect(asked[2]!.set!.alt).toBeCloseTo(3200, 6);
  expect(asked[3]).toEqual({ kind: "apMode", mode: "ils" });
});
