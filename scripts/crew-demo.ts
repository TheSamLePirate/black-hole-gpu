// A scripted room for the crew console (crew/): two pilots flying Paris → Lyon in formation, sending what the
// simulator sends — the poses, the instruments with their plan, prediction, autopilot, systems, alerts — and the
// surroundings (airliners, a carrier and a ship, a mission's units and zones); and three spacecraft (PLAN-VAISSEAUX
// K7 — scripts/lib/space-demo.ts): the Ranger closing on the ISS, the Lander descending on the Moon, the Endurance by
// Gargantua. No simulator, no GPU.
//   bun scripts/crew-demo.ts [ws://localhost:3000/net] [--space]  → prints the room's code; open /crew/#join=CODE
//   (--space: the leader's F-35 and the three spacecraft — a room holds four pilots —; else the two F-35s)
import { NetClient } from "../src/net/client";
import { emptyVisual } from "../src/net/proto";
import { geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import { gcCourse, gcDest, gcDist } from "../src/game/flightplan";
import { readCrewCmd, sayOf } from "../src/net/crewcmd";
import { spacePilots } from "./lib/space-demo";

const SPACE = process.argv.includes("--space");
const url = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "ws://localhost:3000/net";
const D = Math.PI / 180;
type Wp = { name: string; lat: number; lon: number; alt?: number; spd?: number };
const ROUTE: Wp[] = [
  { name: "LFPG", lat: 49.0097, lon: 2.5479, alt: 119 },
  { name: "MOLBA", lat: 48.55, lon: 2.95, alt: 4000 },
  { name: "AVLON", lat: 47.9, lon: 3.55 },
  { name: "DJL", lat: 47.27, lon: 5.09, alt: 7000 },
  { name: "IAF01", lat: 46.25, lon: 5.05, alt: 2500, spd: 150 },
  { name: "LFLL", lat: 45.7256, lon: 5.0811, alt: 250 },
];
let CRUISE = 9000;
let CRUISE_SPD = 235;
let target = "";
const PLACES: Record<string, [number, number]> = {
  LFPO: [48.7233, 2.3794],
  LFLY: [45.7272, 4.9444],
  LFMN: [43.6584, 7.2159],
  LFLS: [45.3629, 5.3294],
  LFSB: [47.59, 7.5291],
  DIJON: [47.322, 5.0415],
};

function pilot(name: string, colour: string) {
  return new NetClient({ url, build: "crew-demo", id: { device: `crew-demo-${name}`, name, colour }, p2p: false });
}
const ana = pilot("Ana", "#ffb43c");
const ben = SPACE ? null : pilot("Ben", "#4cf29a");
const room = await ana.create("Démo équipage", 0);
await ben?.join(room.code, "pilot");
console.log(`Salle ${room.code} · http://localhost:3000/crew/#join=${room.code}`);
// (the spacecraft beside the leader: Cooper, Brand, Romilly)
if (SPACE) await spacePilots(url, room.code);

// the leader's state
let lat = 48.95,
  lon = 2.6,
  alt = 1200,
  spd = 180,
  hdg = 140 * D,
  leg = 1,
  fuel = 7800,
  t = 0;
const airliners = Array.from({ length: 36 }, (_, i) => {
  const a = (i * 137.5 * D) % (2 * Math.PI);
  const r = 15_000 + ((i * 7919) % 120_000);
  const p = gcDest({ lat: 48.6, lon: 3.2 }, a, r);
  return {
    id: `39${(4000 + i * 37).toString(16)}`,
    cs: `AFR${100 + i * 7}`,
    ...p,
    alt: 3000 + ((i * 1733) % 9000),
    hdg: (a + 1.3 * i) % (2 * Math.PI),
    spd: 180 + (i % 7) * 15,
    type: ["A320", "B738", "A21N", "E190"][i % 4]!,
  };
});
const ships = [
  { id: "cv:ford", name: "USS Gerald R. Ford (CVN-78)", lat: 49.85, lon: -0.9, hdg: 250 * D, spd: 14.4, side: "carrier", type: "ford" },
  { id: "s:ferry", name: "Normandie Express", lat: 49.75, lon: -1.4, hdg: 340 * D, spd: 18, side: "traffic", type: "ferry" },
];
const units = [
  { id: "m:sam", name: "SA-6", lat: 47.6, lon: 4.6, side: "hostile", kind: "ground" as const },
  { id: "m:bandit", name: "BANDIT 1", lat: 47.4, lon: 4.2, side: "hostile", kind: "air" as const, hdg: 300 * D, spd: 250, alt: 8000 },
  { id: "m:escort", name: "VIP", lat: 47.95, lon: 3.6, side: "friend", kind: "air" as const, hdg: 140 * D, spd: 220, alt: 8500 },
];

/** the point under the Sun at a date (the declination and the equation of time to a fraction of a degree) */
function subSolar(d: Date) {
  const day = (d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000;
  const g = (2 * Math.PI * (day - 1)) / 365;
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g);
  const eot =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  return { lat: decl / D, lon: -((minutes + eot) / 4 - 180) };
}

/**
 * The fight about the leader (PLAN-RADAR-AAA RD8 — the crew's missiles and decoys), a 30 s loop: an AIM-120 at a bandit
 * 25 km ahead (its time to go, PITBULL's last 15 km, SPLASH); an SA-6 at us from the left at 10 s, flares and chaff
 * dropped at 14 s, the missile DECOYED, then a MISS behind us. Their places along great circles from ours (WGS84
 * enough at these ranges for a display).
 */
function fight(t: number, at: { lat: number; lon: number }, alt: number, hdg: number) {
  const k = t % 30;
  const out: {
    id: string;
    name: string;
    kind: string;
    side: string;
    lat: number;
    lon: number;
    alt: number;
    hdg: number | null;
    spd: number;
    type: string;
  }[] = [];
  const bandit = gcDest(at, hdg, 25_000 - k * 200);
  out.push({
    id: "f:demo-bandit",
    name: "BANDIT 2",
    kind: "air",
    side: k < 13 ? "hostile" : k < 16 ? "dead" : "hostile",
    ...bandit,
    alt: alt + 800,
    hdg: hdg + Math.PI,
    spd: 200,
    type: "Su-35",
  });
  if (k < 16) {
    // (ours: launched at 0 s, 1 200 m/s, splash at 13 s)
    const run = Math.min(k, 13) * 1200 + 600;
    const p = gcDest(at, hdg, Math.min(run, 25_000 - Math.min(k, 13) * 200));
    const tti = Math.max(0, 13 - k);
    out.push({
      id: "msl:demo-120",
      name: "AIM-120C",
      kind: "missile",
      side: "friend",
      ...p,
      alt: alt + 400,
      hdg,
      spd: 1200,
      type: k >= 13 ? "SPLASH" : `${Math.round(tti)}s`,
    });
  }
  if (k >= 10 && k < 24) {
    // (theirs: from 18 km on our left, 900 m/s; drawn off by the flares at 15 s, gone by at 21 s: MISS)
    const from = gcDest(at, hdg - Math.PI / 2, 18_000);
    const run = (k - 10) * 900;
    const decoyed = k >= 15;
    const p = gcDest(from, hdg + Math.PI / 2 + (decoyed ? 0.25 : 0), Math.min(run, 19_000));
    const tti = (18_000 - run) / 900;
    out.push({
      id: "msl:demo-sa6",
      name: "3M9",
      kind: "missile",
      side: "hostile",
      ...p,
      alt,
      hdg: hdg + Math.PI / 2,
      spd: 900,
      type: k >= 21 ? "MISS" : decoyed ? "→ US DECOYED" : `→ US ${Math.round(tti)}s`,
    });
  }
  if (k >= 14 && k < 19)
    for (let i = 0; i < 3; i++) {
      const p = gcDest(at, hdg + Math.PI + (i - 1) * 0.3, 150 + (k - 14) * 60);
      out.push({
        id: `cm:demo-${i}`,
        name: i === 1 ? "CHAFF" : "FLARE",
        kind: "decoy",
        side: "friend",
        ...p,
        alt: alt - (k - 14) * 30,
        hdg: null,
        spd: 0,
        type: i === 1 ? "chaff" : "flare",
      });
    }
  return out;
}

function sample(lat0: number, lon0: number, h: number, heading: number, v: number) {
  const p = geodeticToCart(WGS84_A, WGS84_F, lat0 * D, lon0 * D, h);
  const E = [-Math.sin(lon0 * D), Math.cos(lon0 * D), 0];
  const N = [-Math.sin(lat0 * D) * Math.cos(lon0 * D), -Math.sin(lat0 * D) * Math.sin(lon0 * D), Math.cos(lat0 * D)];
  const U = [Math.cos(lat0 * D) * Math.cos(lon0 * D), Math.cos(lat0 * D) * Math.sin(lon0 * D), Math.sin(lat0 * D)];
  const fwd = E.map((e, i) => e * Math.sin(heading) + N[i]! * Math.cos(heading));
  // (the quaternion turning +x onto the nose: about the up axis by the angle from E)
  const right = [fwd[1]! * U[2]! - fwd[2]! * U[1]!, fwd[2]! * U[0]! - fwd[0]! * U[2]!, fwd[0]! * U[1]! - fwd[1]! * U[0]!];
  const m = [fwd, right.map((x) => -x), U];
  const tr = m[0]![0]! + m[1]![1]! + m[2]![2]!;
  const w = Math.sqrt(Math.max(0, 1 + tr)) / 2;
  const q: [number, number, number, number] = [
    (m[1]![2]! - m[2]![1]!) / (4 * w || 1),
    (m[2]![0]! - m[0]![2]!) / (4 * w || 1),
    (m[0]![1]! - m[1]![0]!) / (4 * w || 1),
    w,
  ];
  return {
    frame: 0,
    body: 0,
    kind: 3,
    flags: 0,
    p,
    v: fwd.map((x) => x * v) as [number, number, number],
    q,
    w: [0, 0, 0] as [number, number, number],
    a: [0, 0, 0] as [number, number, number],
    vis: { ...emptyVisual(), mach: v / 300 },
  };
}

// the crew's orders (docs/PLAN-CREW-ACTIONS.md): Ana's board answers them as the simulator would
const board = { ackUntil: 0, gearDown: false, flaps: 0, brake: 0, sas: true };
// the autopilot as an MCP: its selected targets (null: managed by the plan), its modes
const arms = { sel: "aim120", mode: "TWS", lock: "", stores: { aim120: 4, aim9x: 2, jdam: 2, jsm: 0 } as Record<string, number> };
const ap = { on: true, athr: true, lnav: true, vnav: true, alt: 4000, hdg: null as number | null, spd: 235, order: "", ils: "" };
const crewDo: Record<string, (a: Record<string, unknown>) => string | null> = {
  "cfg.ack": () => {
    board.ackUntil = t + 20;
    return null;
  },
  "cfg.gear": (a) => {
    if (!a.down && alt < 30) return "Au sol : le train reste sorti";
    board.gearDown = !!a.down;
    return null;
  },
  "cfg.flaps": (a) => {
    const p = Number(a.pos);
    board.flaps = p < 0.25 ? 0 : p < 0.75 ? 0.5 : 1;
    return null;
  },
  "cfg.brake": (a) => {
    board.brake = a.on ? 1 : 0;
    return null;
  },
  "nav.add": (a) => {
    let p: Wp;
    if (typeof a.query === "string") {
      const k = a.query.toUpperCase();
      const hit = PLACES[k];
      if (!hit) return `Rien trouvé pour « ${a.query} »`;
      p = { name: k, lat: hit[0], lon: hit[1] };
    } else if (typeof a.lat === "number" && typeof a.lon === "number")
      p = { name: `WP${String(ROUTE.length + 1).padStart(2, "0")}`, lat: a.lat, lon: a.lon };
    else return "Un nom ou une position";
    if (typeof a.alt === "number") p.alt = a.alt;
    if (typeof a.spd === "number") p.spd = a.spd;
    const at = typeof a.index === "number" ? Math.min(a.index, ROUTE.length) : ROUTE.length;
    ROUTE.splice(at, 0, p);
    if (at <= leg && ROUTE.length > 1) leg++;
    return null;
  },
  "nav.remove": (a) => {
    const i = Number(a.index);
    if (!ROUTE[i]) return `Pas de point ${i}`;
    ROUTE.splice(i, 1);
    if (i < leg) leg--;
    leg = Math.max(0, Math.min(leg, ROUTE.length - 1));
    return null;
  },
  "nav.move": (a) => {
    const w = ROUTE[Number(a.index)];
    if (!w) return "Pas de tel point";
    w.lat = Number(a.lat);
    w.lon = Number(a.lon);
    return null;
  },
  "nav.point": (a) => {
    const w = ROUTE[Number(a.index)];
    if (!w) return "Pas de tel point";
    if (a.clearAlt) delete w.alt;
    else if (typeof a.alt === "number") w.alt = a.alt;
    if (a.clearSpd) delete w.spd;
    else if (typeof a.spd === "number") w.spd = a.spd;
    return null;
  },
  "nav.clear": () => {
    ROUTE.length = 0;
    return null;
  },
  "nav.cruise": (a) => {
    if (typeof a.alt === "number") CRUISE = a.alt;
    if (typeof a.spd === "number") CRUISE_SPD = a.spd;
    return null;
  },
  "nav.direct": (a) => {
    if (!ROUTE[Number(a.index)]) return "Pas de tel point";
    leg = Number(a.index);
    return null;
  },
  "nav.procedures": () => "Pas de terrain en bout de plan",
  "nav.target": (a) => {
    target = String(a.name);
    return null;
  },
  "ap.set": (a) => {
    if (typeof a.alt === "number") {
      ap.alt = a.alt;
      ap.vnav = false;
    }
    if (typeof a.hdgDeg === "number") {
      ap.hdg = (a.hdgDeg * Math.PI) / 180;
      ap.lnav = false;
    }
    if (typeof a.spd === "number") {
      ap.spd = a.spd;
      ap.vnav = false;
    }
    ap.on = true;
    return null;
  },
  "ap.engage": (a) => {
    if (typeof a.ap === "boolean") ap.on = a.ap;
    if (typeof a.athr === "boolean") ap.athr = a.athr;
    return null;
  },
  "ap.nav": (a) => {
    if (!ROUTE.length) return "NAV: no flight plan";
    if (typeof a.lnav === "boolean") ap.lnav = a.lnav;
    if (typeof a.vnav === "boolean") ap.vnav = a.vnav;
    return null;
  },
  "ap.ils": (a) => {
    ap.ils = typeof a.field === "string" ? a.field.toUpperCase() : "LFLL";
    return null;
  },
  "ap.ilsOff": () => {
    ap.ils = "";
    return null;
  },
  "ap.mode": (a) => {
    ap.order = a.mode === "off" ? "" : (({ orbit: "ORBIT", hold: "HOLD", tf: "TF" } as Record<string, string>)[String(a.mode)] ?? "");
    return null;
  },
  "ap.traffic": (a) => {
    ap.order = a.action === "stop" ? "" : a.action === "join" ? "FORM" : "ICPT";
    return null;
  },
  "ap.goAround": () => "Pas en approche",
  "wp.radar": (a) => {
    arms.mode = String(a.mode);
    return null;
  },
  "wp.select": (a) => {
    if (!arms.stores[String(a.weapon)]) return "No JSM left";
    arms.sel = String(a.weapon);
    return null;
  },
  "wp.lock": (a) => {
    arms.lock = typeof a.target === "string" ? a.target : "BANDIT 1";
    return null;
  },
  "wp.fire": () => {
    if (!arms.lock) return "No target for the seeker";
    if (!arms.stores[arms.sel]) return "No weapon left";
    arms.stores[arms.sel]!--;
    return null;
  },
  "wp.gun": () => null,
  "wp.cm": () => null,
  "cfg.sas": (a) => {
    board.sas = !!a.on;
    return null;
  },
};
ana.on("event", ({ from, ev }) => {
  if (ev.kind !== "crew-cmd") return;
  const cmd = readCrewCmd(ev);
  if (!cmd.ok)
    return ana.event({ kind: "crew-ack", v: 1, id: cmd.id ?? "", to: from, act: String(ev.act), ok: false, msg: cmd.error, what: "" });
  if (cmd.cmd.to !== ana.room?.slot) return;
  const why = crewDo[cmd.cmd.act]?.(cmd.cmd.args) ?? null;
  ana.event({
    kind: "crew-ack",
    v: 1,
    id: cmd.cmd.id,
    to: from,
    act: cmd.cmd.act,
    ok: !why,
    msg: why ?? "",
    what: sayOf(cmd.cmd.act, cmd.cmd.args).fr,
  });
});

setInterval(() => {
  const dt = 0.25;
  t += dt;
  // (no plan: on along the heading)
  const ahead1 = (from: { lat: number; lon: number }, h: number): Wp => ({ name: "", ...gcDest(from, h, 50_000) });
  const wpAt = (i: number, from: { lat: number; lon: number }, h: number): Wp => ROUTE[Math.min(i, ROUTE.length - 1)] ?? ahead1(from, h);
  const wp = wpAt(leg, { lat, lon }, hdg);
  const brg = gcCourse({ lat, lon }, wp);
  const dist = gcDist({ lat, lon }, wp);
  if (dist < 2500 && leg < ROUTE.length - 1) leg++;
  // (the heading flown: the plan's under LNAV, the selected one else; an orbit's turn)
  const want = ap.order === "ORBIT" ? hdg + 0.4 : ap.lnav || ap.hdg === null ? brg : ap.hdg;
  const dh = Math.atan2(Math.sin(want - hdg), Math.cos(want - hdg));
  const turn = Math.max(-3 * D, Math.min(3 * D, dh)) * dt * 2;
  hdg = (hdg + turn + 2 * Math.PI) % (2 * Math.PI);
  const bank = Math.max(-35 * D, Math.min(35 * D, dh * 2)) + Math.sin(t * 0.7) * 2 * D;
  const target = ap.vnav ? (wp.alt ?? CRUISE) : ap.alt;
  const vs = Math.max(-25, Math.min(30, (Math.min(target, CRUISE) - alt) * 0.02));
  alt += vs * dt;
  spd += ((ap.vnav ? (wp.spd ?? CRUISE_SPD) : ap.spd) - spd) * 0.02;
  const gs = spd + 12;
  const p = gcDest({ lat, lon }, hdg, gs * dt);
  lat = p.lat;
  lon = p.lon;
  fuel -= 0.9 * dt;
  const pitch = Math.atan2(vs, spd) + 3 * D + Math.sin(t * 0.9) * 0.6 * D;
  // the prediction: the next five minutes along the route
  const ahead: { lat: number; lon: number; t: number; h: number }[] = [];
  let q = { lat, lon },
    h2 = alt,
    l2 = leg;
  for (let k = 1; k <= 30; k++) {
    const w2 = wpAt(l2, q, hdg);
    if (gcDist(q, w2) < gs * 10 && l2 < ROUTE.length - 1) l2++;
    const w3 = wpAt(l2, q, hdg);
    q = gcDest(q, gcCourse(q, w3), gs * 10);
    h2 += Math.max(-25, Math.min(30, ((w3.alt ?? CRUISE) - h2) * 0.02)) * 10;
    ahead.push({ ...q, t: k * 10, h: h2 });
  }
  const around = Math.round(t * 4) % 4 === 0;
  for (const a of airliners) {
    const n = gcDest(a, a.hdg, a.spd * dt);
    a.lat = n.lat;
    a.lon = n.lon;
  }
  for (const s of ships) {
    const n = gcDest(s, s.hdg, s.spd * dt);
    s.lat = n.lat;
    s.lon = n.lon;
  }
  const warn =
    t < board.ackUntil
      ? []
      : [...(fuel < 7000 ? ["BINGO"] : []), ...(Math.floor(t / 20) % 6 === 5 ? ["MISSILE"] : []), ...(t > 2 && t < 40 ? ["GEAR"] : [])];
  ana.sendCraft(sample(lat, lon, alt, hdg, spd));
  ana.event({
    kind: "instruments",
    data: {
      v: 1,
      t,
      body: "earth",
      metrics: {
        alt,
        speed: spd,
        vz: vs,
        g: 1 / Math.cos(bank),
        q: 0.5 * 0.45 * spd * spd,
        mach: spd / 300,
        throttle: 0.72,
        fuel: fuel / 8300,
        tau: 1,
      },
      geo: { lat, lon, heading: hdg },
      radar: {
        mode: "RWS",
        contacts: units
          .filter((u) => u.kind === "air")
          .map((u) => {
            const r = gcDist({ lat, lon }, u),
              b = gcCourse({ lat, lon }, u);
            return {
              id: u.id,
              name: u.name,
              e: Math.sin(b) * r,
              n: Math.cos(b) * r,
              dz: (u.alt ?? 0) - alt,
              iff: u.side,
              locked: u.side === "hostile",
            };
          }),
      },
      route: ROUTE,
      ahead,
      flight: {
        pitch,
        bank,
        hdg,
        track: hdg + 2 * D,
        fpa: Math.atan2(vs, gs),
        aoa: 4.5 * D + Math.sin(t) * 0.5 * D,
        beta: 0.3 * D,
        tas: spd,
        eas: spd * 0.62,
        gs,
        agl: alt - 180,
        nz: 1 / Math.cos(bank),
        gMax: 9,
        buffet: 0,
        stallAoa: 28 * D,
        wind: { spd: 14, from: 250 * D },
      },
      auto: {
        mode: "plane",
        assist: "realistic",
        alt: ap.on ? target : null,
        hdg: ap.on ? (ap.lnav ? brg : ap.hdg) : null,
        spd: ap.athr ? (ap.vnav ? (wp.spd ?? CRUISE_SPD) : ap.spd) : null,
        ab: false,
        lnav: ap.lnav,
        vnav: ap.vnav,
        auto: "none",
        hold: "none",
        sas: board.sas,
        order: ap.order,
        hub: null,
      },
      nav: !ROUTE.length
        ? null
        : {
            active: leg,
            dist,
            brg,
            ete: dist / gs,
            xtk: 180 * Math.sin(t / 30),
            dtk: brg,
            phase: alt < CRUISE - 200 && leg < 3 ? "climb" : leg >= 4 ? "descent" : "cruise",
            tod: leg <= 3 && ROUTE[3] ? Math.max(0, gcDist({ lat, lon }, ROUTE[3]) + 20_000) : null,
            altT: target,
            spdT: wp.spd ?? 235,
            cruiseAlt: CRUISE,
            cruiseSpd: CRUISE_SPD,
            bingo: 2400,
            fuelToGo: 1500,
            timeToGo: 1900,
          },
      sys: {
        engine: "F135",
        spool: 0.86,
        thrust: 82,
        ab: 0,
        flow: 0.95,
        fuelKg: fuel,
        fuelFull: 8300,
        gear: board.gearDown ? 1 : 0,
        gearDown: board.gearDown,
        flaps: board.flaps,
        brake: board.brake,
        stovl: "",
        hull: 0.12,
        shield: null,
        damage: 0,
        mass: 22_500,
      },
      ils:
        ap.ils || leg >= 5
          ? { id: `ILS ${ap.ils || "LFLL"}`, loc: Math.sin(t / 5) * 0.6, gs: Math.cos(t / 7) * 0.5, dme: dist, phase: "final" }
          : null,
      orbit: null,
      next: null,
      msn: { name: "SA-6", brg: gcCourse({ lat, lon }, units[0]!), dist: gcDist({ lat, lon }, units[0]!), dz: -alt },
      warn,
      caps: { on: true, fam: ["nav", "config", "jet", "weapons"] },
      sun: subSolar(new Date()),
      arms: { live: true, sel: arms.sel, stores: arms.stores, mode: arms.mode, lock: arms.lock },
      tracks: fight(t, { lat, lon }, alt, hdg),
      ...(around
        ? {
            traffic: [
              ...airliners.map((a) => ({
                id: `t:${a.id}`,
                name: a.cs,
                kind: "air",
                side: "traffic",
                lat: a.lat,
                lon: a.lon,
                alt: a.alt,
                hdg: a.hdg,
                spd: a.spd,
                type: a.type,
              })),
              ...ships.map((s) => ({ ...s, kind: "sea", alt: 0 })),
              ...units.map((u) => ({ ...u, alt: u.alt ?? null, hdg: u.hdg ?? null, spd: u.spd ?? null, type: "" })),
            ],
            zones: [
              { lat: 47.6, lon: 4.6, r: 32_000, name: "SA-6", kind: "threat" },
              { lat: 46.8, lon: 5.0, r: 12_000, name: "Point de rendez-vous", kind: "zone", waiting: false },
            ],
          }
        : {}),
    },
  });
  // the wingman, 1.5 km right and behind
  const w = gcDest(gcDest({ lat, lon }, hdg + Math.PI / 2, 1500), hdg + Math.PI, 900);
  ben?.sendCraft(sample(w.lat, w.lon, alt + 60, hdg, spd));
}, 250);
