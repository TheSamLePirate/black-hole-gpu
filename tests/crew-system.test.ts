import { expect, test } from "bun:test";
import type { InstrumentSnapshot } from "../src/net/instruments";
import { defaultCamera, project } from "../src/crew/sys3d/camera";
import { kerrRadii, systemScene } from "../src/crew/sys3d/scene";

// PLAN-VAISSEAUX K3: the system map's scene from the K1 blocks — the planets' orbits rebuilt about their parents, the
// moon moved a quarter of its month ahead, the craft and its paths, the burns; Gargantua's side with its radii; the
// projection, true and logarithmic.

const MU_SUN = 1.32712440018e11,
  MU_EARTH = 398600.4418;
const AU = 1.495978707e8;
const vc = (mu: number, r: number) => Math.sqrt(mu / r);
const snap = (): InstrumentSnapshot => ({
  v: 1,
  t: 0,
  body: "earth",
  metrics: {},
  geo: null,
  radar: null,
  route: [],
  ahead: [],
  bodies: [
    { id: "sun", r: [0, 0, 0], v: [0, 0, 0], mu: MU_SUN, radius: 696000, parent: "" },
    { id: "earth", r: [AU, 0, 0], v: [0, vc(MU_SUN, AU), 0], mu: MU_EARTH, radius: 6371, parent: "sun" },
    { id: "moon", r: [AU + 384400, 0, 0], v: [0, vc(MU_SUN, AU) + vc(MU_EARTH, 384400), 0], mu: 4902.8, radius: 1737, parent: "earth" },
    { id: "mars", r: [0, 1.524 * AU, 0], v: [-vc(MU_SUN, 1.524 * AU), 0, 0], mu: 42828, radius: 3390, parent: "sun" },
  ],
  state: { body: "earth", r: [6771, 0, 0], v: [0, vc(MU_EARTH, 6771), 0], mu: MU_EARTH, radius: 6371, soi: 924000 },
  traj: {
    free: [
      {
        body: "earth",
        pts: [
          [6771, 0, 0],
          [0, 6771, 0],
          [-6771, 0, 0],
        ],
        t: [0, 1385, 2770],
      },
    ],
    plan: [],
    fate: "continues",
    hit: "",
  },
  nodes: [{ in: 1385, dv: [100, 0, 0], role: "depart" }],
});

test("our side: the planets' orbits about the Sun, the Moon's about the Earth; a quarter month ahead the Moon a quarter round", () => {
  const S = systemScene(snap(), "body", 0)!;
  expect(S.side).toBe("ours");
  expect(S.spheres.map((s) => s.id)).toEqual(["sun", "earth", "moon", "mars"]);
  // (three orbits rebuilt — earth, moon, mars — then the SOI ring and the craft's own conic, the free path)
  expect(S.lines.length).toBeGreaterThanOrEqual(5);
  expect(S.marks.find((m) => m.kind === "craft")).toBeTruthy();
  expect(S.marks.find((m) => m.kind === "node")).toBeTruthy();
  // centred on the Earth, its extent the orbit's (within its sphere)
  expect(S.focus[0]).toBeCloseTo(AU, -1);
  expect(S.extent).toBeGreaterThan(6771);
  expect(S.extent).toBeLessThan(924000 * 1.2 + 1);
  const month = 2 * Math.PI * Math.sqrt(384400 ** 3 / MU_EARTH);
  const A = systemScene(snap(), "body", month / 4)!;
  const e = A.spheres.find((s) => s.id === "earth")!.pos,
    m = A.spheres.find((s) => s.id === "moon")!.pos;
  const rel = [m[0] - e[0], m[1] - e[1], m[2] - e[2]];
  // (a quarter of its month: from +x to +y about the Earth)
  expect(Math.abs(rel[0]!)).toBeLessThan(384400 * 0.05);
  expect(rel[1]!).toBeGreaterThan(384400 * 0.95);
  expect(A.marks.find((q) => q.kind === "ghost")).toBeTruthy();
  // centred on the Sun: Mars's orbit inside the view
  const Sun = systemScene(snap(), "sun", 0)!;
  expect(Sun.extent).toBeGreaterThan(1.524 * AU);
});

test("Gargantua's side: the hole's radii (Schwarzschild, extreme), its worlds on their circles, the craft", () => {
  const z = kerrRadii(0);
  expect(z.rh).toBeCloseTo(2, 9);
  expect(z.photon).toBeCloseTo(3, 9);
  expect(z.isco).toBeCloseTo(6, 9);
  const x = kerrRadii(0.999);
  expect(x.rh).toBeLessThan(1.05);
  expect(x.isco).toBeLessThan(1.25);
  const S = systemScene(
    {
      v: 1,
      t: 0,
      body: "gargantua",
      metrics: {},
      geo: null,
      radar: null,
      route: [],
      ahead: [],
      hole: {
        spin: 0.999,
        bodies: [
          { id: "gargantua", r: [0, 0, 0], radius: 0, orbit: 0 },
          { id: "miller", r: [10, 0, 0], radius: 1e-4, orbit: 10 },
          { id: "mann", r: [0, 40, 0], radius: 1e-4, orbit: 40 },
          { id: "mouth", r: [-300, 0, 0], radius: 0.05, orbit: 300 },
        ],
        craft: [12, 3, 0],
        path: [
          [12, 3, 0],
          [11, 5, 0],
        ],
        fate: "continues",
      },
    },
    "body",
    0,
  )!;
  expect(S.side).toBe("hole");
  expect(S.unit).toBe("M");
  expect(S.spheres[0]!.shade).toBe("hole");
  expect(S.spheres.find((s) => s.id === "mouth")!.shade).toBe("mouth");
  // (framed about the craft — 12.4 M out: its world and the hole's radii in sight, the mouth zoomed out to)
  expect(S.extent).toBeGreaterThan(12.4);
  expect(S.extent).toBeLessThanOrEqual(60);
});

test("the projection: the focus at the view's centre; the log scale brings the far planet in; every disc a few pixels at least", () => {
  const S = systemScene(snap(), "sun", 0)!;
  const cam = defaultCamera();
  const P = project(S, cam, 800, 600);
  const sun = P.discs.find((d) => d.id === "sun")!;
  expect(Math.abs(sun.x - 400)).toBeLessThan(1);
  expect(Math.abs(sun.y - 300)).toBeLessThan(1);
  expect(Math.min(...P.discs.map((d) => d.r))).toBeGreaterThanOrEqual(3);
  const L = project(S, { ...cam, log: true }, 800, 600);
  const far = (q: typeof P) => {
    const m = q.discs.find((d) => d.id === "mars")!;
    return Math.hypot(m.x - 400, m.y - 300);
  };
  const near = (q: typeof P) => {
    const m = q.discs.find((d) => d.id === "earth")!;
    return Math.hypot(m.x - 400, m.y - 300);
  };
  // (log: the Earth's distance grows against Mars's — the inner system opened up)
  expect(near(L) / far(L)).toBeGreaterThan(near(P) / far(P));
});
