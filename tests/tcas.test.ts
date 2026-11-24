import { expect, test } from "bun:test";
import { AAR_TA_ONLY, aarTaOnly, TCAS, tcasAdvise } from "../src/radar/tcas";

// The TCAS (PLAN-RADAR-AAA RD4): TCAS II's grading at its sensitivity level 5.

const own: [number, number, number] = [0, 200, 0];

test("head-on at the same height: proximate, then a TA at 40 s, an RA at 25 s", () => {
  const at = (km: number) => tcasAdvise(own, 3000, [{ id: "a", r: [0, km * 1000, 30], v: [0, -200, 0] }])[0]!;
  expect(at(25).level).toBe("other");
  expect(at(17).level).toBe("other");
  const ta = at(15);
  expect(ta.level).toBe("TA");
  expect(ta.tau).toBeCloseTo(37.5, 0);
  // (5 km off, going away: proximate only)
  expect(tcasAdvise(own, 3000, [{ id: "x", r: [0, -5000, 50], v: [0, -100, 0] }])[0]!.level).toBe("proximate");
  const ra = at(9);
  expect(ra.level).toBe("RA");
  // (it passes 30 m above: we descend)
  expect(ra.sense).toBe("descend");
});

test("an RA's sense: away from where the intruder will be, the intruder's own RA heeded", () => {
  const below = tcasAdvise(own, 3000, [{ id: "b", r: [0, 8000, -60], v: [0, -200, 0] }])[0]!;
  expect(below.sense).toBe("climb");
  const coord = tcasAdvise(own, 3000, [{ id: "b", r: [0, 8000, -60], v: [0, -200, 0] }], new Map([["b", "climb"]]))[0]!;
  expect(coord.sense).toBe("descend");
});

test("no threat: flying alongside, passing well apart, far above; the RAs inhibited near the ground", () => {
  const [apart, side, above] = tcasAdvise(own, 3000, [
    { id: "s", r: [500, 0, 0], v: [0, 200, 0] },
    { id: "p", r: [5000, 8000, 0], v: [0, -200, 0] },
    { id: "u", r: [0, 8000, 1500], v: [0, -200, 0] },
  ]).sort((a, b) => a.id.localeCompare(b.id));
  expect(apart!.level).not.toMatch(/TA|RA/);
  expect(side!.level).toBe("TA"); // (within its protected volume: 500 m, the same height)
  expect(above!.level).toBe("other");
  const low = tcasAdvise(own, 200, [{ id: "a", r: [0, 9000, 30], v: [0, -200, 0] }])[0]!;
  expect(low.level).toBe("TA");
  expect(low.sense).toBeUndefined();
});

test("out of its reach: none", () => {
  expect(tcasAdvise(own, 3000, [{ id: "far", r: [0, TCAS.range + 100, 0], v: [0, 0, 0] }])).toEqual([]);
  expect(tcasAdvise(own, 3000, [{ id: "hi", r: [0, 1000, TCAS.height + 100], v: [0, 0, 0] }])).toEqual([]);
});

test("TA ONLY — the receiver while it refuels —: the tanker 12 m ahead closing at 1 m/s a TA, no RA (14 Nov 2026)", () => {
  const tanker = [{ id: "texaco", r: [0, 12, 3] as [number, number, number], v: [0, 209, 0] as [number, number, number] }];
  expect(tcasAdvise([0, 210, 0], 6000, tanker)[0]!.level).toBe("RA");
  const a = tcasAdvise([0, 210, 0], 6000, tanker, undefined, true)[0]!;
  expect(a.level).toBe("TA");
  expect(a.sense).toBeUndefined();
});

test("TA ONLY past the refuelling's end until clear of the tanker — the 'Descend, descend!' race (24 Nov 2026)", () => {
  // (the session ended 15 m behind and 6 m below the tanker, closing at 0.4 m/s: on TA/RA at once, an RA to descend)
  const tk = { r: [0, 15, 6] as [number, number, number] };
  const other = [{ id: "cmb:1", r: tk.r, v: [0, 209.6, 0] as [number, number, number] }];
  const bare = tcasAdvise([0, 210, 0], 6000, other, undefined, false)[0]!;
  expect(bare.level).toBe("RA");
  expect(bare.sense).toBe("descend");
  // (in the session — the rendezvous, the contact, the breakaway —: TA ONLY whatever the picture)
  expect(aarTaOnly(true, null, null, 0).taOnly).toBe(true);
  // (just after: held while the tanker is near, its hold moved on)
  const m = aarTaOnly(false, { id: "cmb:1", seen: 10 }, tk, 12);
  expect(m.taOnly).toBe(true);
  expect(m.hold).toEqual({ id: "cmb:1", seen: 12 });
  expect(tcasAdvise([0, 210, 0], 6000, other, undefined, m.taOnly)[0]!.sense).toBeUndefined();
  // (its track out of the picture a moment: still held; gone longer than AAR_TA_ONLY.lost: let go)
  expect(aarTaOnly(false, m.hold, null, 13).taOnly).toBe(true);
  expect(aarTaOnly(false, m.hold, null, 12 + AAR_TA_ONLY.lost + 0.1)).toEqual({ taOnly: false, hold: null });
  // (clear of it — 2 NM apart, or 1 200 ft above or below —: TA/RA again)
  expect(aarTaOnly(false, m.hold, { r: [0, AAR_TA_ONLY.clearD + 10, 0] }, 60)).toEqual({ taOnly: false, hold: null });
  expect(aarTaOnly(false, m.hold, { r: [0, 300, AAR_TA_ONLY.clearH + 5] }, 60)).toEqual({ taOnly: false, hold: null });
  // (no refuelling: TA/RA)
  expect(aarTaOnly(false, null, null, 0)).toEqual({ taOnly: false, hold: null });
});
