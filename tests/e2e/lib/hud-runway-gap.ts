// The HUD's runway outline against the runway drawn (Sam, 16 Nov 2026: « la piste du HUD n'est pas alignée avec la vraie piste »):
// the outline is controller/lowthrust.ts runwayView's — its site's threshold, its heading `site.rwy`, its level `runwayLevel`, its
// corners (`runwayCache.geo`); the runway drawn and levelled is game/sites.ts EARTH_RUNWAYS' frame (`__bh.sys.runways()`: the
// game's sites', the world's near the eye). Each corner of the outline set against the same corner of the drawn strip (the
// strip's level the ground drawn there, `__bh.sys.groundAt`), on the WGS84 ellipsoid (body-fixed metres): the gap along,
// across and up, and the angle it makes at the eye. The airport's other runways (AP7a, `others`) the same.

export interface RunwayGap {
  name: string;
  /** the drawn frame matched (its site's name and heading), or null: none drawn there (then only `upOnly`: the outline's worst
   *  corner's ground less its height [m], `hT` its level, `worstDeg` that gap at the eye) */
  drawn: string | null;
  upOnly?: number;
  hT?: number;
  /** the outline's heading less the drawn strip's [°] */
  hdg: number;
  /** at the outline's threshold, then at its far end: the drawn strip's corner less the outline's, across [m, + right], along, up */
  thr: { across: number; along: number; up: number };
  far: { across: number; along: number; up: number };
  /** the worst corner's gap seen from the eye [°], and the eye's distance to that corner [m] */
  worstDeg: number;
  dist: number;
  /** the outline's half width and length against the strip's [m] */
  hw: [number, number];
  len: [number, number];
}

/** In the page: the gaps of the runway in view and its airport's others (an expression → RunwayGap[] | null). */
export const HUD_RUNWAY_GAP_JS = `(() => {
  const c = __bh.camera; c.runwayCache = null; const v = c.runwayView(); const G = c.runwayCache?.geo;
  if (!v || !G) return null;
  const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), R = Math.PI / 180;
  const cart = (la, lo, h) => { la *= R; lo *= R; const s = Math.sin(la), N = A / Math.sqrt(1 - E2 * s * s);
    return [(N + h) * Math.cos(la) * Math.cos(lo), (N + h) * Math.cos(la) * Math.sin(lo), (N * (1 - E2) + h) * s]; };
  const geo = (q) => { const p = Math.hypot(q[0], q[1]); let la = Math.atan2(q[2], p * (1 - E2));
    for (let i = 0; i < 5; i++) { const s = Math.sin(la), N = A / Math.sqrt(1 - E2 * s * s); la = Math.atan2(q[2] + E2 * N * s, p); }
    const s = Math.sin(la), N = A / Math.sqrt(1 - E2 * s * s);
    return { lat: la / R, lon: Math.atan2(q[1], q[0]) / R, h: p / Math.cos(la) - N }; };
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const up = (la, lo) => [Math.cos(la * R) * Math.cos(lo * R), Math.cos(la * R) * Math.sin(lo * R), Math.sin(la * R)];
  const north = (la, lo) => [-Math.sin(la * R) * Math.cos(lo * R), -Math.sin(la * R) * Math.sin(lo * R), Math.cos(la * R)];
  const east = (lo) => [-Math.sin(lo * R), Math.cos(lo * R), 0];
  const g = __bh.sys.geodetic(); const eye = g ? cart(g.lat, g.lon, g.altM) : null;
  const frames = __bh.sys.runways();
  const one = (site, hT, corners) => {
    // (the outline as runwayAxes sets it: the threshold on the ellipsoid lifted hT along its geodetic normal, the heading in its plane)
    const tu = up(site.lat, site.lon), T = add(cart(site.lat, site.lon, 0), tu, hT);
    const h = (site.rwy ?? 0) * R, al = add(north(site.lat, site.lon).map((x) => x * Math.cos(h)), east(site.lon), Math.sin(h)), rg = cross(al, tu);
    const at = (q) => add(add(add(T, al, q[0]), rg, q[1]), tu, q[2]);
    // (the drawn strip: the frame whose axis carries this threshold, either way)
    const q0 = cart(site.lat, site.lon, 0);
    let best = null;
    for (const f of frames) {
      const d = sub(q0, f.origin), a = dot(d, f.along), x = dot(d, f.across), co = dot(al, f.along);
      if (Math.abs(co) < 0.98 || a < -400 || a > f.len + 400 || Math.abs(x) > 200) continue;
      if (!best || Math.abs(x) < Math.abs(best.x)) best = { f, rev: co < 0, x };
    }
    const name = site.des?.[0] ?? String(Math.round(site.rwy / 10));
    if (!best) {
      // (no strip of ours there — a game site's other runway, the photograph's alone —: its corners' height against the ground drawn)
      let worstUp = 0, worstDeg = 0, dist = 0;
      for (const q of corners) { const P = at(q), gg = geo(P), e = __bh.sys.groundAt(gg.lat, gg.lon) - gg.h;
        if (Math.abs(e) > Math.abs(worstUp)) worstUp = e;
        if (eye) { const L = Math.hypot(...sub(P, eye)), ang = Math.atan2(Math.abs(e), L) / R; if (ang > worstDeg) { worstDeg = ang; dist = L; } } }
      return { name: v.name + " " + name, drawn: null, hT: Math.round(hT * 10) / 10, upOnly: Math.round(worstUp * 10) / 10, worstDeg: Math.round(worstDeg * 1000) / 1000, dist: Math.round(dist) };
    }
    const f = best.f, s = best.rev ? -1 : 1;
    const len = Math.max(...corners.map((q) => q[0])), hw = Math.max(...corners.map((q) => Math.abs(q[1])));
    // (the drawn corner at the outline's own place along and across: the strip's frame, the ground drawn there)
    const drawnAt = (q) => { const a = best.rev ? f.len - q[0] : q[0], x = s * q[1];
      const p0 = add(add(f.origin, f.along, a), f.across, x), gg = geo(p0), gr = __bh.sys.groundAt(gg.lat, gg.lon);
      return add(p0, up(gg.lat, gg.lon), gr); };
    const gap = (q) => { const P = at(q), Q = drawnAt(q), e = sub(Q, P);
      return { e, P, across: dot(e, rg), along: dot(e, al), up: dot(e, tu) }; };
    let worst = 0, dist = 0;
    for (const q of corners) { const r = gap(q); if (!eye) continue; const l = sub(r.P, eye), L = Math.hypot(...l);
      const perp = sub(r.e, l.map((x) => (x * dot(r.e, l)) / (L * L))); const ang = Math.atan2(Math.hypot(...perp), L) / R;
      if (ang > worst) { worst = ang; dist = L; } }
    const t0 = gap([0, 0, 0]), t1 = gap([len, 0, 0]);
    const fh = Math.atan2(dot(f.along, east(site.lon)), dot(f.along, north(site.lat, site.lon))) / R + (best.rev ? 180 : 0);
    const r1 = (x) => Math.round(x * 10) / 10;
    return { name: v.name + " " + name, drawn: (f.site?.name ?? "?") + " " + (f.site?.des?.[0] ?? "") + (f.world ? " (world)" : " (site)"),
      hdg: Math.round(((((site.rwy - fh) % 360) + 540) % 360 - 180) * 1000) / 1000,
      thr: { across: r1(t0.across), along: r1(t0.along), up: r1(t0.up) }, far: { across: r1(t1.across), along: r1(t1.along), up: r1(t1.up) },
      worstDeg: Math.round(worst * 1000) / 1000, dist: Math.round(dist), hw: [r1(hw), r1(f.halfWidth)], len: [Math.round(len), Math.round(f.len)] };
  };
  const out = [one(G.site, G.hT, G.corners)];
  for (const o of G.others ?? []) out.push(one(o.site, o.hT, o.corners));
  return out; })()`;
