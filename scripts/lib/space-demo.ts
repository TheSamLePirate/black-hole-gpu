// The crew demo room's spacecraft pilots (PLAN-VAISSEAUX K7): beside the F-35s, three scripted craft sending what the
// simulator sends for a spacecraft — the K1–K6 blocks —, no simulator, no GPU:
//   Cooper  the Ranger in low Earth orbit closing on the ISS (its orbit, a burn planned, the docking's geometry, a
//           failure at 40 s whose checklist the crew ticks);
//   Brand   the Lander descending on the Moon at Tranquility (its height, its ground track, the landing point);
//   Romilly the Endurance on Gargantua's side (its ring, the Ranger at its hub, the hole's worlds, no live link).
// Each answers the crew's orders (the target, the checklist, the ring, the burns).
import { NetClient } from "../../src/net/client";
import { readCrewCmd, sayOf } from "../../src/net/crewcmd";
import { emptyVisual } from "../../src/net/proto";

const MU_E = 398600.4418,
  MU_M = 4902.8,
  MU_S = 1.32712440018e11;
const AU = 1.495978707e8;
// (a demo room's stand-in craft on circular orbits — mean radii, not the WGS84 figure: orbits, no place on the ground)
const R_E = 6371,
  R_M = 1737.4;
const D = Math.PI / 180;
const CHECK_STEPS: Record<string, number> = { engine: 4, rcsStuck: 3, gyro: 3, bus: 3, o2Leak: 3, scrubber: 3 };

type V3 = [number, number, number];
const planet = (id: string, au: number, ang: number, mu: number, radius: number) => {
  const r = au * AU,
    v = Math.sqrt(MU_S / r);
  return {
    id,
    r: [r * Math.cos(ang), r * Math.sin(ang), 0] as V3,
    v: [-v * Math.sin(ang), v * Math.cos(ang), 0] as V3,
    mu,
    radius,
    parent: "sun",
  };
};
/** the bodies about the Earth and the Moon (the K3 map's) */
function bodies(t: number) {
  const earth = planet("earth", 1, 0.3 + t * 2e-7, MU_E, R_E);
  const ma = t * 2.66e-6;
  const moon = {
    id: "moon",
    r: [earth.r[0] + 384_400 * Math.cos(ma), earth.r[1] + 384_400 * Math.sin(ma), 0] as V3,
    v: [earth.v[0] - 1.022 * Math.sin(ma), earth.v[1] + 1.022 * Math.cos(ma), 0] as V3,
    mu: MU_M,
    radius: R_M,
    parent: "earth",
  };
  return [
    { id: "sun", r: [0, 0, 0] as V3, v: [0, 0, 0] as V3, mu: MU_S, radius: 696_000, parent: "" },
    planet("mercury", 0.387, 2.1, 22032, 2440),
    planet("venus", 0.723, 4.0, 324859, 6052),
    earth,
    moon,
    planet("mars", 1.524, 1.2, 42828, 3390),
    planet("jupiter", 5.2, 2.7, 1.26687e8, 69911),
    planet("saturn", 9.58, 4.6, 3.7931e7, 58232),
  ];
}
const sample = (frame: number, body: number, kind: number, p: V3, v: V3) => ({
  frame,
  body,
  kind,
  flags: 0,
  p,
  v,
  q: [0, 0, 0, 1] as [number, number, number, number],
  w: [0, 0, 0] as V3,
  a: [0, 0, 0] as V3,
  vis: emptyVisual(),
});

/** One scripted spacecraft pilot: its client, its state, its answers to the crew. */
class SpacePilot {
  readonly net: NetClient;
  target = "";
  ticks = new Map<string, Set<number>>();
  failures: { kind: string; fixing: boolean; at: number }[] = [];
  ringRpm = 5;
  nodeIn = 900;
  constructor(url: string, name: string, colour: string) {
    this.net = new NetClient({ url, build: "crew-demo", id: { device: `crew-demo-${name}`, name, colour }, p2p: false });
    this.net.on("event", ({ from, ev }) => {
      if (ev.kind !== "crew-cmd") return;
      const cmd = readCrewCmd(ev);
      if (!cmd.ok) return;
      if (cmd.cmd.to !== this.net.room?.slot) return;
      const why = this.do(cmd.cmd.act, cmd.cmd.args);
      this.net.event({
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
  }
  /** an order done (null) or refused (why) */
  do(act: string, a: Record<string, unknown>): string | null {
    if (act === "sp.target") this.target = String(a.name);
    else if (act === "sp.ring") this.ringRpm = Math.max(0, Math.min(10, this.ringRpm + (Number(a.dir) > 0 ? 1 : -1)));
    else if (act === "sp.node") this.nodeIn = a.action === "delete" ? -1 : this.nodeIn + Number(a.dtS ?? 0);
    else if (act === "sys.step") {
      const k = String(a.kind);
      if (!this.failures.some((f) => f.kind === k)) return "Cette panne n'est pas en cours";
      const s = this.ticks.get(k) ?? new Set<number>();
      this.ticks.set(k, s);
      if (a.on) s.add(Number(a.step));
      else s.delete(Number(a.step));
    } else if (act === "sys.fix") {
      const k = String(a.kind);
      const f = this.failures.find((x) => x.kind === k);
      if (!f) return "Cette panne n'est pas en cours";
      if ((this.ticks.get(k)?.size ?? 0) < (CHECK_STEPS[k] ?? 3)) return "La checklist d'abord : toutes les étapes cochées";
      f.fixing = true;
      setTimeout(() => {
        this.failures = this.failures.filter((x) => x !== f);
        this.ticks.delete(k);
      }, 4000);
    }
    return null;
  }
  sysx(battery: number, crew: number, o2h: number) {
    return {
      battery,
      kwh: 60,
      balance: 1.2,
      o2h,
      scrub: 13,
      crew,
      failures: this.failures.map((f) => ({ kind: f.kind, fixing: f.fixing, ticks: [...(this.ticks.get(f.kind) ?? [])].sort() })),
    };
  }
}

export async function spacePilots(url: string, code: string) {
  const cooper = new SpacePilot(url, "Cooper", "#6fd3ff");
  const brand = new SpacePilot(url, "Brand", "#c9a6ff");
  const romilly = new SpacePilot(url, "Romilly", "#ffd84a");
  for (const p of [cooper, brand, romilly]) await p.net.join(code, "pilot");
  let t = 0;
  setInterval(() => {
    t += 0.25;
    const heavy = Math.round(t * 4) % 4 === 0;
    // --- Cooper: the Ranger, 420 km, 51.6°, closing on the ISS 300 m → 20 m and again; a failure at 40 s
    {
      const r = R_E + 420,
        v = Math.sqrt(MU_E / r),
        i = 51.6 * D,
        a = (t / 5560) * 2 * Math.PI;
      const rr: V3 = [r * Math.cos(a), r * Math.sin(a) * Math.cos(i), r * Math.sin(a) * Math.sin(i)];
      const vv: V3 = [-v * Math.sin(a), v * Math.cos(a) * Math.cos(i), v * Math.cos(a) * Math.sin(i)];
      if (t > 40 && t < 41 && !cooper.failures.length) cooper.failures.push({ kind: "rcsStuck", fixing: false, at: t });
      const along = 300 - ((t * 2) % 280);
      const ring = (k: number): V3 => {
        const b = (k / 48) * 2 * Math.PI + a;
        return [r * Math.cos(b), r * Math.sin(b) * Math.cos(i), r * Math.sin(b) * Math.sin(i)];
      };
      cooper.net.sendCraft(sample(0, 0, 0, rr.map((x) => x * 1000) as V3, vv.map((x) => x * 1000) as V3));
      cooper.net.event({
        kind: "instruments",
        data: {
          v: 1,
          t,
          body: "earth",
          metrics: { alt: 420_000, speed: v * 1000, fuel: 0.7, tau: 1 },
          geo: {
            lat: (Math.asin(rr[2] / r) * 180) / Math.PI,
            lon: ((Math.atan2(rr[1], rr[0]) * 180) / Math.PI - t * 0.004) % 180,
            heading: 0.8,
          },
          radar: null,
          route: [],
          ahead: Array.from({ length: 40 }, (_, k) => {
            const p = ring(k);
            return { lat: (Math.asin(p[2] / r) * 180) / Math.PI, lon: (Math.atan2(p[1], p[0]) * 180) / Math.PI, t: k * 116 };
          }),
          flight: { pitch: 0, bank: 0, hdg: 0.8 },
          auto: {
            mode: "rocket",
            assist: "realistic",
            alt: null,
            hdg: null,
            spd: null,
            ab: false,
            lnav: false,
            vnav: false,
            auto: "dock",
            hold: "target",
            sas: true,
            order: "",
            hub: null,
          },
          orbit: { pe: 418, ap: 423, inc: 51.6, ecc: 0.0004, period: 5560, tPe: 1200, tAp: 4000, radius: 6378, a: r },
          next: null,
          warn: cooper.failures.length ? ["RCS"] : [],
          caps: { on: true, fam: ["space"] },
          craft: { id: "ranger", kind: "spacecraft", name: "Ranger", lands: true, ring: false },
          state: { body: "earth", r: rr, v: vv, mu: MU_E, radius: R_E, soi: 924_000 },
          att: { nose: [vv[0] / v, vv[1] / v, vv[2] / v], up: [rr[0] / r, rr[1] / r, rr[2] / r] },
          nodes: cooper.nodeIn > t ? [{ in: cooper.nodeIn - t, dv: [12, 0, 0], role: "mcc" }] : [],
          budget: { dv: 1480, prop: 0.62 },
          target: { id: "iss", name: cooper.target || "ISS", dist: along, rate: 0.18, ca: 0, caIn: along / 0.18 },
          dock: {
            target: "ISS",
            port: "IDA-2 · Harmony avant",
            range: Math.hypot(along, 1.1),
            along,
            latX: 0.6 * Math.sin(t / 7),
            latY: -0.4 * Math.cos(t / 9),
            closing: along > 30 ? 0.2 : 0.06,
            latRate: 0.01,
            angle: 1.2,
            spin: 0.05,
            docked: false,
            phase: along > 220 ? "WAYPOINT 1 · APPROCHE" : along > 20 ? "WAYPOINT 2 · APPROCHE" : "CAPTURE",
          },
          sysx: cooper.sysx(0.94, 4, 285),
          time: { warp: 1, room: 3600 + t, dtau: 0.9999999993, tau: 3600 + t, met: 7200 + t },
          link: { light: 0.0014, delay: 0.0014, cut: false },
          sun: { lat: -10, lon: 20 },
          ...(heavy
            ? {
                bodies: bodies(t),
                traj: {
                  free: [
                    {
                      body: "earth",
                      pts: Array.from({ length: 49 }, (_, k) => ring(k)),
                      t: Array.from({ length: 49 }, (_, k) => (k / 48) * 5560),
                    },
                  ],
                  plan: [],
                  fate: "continues",
                  hit: "",
                },
              }
            : {}),
        },
      });
    }
    // --- Brand: the Lander, 15 km over the Moon down to the ground at Tranquility in ten minutes, again
    {
      const phase = (t % 600) / 600;
      const h = 15_000 * (1 - phase) ** 1.6;
      const lat = 0.674 + (1 - phase) * 2.5,
        lon = 23.473 - (1 - phase) * 3;
      const rr: V3 = [
        (R_M + h / 1000) * Math.cos(lat * D) * Math.cos(lon * D),
        (R_M + h / 1000) * Math.cos(lat * D) * Math.sin(lon * D),
        (R_M + h / 1000) * Math.sin(lat * D),
      ];
      const vh = 1600 * (1 - phase) ** 1.2;
      brand.net.sendCraft(sample(0, 1, 1, rr.map((x) => x * 1000) as V3, [0, vh, -h / 100]));
      brand.net.event({
        kind: "instruments",
        data: {
          v: 1,
          t,
          body: "moon",
          metrics: { alt: h, speed: vh, vz: -h / 100 - 1, fuel: 0.4 * (1 - phase) + 0.1, tau: 1 },
          geo: { lat, lon, heading: 2.6 },
          radar: null,
          route: [],
          ahead: Array.from({ length: 20 }, (_, k) => ({
            lat: lat - k * 0.12 * (1 - phase),
            lon: lon + k * 0.15 * (1 - phase),
            t: k * 20,
          })),
          flight: { pitch: -0.4 + phase * 0.4, bank: 0, hdg: 2.6, agl: h },
          auto: {
            mode: "rocket",
            assist: "assisted",
            alt: null,
            hdg: null,
            spd: null,
            ab: false,
            lnav: false,
            vnav: false,
            auto: "land",
            hold: "none",
            sas: true,
            order: "",
            hub: null,
          },
          orbit: null,
          next: phase < 0.95 ? { kind: "impact", name: "Tranquillité", in: (600 - (t % 600)) * 0.9 } : null,
          warn: [],
          caps: { on: true, fam: ["space"] },
          craft: {
            id: "lander",
            kind: "spacecraft",
            name: "Lander",
            lands: true,
            ring: false,
            status: phase < 0.995 ? "suborbital" : "landed",
            where: "moon",
          },
          // (the descent block: its height, its rates, the landing flown, the point and its reach)
          desc: {
            agl: Math.round(h),
            vz: Math.round((-h / 100 - 1) * 10) / 10,
            vh: Math.round(vh * 10) / 10,
            hover: false,
            auto: "land",
            ttg: Math.round(h / (h / 100 + 1)),
            lpd: { dist: Math.round(Math.max(h * 1.3, 50)), reach: Math.round(Math.max(250, h)) },
          },
          state: { body: "moon", r: rr, v: [0, vh / 1000, -h / 1e5], mu: MU_M, radius: R_M, soi: 66_000 },
          budget: { dv: Math.round(900 * (1 - phase) + 200), prop: 0.4 * (1 - phase) + 0.1 },
          land: { body: "moon", name: "Tranquillité", lat: 0.674, lon: 23.473, moved: false },
          sysx: brand.sysx(0.81, 2, 120),
          time: { warp: 1, room: 3600 + t, dtau: 1, tau: 3600 + t, met: 3 * 86400 + 4 * 3600 + t },
          link: { light: 1.28, delay: 1.28, cut: false },
          sun: { lat: 1, lon: 40 },
          ...(heavy ? { bodies: bodies(t) } : {}),
        },
      });
    }
    // --- Romilly: the Endurance, 12 M from Gargantua, the Ranger at its fore hub, its ring at 5 rpm
    {
      const a = t * 0.02;
      const craft: V3 = [12 * Math.cos(a), 12 * Math.sin(a), 0.1];
      romilly.net.sendCraft(sample(2, 0, 2, craft, [-Math.sin(a), Math.cos(a), 0]));
      romilly.net.event({
        kind: "instruments",
        data: {
          v: 1,
          t,
          body: "gargantua",
          metrics: { speed: 0.31 * 299_792_458, tau: 0.62 },
          geo: null,
          radar: null,
          route: [],
          ahead: [],
          caps: { on: true, fam: ["space"] },
          craft: { id: "endurance", kind: "spacecraft", name: "Endurance", lands: false, ring: true, status: "bound", where: "gargantua" },
          kerr: { r: 12, E: 0.93, L: 3.4 },
          ring: { rpm: romilly.ringRpm, g: (romilly.ringRpm / 5) ** 2 * 0.84 },
          ports: [
            { name: "moyeu avant", docked: "Ranger" },
            { name: "moyeu arrière", docked: "" },
          ],
          sysx: romilly.sysx(0.99, 12, (8000 / 0.84 / 12) * 24),
          time: {
            warp: 1,
            room: 86400 * 23 * 365 + t,
            dtau: 0.62,
            tau: 86400 * 2 + t * 0.62,
            met: 86400 * 2 + t,
            since: Math.round((86400 * 2) / 0.62 + t),
            lag: Math.round((86400 * 2) / 0.62 - 86400 * 2 + t * 0.38),
          },
          link: { light: 0, cut: true },
          ...(heavy
            ? {
                hole: {
                  spin: 0.999,
                  bodies: [
                    { id: "gargantua", r: [0, 0, 0], radius: 0, orbit: 0 },
                    { id: "miller", r: [10 * Math.cos(2.55 + t * 0.03), 10 * Math.sin(2.55 + t * 0.03), 0], radius: 3e-5, orbit: 10 },
                    { id: "mann", r: [40 * Math.cos(0.72 + t * 0.004), 40 * Math.sin(0.72 + t * 0.004), 0], radius: 3e-5, orbit: 40 },
                    { id: "mouth", r: [300 * Math.cos(5.72), 300 * Math.sin(5.72), 0], radius: 0.05, orbit: 300 },
                  ],
                  craft,
                  path: Array.from({ length: 48 }, (_, k) => [12 * Math.cos(a + k * 0.13), 12 * Math.sin(a + k * 0.13), 0.1]),
                  fate: "continues",
                },
              }
            : {}),
        },
      });
    }
  }, 250);
  return { cooper, brand, romilly };
}
