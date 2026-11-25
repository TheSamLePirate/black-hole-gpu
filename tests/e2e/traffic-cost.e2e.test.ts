import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { gpuTimes, passesJs } from "./lib/bridge-views";
import { diffShots } from "./lib/shot-diff";
import { at, FINAL, frameOn, GEARUP, injectTraffic, runTo, sfoPlanes, W01R, W28L } from "./lib/sfo-traffic";

// What the live traffic's aircraft cost to draw, pass by pass (perf lot of 25 Nov 2026 — Sam: « qualité, high-detail et performance,
// pas de défauts »): San Francisco's made-up traffic of traffic-runways.e2e (lib/sfo-traffic.ts: a landing on 28L, a take-off from 01R,
// two in cruise, four parked at boarding area G — the sea's ships about the bay with them), the free camera's Chase view held at two
// moments — the short final (TC_MOMENTS final) and the gates (parked) —, the render scale pinned (TC_SCALE, 0.75), every frame touched,
// the GPU profiler on every frame. At each moment: the craft drawn (ship.lastDraws: mesh, triangles, distance, size on the image), the
// pass's box, the GPU's p50/p95 (renderer.lastGpuMs over 90 frames) and each pass's median; then
//   TC_ABLATE=<set>|"name=js;…" — cuts for attribution, each against the base around it (base cut cut base), no shot: the set "craft"
//     (the craft's pass's parts and its instances by kind and distance), "finish" (the ground's finishing pass at the gates);
//   TC_LEVERS=rig,lod,all (the lot's levers by name) or TC_AB_OFF / TC_AB_ON — in-page levers (the same commit), each off on on off
//     off on, then off / on / off shots compared pixel by pixel
//     (the A/A beside the A/B).
// Run by scripts/ab-e2e.ts (AB_SIDE, AB_RUN name the results) for an A B B A between two commits; alone it is one side.
// Shots: <OUT>/<side>-<moment>[-<lever>-off|-on|-off2].png, the differences ×4 -diff-aa / -diff-ab.png. Results <OUT>/tc-<side>.json.
// TC_LOOKS=looks (or "name=js;…"): each moment shot under each lever, no timing (TC_LOOKS_ONLY=1: those alone) — <side>-<moment>-look-<name>.png;
// the moments final-above and parked-above frame them from above (the apron's shadows, the bay's water).
// Earth data: the e2e disk cache (SFO: USGS/NAIP, no IGN).
// Duration: ~2 min to the first moment on kerr-mini, then ~40 s a moment, ~25 s a cut, ~2.5 min an A/B.
// Done when: each moment measured with ≥ 16 profiled frames and its craft drawn, no GPU error.

const OUT = process.env.TC_OUT ?? process.env.AB_OUT ?? "remote-results/traffic-cost";
const SIDE = `${process.env.AB_SIDE ?? "X"}${process.env.AB_RUN ?? ""}`;
const SCALE = Number(process.env.TC_SCALE ?? 0.75);
/** the in-page levers of the perf lot of 25 Nov 2026 by name — TC_LEVERS=rig,lod —: each off then on (the lot's own setting) */
const LEVERS: Record<string, { off: string; on: string }> = {
  rig: { off: "__bh.renderer.trafficRigShare = 0", on: "__bh.renderer.trafficRigShare = 0.06" },
  lod: { off: "__bh.renderer.ship.lodPx = 0", on: "__bh.renderer.ship.lodPx = 0.5" },
  all: {
    off: "__bh.renderer.trafficRigShare = 0; __bh.renderer.ship.lodPx = 0",
    on: "__bh.renderer.trafficRigShare = 0.06; __bh.renderer.ship.lodPx = 0.5",
  },
};
const AB: [string, { off: string; on: string }][] = [
  ...(process.env.TC_AB_ON && process.env.TC_AB_OFF ? [["lever", { off: process.env.TC_AB_OFF, on: process.env.TC_AB_ON }] as const] : []),
  ...(process.env.TC_LEVERS ?? "")
    .split(",")
    .filter((k) => LEVERS[k])
    .map((k) => [k, LEVERS[k]!] as const),
] as [string, { off: string; on: string }][];
const SEA = `["cargo","tanker","ferry","trawler","sailboat","frigate"]`;
const REP = "__bh.renderer.ship.debugRepeat";
const FS = "__bh.renderer.ship.debugFs";
const NEAR = "__bh.renderer.ship.debugOthers = (o) => Math.hypot(...o.t) < 1000";
const FAR = "__bh.renderer.ship.debugOthers = (o) => Math.hypot(...o.t) >= 1000";
const RIG0 = "__bh.camera.trafficRigMax = 0";
const LOD = "__bh.renderer.ship.lodPx";
const SETS: Record<string, string> = {
  craft: [
    `noship=__bh.renderer.debugSkipShip = true`,
    `shadow=__bh.renderer.ship.debugSkip.add("shadow")`,
    `pre=__bh.renderer.ship.debugSkip.add("pre")`,
    `hull=__bh.renderer.ship.debugSkip.add("hull")`,
    `motion=__bh.renderer.ship.debugSkip.add("motion")`,
    `plume=__bh.renderer.ship.debugSkip.add("plume")`,
    `grey=__bh.renderer.ship.debugFs = 8`,
    `nosea=__bh.renderer.ship.debugOthers = (o) => !${SEA}.includes(o.id)`,
    `seaonly=__bh.renderer.ship.debugOthers = (o) => ${SEA}.includes(o.id)`,
    `near1k=__bh.renderer.ship.debugOthers = (o) => Math.hypot(...o.t) < 1000`,
    `far1k=__bh.renderer.ship.debugOthers = (o) => Math.hypot(...o.t) >= 1000`,
    `rig0=__bh.camera.trafficRigMax = 0`,
    `nocast=__bh.renderer.ship.trafficCast = false`,
  ].join("\n"),
  // (amplified: the pass drawn 6 times more — ship.debugRepeat —, its cost Δ / 6 above the noise; « base@@cut »: the base's JS too)
  amp: [
    `aa=@@`,
    `shade=@@${REP}.shade = 6`,
    `shade-near=${NEAR}@@${NEAR}; ${REP}.shade = 6`,
    `shade-far=${FAR}@@${FAR}; ${REP}.shade = 6`,
    `shade-grey=${FS} = 8@@${FS} = 8; ${REP}.shade = 6`,
    `shade-noshadow=${FS} = 1@@${FS} = 1; ${REP}.shade = 6`,
    `shade-norefl=${FS} = 2@@${FS} = 2; ${REP}.shade = 6`,
    `shade-nospec=${FS} = 4@@${FS} = 4; ${REP}.shade = 6`,
    `shade-rig0=${RIG0}@@${RIG0}; ${REP}.shade = 6`,
    `shadow=@@${REP}.shadow = 6`,
    `motion=@@${REP}.motion = 6`,
  ].join("\n"),
  // (the shading pass amplified at the levels of detail drawn — the triangles' share of its cost: lodPx 0 the meshes whole, 0.5 the lot's,
  // 4 a coarse level — the rigged A320 near the view at its 63 cm level)
  lodamp: [
    `shade-lod0=${LOD} = 0@@${LOD} = 0; ${REP}.shade = 6`,
    `shade-lod05=${LOD} = 0.5@@${LOD} = 0.5; ${REP}.shade = 6`,
    `shade-lod4=${LOD} = 4@@${LOD} = 4; ${REP}.shade = 6`,
    `shade-lod4-grey=${LOD} = 4; ${FS} = 8@@${LOD} = 4; ${FS} = 8; ${REP}.shade = 6`,
    `shade-lod05-grey=${FS} = 8@@${FS} = 8; ${REP}.shade = 6`,
  ].join("\n"),
  finish: [
    `noair=__bh.renderer.liteSkip = 2048`,
    `noship=__bh.renderer.debugSkipShip = true`,
    `nocast=__bh.renderer.ship.trafficCast = false`,
    `nosurface=__bh.renderer.seaSurfaceOn = false`,
    `aa-finish=@@`,
  ].join("\n"),
};
const RESET = `__bh.renderer.debugSkipShip = false; __bh.renderer.ship.debugSkip.clear(); __bh.renderer.ship.debugFs = 0;
  __bh.renderer.ship.debugOthers = null; __bh.camera.trafficRigMax = undefined; __bh.renderer.ship.trafficCast = true;
  __bh.renderer.liteSkip = 0; __bh.renderer.ship.debugRepeat = { shadow: 0, shade: 0, motion: 0 }; __bh.renderer.seaSurfaceOn = true;
  __bh.renderer.ship.lodPx = 0.5`;
const ablate = (spec: string) => {
  // (sets by name — « amp,finish » —, a cut a line each: their JS may hold « ; »; else the cuts given, split at « ; »)
  const sets = spec.split(",");
  const lines = sets.every((k) => SETS[k]) ? sets.flatMap((k) => SETS[k]!.split("\n")) : spec.split(";");
  return lines.filter((s) => s.includes("=")).map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)] as const);
};
const ABLATE = ablate(process.env.TC_ABLATE ?? "");
const MOMENTS = (process.env.TC_MOMENTS ?? "final,parked").split(",");
/** TC_LOOKS=<set>|"name=js;…": shots of each moment under these levers (TC_LOOKS_ONLY=1: those alone, no timing) — what draws what */
const LOOK_SETS: Record<string, string> = {
  looks: [
    "base=",
    "noimagery=__bh.renderer.liteSkip = 128",
    "nosurfaces=__bh.renderer.liteSkip = 8",
    "nocraftshadow=__bh.renderer.liteSkip = 2097152",
    "nocast=__bh.renderer.ship.trafficCast = false",
    "noship=__bh.renderer.debugSkipShip = true",
    "nowatersurf=__bh.renderer.seaSurfaceOn = false",
  ].join("\n"),
};
const LOOKS = (() => {
  const spec = process.env.TC_LOOKS ?? "";
  const lines = LOOK_SETS[spec] ? LOOK_SETS[spec]!.split("\n") : spec.split(";");
  return lines.filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)] as const);
})();
/** each cut's sides: base cut cut base, TC_ROUNDS times (default 1) */
const ORDER = Array.from({ length: Number(process.env.TC_ROUNDS ?? 1) }, () => [false, true, true, false]).flat();

describe.skipIf(!E2E)("the live traffic's aircraft: what drawing them costs, pass by pass", () => {
  let app: App;
  const results: Record<string, unknown>[] = [];

  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    app.steps(["boot", "SFO and its traffic", ...MOMENTS]);
    app.estimate(150 + MOMENTS.length * (40 + ABLATE.length * 25 + AB.length * 150));
    await app.step("boot");
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { Object.assign(__bh.settings, { traffic: true, autosave: false, trafficDelay: 60 }); return 1; })()`);
    // (daylight at San Francisco: 12:30 PST — the harness's own daylight is Europe's)
    await app.js(`__bh.game.setDate("2026-11-24T20:30:00Z")`);
    await app.stepDone("booted");
    await app.step("SFO and its traffic");
    await app.js(`(() => { __bh.settings.ship = false; __bh.refresh(); return 1; })()`);
    await app.waitFor("!__bh.camera.piloting && !__bh.camera.spectating", 20_000);
    const P0 = at(W28L, 1200, -500);
    await app.js(`(() => __bh.viewAt(${P0.lat}, ${P0.lon}, { altM: 400, heading: 300, pitch: -12, fov: 50 }) ?? null)()`);
    await app.waitFor(`__bh.sys.runways().filter((r) => r.world?.field === "KSFO").length >= 4`, 45_000);
    await app.dataSettled("SFO's relief and imagery", { maxMs: 90_000 });
    const thr28 = at(W28L, 0, 0),
      thr01 = at(W01R, 0, 0);
    const G28 = await app.js<number>(`__bh.sys.groundAt(${thr28.lat}, ${thr28.lon})`);
    const G01 = await app.js<number>(`__bh.sys.groundAt(${thr01.lat}, ${thr01.lon})`);
    const n = await injectTraffic(app, sfoPlanes(G28, G01));
    expect(n).toBe(8);
    await app.stepDone(`${n} avions de ligne`);
  }, 300_000);

  afterAll(async () => {
    await Bun.write(`${OUT}/tc-${SIDE}.json`, JSON.stringify({ side: SIDE, scale: SCALE, results }, null, 1));
    app?.close();
    stopServer();
  });

  const SPOTS: Record<string, { id: string; yaw: number; pitch: number; zoom: number; m: number }> = {
    final: { id: "e2e281", yaw: 60, pitch: 3, zoom: 2.5, m: FINAL },
    parked: { id: "e2ep01", yaw: -30, pitch: 0.5, zoom: 1.5, m: GEARUP + 2 },
    // (from above: the parked ones' shadows on the apron, the bay's water under the final)
    "parked-above": { id: "e2ep01", yaw: -30, pitch: -40, zoom: 1.2, m: GEARUP + 2 },
    "final-above": { id: "e2e281", yaw: 60, pitch: -25, zoom: 3, m: FINAL },
  };
  type Prof = { frames: number; sum: number; passes: Record<string, number>; w: number; h: number };
  for (const key of MOMENTS)
    test(
      key,
      async () => {
        const sp = SPOTS[key]!;
        await app.step(key);
        await runTo(app, sp.m);
        await frameOn(app, sp.id, sp.yaw, sp.pitch, sp.zoom);
        await runTo(app, sp.m);
        await app.js(`(() => { __bh.forceScale(${SCALE}); __bh.touch(); return 1; })()`);
        await app.settled(60_000);
        await Bun.sleep(2000);
        // (TC_LOOKS — shots only, no timing —: the moment under each lever, for what draws what)
        for (const [name, js] of LOOKS) {
          await app.js(`(() => { ${RESET}; ${js}; __bh.touch(); return 1; })()`);
          await app.settled(60_000);
          await Bun.sleep(2500);
          await app.shot(`${OUT}/${SIDE}-${key}-look-${name}.png`);
        }
        if (LOOKS.length) await app.js(`(() => { ${RESET}; __bh.touch(); return 1; })()`);
        if (LOOKS.length && process.env.TC_LOOKS_ONLY === "1") {
          await app.shot(`${OUT}/${SIDE}-${key}.png`);
          await app.js(`(() => { __bh.forceScale(null); return 1; })()`);
          await app.stepDone(`${key}: ${LOOKS.length} captures`);
          return;
        }
        const gpu = await gpuTimes(app);
        const prof = await app.js<Prof>(passesJs(30));
        const drawn = await app.js<{ box: number[]; draws: { id: string; tris: number; d: number; px: number; cast: number }[] }>(`(() => {
          const S = __bh.renderer.ship, H = __bh.renderer.live?.height ?? 810;
          return { box: S.lastBox, draws: (S.lastDraws ?? []).map((x) => ({ ...x, px: +(x.r * H / 2).toFixed(1) })) }; })()`);
        const tris = drawn.draws.reduce((s, x) => s + x.tris, 0);
        // (the eye's place: over the sea and over the ground under it — the aerial table's columns end at the ellipsoid)
        const eye = await app.js<unknown>(`(() => { const h = __bh.trafficFocus()?.here; if (!h) return null;
          return { ...h, ground: __bh.sys.groundAt(h.lat, h.lon), geoid: __bh.sys.geoid(h.lat, h.lon) }; })()`);
        console.log(`  ${SIDE} ${key}: the eye ${JSON.stringify(eye)}`);
        console.log(
          `  ${SIDE} ${key}: GPU p50 ${gpu.p50} p95 ${gpu.p95} ms, Σ passes ${prof.sum} ms (${prof.w}×${prof.h}); box ${drawn.box.join("×")}; ${drawn.draws.length} drawn, ${tris} triangles: ${drawn.draws
            .map((x) => `${x.id} ${x.tris} tri ${x.d} m r ${x.px} px${x.cast ? ` cast${x.cast}` : ""}`)
            .join(" · ")}`,
        );
        await app.shot(`${OUT}/${SIDE}-${key}.png`);
        // (attribution: each cut against the base around it — the compute passes' changes attributable, the render passes' overlap)
        type One = { gpu: number; sum: number; passes: Record<string, number> };
        const ablations: Record<string, { base: number; cut: number; delta: number; passes: Record<string, number> }> = {};
        for (const [name, js] of ABLATE) {
          const base: One[] = [],
            cut: One[] = [];
          // (« base@@cut »: the base's own JS — a filter both sides share —, then the cut's)
          const [bJs, cJs] = js.includes("@@") ? (js.split("@@") as [string, string]) : ["", js];
          for (const [i, on] of ORDER.entries()) {
            await app.js(`(() => { ${RESET}; ${on ? cJs : bJs}; __bh.touch(); return 1; })()`);
            await Bun.sleep(800);
            const g = await gpuTimes(app);
            const pr = await app.js<Prof>(passesJs(16));
            (on ? cut : base).push({ gpu: g.p50, sum: pr.sum, passes: pr.passes });
            await app.progress(`${key} · coupe ${name} ${i + 1}/${ORDER.length} · ${g.p50} ms`);
          }
          await app.js(`(() => { ${RESET}; return 1; })()`);
          const avg = (x: One[]) => +(x.reduce((s, y) => s + y.gpu, 0) / x.length).toFixed(2);
          const passes: Record<string, number> = {};
          for (const l of new Set([...base, ...cut].flatMap((r) => Object.keys(r.passes)))) {
            const m = (x: One[]) => x.reduce((s, y) => s + (y.passes[l] ?? 0), 0) / x.length;
            const d = +(m(cut) - m(base)).toFixed(2);
            if (Math.abs(d) >= 0.1) passes[l] = d;
          }
          ablations[name] = { base: avg(base), cut: avg(cut), delta: +(avg(cut) - avg(base)).toFixed(2), passes };
          console.log(
            `  ${SIDE} ${key} cut ${name}: GPU p50 ${avg(base)} → ${avg(cut)} (${ablations[name].delta} ms) ${JSON.stringify(passes)}`,
          );
        }
        // (in-page levers: each off on on off off on, then shots off / on / off compared — left on)
        const levers: Record<string, unknown> = {};
        for (const [name, L] of AB) {
          const runs: { on: boolean; p50: number; p95: number; sum: number; passes: Record<string, number> }[] = [];
          for (const on of [false, true, true, false, false, true]) {
            await app.js(`(() => { ${on ? L.on : L.off}; __bh.touch(); return 1; })()`);
            await app.settled(60_000);
            await Bun.sleep(1500);
            const g = await gpuTimes(app);
            const pr = await app.js<Prof>(passesJs(24));
            runs.push({ on, p50: g.p50, p95: g.p95, sum: pr.sum, passes: pr.passes });
            await app.progress(`${key} · levier ${name} ${on ? "on" : "off"} ${runs.length}/6 · ${g.p50} ms`);
          }
          const shotOf = async (on: boolean, tag: string) => {
            await app.js(`(() => { ${on ? L.on : L.off}; __bh.touch(); return 1; })()`);
            await app.settled(60_000);
            await Bun.sleep(2500);
            const f = `${OUT}/${SIDE}-${key}-${name}-${tag}.png`;
            await app.shot(f);
            return f;
          };
          const off1 = await shotOf(false, "off"),
            on1 = await shotOf(true, "on"),
            off2 = await shotOf(false, "off2");
          const aa = await diffShots(app, off1, off2, `${OUT}/${SIDE}-${key}-${name}-diff-aa.png`);
          const ab = await diffShots(app, off1, on1, `${OUT}/${SIDE}-${key}-${name}-diff-ab.png`);
          const mean = (on: boolean, f: (r: (typeof runs)[number]) => number) => {
            const x = runs.filter((r) => r.on === on).map(f);
            return +(x.reduce((s, y) => s + y, 0) / x.length).toFixed(2);
          };
          const passes: Record<string, { off: number; on: number }> = {};
          for (const l of new Set(runs.flatMap((r) => Object.keys(r.passes))))
            passes[l] = { off: mean(false, (r) => r.passes[l] ?? 0), on: mean(true, (r) => r.passes[l] ?? 0) };
          const lever = {
            p50: { off: mean(false, (r) => r.p50), on: mean(true, (r) => r.p50) },
            p95: { off: mean(false, (r) => r.p95), on: mean(true, (r) => r.p95) },
            runs: runs.map((r) => ({ on: r.on, p50: r.p50, p95: r.p95, sum: r.sum })),
            passes,
            diff: { aa, ab },
          };
          levers[name] = lever;
          await app.js(`(() => { ${L.on}; __bh.touch(); return 1; })()`);
          console.log(
            `  ${SIDE} ${key} lever ${name}: GPU p50 ${JSON.stringify(lever.p50)} p95 ${JSON.stringify(lever.p95)} (runs ${JSON.stringify(lever.runs)}); image A/A ${aa.mean} (${aa.over8} > 8), off/on ${ab.mean} (${ab.over8} > 8, ${ab.over24} > 24)`,
          );
        }
        await app.js(`(() => { __bh.forceScale(null); return 1; })()`);
        const errors = await app.js<number>(`__bh.renderer.gpuErrors?.length ?? 0`).catch(() => 0);
        results.push({ moment: key, gpu, prof, drawn, eye, ablations, levers, errors });
        await app.stepDone(`${key}: p50 ${gpu.p50} ms · ${drawn.draws.length} dessinés · ${tris} triangles`);
        expect(prof.frames).toBeGreaterThanOrEqual(16);
        // (an older commit — scripts/ab-e2e.ts's side A — has no ship.lastDraws: its craft not listed)
        if (await app.js<boolean>(`!!__bh.renderer.ship.lastDraws`)) expect(drawn.draws.length).toBeGreaterThan(0);
        expect(app.cdp.errors).toEqual([]);
      },
      300_000 + ABLATE.length * 60_000 + AB.length * 300_000,
    );
});
