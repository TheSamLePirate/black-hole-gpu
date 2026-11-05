import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// T7/T8 — the relief over the sea and near the ground while it streams in, in flight (Sam, 5 Nov 2026: « des parties sol qui
// ne devraient pas exister en mer, là où ce n'est pas chargé ou à un niveau de détail faible ; le relief de qualité max se
// charge trop tard près du sol et des collines »). The F-35 flown live along coasts, 1–2 km off them at 300 m, the look
// turned towards them, each site cold for its own tiles: the Calanques, Nice, Dubrovnik (no national relief), Santorini's
// caldera, the Lofoten. Every CF_EVERY ms for CF_FOR s a shot pair — the image and the water's cover by kind
// (liteSkip 512: red the sea; what is not red is land) — and the relief's state: tiles pending, the finest level, the view's
// quality (a fan of 384 rays over the ground ahead, each the level its footprint wants against the finest drawn there,
// 2^(drawn − wanted), their mean: 1 = the relief at its best everywhere — tile-arrival's measure, from the craft's place).
//   CF_SITES: lat,lon,heading,agl[,yaw];… (the five when unset) · CF_OUT · CF_EVERY · CF_FOR
// Output: remote-results/coast-flight/<site>-NN.png, -NN-w.png, series.json.
// Done when: each site flown CF_FOR s with its shots and measures, no GPU error. Duration: ~1 min a site.
const OUT = process.env.CF_OUT ?? "remote-results/coast-flight";
const EVERY = Number(process.env.CF_EVERY ?? 2500);
const FOR = Number(process.env.CF_FOR ?? 30);
// (flown along the coast, 1–2 km off it, the look turned towards it (yaw, degrees): its rocks, cliffs and islands in view at
// 1–5 km while their tiles come)
const SITES: { name: string; at: [number, number, number, number]; yaw: number }[] = process.env.CF_SITES
  ? process.env.CF_SITES.split(";").map((s, i) => {
      const v = s.split(",").map(Number);
      return { name: `s${i}`, at: [v[0], v[1], v[2], v[3]] as [number, number, number, number], yaw: v[4] ?? 0 };
    })
  : [
      { name: "calanques", at: [43.193, 5.37, 100, 300], yaw: -30 },
      { name: "nice", at: [43.665, 7.2, 75, 300], yaw: -30 },
      { name: "dubrovnik", at: [42.625, 18.06, 125, 300], yaw: -30 },
      { name: "santorini", at: [36.39, 25.39, 10, 300], yaw: 25 },
      { name: "lofoten", at: [68.09, 13.48, 60, 300], yaw: -30 },
    ];
afterAll(stopServer);

const QUALITY = `(() => {
  const t = __bh.renderer.earthTiles, g = __bh.camera.geoNow(), G = __bh.sys.geodetic();
  if (!g || !G) return null;
  const R = 6378137, TAU = 2 * Math.PI, head = g.track;
  const H = Math.max(G.altM - __bh.sys.groundAt(g.lat, g.lon), 20);
  const vf = ((__bh.settings.fov ?? 60) * Math.PI) / 180, hf = 2 * Math.atan((Math.tan(vf / 2) * innerWidth) / innerHeight);
  const pix = (2 * Math.tan(vf / 2)) / innerHeight;
  const merc = (sl, n) => (0.5 - Math.atanh(Math.min(Math.max(sl, -0.999999), 0.999999)) / TAU) * n;
  const inR = (r, x, y) => !!r && x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
  let qs = 0, qn = 0, worst = 1, is = 0, near = 0, nn = 0;
  // (the ideal: the level the footprint asks there whatever the windows — up to z 17 over the IGN's France, z 14 elsewhere)
  const zMax = t.nationalAt === "ign" ? 17 : 14;
  for (let i = 0; i < 24; i++) for (let j = 1; j <= 16; j++) {
    const az = head + ((i + 0.5) / 24 - 0.5) * hf;
    const dep = Math.atan((j / 16) * Math.tan(vf / 2)) + (6 * Math.PI) / 180;
    const d = Math.min(H / Math.tan(dep), 60000);
    const foot = (d * pix) / Math.sin(dep);
    const lat = (g.lat * Math.PI) / 180 + (d * Math.cos(az)) / R, lon = (g.lon * Math.PI) / 180 + (d * Math.sin(az)) / (R * Math.cos((g.lat * Math.PI) / 180));
    const zf = Math.log2((TAU * R * Math.cos(lat)) / (256 * foot));
    let want = 5, have = 5;
    for (const L of t.levels) {
      if (L.z > zf + 1) continue;
      const x = (lon / TAU + 0.5) * L.n, y = merc(Math.sin(lat), L.n);
      if (L.want && inR(L.want, x, y)) want = Math.max(want, L.z);
      if (L.valid && inR(L.valid, x, y)) have = Math.max(have, L.z);
    }
    const q = Math.min(1, 2 ** (have - want));
    qs += q; qn++; worst = Math.min(worst, q);
    const qi = Math.min(1, 2 ** (have - Math.min(Math.floor(zf + 0.5), zMax)));
    is += qi;
    if (d < 1500) { near += qi; nn++; }
  }
  return { q: +(qs / qn).toFixed(3), worst: +worst.toFixed(3), ideal: +(is / qn).toFixed(3), near: nn ? +(near / nn).toFixed(3) : null, pending: t.pending, photos: t.orthoPending, finest: t.finest, agl: Math.round(H), lat: +g.lat.toFixed(4), lon: +g.lon.toFixed(4) };
})()`;

// (CF_PROBE=1: the tiles' raw heights over a fan ahead and to the left — 300 m to 2.5 km, the heading −80° … +20° —, each
// point's finest drawn level, its height there and whether the slot holds that tile (its key): kept every step, compared at
// the end with the same points' final heights — a point shown 50 m and more over its final height said, with its level)
const PROBE = `((lat0, lon0, hdg) => {
  const t = __bh.renderer.earthTiles, TAU = 2 * Math.PI, R = 6378137, D = Math.PI / 180, out = [];
  const merc = (sl, n) => (0.5 - Math.atanh(Math.min(Math.max(sl, -0.999999), 0.999999)) / TAU) * n;
  const inR = (r, x, y) => !!r && x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
  for (let b = -80; b <= 20; b += 4) for (let d = 300; d <= 2500; d += 100) {
    const az = (hdg + b) * D, lat = lat0 * D + (d * Math.cos(az)) / R, lon = lon0 * D + (d * Math.sin(az)) / (R * Math.cos(lat0 * D));
    let hit = null;
    for (let k = t.levels.length - 1; k >= 0 && !hit; k--) {
      const L = t.levels[k];
      const x = (lon / TAU + 0.5) * L.n, y = merc(Math.sin(lat), L.n);
      if (!inR(L.valid, x, y)) continue;
      const tx = Math.floor(x), ty = Math.floor(y), s = t.slotOf(L, tx, ty), dd = L.data[s];
      if (!dd) continue;
      const px = Math.min(255, Math.floor((x - tx) * 256)), py = Math.min(255, Math.floor((y - ty) * 256));
      hit = [L.z, Math.round(dd[py * 256 + px]), L.key[s] === t.keyOf(L, tx, ty) ? 1 : 0];
    }
    out.push(hit ?? [0, 0, 1]);
  }
  return out;
})`;

test.skipIf(!E2E)(
  "T7/T8: the relief over the sea and near the ground while it streams in — the F-35 flown live along five coasts",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    const pair = async (f: string) => {
      const a = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
      await Bun.write(`${f}.jpg`, Buffer.from(a.data, "base64"));
      await app.js(`new Promise((q) => { __bh.renderer.liteSkip = 512; requestAnimationFrame(() => requestAnimationFrame(() => q(1))); })`);
      const b = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
      await Bun.write(`${f}-w.jpg`, Buffer.from(b.data, "base64"));
      await app.js(`(__bh.renderer.liteSkip = 0, 1)`);
    };
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", f35Invulnerable: true, f35AutoProtect: true, motionBlur: 0, dof: false, traffic: false }); return 1; })()`,
      );
      await app.waitProgress(`__bh.fleet.active === "f35"`, "the F-35");
      for (const s of SITES) {
        const [lat, lon, hdg, agl] = [s.at[0], s.at[1], s.at[2], s.at[3]];
        // (13 h solar there, the 5th of November)
        const utc = new Date(Date.UTC(2026, 10, 5) + (13 - lon / 15) * 3600e3).toISOString();
        await app.js(`(() => { __bh.freeze(false); __bh.game.setDate(${JSON.stringify(utc)}); __bh.game.set("weather", "fair");
          __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, 150); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`);
        // (no autopilot — it turned every flight to the north-east: the jet as put, gently settling)
        await app.js(`new Promise((q) => setTimeout(() => { __bh.camera.setLook(${s.yaw}, -6); q(1); }, 600))`);
        const series: unknown[] = [];
        const probes: { t: number; lat: number; lon: number; at: number[][] }[] = [];
        const t0 = Date.now();
        for (let i = 0; Date.now() - t0 < FOR * 1000; i++) {
          const t = +((Date.now() - t0) / 1000).toFixed(1);
          await pair(`${OUT}/${s.name}-${String(i).padStart(2, "0")}`);
          const m = await app.js<Record<string, unknown> | null>(QUALITY);
          if (process.env.CF_PROBE === "1" && m)
            probes.push({
              t,
              lat: m.lat as number,
              lon: m.lon as number,
              at: await app.js<number[][]>(`${PROBE}(${m.lat}, ${m.lon}, ${s.at[2]})`),
            });
          series.push({ i, t, ...m });
          console.log(`  ${s.name} ${t}s: ${JSON.stringify(m)}`);
          await Bun.sleep(EVERY);
        }
        // (the probe: each step's points again at the end, from the same place — the tiles all in by then or nearly)
        if (probes.length) {
          await app.settled(60_000).catch(() => {});
          const bad: unknown[] = [];
          for (const P of probes) {
            const fin = await app.js<number[][]>(`${PROBE}(${P.lat}, ${P.lon}, ${s.at[2]})`);
            P.at.forEach((v, k) => {
              const f = fin[k]!;
              if (v[1]! - f[1]! > 50) bad.push({ t: P.t, k, z: v[0], h: v[1], keyOk: v[2], zEnd: f[0], hEnd: f[1] });
            });
          }
          console.log(`  ${s.name} probe: ${bad.length} points shown 50 m over their end — ${JSON.stringify(bad.slice(0, 12))}`);
          await Bun.write(`${OUT}/${s.name}-probe.json`, JSON.stringify({ probes, bad }));
        }
        out[s.name] = { at: s.at, utc, series };
      }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/series.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  12 * 60_000,
);
