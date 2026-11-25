// The bridges' and roads' views (PLAN-PONT-ROUTES-AAA, bridges.e2e and bridges-notable.e2e): a place shown from a free camera set
// over the ground loaded there — never at an altitude guessed over the sea, which stood the camera under Paris's streets and Millau's
// slopes (the campaign of 24 Nov 2026: the wet street and Millau drawn from under the relief, Alexandre III from inside a roof) —,
// aimed at a point by its bearing and its slope, with the scene about the new place (its centre moved there: the last place's stats
// still read "ready" for a moment — the Golden Gate's view was shot on Millau's), its data, its street cells and its compiles waited.
import type { App } from "./app";

export interface BridgeView {
  key: string;
  at: [number, number];
  /** the camera's height over the ground loaded there [m], or its height over the ellipsoid (`altM`) */
  aglM?: number;
  altM?: number;
  /** what it looks at, and that point's height over its ground [m] (default 0) or over the ellipsoid (`lookAltM`) */
  look: [number, number];
  lookAglM?: number;
  lookAltM?: number;
  /** the vertical field [°] (45) */
  fov?: number;
  weather?: string;
  /** what the scene must hold (a page expression over `sc`, earthScenery.stats()) */
  holds: string;
  /** the data's wait [ms] (45 s, each side of the camera's placing) */
  dataMs?: number;
}

export interface ViewState {
  /** the scene at the shot about the place and holding what it must */
  ready: boolean;
  /** whether it did so within the capped waits (else it came later, or never) */
  waitsMet: boolean;
  dataOk: boolean;
  streets: boolean;
  altM: number;
  groundM: number;
  heading: number;
  pitch: number;
  fov: number;
}

/** the scene about `at`, full (not the quick one), holding `holds` (waited 45 s, then 30 s once placed — said if not met) */
const sceneAbout = (at: [number, number], holds: string) =>
  `(() => { const sc = __bh.renderer.earthScenery?.stats?.(); return !!sc && sc.status === "ready" && !sc.quick && Math.abs(sc.lat - ${at[0]}) < 0.06 && Math.abs(sc.lon - ${at[1]}) < 0.08 && (${holds}); })()`;

/** what the scene is doing when a wait is not met: its status, the step under way, the scene drawn and the one asked (their keys —
 *  a key that keeps changing is a scene rebuilt over and over), the last build's time, its error, the street cells awaited */
export const sceneDiag = (app: App) =>
  app.js<Record<string, unknown>>(`(() => {
    const e = __bh.renderer.earthScenery, s = e.stats();
    return { status: s.status, pending: s.pending, progress: s.progress, applied: e.applied, requested: e.requested, busy: e.busy,
      lastMs: e.lastMs, lastError: e.lastError, failures: e.failures, streetRevision: s.streetRevision, streetMissing: s.streetMissing,
      lat: s.lat, lon: s.lon };
  })()`);

async function dataIn(app: App, key: string, ms: number) {
  try {
    await app.dataSettled(key, { maxMs: ms });
    return true;
  } catch (e) {
    // (said, and the view shot all the same: a part of the place still loading is reported beside its picture)
    console.log(`  ${key}: the place's data not all in — ${e instanceof Error ? e.message : String(e)}`);
    console.log(`  ${key}: the scene — ${JSON.stringify(await sceneDiag(app))}`);
    return false;
  }
}

/** Shows a view: the scene placed (no craft, noon on the 21st of June, the weather), its data waited, then the free camera set over
 *  the ground loaded, aimed, its lens eased, the compiles waited. */
export async function showView(app: App, v: BridgeView): Promise<ViewState> {
  const noon = new Date(Date.UTC(2026, 5, 21, 12) - (v.at[1] / 15) * 3600_000 + 2 * 3600_000).toISOString();
  await app.js(`(() => {
    __bh.freeze(true);
    __bh.game.setDate(${JSON.stringify(noon)});
    __bh.presets["bridges ${v.key}"] = {
      ...__bh.presets["Earth: the Blue Marble"],
      animate: false, ship: false, time: __bh.sim.time,
      earthScenery: "high", earthSurface: "satellite", earthTerrain: true, earthClouds: 0,
      dof: false, motionBlur: 0, traffic: false, weather: ${JSON.stringify(v.weather ?? "fair")},
      pose: { body: "earth", at: ${JSON.stringify(v.at)}, altKm: 1.5, aim: ${JSON.stringify(v.look)} },
    };
    __bh.preset("bridges ${v.key}");
    __bh.settings.weather = ${JSON.stringify(v.weather ?? "fair")};
    document.body.classList.add("hide-ui");
    __bh.refresh();
    return true;
  })()`);
  await app.progress(`${v.key}: the scene about the place, its data`);
  const ready = await app.waitOptional(sceneAbout(v.at, v.holds), 45_000);
  let dataOk = await dataIn(app, v.key, v.dataMs ?? 45_000);
  // (the camera over the ground now loaded there, aimed at its point)
  const pose = await app.js<{ altM: number; groundM: number; heading: number; pitch: number; why: string | null }>(`(() => {
    const D = Math.PI / 180, at = ${JSON.stringify(v.at)}, look = ${JSON.stringify(v.look)};
    const g = __bh.sys.groundAt(at[0], at[1]), gl = __bh.sys.groundAt(look[0], look[1]);
    const altM = ${v.altM ?? `g + ${v.aglM ?? 30}`}, lookM = ${v.lookAltM ?? `gl + ${v.lookAglM ?? 0}`};
    const n = (look[0] - at[0]) * 111132, e = (look[1] - at[1]) * 111320 * Math.cos(at[0] * D);
    const heading = (Math.atan2(e, n) / D + 360) % 360, pitch = Math.atan2(lookM - altM, Math.hypot(n, e)) / D;
    const why = __bh.viewAt(at[0], at[1], { altM, heading, pitch, fov: ${v.fov ?? 45} });
    // (the field set at once: viewAt eases it, and the frozen world steps no ease — the lens stayed the free camera's 55°)
    const vc = __bh.camera.viewController();
    if (!why) { vc.s.fov = ${v.fov ?? 45}; vc.fovTarget = null; }
    __bh.touch();
    return { altM: +altM.toFixed(1), groundM: +g.toFixed(1), heading: +heading.toFixed(1), pitch: +pitch.toFixed(2), why };
  })()`);
  if (pose.why) throw new Error(`${v.key}: the view refused — ${pose.why}`);
  // (the scene, its data and street cells about the view's own place)
  const again = await app.waitOptional(sceneAbout(v.at, v.holds), 30_000);
  dataOk = (await dataIn(app, `${v.key} (placed)`, v.dataMs ?? 45_000)) && dataOk;
  const streets = await app.waitOptional(`__bh.renderer.earthScenery.stats().streetMissing === 0`, 30_000);
  if (!ready && !again) console.log(`  ${v.key}: the scene not ready about the place — ${JSON.stringify(await sceneDiag(app))}`);
  await app.settled(60_000);
  const fov = await app.js<number>(`__bh.camera.viewController().s.fov`);
  // (and as it stands at the shot: about the place, holding what it must — "refreshing" too: the street cells' revision makes it again
  // with what it holds still drawn)
  const holdsNow = await app.js<boolean>(
    sceneAbout(v.at, v.holds).replace('sc.status === "ready"', '(sc.status === "ready" || sc.status === "refreshing")'),
  );
  console.log(
    `  ${v.key}: camera ${pose.altM} m (ground ${pose.groundM} m), heading ${pose.heading}°, pitch ${pose.pitch}°, fov ${fov.toFixed(1)}°`,
  );
  return {
    ready: holdsNow,
    waitsMet: !!(ready || again),
    dataOk,
    streets: streets !== null,
    altM: pose.altM,
    groundM: pose.groundM,
    heading: pose.heading,
    pitch: pose.pitch,
    fov,
  };
}

/** the GPU's time per image over 90 images [ms], and the images' rate */
export const gpuTimes = (app: App) =>
  app.js<{ p50: number; p95: number; n: number; fps: number }>(`(async () => {
    const R = __bh.renderer, ms = []; const t0 = performance.now();
    for (let i = 0; i < 90; i++) { __bh.touch(); await new Promise((r) => requestAnimationFrame(r)); if (R.lastGpuMs > 0) ms.push(R.lastGpuMs); }
    const fps = 90 / ((performance.now() - t0) / 1000);
    ms.sort((a, b) => a - b);
    const q = (p) => +(ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] ?? 0).toFixed(2);
    return { p50: q(0.5), p95: q(0.95), n: ms.length, fps: +fps.toFixed(1) };
  })()`);

/** the scene's counts, the pipeline drawing it, the GPU's errors */
export const sceneStats = (app: App) =>
  app.js<Record<string, number | string | boolean>>(`(() => {
    const s = __bh.renderer.earthScenery.stats();
    return { status: s.status, quick: s.quick, lat: s.lat, lon: s.lon, bridges: s.bridges, bridgePiers: s.bridgePiers,
      cellBridges: s.cellBridges, notableBridges: s.notableBridges, cellRoads: s.cellRoads, streetMissing: s.streetMissing,
      streetRevision: s.streetRevision, furniture: s.furniture,
      pipeline: __bh.renderer.earthPipelineNow?.(__bh.settings) ?? "?", gpuErrors: __bh.renderer.gpuErrors ?? 0 };
  })()`);

/** the widest road (not on a bridge) about a place in the drawn scenery, within `radius` m (along `bearingDeg` ± 20° when given): its axis' ends [lat, lon], its half width */
export const widestRoad = (app: App, at: [number, number], radius: number, bearingDeg?: number) =>
  app.js<{ a: [number, number]; b: [number, number]; halfW: number } | null>(`(() => {
    const c = __bh.renderer.earthScenery.contact; if (!c) return null;
    const f = c.f, D = Math.PI / 180, A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F);
    const cart = (lat, lon) => { const a = lat * D, b = lon * D, N = A / Math.sqrt(1 - E2 * Math.sin(a) ** 2);
      return [N * Math.cos(a) * Math.cos(b), N * Math.cos(a) * Math.sin(b), N * (1 - E2) * Math.sin(a)]; };
    const o = c.local(cart(${at[0]}, ${at[1]}));
    const geo = (x, y) => [${at[0]} + (y - o[1]) / 111132, ${at[1]} + (x - o[0]) / (111320 * Math.cos(${at[0]} * D))];
    let best = null;
    c.visit([o[0], o[1], 0], ${radius}, true, (b) => {
      // (a surface segment — a line —, a road's — kind ≤ 2 —, not on a deck — ROAD_ON_BRIDGE —: road-markings.ts)
      if (f[b + 11] >= 0.5 || f[b + 5] > 2 || (f[b + 6] & 32768) !== 0) return;
      const len = Math.hypot(f[b + 2] - f[b], f[b + 3] - f[b + 1]);
      if (len < 20) return;
      // (along a bearing when one is given, ±20° either way)
      ${
        bearingDeg === undefined
          ? ""
          : `{ const br = ((Math.atan2(f[b + 2] - f[b], f[b + 3] - f[b + 1]) / D) % 180 + 180) % 180, want = ${((bearingDeg % 180) + 180) % 180};
        if (Math.min(Math.abs(br - want), 180 - Math.abs(br - want)) > 20) return; }`
      }
      // (by its carriageway — data[7], ± its half-width —, not its record: a town road's record holds its pavements, widened to the
      // façades since 25 Nov 2026 — pavement-reach.ts)
      const w = f[b + 7] !== 0 ? Math.abs(f[b + 7]) : f[b + 4];
      if (!best || w > best.w) best = { w, b };
    });
    if (!best) return null;
    const b = best.b;
    return { a: geo(f[b], f[b + 1]), b: geo(f[b + 2], f[b + 3]), halfW: f[b + 4] };
  })()`);
