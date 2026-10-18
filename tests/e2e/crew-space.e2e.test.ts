import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { NetClient } from "../../src/net/client";
import { emptyVisual } from "../../src/net/proto";
import { geodeticToCart, WGS84_A, WGS84_F } from "../../src/system/ellipsoid";

// PLAN-VAISSEAUX K2–K4: the crew console's two profiles in a real room, real clicks. A pilot (a client of the test)
// sends an F-35's snapshots: the tactical console — its badge, MISSION AÉRIENNE first, no ORBIT —; then the same pilot
// flies the Ranger in orbit: the console turns to the spacecraft's — its badge, its tiles (Δv, apsides), its dashboard
// first, no radar —; the ORBIT view clicked. (E2E_SHOTS=<dir>: the views.) ~40 s.

const MU = 398600.4418;
const R = 6371;
const orbitSnap = (t: number) => {
  const r = R + 420,
    v = Math.sqrt(MU / r),
    i = (51.6 * Math.PI) / 180,
    a = (t / 5560) * 2 * Math.PI;
  return {
    v: 1,
    t,
    body: "earth",
    metrics: { alt: 420_000, speed: 7660, throttle: 0, fuel: 0.62, tau: 1 },
    geo: { lat: 0, lon: 0, heading: 0 },
    radar: null,
    route: [],
    ahead: [],
    flight: { pitch: 0.1, bank: 0, hdg: 1.2 },
    caps: { on: true, fam: ["space"] },
    orbit: { pe: 418, ap: 423, inc: 51.6, ecc: 0.0004, period: 5560, tPe: 1200, tAp: 4000, radius: 6378, a: 6791 },
    next: { kind: "node", name: "Poussée", in: 900 - t },
    craft: { id: "ranger", kind: "spacecraft", name: "Ranger", lands: true, ring: false },
    state: {
      body: "earth",
      r: [r * Math.cos(a), r * Math.sin(a) * Math.cos(i), r * Math.sin(a) * Math.sin(i)],
      v: [-v * Math.sin(a), v * Math.cos(a) * Math.cos(i), v * Math.cos(a) * Math.sin(i)],
      mu: MU,
      radius: R,
      soi: 924_000,
    },
    nodes: [{ in: 900 - t, dv: [55, 0, 0], role: "depart" }],
    budget: { dv: 1480, prop: 0.62 },
    sysx: { battery: 0.94, kwh: 60, balance: 1.4, o2h: 285, scrub: 13.6, crew: 4, failures: [] },
    time: { warp: 1, room: t, dtau: 1, tau: t },
    link: { light: 0.0014, cut: false },
    // (once a second in the game: the bodies and the paths — here every time)
    bodies: BODIES,
    traj: {
      free: [
        {
          body: "earth",
          pts: Array.from({ length: 49 }, (_, k) => ring(k / 48, r, i)),
          t: Array.from({ length: 49 }, (_, k) => (k / 48) * 5560),
        },
      ],
      plan: [],
      fate: "continues",
      hit: "",
    },
  };
};
const AU = 1.495978707e8;
const MU_SUN = 1.32712440018e11;
const ring = (u: number, r: number, i: number) => {
  const a = u * 2 * Math.PI;
  return [r * Math.cos(a), r * Math.sin(a) * Math.cos(i), r * Math.sin(a) * Math.sin(i)];
};
const planet = (id: string, au: number, ang: number, mu: number, radius: number) => {
  const r = au * AU,
    v = Math.sqrt(MU_SUN / r);
  return { id, r: [r * Math.cos(ang), r * Math.sin(ang), 0], v: [-v * Math.sin(ang), v * Math.cos(ang), 0], mu, radius, parent: "sun" };
};
const EARTH = planet("earth", 1, 0.3, MU, 6371);
const BODIES = [
  { id: "sun", r: [0, 0, 0], v: [0, 0, 0], mu: MU_SUN, radius: 696_000, parent: "" },
  planet("mercury", 0.387, 2.1, 22032, 2440),
  planet("venus", 0.723, 4.0, 324859, 6052),
  EARTH,
  {
    id: "moon",
    r: [EARTH.r[0]! + 384_400, EARTH.r[1]!, 0],
    v: [EARTH.v[0]!, EARTH.v[1]! + 1.022, 0],
    mu: 4902.8,
    radius: 1737,
    parent: "earth",
  },
  planet("mars", 1.524, 1.2, 42828, 3390),
  planet("jupiter", 5.2, 2.7, 1.26687e8, 69911),
  planet("saturn", 9.58, 4.6, 3.7931e7, 58232),
];
const holeSnap = (t: number) => ({
  v: 1,
  t,
  body: "gargantua",
  metrics: { speed: 0.3 * 299_792_458, tau: 0.6 },
  geo: null,
  radar: null,
  route: [],
  ahead: [],
  caps: { on: true, fam: ["space"] },
  craft: { id: "endurance", kind: "spacecraft", name: "Endurance", lands: false, ring: true },
  time: { warp: 1, room: t, dtau: 0.62, tau: t * 0.62 },
  link: { light: 0, cut: true },
  hole: {
    spin: 0.999,
    bodies: [
      { id: "gargantua", r: [0, 0, 0], radius: 0, orbit: 0 },
      { id: "miller", r: [10 * Math.cos(2.55), 10 * Math.sin(2.55), 0], radius: 3e-5, orbit: 10 },
      { id: "mann", r: [40 * Math.cos(0.72), 40 * Math.sin(0.72), 0], radius: 3e-5, orbit: 40 },
      { id: "mouth", r: [300 * Math.cos(5.72), 300 * Math.sin(5.72), 0], radius: 0.05, orbit: 300 },
    ],
    craft: [10.5 * Math.cos(2.4), 10.5 * Math.sin(2.4), 0.2],
    path: Array.from({ length: 40 }, (_, k) => [10.5 * Math.cos(2.4 + k * 0.05), 10.5 * Math.sin(2.4 + k * 0.05), 0.2 - k * 0.005]),
    fate: "continues",
  },
});
const jetSnap = (t: number) => ({
  v: 1,
  t,
  body: "earth",
  metrics: { alt: 1500, speed: 200, fuel: 0.75, mach: 0.6, g: 1, tau: 1 },
  geo: { lat: 48.85, lon: 2.35, heading: 1 },
  radar: { mode: "TWS", contacts: [{ id: "bandit", name: "BANDIT", e: 4000, n: 10000, dz: 200, iff: "hostile", locked: true }] },
  route: [],
  ahead: [],
  flight: { pitch: 0.05, bank: 0.2, hdg: 1 },
  caps: { on: true, fam: ["nav", "config", "jet", "weapons"] },
  craft: { id: "f35", kind: "jet", name: "F-35", lands: true, ring: false },
  arms: { live: true, sel: "aim120", stores: { aim120: 4, aim9x: 2 }, mode: "TWS", lock: "BANDIT" },
  msn: { name: "CAP", brg: 1, dist: 42_000, dz: 0 },
  warn: [],
});

describe.skipIf(!E2E)("the crew console's two profiles (K2)", () => {
  let app: App;
  let pilot: NetClient;
  let feed: ReturnType<typeof setInterval>;
  let space = false;
  let hole = false;
  let t = 0;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  beforeAll(async () => {
    app = await App.boot({ entry: "crew", width: 1440, height: 900 });
    pilot = new NetClient({
      url: new URL("net", app.url).href.replace("http", "ws"),
      build: "test",
      id: { device: "crew-space-pilot", name: "Cooper", colour: "#89dce5" },
      p2p: false,
    });
    const code = (await pilot.create("Endurance", 0)).code;
    feed = setInterval(() => {
      t += 0.25;
      pilot.sendCraft({
        frame: 0,
        body: 0,
        kind: space ? 0 : 3,
        flags: 0,
        p: geodeticToCart(WGS84_A, WGS84_F, (48.85 * Math.PI) / 180, (2.35 * Math.PI) / 180, space ? 420_000 : 1500),
        v: [0, 200, 0],
        q: [0, 0, 0, 1],
        w: [0, 0, 0],
        a: [0, 0, 0],
        vis: emptyVisual(),
      });
      pilot.event({ kind: "instruments", data: hole ? holeSnap(t) : space ? orbitSnap(t) : jetSnap(t) });
    }, 250);
    await app.click("#name");
    await app.type("Brand");
    await app.click("#code");
    await app.type(code);
    await app.click("#join");
    await app.waitFor("__crew.net.room?.role === 'instruments' && !!__crew.model.own()?.snapshot", 20_000);
  }, 120_000);
  afterAll(() => {
    clearInterval(feed);
    pilot?.close();
    app?.close();
    stopServer();
  });

  const strip = `[...document.querySelectorAll("#views button")].map((b) => b.dataset.view)`;

  test("the F-35 followed: the tactical console — its badge, MISSION AÉRIENNE first, no ORBIT", async () => {
    await app.waitFor(`document.body.dataset.profile === "jet"`, 10_000);
    const views = await app.js<string[]>(strip);
    expect(views[0]).toBe("air");
    expect(views).not.toContain("orbit");
    expect(await app.js<string>(`document.getElementById("profile-badge").textContent`)).toBe("F-35 · TACTIQUE");
    await app.click("[data-view=air]");
    await app.waitFor(`document.getElementById("view-title").textContent === "Mission aérienne"`, 5000);
    await Bun.sleep(800);
    await shot("1-f35-mission");
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);

  test("the Ranger followed: the spacecraft's console — its badge, its tiles, its dashboard, no radar; ORBIT clicked", async () => {
    space = true;
    await app.waitFor(`document.body.dataset.profile === "space"`, 10_000);
    const views = await app.js<string[]>(strip);
    expect(views[0]).toBe("sdash");
    expect(views).toContain("orbit");
    expect(views).not.toContain("radar");
    expect(await app.js<string>(`document.getElementById("profile-badge").textContent`)).toBe("VAISSEAU · RANGER");
    // (the view the F-35's console showed is not the spacecraft's: its first)
    expect(await app.js<string>(`document.getElementById("view-title").textContent`)).toBe("Tableau");
    // (French grouping: a narrow no-break space)
    await app.waitFor(`document.querySelector("#metrics [data-key=dv] strong")?.textContent.replace(/\\s/g, "") === "1480"`, 5000);
    const pe = await app.js<string>(`document.querySelector("#metrics [data-key=pe] strong").textContent`);
    expect(pe).toBe("418");
    await Bun.sleep(600);
    await shot("2-ranger-tableau");
    await app.click("[data-view=orbit]");
    await app.waitFor(`document.getElementById("view-title").textContent === "Orbite"`, 5000);
    await Bun.sleep(600);
    await shot("3-ranger-orbite");
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);

  test("the system map (K3): about the Earth, then the Sun in the log scale, the prediction scrolled; Gargantua's side", async () => {
    await app.click("[data-view=system]");
    await app.waitFor(`document.getElementById("view-title").textContent === "Carte système"`, 5000);
    // (its renderer asked once shown: WebGPU, else the canvas)
    await app.waitFor(`!!__crew.views.sysRenderer.kind`, 10_000);
    const kind = await app.js<string>(`__crew.views.sysRenderer.kind`);
    console.log(`  the map's renderer: ${kind}`);
    await Bun.sleep(600);
    await shot("4-carte-terre");
    await app.click("[aria-label='Centre de la carte'] button:nth-child(3)");
    await app.click("[aria-label='Échelle'] button:nth-child(2)");
    await app.waitFor(`__crew.views.map3d.focus === "sun" && __crew.views.map3d.cam.log`, 3000);
    await Bun.sleep(600);
    await shot("5-carte-soleil-log");
    // the prediction: the slider half way — the Moon and the craft moved on
    await app.js(
      `(() => { const s = document.getElementById("map-ahead"); s.value = "500"; s.dispatchEvent(new Event("input")); return 1; })()`,
    );
    await app.waitFor(`__crew.views.map3d.ahead > 0`, 3000);
    hole = true;
    await app.waitFor(`!!__crew.model.own()?.snapshot?.hole`, 5000);
    await app.click("[aria-label='Échelle'] button:nth-child(1)");
    await app.click("[aria-label='Centre de la carte'] button:nth-child(1)");
    await Bun.sleep(800);
    await shot("6-carte-gargantua");
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);
});
