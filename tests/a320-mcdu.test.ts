// The A320's MCDU (docs/PLAN-A320.md, A9 — src/a320/mcdu): its scratchpad (typing, CLR, +/-, the keyboard), INIT A
// making the flight plan from FROM/TO, F-PLN's insertions, deletions and constraints, INIT B's weights and PERF TAKE
// OFF's V speeds proposed and entered, its picture's characters — on a host made for the test.
import { describe, expect, test } from "bun:test";
import { newPlan, type Waypoint } from "../src/game/flightplan";
import { vprofile } from "../src/a320/fmgc/vprofile";
import { Fms } from "../src/a320/fmgc/fms";
import { Mcdu } from "../src/a320/mcdu/mcdu";
import type { McduHost } from "../src/a320/mcdu/types";
import { readdirSync, readFileSync } from "node:fs";
import { publishedArrival } from "../src/controller/ils";
import { type Approach, approachesOf, decodeApproachTile } from "../src/world/approaches";
import { decodeTile, tileKey } from "../src/world/runways";
import { type Terminal, type Terminals, terminalLegs, terminalWaypoints, rwyServes } from "../src/world/terminals";
import type { TerminalRecord } from "../src/world/approaches";
import { legOf } from "../src/world/approaches";
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

  test("F-PLN: a VOR and a fix of the navigation database inserted by their ident (PLAN-A320-VOL-AAA N1)", () => {
    const { h, route } = host();
    const NAV: Record<string, { id: string; kind: "VD" | "FIX"; lat: number; lon: number; freq?: number }> = {
      PON: { id: "PON", kind: "VD", lat: 49.096, lon: 2.036, freq: 111600 },
      KOVIN: { id: "KOVIN", kind: "FIX", lat: 49.486, lon: 3.106 },
    };
    h.navPoint = (id) => NAV[id] ?? null;
    const m = mcdu(h);
    m.page("init");
    m.sp = "LFPG/EGLL";
    m.lsk("R", 1);
    m.page("f-pln");
    m.sp = "PON";
    m.lsk("L", 2);
    m.sp = "KOVIN";
    m.lsk("L", 2);
    expect(route.wps.map((w) => w.name)).toEqual(["LFPG", "KOVIN", "PON", "EGLL"]);
    expect(route.wps[2]!.nav).toEqual({ kind: "VD", freq: 111600 });
    expect(route.wps[1]!.nav?.kind).toBe("FIX");
    m.sp = "ZZZZZ";
    m.lsk("L", 2);
    expect(m.message).toBe("NOT IN DATA BASE");
  });

  test("LAT REV › AIRWAYS: UN872/LESDO from PON — its points inserted after it, the airway written over its legs (PLAN-A320-VOL-AAA N2)", async () => {
    const { h, route } = host();
    h.navPoint = (id) => (id === "PON" ? { id: "PON", kind: "VD", lat: 49.096, lon: 2.036, freq: 111600 } : null);
    h.airway = async (via, from, to) =>
      via === "UN872" && from.name === "PON" && to === "LESDO"
        ? [
            { name: "PON", lat: 49.096, lon: 2.036 },
            { name: "KOVIN", lat: 49.486, lon: 3.106, nav: { kind: "FIX" } },
            { name: "LESDO", lat: 49.808, lon: 3.318, nav: { kind: "FIX" } },
          ]
        : null;
    const m = mcdu(h);
    m.page("init");
    m.sp = "LFPG/EGLL";
    m.lsk("R", 1);
    m.page("f-pln");
    m.sp = "PON";
    m.lsk("L", 2);
    // (LAT REV from PON, the second line — its AIRWAYS>)
    m.lsk("L", 2);
    expect(m.pageId).toBe("latrev");
    m.lsk("R", 5);
    expect(m.pageId).toBe("airways");
    m.sp = "UN872/LESDO";
    m.lsk("L", 1);
    await Bun.sleep(0);
    expect(route.wps.map((w) => w.name)).toEqual(["LFPG", "PON", "KOVIN", "LESDO", "EGLL"]);
    expect(route.wps[2]!.nav?.via).toBe("UN872");
    // (a mismatch said)
    m.page("f-pln");
    m.lsk("L", 2);
    m.lsk("R", 5);
    m.sp = "UN872/ZZZZZ";
    m.lsk("L", 1);
    await Bun.sleep(0);
    expect(m.message).toBe("AWY/WPT MISMATCH");
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

  test("ARRIVAL (PLAN-APPROCHES AP3): KSFO's approaches from the FAA, its ILS 28R and its VIA ARCHI inserted, RAD NAV on its localizer", () => {
    // (San Francisco as the game has it: its runways, its tile's approaches — the CIFP's whole)
    let ksfo: Airfield | undefined;
    for (const n of readdirSync("assets/runways/v1"))
      if (/^t-?\d/.test(n) && !ksfo)
        ksfo = decodeTile(JSON.parse(readFileSync(`assets/runways/v1/${n}`, "utf8"))).find((f) => f.icao === "KSFO");
    const t = decodeApproachTile(JSON.parse(readFileSync(`assets/approaches/v1/t${tileKey(ksfo!.lat, ksfo!.lon)}.json`, "utf8")));
    const list: Approach[] = approachesOf(
      ksfo!,
      t.records.filter((r) => r.f === "KSFO"),
      t.cycle,
      t.cifp.filter((r) => r.f === "KSFO"),
      t.cifpCycle,
    );
    const { h, route } = host();
    let sel = { field: "auto", approach: "auto", via: "auto" };
    Object.assign(h, {
      field: (c: string) => (c === "KSFO" ? (ksfo ?? null) : (FIELDS[c] ?? null)),
      approaches: (c: string) => (c === "KSFO" ? list : null),
      approachSel: () => sel,
      selectApproach: (x: typeof sel) => ((sel = x), { ok: list.some((a) => a.id === x.approach), say: "" }),
      arrivalApproach: () => list.find((a) => a.id === sel.approach) ?? null,
      insertArrival: () => {
        const a = list.find((x) => x.id === sel.approach)!;
        route.wps.splice(route.wps.length - 1, 0, ...publishedArrival(a, sel.via === "auto" ? null : sel.via, route.wps[0]!));
        return "";
      },
    } satisfies Partial<McduHost>);
    const m = mcdu(h);
    m.page("init");
    m.sp = "LFPG/KSFO";
    m.lsk("R", 1);
    m.page("f-pln");
    // (LAT REV at the destination: ARRIVAL>)
    m.lsk("L", 2);
    expect(m.pageId).toBe("latrev");
    const txt = (L?: { t: string }[]) => (L ?? []).map((r) => r.t).join("");
    expect(txt(m.current.screen(m).lines[0]!.r)).toBe("ARRIVAL>");
    m.lsk("R", 1);
    expect(m.pageId).toBe("arrival");
    // (the list: the published ILS 28R among them, its source said; scrolled to it)
    const ids = list.map((a) => a.id);
    const k = ids.indexOf("I28R");
    m.arrTop = k;
    expect(txt(m.current.screen(m).lines[2]!.l)).toBe("<I28R");
    expect(txt(m.current.screen(m).lines[2]!.r)).toMatch(/ILS CAT III FAA/);
    m.lsk("L", 3);
    // (its VIAS shown: NO VIA, then ARCHI, DUMBA, EDDYY, SIDBY)
    expect(m.arrMode).toBe("via");
    const vias = [3, 4, 5].map((n) => txt(m.current.screen(m).lines[n - 1]!.l));
    expect(vias[0]).toBe("<NO VIA");
    const at = vias.indexOf("<ARCHI");
    m.lsk("L", at >= 0 ? at + 3 : 4);
    expect(m.arrVia).toBe(at >= 0 ? "ARCHI" : m.arrVia);
    m.arrVia = "ARCHI";
    m.lsk("R", 6);
    expect(sel).toEqual({ field: "KSFO", approach: "I28R", via: "ARCHI" });
    // (the plan: the transition's fixes then the final's, its IF marked where the approach is engaged)
    expect(route.wps.map((w) => w.name)).toEqual(["LFPG", "ARCHI", "ZILED", "GIRRR", "DUMBA", "CEPIN", "AXMUL", "KSFO"]);
    expect(route.wps.find((w) => w.name === "CEPIN")!.proc).toMatchObject({ kind: "arr", rwy: "28R", join: true });
    expect(Math.round(route.wps[1]!.alt! / 0.3048)).toBe(7000);
    // (RAD NAV: the real localizer — IGWQ 111.70, its course true)
    m.page("radnav");
    const ls = txt(m.current.screen(m).lines[2]!.l);
    expect(ls).toBe("IGWQ/111.70");
    expect(txt(m.current.screen(m).lines[3]!.l)).toBe("298");
  });
  test("DEPARTURE and ARRIVAL › STAR (PLAN-A320-VOL-AAA N2): KSFO 10L CIITY3.DEDHD, KLAX SADDE8 — the CIFP's points, their constraints, the plan in order", () => {
    const fieldOf = (icao: string) => {
      for (const n of readdirSync("assets/runways/v1"))
        if (/^t-?\d/.test(n)) {
          const f = decodeTile(JSON.parse(readFileSync(`assets/runways/v1/${n}`, "utf8"))).find((x) => x.icao === icao);
          if (f) return f;
        }
      return null;
    };
    const termsOf = (icao: string): Terminals => {
      const j = JSON.parse(readFileSync(`assets/approaches/v1/procs/${icao}.json`, "utf8")) as {
        cycle: string;
        sid: TerminalRecord[];
        star: TerminalRecord[];
      };
      const dec =
        (kind: Terminal["kind"]) =>
        (r: TerminalRecord): Terminal => ({
          kind,
          id: r.id,
          rwys: r.rw.map(([name, legs]) => ({ name, legs: legs.map(legOf) })),
          common: r.c.map(legOf),
          enroute: r.en.map(([name, legs]) => ({ name, legs: legs.map(legOf) })),
        });
      return { cycle: j.cycle, sid: j.sid.map(dec("SID")), star: j.star.map(dec("STAR")) };
    };
    const ksfo = fieldOf("KSFO")!,
      klax = fieldOf("KLAX")!;
    const T = { KSFO: termsOf("KSFO"), KLAX: termsOf("KLAX") } as Record<string, Terminals>;
    // (the runway transitions' names: « RW19B » both 19s, « ALL » every one)
    expect(rwyServes("RW19B", "19L")).toBeTrue();
    expect(rwyServes("RW19B", "1L")).toBeFalse();
    expect(rwyServes("RW10L", "10L")).toBeTrue();
    expect(rwyServes("RW10L", "10R")).toBeFalse();
    expect(rwyServes("ALL", "28R")).toBeTrue();
    // (CIITY3 from 10L: the heading to 520 ft has no fix — no point —, then ORYAN, SAHEY, CIITY at or above 5 000 ft, the DEDHD transition)
    const ciity = T.KSFO!.sid.find((x) => x.id === "CIITY3")!;
    expect(terminalLegs(ciity, "10L", "DEDHD")[0]).toMatchObject({ t: "VA" });
    const pts = terminalWaypoints(ciity, "10L", "DEDHD");
    expect(pts.map((w) => w.name)).toEqual(["ORYAN", "SAHEY", "CIITY", "BCEEE", "DEDHD"]);
    expect(Math.round(pts[2]!.cstr![0]! / 0.3048)).toBe(5000);
    expect(pts[0]!.proc).toMatchObject({ kind: "dep", rwy: "10L", sid: "CIITY3", trans: "DEDHD" });

    const { h, route } = host();
    Object.assign(h, {
      field: (c: string) => (c === "KSFO" ? ksfo : c === "KLAX" ? klax : (FIELDS[c] ?? null)),
      terminals: (c: string) => T[c] ?? { cycle: "", sid: [], star: [] },
    } satisfies Partial<McduHost>);
    const m = mcdu(h);
    const txt = (L?: { t: string }[]) => (L ?? []).map((r) => r.t).join("");
    m.page("init");
    m.sp = "KSFO/KLAX";
    m.lsk("R", 1);
    m.page("f-pln");
    // (LAT REV at the origin: <DEPARTURE — the runways, the longest first)
    m.lsk("L", 1);
    expect(m.pageId).toBe("latrev");
    expect(txt(m.current.screen(m).lines[0]!.l)).toBe("<DEPARTURE");
    m.lsk("L", 1);
    expect(m.pageId).toBe("departure");
    const rows = () => [3, 4, 5].map((n) => txt(m.current.screen(m).lines[n - 1]!.l));
    // (10L chosen: scrolled to it)
    const ends = ksfo.runways.flatMap((r) => [r.le, r.he]);
    expect(ends).toContain("10L");
    for (let k = 0; k < 12 && !rows().includes("<10L"); k++) m.arrow("up");
    m.lsk("L", 3 + rows().indexOf("<10L"));
    expect(m.depRwy).toBe("10L");
    // (its SIDs: CIITY3 there, GNNRR3 — 28s only — not)
    expect(m.depMode).toBe("sid");
    const sids: string[] = [];
    for (let k = 0; k < 15; k++, m.arrow("up")) sids.push(...rows());
    expect(sids).toContain("<CIITY3");
    expect(sids).not.toContain("<GNNRR3");
    m.depTop = 0;
    for (let k = 0; k < 15 && !rows().includes("<CIITY3"); k++) m.arrow("up");
    m.lsk("L", 3 + rows().indexOf("<CIITY3"));
    expect(m.depMode).toBe("trans");
    m.depTop = 0;
    for (let k = 0; k < 8 && !rows().includes("<DEDHD"); k++) m.arrow("up");
    m.lsk("L", 3 + rows().indexOf("<DEDHD"));
    expect(txt(m.current.screen(m).lines[0]!.r)).toBe("DEDHD");
    expect(txt(m.current.screen(m).lines[5]!.r)).toBe("INSERT*");
    m.lsk("R", 6);
    expect(m.pageId).toBe("fpln");
    expect(route.wps.map((w) => w.name)).toEqual(["KSFO", "ORYAN", "SAHEY", "CIITY", "BCEEE", "DEDHD", "KLAX"]);
    // (F-PLN: CIITY's « at or above 5 000 ft » written « */+5000 »; a constraint typed « /-FL120 » at BCEEE: at or below)
    const fl = () => m.current.screen(m).lines.map((L) => `${txt(L.l)}|${txt(L.r)}`);
    expect(fl().find((x) => x.startsWith("CIITY"))).toMatch(/\*---\/\+5000$/);
    m.sp = "/-FL120";
    const iB = fl().findIndex((x) => x.startsWith("BCEEE"));
    m.lsk("R", iB + 1);
    expect(route.wps[4]!.cstr).toEqual([null, 12000 * 0.3048]);

    // (ARRIVAL at KLAX: STARS> — SADDE8 by the FIM transition: the transition's fixes, then SADDE, BAYST, SMO — KLAX itself once, the end)
    // (the destination's LAT REV)
    m.latRev = route.wps.length - 1;
    m.open("latrev");
    // (no approaches in this host: ARRIVAL> needs them — a list that is empty)
    Object.assign(h, { approaches: () => [] as Approach[] });
    expect(txt(m.current.screen(m).lines[0]!.r)).toBe("ARRIVAL>");
    m.lsk("R", 1);
    expect(m.pageId).toBe("arrival");
    expect(txt(m.current.screen(m).lines[1]!.r)).toBe("STARS>");
    m.lsk("R", 2);
    expect(m.arrMode).toBe("star");
    for (let k = 0; k < 30 && !rows().includes("<SADDE8"); k++) m.arrow("up");
    m.lsk("L", 3 + rows().indexOf("<SADDE8"));
    expect(m.arrMode).toBe("trans");
    m.arrTop = 0;
    for (let k = 0; k < 8 && !rows().includes("<FIM"); k++) m.arrow("up");
    m.lsk("L", 3 + rows().indexOf("<FIM"));
    expect(txt(m.current.screen(m).lines[0]!.r)).toBe("SADDE8.FIM");
    m.lsk("R", 6);
    const names = route.wps.map((w) => w.name);
    console.log(`  plan: ${names.join(" ")}`);
    expect(names.slice(0, 6)).toEqual(["KSFO", "ORYAN", "SAHEY", "CIITY", "BCEEE", "DEDHD"]);
    expect(names.at(-1)).toBe("KLAX");
    expect(names.filter((n) => n === "KLAX").length).toBe(1);
    const iS = names.indexOf("SADDE");
    expect(names.slice(iS, iS + 3)).toEqual(["SADDE", "BAYST", "SMO"]);
    expect(route.wps[iS]!.proc).toMatchObject({ kind: "arr", star: "SADDE8", trans: "FIM" });
    expect(route.wps.find((w) => w.name === "FIM")?.nav?.via).toBe("SADDE8");
    // (a new SID replaces the old one: NO SID takes its points out)
    m.latRev = 0;
    m.open("latrev");
    m.lsk("L", 1);
    m.lsk("L", 3); // (the first runway)
    m.lsk("L", 3); // (NO SID)
    m.lsk("R", 6);
    expect(route.wps.some((w) => w.proc?.sid)).toBeFalse();
    expect(route.wps[1]!.name).not.toBe("ORYAN");
  });
  test("F-PLN with the managed profile (PLAN-A320-VOL-AAA N3): (T/C), (T/D), (DECEL) between the points, the predictions, no revision on them", () => {
    const { h, route } = host();
    const E = (name: string, nm: number, extra: Partial<Waypoint> = {}): Waypoint => ({ name, lat: 0, lon: nm / 60.04, ...extra });
    route.wps = [
      E("ORIG", 0, { field: { icao: "ORIG", elev: 0 } }),
      E("AAA", 60),
      E("BBB", 150),
      E("CCC", 250),
      E("IF", 290, { alt: 3000 * 0.3048, cstr: [3000 * 0.3048, 3000 * 0.3048], proc: { kind: "arr", approach: "I09", join: true } }),
      E("DEST", 300, { field: { icao: "DEST", elev: 0 } }),
    ];
    const VP = vprofile({ wps: route.wps, active: 1, distTo: 50 * 1852, alt: 5000, crz: 30000, gs: 300, vs: 2000, descending: false })!;
    Object.assign(h, { vprofile: () => VP, activeWp: () => 1 } satisfies Partial<McduHost>);
    const m = mcdu(h);
    m.page("f-pln");
    const txt = (L?: { t: string }[]) => (L ?? []).map((r) => r.t).join("");
    const all: string[] = [];
    for (let k = 0; k < 12; k++) {
      m.fplnTop = k;
      all.push(txt(m.current.screen(m).lines[0]!.l).trim().split(/\s+/)[0]!);
    }
    console.log(`  F-PLN: ${all.join(" ")}`);
    // (T/C after AAA — 50 NM, then 25 000 ft at 400 ft/NM: 112 NM —, T/D before CCC, DECEL 5 NM before the IF)
    const order = ["ORIG", "AAA", "(T/C)", "BBB", "(T/D)", "CCC", "(DECEL)", "IF", "DEST"];
    expect(all.slice(0, order.length)).toEqual(order);
    // (BBB predicted at the cruise level; LAT REV refused on a pseudo-waypoint)
    m.fplnTop = 3;
    expect(txt(m.current.screen(m).lines[0]!.r)).toBe("---/FL300");
    m.fplnTop = 2;
    m.lsk("L", 1);
    expect(m.pageId).toBe("fpln");
  });
});
