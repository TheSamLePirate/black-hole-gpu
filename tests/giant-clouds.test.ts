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

test("the eyes and the flashes' constants are the shader's (giantEye, giantFlashes)", () => {
  expect(fnBody("giantEye")).toContain("select(0.0166, 0.0175, m == 4u)");
  const f = fnBody("giantFlashes");
  for (const s of [
    "let Ts = 0.5",
    "f32(j) * 0.137",
    "0x9e37u + m",
    "0x51edu + m",
    "0x7f4au + m",
    "let t0 = 0.3 * u.w * Ts",
    "1.0 + floor(u.z * 2.99)",
    "0.07 + 0.05 * fract(u.z * 13.0 + k)",
    "exp(-(tau - tk) / 0.035) * (1.0 - 0.3 * k)",
    "fract(u.z * 7.0) < 0.17",
    "giantLayer(m, 2u).x + 15e3, giantLayer(m, 0u).x - 8e3",
    "300e3 * fract(u.x + f32(hi & 0xffu) / 255.0 * 0.15)",
    "TAU * (u.y + f32(hi >> 24u) / 255.0 * 0.03)",
    "(1.0 / 80.0) + vec3f(3.1, 7.7, 1.3)",
    "best < 0.7 + rare || giantEye(m, q).x < 0.95",
    "select(0.05, 0.0, m == 4u)",
  ])
    expect(f).toContain(s);
  // (the clock the shader reads: the renderer's seconds modulo 4 096)
  expect(f).toContain("P.zamo2.z");
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

test("the AIR panel: Galileo's figures as met, the 22 bar marked; the calls each crossed once", () => {
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
});
