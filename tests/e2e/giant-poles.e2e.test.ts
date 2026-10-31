import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { presets } from "../../src/settings";
import { ourState } from "../../src/system/our-side";
import { SOLAR_BODIES, spinVector } from "../../src/system/solar";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

// The giants' flattened poles seen from 4 radii (PLAN-PLANETES-AAA P11 D6; the pitfall Alex's project met: a hydrogen haze
// left on the mean radius's sphere drew a band over the flattened poles, seen from a few radii). Saturn (f = 0.098) and
// Jupiter (0.065), each from 4 equatorial radii in its equator's plane, the Sun behind the camera, the HUD hidden. Measured
// on the image: the limb along rays from the disc's centre — its outline's axes ratio the figure's (the limb's tangents from
// the eye: tan θ ∝ the semi-axis, so b / a exactly, in the equator's plane) —, and the light past the limb over each pole
// against the same past the limb at ±25° (no band: the poles' glow no brighter, no wider).
// Duration: ~1 min on this Mac
// Done when: both giants measured.

const OUT = "remote-results/giant-poles";
afterAll(stopServer);

const GIANTS = [
  { id: "saturn", scene: "Saturn: the rings from above", a: 60268, b: 54364 },
  { id: "jupiter", scene: "Jupiter: from orbit", a: 71492, b: 66854 },
];

/** the Sun's latitude over a body's equator at t [°] */
function sunLat(id: string, t: number) {
  const B = ourState(id, t).pos,
    S = ourState("sun", t).pos;
  const d = [S[0] - B[0], S[1] - B[1], S[2] - B[2]];
  const w = spinVector(SOLAR_BODIES.find((x) => x.id === id)!, t);
  const k = (d[0]! * w[0] + d[1]! * w[1] + d[2]! * w[2]) / Math.hypot(...d) / Math.hypot(...w);
  return (Math.asin(k) * 180) / Math.PI;
}

/** the disc on a capture: its centre, the limb along rays, the light past it */
function measure(file: string, png: Uint8Array) {
  const P = readPng(png);
  const { width: W, height: H } = P;
  const L = (x: number, y: number) => {
    const i = (Math.round(y) * W + Math.round(x)) * P.channels;
    return x < 0 || y < 0 || x >= W - 0.5 || y >= H - 0.5 ? 0 : 0.2126 * P.data[i]! + 0.7152 * P.data[i + 1]! + 0.0722 * P.data[i + 2]!;
  };
  // (the centre: the brightest run's middle on rows and on the column — refined twice)
  // (lit: over 40 % of the disc's light — the median of a grid about the image's middle: a ring's shadow or line across it
  // not taken for the disc's light —; the halo about an overexposed disc not taken for it)
  const grid: number[] = [];
  for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) grid.push(L(W / 2 + i * 12, H / 2 + j * 12));
  const mid = grid.sort((p, q) => p - q)[grid.length >> 1]!;
  // (the disc along a line: from the first to the last run of 15 lit pixels — a star is shorter, a dark band across the
  // disc (the rings' shadow, their line seen edge-on) inside it)
  const run = (n: number, at: (k: number) => number) => {
    let first = -1,
      last = -1,
      s = -1;
    for (let k = 0; k <= n; k++) {
      const on = k < n && at(k) > 0.4 * mid;
      if (on && s < 0) s = k;
      if (!on && s >= 0) {
        if (k - s >= 15) {
          if (first < 0) first = s;
          last = k - 1;
        }
        s = -1;
      }
    }
    return [first, last] as [number, number];
  };
  let cx = W / 2,
    cy = H / 2;
  for (let i = 0; i < 3; i++) {
    const c = run(H, (y) => L(cx, y));
    cy = (c[0] + c[1]) / 2;
    const r = run(W, (x) => L(x, cy - 0.3 * (c[1] - c[0]) * 0.5));
    cx = (r[0] + r[1]) / 2;
  }
  // (along a ray from the centre: the limb where the light falls under 40 % of the disc's inside on that ray, found from
  // inside out — the stars beyond never taken for it)
  const ray = (deg: number) => {
    const ux = Math.cos((deg * Math.PI) / 180),
      uy = -Math.sin((deg * Math.PI) / 180);
    const v = Array.from({ length: 900 }, (_, r) => L(cx + ux * r, cy + uy * r));
    return v;
  };
  const limbOf = (v: number[], r0: number) => {
    const inside = [...v.slice(Math.round(0.55 * r0), Math.round(0.85 * r0))].sort((p, q) => p - q);
    const ref = inside[Math.floor(inside.length / 2)]!;
    let r = Math.round(0.85 * r0);
    while (r < v.length - 2 && v[r + 1]! > 0.4 * ref) r++;
    // (sub-pixel: where it crosses 40 %)
    const a = v[r]!,
      b = v[r + 1]!;
    return r + (a - 0.4 * ref) / Math.max(a - b, 1e-6);
  };
  const r0 = (run(H, (y) => L(cx, y))[1] - run(H, (y) => L(cx, y))[0]) / 2;
  const lim: Record<number, number> = {};
  for (const deg of [90, 270, 25, 155, 205, 335, 60, 120, 240, 300]) lim[deg] = limbOf(ray(deg), r0);
  // (the axes: the poles' distance, the equator's from the rays' points on x²/A² + y²/B² = 1, B fixed)
  const B = (lim[90]! + lim[270]!) / 2;
  const As = [25, 155, 205, 335, 60, 120, 240, 300].map((d) => {
    const r = lim[d]!,
      x = r * Math.cos((d * Math.PI) / 180),
      y = r * Math.sin((d * Math.PI) / 180);
    return Math.abs(x) / Math.sqrt(Math.max(1 - (y / B) ** 2, 1e-6));
  });
  const A = As.reduce((s, x) => s + x, 0) / As.length;
  // (past the limb: the mean light over the sky's, from 4 px out to 7 % of the radius — where a band on the mean sphere
  // would be —, and how far it stays 6 over the sky)
  const past = (deg: number) => {
    const v = ray(deg),
      l = lim[deg]!;
    const far = [...v.slice(Math.round(l + 0.25 * A), Math.round(l + 0.4 * A))].sort((p, q) => p - q);
    const sky = far[Math.floor(far.length / 2)]!;
    const w = v.slice(Math.round(l + 4), Math.round(l + 0.07 * A));
    const excess = w.reduce((s, x) => s + x, 0) / w.length - sky;
    let reach = 0;
    for (let r = Math.ceil(l); r < l + 0.12 * A; r++) if (v[r]! > sky + 6) reach = r - l;
    return { excess, reach, sky };
  };
  const glow = Object.fromEntries([90, 270, 25, 155, 205, 335].map((d) => [d, past(d)]));
  console.log(
    `  ${file}: centre ${cx.toFixed(1)}, ${cy.toFixed(1)} · A ${A.toFixed(1)} px (${As.map((x) => x.toFixed(1)).join(" ")}) · B ${B.toFixed(1)} · B/A ${(B / A).toFixed(4)}`,
  );
  for (const [d, g] of Object.entries(glow))
    console.log(
      `    ${d}°: limb ${lim[Number(d)]!.toFixed(1)} px · past it +${g.excess.toFixed(1)} over the sky (${g.sky}) · reach ${g.reach.toFixed(0)} px`,
    );
  return { A, B, glow };
}

test.skipIf(!E2E)(
  "Saturn's and Jupiter's flattened poles from 4 radii: the limb on their figure, no haze band over the poles",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Saturn: the rings from above")}` });
    try {
      for (const g of GIANTS) {
        const t = presets[g.scene]!.time!;
        // (in the equator's plane: the Sun's latitude taken off the phase's; 4 equatorial radii from the centre)
        const pose = `{ body: "${g.id}", altKm: ${3 * g.a}, phase: 0, at: [${-sunLat(g.id, t)}, 0], look: "${g.id}" }`;
        await app.js(`(() => { __bh.presets.zzp = { ...__bh.presets[${JSON.stringify(g.scene)}], ship: false, fov: 40, pose: ${pose} };
          __bh.game.preset("zzp"); Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9 }); return 1; })()`);
        await app.settled();
        // (the exposure settled on this view)
        await app.js(`new Promise((r) => setTimeout(r, 6000))`);
        // (the HUD hidden: the view's canvas alone)
        await app.js(`(() => { let s = document.getElementById("zz-clean"); if (!s) { s = document.createElement("style"); s.id = "zz-clean";
          s.textContent = "body * { visibility: hidden !important } canvas#view { visibility: visible !important }"; document.head.append(s); } return 1; })()`);
        const file = `${OUT}/${g.id}-4radii.png`;
        await app.shot(file);
        const m = measure(file, new Uint8Array(await Bun.file(file).arrayBuffer()));
        // (the outline on the figure: b / a to 0.005 — 2 px of the ~415 px radius)
        expect(Math.abs(m.B / m.A - g.b / g.a)).toBeLessThan(0.005);
        // (no band over the poles: their light past the limb no more than the ±25° rays' — the bloom of the disc, the Milky
        // Way behind — and a margin; a haze on the mean sphere would lie in this window, 3 to 7 % of the radius out)
        const side = Math.max(...[25, 155, 205, 335].map((d) => m.glow[d]!.excess));
        for (const d of [90, 270]) expect(m.glow[d]!.excess).toBeLessThan(1.3 * side + 4);
        await app.js(`(() => { document.getElementById("zz-clean")?.remove(); return 1; })()`);
      }
    } finally {
      app.close();
    }
  },
  600_000,
);
