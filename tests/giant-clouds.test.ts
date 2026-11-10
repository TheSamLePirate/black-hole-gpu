import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { GALILEO_LAST, giantAirPanel, giantCalls } from "../src/game/craftpanel";
import { cloudNoiseG, GIANT_LAYERS, giantDaylight, giantDeckAt, giantFlashes, GiantThunder } from "../src/system/giant-clouds";
import { unitsOf } from "../src/ui/unitsys";

// The giants' clouds and lightning on the CPU (PLAN-PLANETES-AAA P11 D5): the twin of trace.wgsl's — its decks, its eyes,
// its flashes' constants — held equal to the shader's; the daylight, the panel, the calls, the thunder's ear.

const wgsl = await Bun.file(new URL("../src/shaders/trace.wgsl", import.meta.url)).text();
const fnBody = (name: string) => {
  const i = wgsl.indexOf(`fn ${name}(`);
  return wgsl.slice(i, wgsl.indexOf("\n}\n", i));
};

test("the decks are the shader's (giantLayer): Jupiter's and Saturn's, in their order", () => {
  const body = fnBody("giantLayer");
  const vecs = [...body.matchAll(/vec4f\(([^)]+)\)/g)].map((m) => m[1]!.split(",").map((x) => Number(x.trim())));
  // (select(select(L2, L1, i == 1), L0, i == 0): the text holds each giant's decks bottom first)
  const jup = vecs.slice(0, 3).reverse();
  const sat = vecs.slice(3, 6).reverse();
  for (const [id, v] of [
    ["jupiter", jup],
    ["saturn", sat],
  ] as const)
    GIANT_LAYERS[id].forEach((L, i) => expect([L.c, L.w, L.scale, L.sigma]).toEqual(v[i]!));
});

test("the eyes and the storms are the shader's (giantEye, giantSigma); the flash found on the CPU, its glow the shader's", () => {
  expect(fnBody("giantEye")).toContain("select(0.0166, 0.0175, m == 4u)");
  // (the flashes searched where the shader's storms are: its large noise, its threshold — PLAN-GEANTES-VOLUME V1: the search
  // once a frame here, the brightest flash passed in P.wx[6])
  const sg = fnBody("giantSigmaAt");
  expect(sg).toContain("cloudNoise(pk * (1.0 / 80.0) + vec3f(3.1, 7.7, 1.3))");
  expect(sg).toContain("let rare = select(0.05, 0.0, m == 4u)");
  expect(wgsl).not.toContain("fn giantFlashes(");
  expect(fnBody("giantFlashGlow")).toContain("let GF = vec4f(f, P.wx[6].w);");
  expect(fnBody("giantInside")).toContain("let GFT = giantTurn(P.wx[6].xyz, kv, cv, cz);");
  const renderer = readFileSync(new URL("../src/renderer.ts", import.meta.url), "utf8");
  expect(renderer).toContain("f.set(giantFlash, PARAMS.wx + 6 * 4)");
  expect(renderer).toContain("(time * 4.925490947e-6 * s.massSolar) % 4096");
});

test("the Perlin–Worley on the CPU: within 0…1, varied, wrapped every 32 lattice units", () => {
  const v: number[] = [];
  for (let i = 0; i < 200; i++) v.push(cloudNoiseG(i * 0.37, i * 0.11 + 3, i * 0.23 + 5));
  expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...v)).toBeLessThanOrEqual(1);
  expect(Math.max(...v) - Math.min(...v)).toBeGreaterThan(0.3);
  expect(cloudNoiseG(1.3 + 32, 2.7 - 64, 9.1 + 32)).toBeCloseTo(cloudNoiseG(1.3, 2.7, 9.1), 9);
});

test("the decks and the daylight: dimmer down the column, none by night", () => {
  expect(giantDeckAt("jupiter", 12e3)?.name).toBe("NH₃");
  expect(giantDeckAt("jupiter", -19e3)?.name).toBe("NH₄SH");
  expect(giantDeckAt("jupiter", -35e3)).toBeNull();
  expect(giantDeckAt("saturn", -189e3)?.name).toBe("H₂O");
  let prev = 2;
  for (const h of [60e3, 20e3, 0, -20e3, -50e3, -80e3]) {
    const d = giantDaylight("jupiter", h, 0.8).direct;
    expect(d).toBeLessThanOrEqual(prev);
    prev = d;
  }
  expect(giantDaylight("jupiter", 60e3, 0.8).direct).toBeGreaterThan(0.9);
  expect(giantDaylight("jupiter", -80e3, 0.8).direct).toBeLessThan(0.01);
  expect(giantDaylight("jupiter", 0, -0.5).direct).toBe(0);
});

test("the flashes: the same for the same clock, two or three a second near a stormy place, each heard once", () => {
  // (Jupiter's metres a radius, a camera 3 km under 1 bar at 12° S — the e2e's storm)
  const rm = 71492e3;
  const lat = (-12 * Math.PI) / 180,
    lon = (126.4 * Math.PI) / 180;
  const k = 1 - 3e3 / rm;
  const c: [number, number, number] = [k * Math.cos(lat) * Math.cos(lon), k * Math.cos(lat) * Math.sin(lon), k * Math.sin(lat)];
  expect(giantFlashes(4, c, rm, 1000.123)).toEqual(giantFlashes(4, c, rm, 1000.123));
  const ear = new GiantThunder();
  let heard = 0;
  const seen = new Set<string>();
  for (let tc = 2000; tc < 2060; tc += 1 / 30) {
    for (const x of ear.step(4, c, rm, tc)) {
      const key = `${x.flash.j}/${x.flash.n}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(x.dist).toBeGreaterThan(5e3);
      expect(x.dist).toBeLessThan(320e3);
      heard++;
    }
  }
  console.log(`  ${heard} flashes heard in 60 s`);
  expect(heard).toBeGreaterThan(10);
  expect(heard).toBeLessThan(480);
  // (the clock held: nothing more)
  expect(ear.step(4, c, rm, 2060)).toEqual(ear.step(4, c, rm, 2060));
});

test("the AIR panel: Galileo's figures as met, the 22 bar marked, the hull's share; the calls each crossed once", () => {
  const air = (h: number, p: number, deck: string | null, sun: number) => ({ h, p, T: 166, deck, sun, mu0: 0.5, wind: -40, q: 0 });
  const P = giantAirPanel(air(-3e3, 1.4e5, null, 0.2), unitsOf("metric"), (s) => s);
  expect(P.title).toBe("AIR");
  expect(P.rows.find((r) => r.label === "P")!.value).toBe("1.40 bar");
  expect(P.rows.find((r) => r.label === "T")!.value).toBe("166 K · -107 °C");
  expect(P.rows.find((r) => r.label === "1 BAR")!.value).toBe("−3.0 km");
  expect(P.rows.find((r) => r.label === "WIND")!.value).toBe("40 m/s W");
  expect(giantAirPanel(air(-150e3, GALILEO_LAST * 1.1, null, 0), unitsOf("metric"), (s) => s).rows[0]!.tone).toBe("bad");
  expect(giantAirPanel(air(-3e3, 1.4e5, null, 0.2), unitsOf("imperial"), (s) => s).rows[0]!.value).toBe("20.3 psi");
  const calls = giantCalls(air(14e3, 0.6e5, null, 0.5), air(10e3, 1.05e5, "NH₃", 0.005));
  expect(calls).toEqual([{ kind: "deck", name: "NH₃" }, { kind: "bar", bar: 1 }, { kind: "dark" }]);
  expect(giantCalls(air(10e3, 1.05e5, "NH₃", 0.005), air(9e3, 1.1e5, "NH₃", 0.004))).toEqual([]);
  expect(giantCalls(null, air(9e3, 1.1e5, "NH₃", 0.004))).toEqual([]);
  // (D1c: the hull — the share of what it holds, its tone; the call once past 80 %)
  const deep = (p: number) => ({ ...air(-250e3, p, null, 0), pMax: 150e5 });
  const H = giantAirPanel(deep(90e5), unitsOf("metric"), (s) => s);
  expect(H.rows.find((r) => r.label === "HULL")!.value).toBe("60 % · 150 bar");
  expect(H.rows[0]!.tone).toBe("norm");
  expect(giantAirPanel(deep(125e5), unitsOf("metric"), (s) => s).rows[0]!.tone).toBe("warn");
  expect(giantCalls(deep(118e5), deep(121e5))).toEqual([{ kind: "hull" }]);
  expect(giantCalls(deep(121e5), deep(124e5))).toEqual([]);
});

test("V4: the decks at their pressures — Alex's s(φ) from the bodies' masses, radii, spins and J2; the shader's giantLevel", async () => {
  const { GIANT_FIGURE, giantLevel, giantLevelScale } = await import("../src/system/giant-clouds");
  const { solarBody } = await import("../src/system/solar");
  const { flatteningOf } = await import("../src/system/ellipsoid");
  const { ZONAL } = await import("../src/system/geopotential");
  const { M_METRES } = await import("../src/units");
  const body = fnBody("giantLevel");
  for (const id of ["jupiter", "saturn"] as const) {
    // (Somigliana between g_eq = GM/a² (1 + 3/2 J2) − ω² a and g_pole = GM/b² (1 − 3 J2 a²/b²) — vr-solar-system GiantAir)
    const b = solarBody(id)!;
    const a = b.radius * M_METRES,
      f = flatteningOf(id),
      bb = a * (1 - f);
    const GM = b.mass * M_METRES * 299792458 ** 2;
    const w = (2 * Math.PI) / (b.rotation! * 3600);
    const J2 = ZONAL[id]!.J[0];
    const gEq = (GM / (a * a)) * (1 + 1.5 * J2) - w * w * a;
    const gP = (GM / (bb * bb)) * (1 - (3 * J2 * a * a) / (bb * bb));
    expect(GIANT_FIGURE[id].ba).toBeCloseTo(1 - f, 5);
    expect(GIANT_FIGURE[id].gpg).toBeCloseTo(gP / gEq, 4);
    // (the shader's constants the twin's)
    expect(body).toContain(String(GIANT_FIGURE[id].ba));
    expect(body).toContain(String(GIANT_FIGURE[id].gpg));
    // (Alex's: 0.86 and 0.75 at the poles; the equator 1; between, monotonic)
    expect(giantLevelScale(id, 0)).toBeCloseTo(1, 9);
    let prev = 1;
    for (let d = 10; d <= 90; d += 10) {
      const s = giantLevelScale(id, (d * Math.PI) / 180);
      expect(s).toBeLessThan(prev);
      prev = s;
    }
    expect(prev).toBeCloseTo(id === "jupiter" ? 0.86 : 0.75, 2);
    // (giantLevel on the squashed axes: at the equator the level the squashed height; at the pole the real one b/a of it,
    // the level that over s)
    expect(giantLevel(id, [1, 0, 0]).kl).toBeCloseTo(1, 9);
    const pole = giantLevel(id, [0, 0, 1]);
    expect(pole.s).toBeCloseTo(prev, 6);
    expect(pole.kl).toBeCloseTo((1 - f) / prev, 5);
  }
});

test("V7: the volume carried by the zonal wind — two phases, each alone 70 % of the cycle, held when the clock runs fast", async () => {
  const { GIANT_CYCLE, giantFlowBack, giantFlowPhases } = await import("../src/system/giant-clouds");
  const { giantWindAt } = await import("../src/system/giant-winds");
  // (the shader's: its cycle, its fades, its hold, the reading place turned west by u τ / (R cos φ))
  expect(wgsl).toContain(`const GIANT_CYCLE = ${GIANT_CYCLE.toFixed(1)};`);
  const gi = fnBody("giantInside");
  expect(gi).toContain("let fr = smoothstep(1000.0, 3000.0, P.envX.w);");
  expect(gi).toContain("let w1 = smoothstep(0.35, 0.65, abs(2.0 * fph - 1.0)) * (1.0 - fr);");
  expect(gi).toContain("let age = vec2f(mix(fph, 0.5, fr), fract(fph + 0.5)) * GIANT_CYCLE;");
  expect(gi).toContain("var dom = wc.y / (0.0436332 * rc * max(length(qc.xy), 0.05));");
  expect(gi).toContain("let ag = select(age.x, age.y, RNDV.w < w1);");
  expect(gi).toContain("GI_SH = -dom * ag;");
  expect(gi).toContain("let cz = vec2f(cos(-om * ag), sin(-om * ag));");
  expect(gi).toContain("let p = roT + rdT * (dm * mm / rm);");
  expect(fnBody("giantSigma")).toContain("let d = GI_SH * (q0.z - GI_ZC);");
  let alone = 0;
  for (let i = 0; i < 1000; i++) {
    const [a0, a1, w0, w1] = giantFlowPhases(((i + 0.5) / 1000) * GIANT_CYCLE + 7 * GIANT_CYCLE, 1);
    expect(w0 + w1).toBeCloseTo(1, 9);
    // (a phase seen only within its window: its age's start and end — its jump — never)
    if (w0 > 0) expect(a0 / GIANT_CYCLE).toBeGreaterThan(0.17);
    if (w0 > 0) expect(a0 / GIANT_CYCLE).toBeLessThan(0.83);
    if (w1 > 0) expect(a1 / GIANT_CYCLE).toBeGreaterThan(0.17);
    if (w1 > 0) expect(a1 / GIANT_CYCLE).toBeLessThan(0.83);
    if (w0 === 0 || w1 === 0) alone++;
  }
  expect(alone / 1000).toBeCloseTo(0.7, 1);
  // (fast: one phase, mid-window)
  expect(giantFlowPhases(1234.5, 5000)).toEqual([0.5 * GIANT_CYCLE, expect.any(Number), 1, 0]);
  // (the matter at 20° N on Jupiter, an hour ago: west of here by the wind's run along its parallel)
  const rm = 71492e3;
  const lat = (20 * Math.PI) / 180;
  const q: [number, number, number] = [Math.cos(lat), 0, Math.sin(lat)];
  const back = giantFlowBack("jupiter", q, 3600, rm);
  const run = (-Math.atan2(back[1], back[0]) * rm * Math.cos(lat)) / 3600;
  expect(run).toBeCloseTo(giantWindAt("jupiter", 20), 3);
  // (half a degree north of a camera at 20° N: its wind by the table's smoothed shear there — central differences over
  // 17.5–22.5° —, to first order)
  const l2 = (20.5 * Math.PI) / 180;
  const q2: [number, number, number] = [Math.cos(l2), 0, Math.sin(l2)];
  const b2 = giantFlowBack("jupiter", q2, 3600, rm, q);
  const run2 = (-Math.atan2(b2[1], b2[0]) * rm * Math.cos(l2)) / 3600;
  const shear = (0.5 * (giantWindAt("jupiter", 22.5) - giantWindAt("jupiter", 17.5)) * 0.5) / 2.5;
  expect(run2).toBeCloseTo(giantWindAt("jupiter", 20) + shear, 0);
});

test("V7b: inside the Great Red Spot the matter turns about its centre (the zonal wind out); Saturn's polar jet added", async () => {
  const { giantFlowBack } = await import("../src/system/giant-clouds");
  const gi = fnBody("giantInside");
  // (the shader's vortices and jet: giantFlow's constants)
  expect(gi).toContain("vec4f(2.2066, -0.384, 0.157, 0.0916)");
  expect(gi).toContain("vec4f(-1.0071, -0.5603, 0.0733, 0.0698)");
  expect(gi).toContain("select(135.0, 180.0, vi == 0u)");
  expect(fnBody("giantFlow")).toContain("vec4f(2.2066, -0.384, 0.157, 0.0916)");
  const rm = 71492e3;
  const dir = (lat: number, lon: number): [number, number, number] => [
    Math.cos(lat) * Math.cos(lon),
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
  ];
  // (at 0.8 of the Spot's radius north of its centre: an hour ago the matter was where its ring's ~180 m/s carried it — about
  // its centre, its distance from the centre kept)
  const c = dir(-0.384, 2.2066);
  const q = dir(-0.384 + 0.8 * 0.0916, 2.2066);
  const b = giantFlowBack("jupiter", q, 3600, rm, q);
  const dc = (v: number[]) => Math.acos(Math.min(1, v[0]! * c[0] + v[1]! * c[1] + v[2]! * c[2]));
  expect(dc(b)).toBeCloseTo(dc(q), 6);
  const moved = Math.acos(Math.min(1, b[0]! * q[0] + b[1]! * q[1] + b[2]! * q[2])) * rm;
  expect(moved / 3600).toBeGreaterThan(80);
  expect(moved / 3600).toBeLessThan(400);
  // (Saturn 1.5° from its pole: the jet turns the matter about the axis — ~150 m/s)
  const rs = 60268e3;
  const qs = dir(Math.PI / 2 - 0.026, 0.3);
  const bs = giantFlowBack("saturn", qs, 3600, rs, qs);
  const run = (Math.acos(Math.min(1, bs[0]! * qs[0] + bs[1]! * qs[1] + bs[2]! * qs[2])) * rs) / 3600;
  expect(run).toBeGreaterThan(100);
  expect(run).toBeLessThan(200);
});

test("V8: the storms' bias where the map is white about its latitude's mean — the shader's ramp, the twin's", async () => {
  const { giantStormBias, setGiantMapLuminance } = await import("../src/system/giant-clouds");
  const { GIANT_TOPS } = await import("../src/system/giant-tops");
  expect(fnBody("giantInside")).toContain("GI_SB = 0.1 * smoothstep(0.0, 0.08, luminance(mcw) - giantTop(m, 1u, lam)) - 0.03;");
  expect(fnBody("giantSigmaAt")).toContain("let gs = big.g + GI_SB;");
  // (a map at its zonal means but for one white patch at 13° S, 103° E — the bias +0.07 there, −0.03 elsewhere)
  const w = 1024,
    h = 512;
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) * 180) / h;
    const x = Math.min(Math.max(lat + 90, 0), 179.999);
    const z =
      GIANT_TOPS.jupiterLum[Math.floor(x)]! + (GIANT_TOPS.jupiterLum[Math.floor(x) + 1]! - GIANT_TOPS.jupiterLum[Math.floor(x)]!) * (x % 1);
    for (let i = 0; i < w; i++) lum[y * w + i] = z;
  }
  const px = (lat: number, lon: number) => [Math.round((0.5 + lon / 360) * w - 0.5), Math.round((0.5 - lat / 180) * h - 0.5)];
  const [cx, cy] = px(-13, 103);
  for (let dy = -6; dy <= 6; dy++)
    for (let dx = -6; dx <= 6; dx++) {
      const i = (cy! + dy) * w + cx! + dx;
      lum[i] = lum[i]! + 0.15;
    }
  setGiantMapLuminance("jupiter", w, h, lum);
  const q = (lat: number, lon: number): [number, number, number] => {
    const a = (lat * Math.PI) / 180,
      o = (lon * Math.PI) / 180;
    return [Math.cos(a) * Math.cos(o), Math.cos(a) * Math.sin(o), Math.sin(a)];
  };
  expect(giantStormBias("jupiter", q(-13, 103))).toBeCloseTo(0.07, 2);
  expect(giantStormBias("jupiter", q(20, -40))).toBeCloseTo(-0.03, 2);
});

test("V9: a pole's clear air — poleward of 55° where the map is blue, the hazes thinned, the hydrosulfide greyed", () => {
  const gi = fnBody("giantInside");
  expect(gi).toContain("GI_POL = smoothstep(0.96, 1.22, abs(latc)) * smoothstep(0.55, 0.9, mapc.b / max(mapc.r, 1e-3));");
  expect(gi).toContain("let hazeK = 1.0 - 0.65 * GI_POL;");
  expect(gi).toContain("let hz = giantHazeCol(h, Lt.x, AIR.hr) * SL * hazeK;");
  expect(fnBody("giantLayerAlbedo")).toContain("mix(vec3f(0.86, 0.47, 0.20), vec3f(0.74, 0.73, 0.71), GI_POL)");
  // (55° in radians: none at Jupiter's GRS or the planets' mid-latitudes)
  expect(Math.abs(0.96 - (55 * Math.PI) / 180)).toBeLessThan(0.01);
});

test("V11: the Sun's light on the clouds × 3, the sky's × 0.55 in the Sun's light and × 0.85 in shadow (Alex's weights)", () => {
  expect(wgsl).toContain("const GI_KS = 3.0;");
  const gi = fnBody("giantInside");
  expect(gi).toContain("let ka = mix(0.85, 0.55, smoothstep(0.05, 0.4, luminance(sunT)));");
  expect(gi).toContain("alb * sig * (GI_KS * S + ka * amb)");
  expect(gi).toContain("0.4 * ka * amb");
});
