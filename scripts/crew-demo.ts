// A scripted room for the crew console (crew/): two pilots flying Paris → Lyon in formation, sending what the
// simulator sends — the poses, the instruments with their plan, prediction, autopilot, systems, alerts — and the
// surroundings (airliners, a carrier and a ship, a mission's units and zones). No simulator, no GPU.
//   bun scripts/crew-demo.ts [ws://localhost:3000/net]  → prints the room's code; open /crew/#join=CODE
import { NetClient } from "../src/net/client";
import { emptyVisual } from "../src/net/proto";
import { geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import { gcCourse, gcDest, gcDist } from "../src/game/flightplan";

const url = process.argv[2] ?? "ws://localhost:3000/net";
const D = Math.PI / 180;
const ROUTE = [
  { name: "LFPG", lat: 49.0097, lon: 2.5479, alt: 119 },
  { name: "MOLBA", lat: 48.55, lon: 2.95, alt: 4000 },
  { name: "AVLON", lat: 47.9, lon: 3.55 },
  { name: "DJL", lat: 47.27, lon: 5.09, alt: 7000 },
  { name: "IAF01", lat: 46.25, lon: 5.05, alt: 2500, spd: 150 },
  { name: "LFLL", lat: 45.7256, lon: 5.0811, alt: 250 },
];
const CRUISE = 9000;

function pilot(name: string, colour: string) {
  return new NetClient({ url, build: "crew-demo", id: { device: `crew-demo-${name}`, name, colour }, p2p: false });
}
const ana = pilot("Ana", "#ffb43c");
const ben = pilot("Ben", "#4cf29a");
const room = await ana.create("Démo équipage", 0);
await ben.join(room.code, "pilot");
console.log(`Salle ${room.code} · http://localhost:3000/crew/#join=${room.code}`);

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

setInterval(() => {
  const dt = 0.25;
  t += dt;
  const wp = ROUTE[leg]!;
  const brg = gcCourse({ lat, lon }, wp);
  const dist = gcDist({ lat, lon }, wp);
  if (dist < 2500 && leg < ROUTE.length - 1) leg++;
  const dh = Math.atan2(Math.sin(brg - hdg), Math.cos(brg - hdg));
  const turn = Math.max(-3 * D, Math.min(3 * D, dh)) * dt * 2;
  hdg = (hdg + turn + 2 * Math.PI) % (2 * Math.PI);
  const bank = Math.max(-35 * D, Math.min(35 * D, dh * 2)) + Math.sin(t * 0.7) * 2 * D;
  const target = wp.alt ?? CRUISE;
  const vs = Math.max(-25, Math.min(30, (Math.min(target, CRUISE) - alt) * 0.02));
  alt += vs * dt;
  spd += ((wp.spd ?? 235) - spd) * 0.02;
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
    const w2 = ROUTE[l2]!;
    if (gcDist(q, w2) < gs * 10 && l2 < ROUTE.length - 1) l2++;
    q = gcDest(q, gcCourse(q, ROUTE[l2]!), gs * 10);
    h2 += Math.max(-25, Math.min(30, ((ROUTE[l2]!.alt ?? CRUISE) - h2) * 0.02)) * 10;
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
  const warn = [...(fuel < 7000 ? ["BINGO"] : []), ...(Math.floor(t / 20) % 6 === 5 ? ["MISSILE"] : [])];
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
        alt: target,
        hdg: brg,
        spd: 235,
        ab: false,
        lnav: true,
        vnav: true,
        auto: "none",
        hold: "none",
        sas: true,
        order: "",
        hub: null,
      },
      nav: {
        active: leg,
        dist,
        brg,
        ete: dist / gs,
        xtk: 180 * Math.sin(t / 30),
        dtk: brg,
        phase: alt < CRUISE - 200 && leg < 3 ? "climb" : leg >= 4 ? "descent" : "cruise",
        tod: leg <= 3 ? Math.max(0, gcDist({ lat, lon }, ROUTE[3]!) + 20_000) : null,
        altT: target,
        spdT: wp.spd ?? 235,
        cruiseAlt: CRUISE,
        cruiseSpd: 235,
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
        gear: 0,
        gearDown: false,
        flaps: 0,
        brake: 0,
        stovl: "",
        hull: 0.12,
        shield: null,
        damage: 0,
        mass: 22_500,
      },
      ils: leg >= 5 ? { id: "ILS 36R LFLL", loc: Math.sin(t / 5) * 0.6, gs: Math.cos(t / 7) * 0.5, dme: dist, phase: "final" } : null,
      orbit: null,
      next: null,
      msn: { name: "SA-6", brg: gcCourse({ lat, lon }, units[0]!), dist: gcDist({ lat, lon }, units[0]!), dz: -alt },
      warn,
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
  ben.sendCraft(sample(w.lat, w.lon, alt + 60, hdg, spd));
}, 250);
