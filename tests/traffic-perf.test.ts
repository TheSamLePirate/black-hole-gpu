import { afterEach, describe, expect, test } from "bun:test";
import { TrafficFeed, type Plane, type Ship } from "../src/traffic/feed";
import { TrafficFocus } from "../src/traffic/focus";
import { overPlace, resetFlights } from "./helpers/flight";

// The traffic's CPU cost a frame (Sam, 24 Nov 2026: the traffic always on — the free camera with no craft too): a busy
// sky and sea — 200 aircraft and 200 ships within 100 km of a free camera over the bay, each with five minutes of reports
// — drawn a minute behind (the default delay, on their fitted paths): what the page spends each frame on them (their
// places — controller/traffic.ts trafficNow, seatraffic.ts seaNow —, the renderer's meshes, the overlay's labels and
// lights, the wakes), the first frame (every path fitted) apart. A bun-side measure (this machine's CPU, no GPU, no
// page): the figures printed; the bound only catches a regression by an order of magnitude.

afterEach(resetFlights);

const D = Math.PI / 180;
const SFO = { lat: 37.62, lon: -122.38 };
const N = Number(process.env.TRAFFIC_N ?? 200);

/** a seeded random in [0, 1) */
function rnd(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function busySky(now: number) {
  const r = rnd(7);
  const F = new TrafficFeed(
    () => "",
    async () => new Response("{}"),
    () => false,
  );
  for (let i = 0; i < N; i++) {
    const lat0 = SFO.lat + (r() - 0.5) * 1.6,
      lon0 = SFO.lon + (r() - 0.5) * 2;
    const trk = r() * 360,
      gs = 70 + r() * 180,
      alt = 300 + r() * 11_000,
      vs = (r() - 0.5) * 10,
      every = 5 + r() * 10;
    const hist: Plane[] = [];
    for (let t = now - 300; t <= now; t += every) {
      const d = gs * (t - now);
      hist.push({
        id: `p${i.toString(16).padStart(4, "0")}`,
        cs: `TST${i}`,
        reg: `N${i}TS`,
        type: ["A320", "B738", "B77W", "CRJ9", "E75L", "C172"][i % 6]!,
        cat: "A3",
        lat: lat0 + (d * Math.cos(trk * D)) / 111_195,
        lon: lon0 + (d * Math.sin(trk * D)) / (111_195 * Math.cos(lat0 * D)),
        alt: alt + vs * (t - now),
        gs,
        trk,
        hdg: null,
        vs,
        roll: null,
        gnd: false,
        t,
        src: "adsb.lol",
      });
    }
    F.planes.set(hist[0]!.id, { p: hist.at(-1)!, prev: hist.at(-2) ?? null, hist, heard: now });
  }
  for (let i = 0; i < N; i++) {
    const lat0 = SFO.lat + (r() - 0.5) * 0.8,
      lon0 = SFO.lon - 0.3 - r() * 0.7;
    const cog = r() * 360,
      sog = r() < 0.2 ? 0 : 2 + r() * 9;
    const hist: Ship[] = [];
    for (let t = now - 600; t <= now; t += 20 + r() * 40) {
      const d = sog * (t - now);
      hist.push({
        mmsi: 366_000_000 + i,
        name: `SHIP ${i}`,
        type: [70, 80, 60, 30, 36][i % 5]!,
        len: 20 + r() * 280,
        beam: 6 + r() * 40,
        dest: "",
        lat: lat0 + (d * Math.cos(cog * D)) / 111_195,
        lon: lon0 + (d * Math.sin(cog * D)) / (111_195 * Math.cos(lat0 * D)),
        sog,
        cog,
        hdg: cog,
        t,
      } as Ship);
    }
    F.ships.set(366_000_000 + i, { s: hist.at(-1)!, hist, heard: now });
  }
  return F;
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { med: s[s.length >> 1]!, p95: s[Math.floor(s.length * 0.95)]!, max: s.at(-1)! };
};

describe("the traffic's cost a frame", () => {
  test(`${N} aircraft and ${N} ships about a free camera with no craft, a minute behind`, () => {
    const { c } = overPlace("earth", SFO.lat, SFO.lon, 0.6, true);
    c.setPilot(false);
    const t0 = 1_800_000_000;
    let now = t0;
    c.trafficClock = () => now;
    c.s.trafficDelay = 60;
    c.traffic = busySky(t0);
    const F = new TrafficFocus();
    const f = F.update({ on: true, craft: null, view: c.viewController().geoNow() })!;
    c.trafficAt = { ...F.here!, airR: f.airR };
    const vc = c.viewController();
    const fmtA = (m: number) => `${m.toFixed(0)} m`,
      fmtS = (v: number) => `${v.toFixed(1)} m/s`;
    const frame = () => {
      const a = performance.now();
      const air = c.trafficNow();
      const sea = c.seaNow();
      const b = performance.now();
      const meshes = [...c.trafficShips(vc), ...c.seaShips(vc)];
      const wakes = c.seaWakes(vc);
      const e = performance.now();
      const marks = [...c.trafficOverlay(fmtA, vc), ...c.seaOverlay(fmtS, vc)];
      const g = performance.now();
      return {
        places: b - a,
        draw: e - b,
        overlay: g - e,
        all: g - a,
        n: [air.length, sea.length, meshes.length, wakes.length, marks.length],
      };
    };
    const first = frame();
    const rows: ReturnType<typeof frame>[] = [];
    const batch: number[] = [];
    for (let i = 0; i < 600; i++) {
      now += 1 / 60;
      // (every 15 s the relay's answer: a new report for every aircraft at once — each one's path to fit again)
      if (i % 300 === 150)
        for (const T of c.traffic.planes.values()) {
          const q = { ...T.p, t: T.p.t + 15 };
          T.hist.push(q);
          T.prev = T.p;
          T.p = q;
        }
      rows.push(frame());
      if (i % 300 >= 150 && i % 300 < 160) batch.push(rows.at(-1)!.all);
    }
    const slow = rows.map((x, i) => [i, x.all] as const).filter(([, t]) => t > 8);
    console.log(`  frames over 8 ms: ${slow.map(([i, t]) => `#${i} ${t.toFixed(0)} ms`).join(", ") || "none"}`);
    console.log(`  the 10 frames after a batch of new reports: ${batch.map((t) => t.toFixed(1)).join(" ")} ms`);
    const all = stats(rows.map((x) => x.all));
    const pl = stats(rows.map((x) => x.places)),
      dr = stats(rows.map((x) => x.draw)),
      ov = stats(rows.map((x) => x.overlay));
    const n = rows.at(-1)!.n;
    console.log(
      `  ${n[0]} aircraft, ${n[1]} ships placed; ${n[2]} meshes, ${n[3]} wakes, ${n[4]} marks drawn\n` +
        `  first frame (every path fitted): ${first.all.toFixed(1)} ms\n` +
        `  a frame (600, 1/60 s apart): median ${all.med.toFixed(2)} ms, p95 ${all.p95.toFixed(2)} ms, max ${all.max.toFixed(2)} ms\n` +
        `    places ${pl.med.toFixed(2)} / ${pl.p95.toFixed(2)} ms · meshes+wakes ${dr.med.toFixed(2)} / ${dr.p95.toFixed(2)} ms · ` +
        `overlay ${ov.med.toFixed(2)} / ${ov.p95.toFixed(2)} ms (median / p95)`,
    );
    expect(n[0]).toBe(N);
    expect(n[1]).toBeGreaterThanOrEqual(N);
    expect(all.med).toBeLessThan(20);
  });
});
