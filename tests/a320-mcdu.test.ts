// The A320's MCDU (docs/PLAN-A320.md, A9 — src/a320/mcdu): its scratchpad (typing, CLR, +/-, the keyboard), INIT A
// making the flight plan from FROM/TO, F-PLN's insertions, deletions and constraints, INIT B's weights and PERF TAKE
// OFF's V speeds proposed and entered, its picture's characters — on a host made for the test.
import { describe, expect, test } from "bun:test";
import { newPlan } from "../src/game/flightplan";
import { Fms } from "../src/a320/fmgc/fms";
import { Mcdu } from "../src/a320/mcdu/mcdu";
import type { McduHost } from "../src/a320/mcdu/types";
import type { Airfield } from "../src/world/runways";

const field = (icao: string, lat: number, lon: number, elev: number, hdg: number): Airfield =>
  ({
    ident: icao,
    icao,
    iata: "",
    name: icao,
    kind: "large_airport",
    lat,
    lon,
    elev,
    city: "",
    scheduled: true,
    runways: [{ le: "09", he: "27", lat1: lat, lon1: lon, lat2: lat, lon2: lon, hdg, len: 3500, wid: 45, surface: "asphalt", lit: true }],
  }) as unknown as Airfield;
const FIELDS: Record<string, Airfield> = {
  LFPG: field("LFPG", 49.0097, 2.5479, 119, 266),
  EGLL: field("EGLL", 51.47, -0.4543, 25, 270),
  EGKK: field("EGKK", 51.148, -0.19, 62, 258),
};

function host() {
  const route = newPlan();
  let changed = 0;
  const dir: number[] = [];
  const h: McduHost = {
    fms: new Fms(),
    fmgc: () => null,
    route: () => route,
    routeChanged: () => void changed++,
    activeWp: () => 1,
    directTo: (i) => void dir.push(i),
    geo: () => ({ lat: 49.0, lon: 2.5, alt: 120, gs: 0 }),
    onGround: () => true,
    field: (c) => FIELDS[c] ?? null,
    gwKg: () => 64000,
    fobKg: () => 8000,
    now: () => new Date(Date.UTC(2026, 9, 22, 12, 0)),
  };
  return { h, route, changed: () => changed, dir };
}
let clock = 0;
const mcdu = (h: McduHost) => new Mcdu(0, h, () => clock);
const typeIn = (m: Mcdu, s: string) => {
  for (const ch of s) m.button(ch === " " ? "SP" : ch);
};

describe("A320 MCDU", () => {
  test("the scratchpad: typed, CLR a character, twice all of it, on nothing CLR; +/-; the keyboard", () => {
    const { h } = host();
    const m = mcdu(h);
    typeIn(m, "AB1");
    expect(m.sp).toBe("AB1");
    clock = 0;
    m.button("CLR");
    expect(m.sp).toBe("AB");
    clock = 2000;
    m.button("CLR");
    clock = 2300;
    m.button("CLR");
    expect(m.sp).toBe("");
    clock = 5000;
    m.button("CLR");
    expect(m.sp).toBe("CLR");
    m.button("1");
    expect(m.sp).toBe("1");
    m.button("PLUSMINUS");
    m.button("PLUSMINUS");
    expect(m.sp).toBe("1+");
    clock = 9000;
    m.type("\b\bek 12");
    expect(m.sp).toBe("EK 12");
  });

  test("INIT A: FROM/TO makes the plan (the points between kept), the errors said", () => {
    const { h, route, changed } = host();
    route.wps = [{ name: "WP01", lat: 50, lon: 1 }];
    const m = mcdu(h);
    m.page("init");
    typeIn(m, "LFPG/EGXX");
    m.lsk("R", 1);
    expect(m.message).toBe("NOT IN DATA BASE");
    m.button("CLR");
    clock += 1000;
    m.button("CLR");
    clock += 1000;
    typeIn(m, "LFPGEGLL");
    m.lsk("R", 1);
    expect(m.message).toBe("FORMAT ERROR");
    m.button("A");
    m.sp = "LFPG/EGLL";
    m.lsk("R", 1);
    expect(m.sp).toBe("");
    expect(route.wps.map((w) => w.name)).toEqual(["LFPG", "WP01", "EGLL"]);
    expect(route.wps[0]!.field?.rwy).toBe(266);
    expect(h.fms.from).toBe("LFPG");
    expect(h.fms.to).toBe("EGLL");
    expect(changed()).toBeGreaterThan(0);
    // (the cost index, the cruise level — the plan's cruise with it)
    m.sp = "35";
    m.lsk("L", 5);
    m.sp = "FL350/-50";
    m.lsk("L", 6);
    expect(h.fms.costIndex).toBe(35);
    expect(h.fms.crzFl).toBe(350);
    expect(h.fms.crzTemp).toBe(-50);
    expect(Math.round(route.cruiseAlt)).toBe(10668);
  });

  test("F-PLN: a waypoint inserted on a line, a lat/lon, a constraint, CLR deleting; LAT REV's DIR TO", () => {
    const { h, route, dir } = host();
    const m = mcdu(h);
    m.page("init");
    m.sp = "LFPG/EGLL";
    m.lsk("R", 1);
    m.page("f-pln");
    m.sp = "EGKK";
    m.lsk("L", 2);
    expect(route.wps.map((w) => w.name)).toEqual(["LFPG", "EGKK", "EGLL"]);
    m.sp = "4851.0N/00230.0E";
    m.lsk("L", 2);
    expect(route.wps[1]!.name).toBe("LL01");
    expect(route.wps[1]!.lat).toBeCloseTo(48.85, 6);
    expect(route.wps[1]!.lon).toBeCloseTo(2.5, 6);
    m.sp = "250/FL100";
    m.lsk("R", 2);
    expect(Math.round(route.wps[1]!.spd! / 0.514444)).toBe(250);
    expect(Math.round(route.wps[1]!.alt! / 0.3048)).toBe(10000);
    m.button("CLR");
    m.lsk("L", 2);
    expect(route.wps.map((w) => w.name)).toEqual(["LFPG", "EGKK", "EGLL"]);
    // (the departure stays)
    m.button("CLR");
    m.lsk("L", 1);
    expect(m.message).toBe("NOT ALLOWED");
    // (CLR: the message, then the "CLR" left in the scratchpad)
    m.button("CLR");
    m.button("CLR");
    expect(m.sp).toBe("");
    expect(route.wps.length).toBe(3);
    // (LAT REV on EGKK: DIR TO it)
    m.lsk("L", 2);
    expect(m.pageId).toBe("latrev");
    m.lsk("L", 1);
    expect(dir).toEqual([1]);
    expect(m.pageId).toBe("fpln");
  });

  test("INIT B's weights, PERF TAKE OFF's V speeds proposed then entered, FLEX, FLAPS/THS", () => {
    const { h } = host();
    const m = mcdu(h);
    m.page("init");
    m.arrow("right");
    expect(m.pageId).toBe("initb");
    m.sp = "27.0/60.0";
    m.lsk("R", 1);
    m.sp = "8.0";
    m.lsk("R", 2);
    expect(h.fms.zfw).toBe(60);
    expect(h.fms.zfwcg).toBe(27);
    expect(h.fms.tow).toBeCloseTo(67.8, 6);
    m.page("perf");
    m.sp = "2/UP1.0";
    m.lsk("R", 3);
    expect(h.fms.toConf).toBe(2);
    expect(h.fms.ths).toBe("UP1.0");
    // (V1 taken from the proposal, VR typed)
    m.lsk("L", 1);
    const p = h.fms.proposeV(67800, 2);
    expect(h.fms.v1).toBe(p.v1);
    m.sp = "145";
    m.lsk("L", 2);
    expect(h.fms.vr).toBe(145);
    m.sp = "45";
    m.lsk("R", 4);
    expect(h.fms.flex).toBe(45);
    m.sp = "999";
    m.lsk("L", 3);
    expect(m.message).toBe("FORMAT ERROR");
    // (NEXT PHASE: CLB)
    m.lsk("R", 6);
    expect(m.perfPhase).toBe(1);
  });

  test("the picture: the page's characters on the grid, the scratchpad", () => {
    const { h } = host();
    const m = mcdu(h);
    m.page("init");
    typeIn(m, "LFPG");
    const drawn: string[] = [];
    const ctx = {
      fillText: (c: string) => void drawn.push(c),
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() {},
    } as unknown as CanvasRenderingContext2D;
    m.render(ctx, 1024, 864);
    const s = drawn.join("");
    expect(s).toContain("INIT");
    expect(s).toContain("FROM/TO");
    expect(s).toContain("LFPG");
  });
});
