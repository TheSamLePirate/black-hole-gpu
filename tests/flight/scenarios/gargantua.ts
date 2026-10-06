// Gargantua's family: the automatic Interstellar mission, the wormhole crossed both ways (the flight
// computer's MISSION tab, PLAN TRANSFER's low thrust), the flights about Gargantua (its transfers, the
// hole's orbital operations, missions to Miller, Mann and Edmunds, landings on them and take-offs), and
// the grand tour — the Earth, Jupiter, the wormhole, a world of Gargantua's.
//
// Each judged on arriving and on flying well: the Δv spent against the plan's, the warp never above the
// autopilots' ceilings, the state finite and continuous through the throat (no jump in speed where the
// flight goes from one metric to the other), no plan dropped on the way, transfers that converge.
import { engage, said, scene, type Scenario, type Verdict } from "./helpers";
import type { Lab } from "../lib/lab";

const C = 299792458;
const MISSION_SCENE = "Mission: through the wormhole to the companion star (automatic flight)";

/** The game's Gargantua world (the Crew engine, 2 g; the wormhole between Saturn and Gargantua). */
async function interstellar(lab: Lab, engine: "crew" | "cinema" = "crew") {
  await scene(lab, "game:interstellar");
  await lab.js(`(__bh.settings.engine = ${JSON.stringify(engine)}, __bh.freeze(true), __bh.step(1 / 30), true)`);
}

/**
 * The craft placed (game tools), then a few frames flown: the flight's frame and its predictions caught
 * up with the new place — as a player's frames would — before anything is planned there.
 */
async function place(lab: Lab, expr: string) {
  await lab.js(`(${expr}, __bh.step(1 / 30), __bh.step(1 / 30), __bh.step(1 / 30), true)`);
}

/**
 * Every step watched (page side, around __bh.step): the warp against the autopilots' ceiling of that
 * step (a step above it, with what flew), the state's finiteness, the propellant spent at each node
 * flown, the low-thrust transfer's stages, and each change of region or side — the crossings — with the
 * flight's flat-map state (the hole's frame on Gargantua's side, the home frame on ours) just before
 * and after. The map's coordinate velocity is the physical one on both sides of the gluing sphere
 * (flightInfo's own `speed` is against the moving mouth inside it, against the ZAMO out of it).
 */
async function watch(lab: Lab) {
  await lab.js(`(() => {
    if (window.__xs) return true;
    const xs = (window.__xs = { n: 0, viol: 0, over: [], maxOver: 1, warpMax: 0, nan: 0, cross: [], last: [], stages: [], nodes: [] });
    const step = __bh.step;
    let prev = null;
    __bh.step = (dt) => {
      const t0 = __bh.sim.time;
      const out = step(dt);
      const c = __bh.camera, s = __bh.settings, i = c.flightInfo(), M = 4.925490947e-6 * s.massSolar;
      const lim = Math.min(c.hubWarpLimit ?? Infinity, c.railsCap ?? Infinity);
      const flat = i.region === "throat" && i.map ? i.map : i;
      const S = { t: __bh.sim.time * M, tM: __bh.sim.time, region: i.region, side: c.shipSide, ell: i.ell, r: i.r,
        X: flat.X ? [...flat.X] : null, V: flat.V ? [...flat.V] : null, lsp: i.map?.tunnel?.speed ?? null, warp: s.timeSpeed * M };
      xs.n++;
      const st = c.transfer?.stage ?? null;
      if (st !== (xs.stages[xs.stages.length - 1]?.[1] ?? null)) xs.stages.push([Math.round(S.t), st]);
      const nn = c.plan?.nodes?.length ?? 0;
      if (nn !== (xs.nodes[xs.nodes.length - 1]?.n ?? -1)) xs.nodes.push({ t: Math.round(S.t), n: nn, spent: c.spent * 299792458 });
      xs.warpMax = Math.max(xs.warpMax, S.warp);
      if (!(S.X && S.X.every(Number.isFinite) && S.V && S.V.every(Number.isFinite)) && !(i.map?.tunnel?.inside)) xs.nan++;
      // (the warp the step was flown at — the time it advanced — against the ceilings its frame set)
      const used = (__bh.sim.time - t0) / dt;
      if (c.pilot.auto !== "none" && Number.isFinite(lim) && used > lim * 1.001) {
        xs.viol++;
        xs.maxOver = Math.max(xs.maxOver, used / lim);
        if (xs.over.length < 8) xs.over.push({ t: Math.round(S.t), auto: c.pilot.auto, warp: used * M, lim: lim * M, note: c.railsNote, mission: __bh.mission?.phase ?? null });
      }
      xs.last.push(S);
      if (xs.last.length > 4) xs.last.shift();
      if (prev && (prev.region !== S.region || prev.side !== S.side)) xs.cross.push({ t: S.t, before: xs.last.slice(0, -1), after: [S] });
      for (const K of xs.cross) if (K.after.length < 4 && !K.after.includes(S)) K.after.push(S);
      prev = S;
      return out;
    };
    return true;
  })()`);
}

interface Flat {
  t: number;
  tM: number;
  region: string;
  side: string;
  ell: number;
  r: number;
  X: number[] | null;
  V: number[] | null;
  lsp: number | null;
  warp: number;
}

interface Watched {
  n: number;
  viol: number;
  over: { t: number; auto: string; warp: number; lim: number; mission: string | null }[];
  maxOver: number;
  warpMax: number;
  nan: number;
  stages: [number, string | null][];
  nodes: { t: number; n: number; spent: number }[];
  cross: { t: number; before: Flat[]; after: Flat[] }[];
}

const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/**
 * What the watch saw: the warp's excesses, NaN, and each crossing's continuity — across the gluing sphere
 * (the same universe's flat map on both sides): the position against where the last velocity carried it,
 * over the step's length, and the velocity's change over the step-to-step changes before it; through the
 * tunnel's exit (the universe changes, the map with it): the longitudinal speed's change.
 */
async function watched(lab: Lab) {
  const w = await lab.js<Watched>("window.__xs");
  const jumps = w.cross.map((K) => {
    const b = K.before[K.before.length - 1]!,
      a = K.after[0]!;
    const at = `${b.region}/${b.side}→${a.region}/${a.side}`;
    if (b.side !== a.side) {
      const dl = b.lsp !== null && a.lsp !== null ? Math.abs(a.lsp - b.lsp) / Math.max(Math.abs(b.lsp), 1e-12) : null;
      return { at, dX: 0, dV: dl ?? 0 };
    }
    if (!b.X || !a.X || !b.V || !a.V) return { at, dX: Number.NaN, dV: Number.NaN };
    const dt = a.tM - b.tM;
    const carried = b.X.map((x, k) => x + b.V![k]! * dt);
    const v = Math.hypot(...b.V);
    const dX = dist(a.X, carried) / Math.max(v * dt, 1e-12);
    // (the velocity's own change from step to step just before: the gravity, the thrust)
    const p = K.before.length > 1 ? K.before[K.before.length - 2]! : null;
    const usual = p?.V && p.region === b.region ? dist(b.V, p.V) : 0;
    const dV = dist(a.V, b.V) / Math.max(v, 1e-12);
    return { at, dX, dV, usual: usual / Math.max(v, 1e-12) };
  });
  const worst = jumps.reduce((m, j) => Math.max(m, Number.isFinite(j.dV) ? j.dV - 3 * ("usual" in j ? (j.usual ?? 0) : 0) : 1), 0);
  const nodes = w.nodes.map((x, k) => (k ? `${x.n}@${x.t}s:${Math.round(x.spent - w.nodes[k - 1]!.spent)}` : `${x.n}`)).join(" ");
  lab.note(
    "watch",
    `steps ${w.n} · warp max ×${Math.round(w.warpMax)} · over its ceiling ${w.viol} (×${w.maxOver.toFixed(2)}) ${JSON.stringify(w.over)} · NaN ${w.nan} · nodes ${nodes} · stages ${w.stages.map((x) => `${x[1]}@${x[0]}`).join(" ")} · crossings ${JSON.stringify(jumps)}`,
  );
  return { ...w, jumps, worst };
}

/** The propellant's rapidity spent [m/s] (≈ the Δv flown). */
const spentMps = (lab: Lab) => lab.js<number>(`__bh.camera.spent * ${C}`);

/** A mission planned by the flight computer's MISSION tab, adopted, flown: its plan's figures. */
async function mission(lab: Lab, spec: Record<string, unknown>) {
  const r = await lab.js<{ ok: boolean; note: string; dvTotal?: number; burns?: { t: number; dv: number[] }[]; afterText?: string }>(
    `(async () => { const r = await __bh.camera.missionPlan(${JSON.stringify(spec)}); return r.ok ? { ok: true, note: r.note, dvTotal: r.dvTotal, burns: r.burns.map((b) => ({ t: b.t, dv: b.dv })), afterText: r.afterText } : r; })()`,
  );
  lab.note(
    "plan",
    `${JSON.stringify(spec)} → ${r.ok ? `${r.note} · Δv ${Math.round(r.dvTotal ?? 0)} m/s · ${r.burns?.length} burns (${r.burns?.map((b) => `${Math.round(Math.hypot(...b.dv))}@${Math.round(b.t)}s`).join(" ")}) · ${r.afterText}` : r.note}`,
  );
  if (!r.ok) return r;
  const why = await lab.js<string | null>("(__bh.camera.missionCommit() ?? __bh.camera.fcExecute())");
  if (why) lab.note("plan", `not flown: ${why}`);
  return { ...r, why };
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((1000 * (a - b)) / b) / 10 : null);
const ok = (e: { end: string }) => e.end === "until";

// ---------------------------------------------------------------------------------------------- scenarios

export const GARGANTUA: Scenario[] = [
  {
    id: "garg-mission-auto",
    title: "Mission scene — through the wormhole to the companion star, flown automatically to the end",
    tags: ["gargantua", "wormhole", "mission", "cinema"],
    minutes: 6,
    async run(lab): Promise<Verdict> {
      await scene(lab, MISSION_SCENE);
      await watch(lab);
      const e = await lab.fixed({ until: "!__bh.mission.active", maxWall: 600, every: 15 });
      const cap = await lab.js<string[]>("__bh.mission.captionText");
      const phases = lab.events.filter((x) => x.kind === "phase" && x.text.startsWith("mission:")).map((x) => x.text.split("→ ")[1]);
      // (then the orbit kept about the star a while: the autopilot's, as the caption promises)
      const d0 = await lab.js<number>("__bh.camera.flightInfo().targetDist");
      const keep = await lab.fixed({ until: "false", maxWall: 60, every: 30 });
      const d1 = await lab.js<number>("__bh.camera.flightInfo().targetDist");
      const w = await watched(lab);
      const done = cap[1] === "Mission complete";
      const all = ["ignition", "throat", "arrival", "raise", "orbit", "align", "transfer", "star"].every((p) => phases.includes(p));
      return {
        ok: ok(e) && done && all && d0 > 4 && d0 < 14 && d1 > 4 && d1 < 14 && w.nan === 0 && w.worst < 0.02 && keep.end !== "fail",
        why: `${e.why} · ${cap.join(" | ")} · phases ${phases.join(",")} · star ${d0?.toFixed(1)} → ${d1?.toFixed(1)} M`,
        metrics: { starM: d0, starAfterM: d1, phases: phases.length, crossJump: w.worst, nan: w.nan, warpOver: w.viol },
      };
    },
  },
  {
    id: "wh-ours-mouth-to-garg",
    title: "Wormhole, our side → Gargantua: at rest before our mouth, the MISSION tab's path into it, through",
    tags: ["gargantua", "wormhole", "fc", "crew"],
    minutes: 6,
    async run(lab) {
      await interstellar(lab);
      await place(lab, `__bh.game.wormhole("ours")`);
      await watch(lab);
      const p = await mission(lab, { target: "wormhole" });
      if (!p.ok) return { ok: false, why: p.note };
      const s0 = await spentMps(lab);
      const e = await lab.fixed({ until: `T.side === "gargantua" && c.flightInfo().region === "hole"`, maxWall: 600 });
      const after = await lab.fixed({ until: "false", maxWall: 15 });
      const dv = (await spentMps(lab)) - s0;
      // (a plan made on arrival — this universe's — flies: the orbit about Gargantua rounded)
      const op = await lab.js<string | { dv: number; n: number }>(`(() => {
        const c = __bh.camera, r = c.fcKerrOp("circ", "now");
        if (typeof r === "string" || !r.ok) return typeof r === "string" ? r : r.note;
        return c.fcSetPlan(r.burns, r.note) ?? c.fcExecute() ?? { dv: r.dvTotal, n: r.burns.length };
      })()`);
      lab.note("plan", `circularize on arrival: ${JSON.stringify(op)}`);
      const circ = await lab.fixed({ until: `T.nodes === 0 && T.auto !== "node"`, maxWall: 200 });
      const k = await lab.js<{ rp: number; ra: number } | null>(
        "(() => { const K = __bh.camera.fcKerrInfo(); return K ? { rp: K.o.rp, ra: K.o.ra } : null; })()",
      );
      const w = await watched(lab);
      const msg = said(lab, /Through the wormhole — Gargantua/);
      const suspended = said(lab, /suspended|Planning dropped/);
      return {
        ok:
          ok(e) &&
          !!msg &&
          w.nan === 0 &&
          w.viol === 0 &&
          w.worst < 0.02 &&
          after.end !== "fail" &&
          typeof op === "object" &&
          ok(circ) &&
          !suspended &&
          !!k &&
          Math.abs(k.ra - k.rp) < 0.02 * k.rp &&
          Math.abs(pct(dv, p.dvTotal ?? 0) ?? 99) < 5,
        why: `${e.why} · ${msg ?? "no crossing said"} · Δv ${Math.round(dv)} / plan ${Math.round(p.dvTotal ?? 0)} m/s · circularized ${JSON.stringify(k)} ${suspended ?? ""}`,
        metrics: {
          planDv: p.dvTotal,
          dv,
          dvErrPct: pct(dv, p.dvTotal ?? 0),
          crossJump: w.worst,
          warpOver: w.viol,
          nan: w.nan,
          rp: k?.rp,
          ra: k?.ra,
          simS: lab.T.t,
        },
      };
    },
  },
  {
    id: "wh-garg-mouth-to-ours",
    title: "Wormhole, Gargantua → our side: before the far mouth, pushed in, back in the solar system",
    tags: ["gargantua", "wormhole", "crew"],
    minutes: 4,
    async run(lab) {
      await interstellar(lab);
      await place(lab, `__bh.game.wormhole("gargantua")`);
      await watch(lab);
      // (inside the gluing sphere no autopilot flies: the pilot's own push — nose on the mouth, full
      // thrust to 30 km/s, then the coast through at warp)
      await lab.js(`(() => { const p = __bh.camera.pilot; p.auto = "none"; p.setAuto("none"); p.hold = "target"; return true; })()`);
      await lab.fixed({ until: "false", maxWall: 6 });
      await lab.js(`(__bh.camera.pilot.throttle = 1, true)`);
      const push = await lab.fixed({ until: `T.v > 30000`, maxWall: 120 });
      await lab.js(`(__bh.camera.pilot.throttle = 0, __bh.game.warp(1e5), true)`);
      lab.note("push", `${push.why} · ${lab.T.v} m/s · ${lab.T.label}`);
      const e = await lab.fixed({ until: `T.side === "ours"`, maxWall: 300 });
      const after = await lab.fixed({ until: "false", maxWall: 20 });
      const w = await watched(lab);
      const msg = said(lab, /back in the solar system/);
      return {
        ok: ok(e) && !!msg && w.nan === 0 && w.worst < 0.02 && after.end !== "fail",
        why: `${e.why} · ${msg ?? "no crossing said"} · ${lab.T.label}`,
        metrics: { crossJump: w.worst, nan: w.nan, warpOver: w.viol, simS: lab.T.t },
      };
    },
  },
  {
    id: "wh-garg-orbit-to-ours",
    title: "Wormhole, Gargantua → ours: from a 30 M orbit, the MISSION tab's intercept of the far mouth, through",
    tags: ["gargantua", "wormhole", "fc", "cinema"],
    minutes: 8,
    async run(lab) {
      // (the Cinema engine: the hole's intercepts are impulsive burns of a tenth of c)
      await interstellar(lab, "cinema");
      await place(lab, `__bh.game.orbit("gargantua", { rM: 30 })`);
      await watch(lab);
      const p = await mission(lab, { target: "wormhole" });
      if (!p.ok) return { ok: false, why: p.note };
      const e = await lab.fixed({ until: `T.side === "ours"`, maxWall: 600 });
      const after = await lab.fixed({ until: "false", maxWall: 20 });
      const w = await watched(lab);
      const msg = said(lab, /back in the solar system/);
      return {
        ok: ok(e) && !!msg && w.nan === 0 && w.viol === 0 && w.worst < 0.02 && after.end !== "fail",
        why: `${e.why} · ${msg ?? "no crossing said"} · plan ${p.note}`,
        metrics: { planDv: p.dvTotal, crossJump: w.worst, warpOver: w.viol, nan: w.nan, simS: lab.T.t },
      };
    },
  },
  {
    id: "wh-lt-to-mouth",
    title: "Gargantua: PLAN TRANSFER to the wormhole at 2 g (low thrust), through to our side",
    tags: ["gargantua", "wormhole", "lowthrust", "crew"],
    minutes: 12,
    async run(lab) {
      await interstellar(lab);
      await place(lab, `__bh.game.orbit("gargantua", { rM: 30 })`);
      await watch(lab);
      const note = await lab.js<string>(`__bh.camera.planTransfer("wormhole", 30)`);
      lab.note("plan", note);
      await engage(lab, "transfer");
      const s0 = await spentMps(lab);
      const e = await lab.fixed({ until: `T.side === "ours"`, maxWall: 900, every: 60 });
      const dv = (await spentMps(lab)) - s0;
      const w = await watched(lab);
      const planDv = Number(/Δv ≈ ([\d.]+) c/.exec(note)?.[1] ?? Number.NaN) * C;
      return {
        ok: ok(e) && w.nan === 0 && w.worst < 0.02,
        why: `${e.why} · ${note} · stage ${lab.T.xfer} · Δv ${Math.round(dv)} m/s`,
        metrics: { planDv, dv, dvErrPct: pct(dv, planDv), crossJump: w.worst, warpOver: w.viol, simS: lab.T.t },
      };
    },
  },
  {
    id: "garg-lt-orbit-30-45",
    title: "Gargantua: PLAN TRANSFER, a circular orbit 30 → 45 M at 2 g (spiral, circularize)",
    tags: ["gargantua", "lowthrust", "crew", "orbit"],
    minutes: 6,
    async run(lab) {
      await interstellar(lab);
      await place(lab, `__bh.game.orbit("gargantua", { rM: 30 })`);
      await watch(lab);
      const note = await lab.js<string>(`__bh.camera.planTransfer("orbit", 45)`);
      lab.note("plan", note);
      await engage(lab, "transfer");
      const s0 = await spentMps(lab);
      const e = await lab.fixed({ until: `T.auto !== "transfer"`, maxWall: 600, every: 60 });
      const settle = await lab.fixed({ until: "false", maxWall: 20 });
      const dv = (await spentMps(lab)) - s0;
      const i = await lab.js<{ r: number; vr: number; speed: number; want: number }>(
        "(() => { const i = __bh.camera.flightInfo(); return { r: i.r, vr: i.vr, speed: i.speed, want: i.wantSpeed }; })()",
      );
      const w = await watched(lab);
      const planDv = Number(/Δv ≈ ([\d.]+) c/.exec(note)?.[1] ?? Number.NaN) * C;
      const msg = said(lab, /Transfer done/);
      return {
        ok:
          ok(e) &&
          !!msg &&
          Math.abs(i.r - 45) < 1 &&
          Math.abs(i.vr) < 2e-3 &&
          w.viol === 0 &&
          settle.end !== "fail" &&
          (pct(dv, planDv) ?? 99) < 10,
        why: `${e.why} · ${msg ?? "not done"} · r ${i.r.toFixed(2)} M · vr ${i.vr.toExponential(1)} · Δv ${Math.round(dv)} / ${Math.round(planDv)} m/s`,
        metrics: { rM: i.r, vr: i.vr, planDv, dv, dvErrPct: pct(dv, planDv), warpOver: w.viol, simS: lab.T.t },
      };
    },
  },
  ...(["miller", "mann", "edmunds"] as const).map(
    (world): Scenario => ({
      id: `garg-lt-${world}`,
      title: `Gargantua: PLAN TRANSFER to ${world[0]!.toUpperCase()}${world.slice(1)} at 2 g, in orbit about it`,
      tags: ["gargantua", "lowthrust", "crew", world],
      minutes: 10,
      async run(lab) {
        await interstellar(lab);
        await place(lab, `__bh.game.orbit("gargantua", { rM: 30 }), __bh.game.target(${JSON.stringify(world)})`);
        await watch(lab);
        const note = await lab.js<string>(`__bh.camera.planTransfer("star", 30, { orbitStar: true })`);
        lab.note("plan", note);
        await engage(lab, "transfer");
        const s0 = await spentMps(lab);
        const e = await lab.fixed({ until: `T.auto !== "transfer"`, maxWall: 700, every: 60 });
        // (then the orbit autopilot closes in and holds the orbit)
        const o = await lab.fixed({
          until: `T.soi === ${JSON.stringify(world)} && !!T.orbit && T.orbit.pe > 0 && T.orbit.ecc < 0.3`,
          maxWall: 240,
        });
        const dv = (await spentMps(lab)) - s0;
        const w = await watched(lab);
        const stages = w.stages.map((x) => x[1]).join(",");
        const planDv = Number(/Δv ≈ ([\d.]+) c/.exec(note)?.[1] ?? Number.NaN) * C;
        return {
          ok: ok(e) && ok(o) && w.nan === 0 && w.viol === 0 && (pct(dv, planDv) ?? 99) < 15,
          why: `${e.why} · ${o.why} · ${lab.T.label} ${JSON.stringify(lab.T.orbit)} · Δv ${Math.round(dv)} / ${Math.round(planDv)} m/s · ${stages}`,
          metrics: { planDv, dv, dvErrPct: pct(dv, planDv), pe: lab.T.orbit?.pe, ap: lab.T.orbit?.ap, warpOver: w.viol, simS: lab.T.t },
        };
      },
    }),
  ),
  ...(["miller", "mann", "edmunds"] as const).map(
    (world): Scenario => ({
      id: `garg-fc-${world}`,
      title: `Gargantua: the MISSION tab to ${world[0]!.toUpperCase()}${world.slice(1)} (Cinema engine), in orbit about it`,
      tags: ["gargantua", "fc", "cinema", world],
      minutes: 6,
      async run(lab) {
        await interstellar(lab, "cinema");
        await place(lab, `__bh.game.orbit("gargantua", { rM: 30 })`);
        await watch(lab);
        const p = await mission(lab, { target: world, orbit: true });
        if (!p.ok) return { ok: false, why: p.note };
        const e = await lab.fixed({ until: `T.nodes === 0 && T.auto !== "node"`, maxWall: 500 });
        const o = await lab.fixed({
          until: `T.soi === ${JSON.stringify(world)} && !!T.orbit && T.orbit.pe > 0 && T.orbit.ecc < 0.3`,
          maxWall: 240,
        });
        const w = await watched(lab);
        return {
          ok: ok(e) && ok(o) && w.nan === 0 && w.viol === 0,
          why: `${e.why} · ${o.why} · ${lab.T.label} ${JSON.stringify(lab.T.orbit)} · plan ${p.note}`,
          metrics: { planDv: p.dvTotal, pe: lab.T.orbit?.pe, ap: lab.T.orbit?.ap, warpOver: w.viol, simS: lab.T.t },
        };
      },
    }),
  ),
  {
    id: "garg-kerr-ops",
    title: "Gargantua: the hole's operations — Hohmann 30 → 40 M, a plane change, circularize (Cinema engine)",
    tags: ["gargantua", "fc", "kerr", "cinema"],
    minutes: 6,
    async run(lab) {
      await interstellar(lab, "cinema");
      await place(lab, `__bh.game.orbit("gargantua", { rM: 30 })`);
      await watch(lab);
      const op = async (kind: string, x?: unknown) => {
        const r = await lab.js<{ ok: boolean; note: string; burns: unknown[]; dvTotal: number; afterText?: string } | string>(
          `(() => { const r = __bh.camera.fcKerrOp(${JSON.stringify(kind)}, ${JSON.stringify(x ?? null)} ?? undefined);
            if (typeof r === "string" || !r.ok) return r; const w = __bh.camera.fcSetPlan(r.burns, r.note) ?? __bh.camera.fcExecute(); return w ?? r; })()`,
        );
        lab.note(
          "plan",
          `${kind} ${x ?? ""}: ${typeof r === "string" ? r : `${r.note} · Δv ${Math.round(r.dvTotal)} m/s · ${r.afterText}`}`,
        );
        if (typeof r === "string" || !r.ok) return null;
        const e = await lab.fixed({ until: `T.nodes === 0 && T.auto !== "node"`, maxWall: 300 });
        const k = await lab.js<{ r: number; vr: number; inc: number }>(
          `(() => { const i = __bh.camera.flightInfo(), K = __bh.camera.fcKerrInfo(); return { r: i.r, vr: i.vr, inc: K ? K.o.inc * 180 / Math.PI : null, rp: K?.o.rp, ra: K?.o.ra }; })()`,
        );
        lab.note("orbit", `${kind}: ${JSON.stringify(k)} · ${e.why}`);
        return { e, k };
      };
      const h = await op("hohmann", 40);
      const i = await op("inc", 10);
      const w = await watched(lab);
      const K = await lab.js<{ rp: number; ra: number; inc: number }>(
        "(() => { const K = __bh.camera.fcKerrInfo(); return K ? { rp: K.o.rp, ra: K.o.ra, inc: K.o.inc * 180 / Math.PI } : null; })()",
      );
      return {
        ok:
          !!h &&
          ok(h.e) &&
          !!i &&
          ok(i.e) &&
          !!K &&
          Math.abs(K.rp - 40) < 1 &&
          Math.abs(K.ra - 40) < 1 &&
          Math.abs(K.inc - 10) < 1 &&
          w.viol === 0,
        why: `after: ${JSON.stringify(K)}`,
        metrics: { rp: K?.rp, ra: K?.ra, inc: K?.inc, warpOver: w.viol, simS: lab.T.t },
      };
    },
  },
  ...(
    [
      ["miller", 0, 20],
      ["mann", 12, -35],
      ["edmunds", 6, 55],
    ] as const
  ).map(
    ([world, lat, lon]): Scenario => ({
      id: `garg-land-${world}`,
      title: `Gargantua: the landing autopilot on ${world[0]!.toUpperCase()}${world.slice(1)} from a 200 km orbit (2 g)`,
      tags: ["gargantua", "landing", "crew", world],
      minutes: 5,
      async run(lab) {
        await interstellar(lab);
        await place(lab, `__bh.game.orbit(${JSON.stringify(world)}, { altKm: 200, nu: ${lon} + ${lat} })`);
        await watch(lab);
        await engage(lab, "land");
        const e = await lab.fixed({ until: "c.landed", maxWall: 400 });
        const settle = await lab.fixed({ until: "false", maxWall: 10 });
        const td = said(lab, /Landed on|Touchdown|touchdown/);
        const sink = Number(/([\d.]+) m\/s/.exec(td ?? "")?.[1] ?? Number.NaN);
        const w = await watched(lab);
        return {
          ok: ok(e) && settle.end !== "fail" && (await lab.js<boolean>("__bh.camera.landed")) && w.nan === 0,
          why: `${e.why} · ${td ?? "no touchdown said"} · ${lab.T.label}`,
          metrics: { sinkMps: sink, warpOver: w.viol, simS: lab.T.t },
        };
      },
    }),
  ),
  {
    id: "garg-takeoff-miller",
    title: "Gargantua: from Miller's shallows (1.3 g, the sea) to orbit — the take-off autopilot at 2 g",
    tags: ["gargantua", "takeoff", "crew", "miller"],
    minutes: 5,
    async run(lab) {
      await interstellar(lab);
      await place(lab, `__bh.game.land("miller", 0, 20)`);
      await watch(lab);
      await engage(lab, "takeoff");
      const e = await lab.fixed({ until: `T.auto === "orbit" || /In orbit around/.test(T.label ?? "")`, maxWall: 400 });
      const hold = await lab.fixed({ until: "false", maxWall: 30 });
      const msg = said(lab, /In orbit around Miller/);
      const w = await watched(lab);
      return {
        ok: ok(e) && !!msg && hold.end !== "fail" && !!lab.T.orbit && lab.T.orbit.pe > 0 && lab.T.orbit.ecc < 0.3 && w.nan === 0,
        why: `${e.why} · ${msg ?? "not in orbit"} · ${lab.T.label} ${JSON.stringify(lab.T.orbit)}`,
        metrics: { pe: lab.T.orbit?.pe, ap: lab.T.orbit?.ap, warpOver: w.viol, simS: lab.T.t },
      };
    },
  },
  {
    id: "tour-earth-jupiter",
    title: "Grand tour, leg 1: a 400 km Earth orbit → Jupiter, in orbit (MISSION tab, 2 g)",
    tags: ["tour", "ours", "fc", "crew", "jupiter"],
    minutes: 12,
    async run(lab) {
      await interstellar(lab);
      await place(lab, `__bh.game.orbit("earth", { altKm: 400 })`);
      await watch(lab);
      const p = await mission(lab, { target: "jupiter", orbit: true, altKm: 500000 });
      if (!p.ok) return { ok: false, why: p.note };
      const s0 = await spentMps(lab);
      const e = await lab.fixed({ until: `T.soi === "jupiter" && T.nodes === 0 && T.auto !== "node"`, maxWall: 900, every: 60 });
      const dv = (await spentMps(lab)) - s0;
      const w = await watched(lab);
      const o = lab.T.orbit;
      return {
        ok: ok(e) && !!o && o.pe > 0 && Number.isFinite(o.ap) && w.viol === 0 && Math.abs(pct(dv, p.dvTotal ?? 0) ?? 99) < 5,
        why: `${e.why} · ${lab.T.label} ${JSON.stringify(o)} · Δv ${Math.round(dv)} / ${Math.round(p.dvTotal ?? 0)} m/s`,
        metrics: { planDv: p.dvTotal, dv, dvErrPct: pct(dv, p.dvTotal ?? 0), pe: o?.pe, ap: o?.ap, warpOver: w.viol, simS: lab.T.t },
      };
    },
  },
  {
    id: "tour-jupiter-wormhole",
    title: "Grand tour, leg 2: Jupiter orbit → the wormhole (MISSION tab, 2 g), through to Gargantua",
    tags: ["tour", "wormhole", "fc", "crew", "jupiter"],
    minutes: 12,
    async run(lab) {
      await interstellar(lab);
      await place(lab, `__bh.game.orbit("jupiter", { altKm: 500000 })`);
      await watch(lab);
      const p = await mission(lab, { target: "wormhole" });
      if (!p.ok) return { ok: false, why: p.note };
      const s0 = await spentMps(lab);
      const e = await lab.fixed({ until: `T.side === "gargantua" && c.flightInfo().region === "hole"`, maxWall: 900, every: 60 });
      const dv = (await spentMps(lab)) - s0;
      const w = await watched(lab);
      return {
        ok: ok(e) && w.nan === 0 && w.viol === 0 && w.worst < 0.02 && Math.abs(pct(dv, p.dvTotal ?? 0) ?? 99) < 5,
        why: `${e.why} · ${lab.T.label} · Δv ${Math.round(dv)} / ${Math.round(p.dvTotal ?? 0)} m/s`,
        metrics: { planDv: p.dvTotal, dv, dvErrPct: pct(dv, p.dvTotal ?? 0), crossJump: w.worst, warpOver: w.viol, simS: lab.T.t },
      };
    },
  },
  {
    id: "tour-grand",
    title: "Grand tour: Earth orbit → Jupiter → the wormhole → Gargantua → in orbit about Miller, in one flight",
    tags: ["tour", "wormhole", "fc", "lowthrust", "crew", "long"],
    minutes: 25,
    async run(lab) {
      await interstellar(lab);
      await place(lab, `__bh.game.orbit("earth", { altKm: 400 })`);
      await watch(lab);
      const legs: Record<string, unknown> = {};
      const p1 = await mission(lab, { target: "jupiter", orbit: true, altKm: 500000 });
      if (!p1.ok) return { ok: false, why: `leg 1: ${p1.note}` };
      const e1 = await lab.fixed({ until: `T.soi === "jupiter" && T.nodes === 0 && T.auto !== "node"`, maxWall: 400, every: 60 });
      legs.jupiter = { end: e1.end, label: lab.T.label, orbit: lab.T.orbit };
      if (!ok(e1)) return { ok: false, why: `leg 1: ${e1.why}`, metrics: legs };
      const p2 = await mission(lab, { target: "wormhole" });
      if (!p2.ok) return { ok: false, why: `leg 2: ${p2.note}`, metrics: legs };
      const e2 = await lab.fixed({ until: `T.side === "gargantua" && c.flightInfo().region === "hole"`, maxWall: 500, every: 60 });
      legs.wormhole = { end: e2.end, label: lab.T.label };
      if (!ok(e2)) return { ok: false, why: `leg 2: ${e2.why}`, metrics: legs };
      // (clear of the mouth: a transfer to Miller at the Crew engine's 2 g)
      await lab.fixed({ until: "false", maxWall: 10 });
      await lab.js(`(__bh.game.target("miller"), true)`);
      const n3 = await lab.js<string>(`__bh.camera.planTransfer("star", 30, { orbitStar: true })`);
      lab.note("plan", n3);
      await engage(lab, "transfer");
      const e3 = await lab.fixed({
        until: `T.soi === "miller" && !!T.orbit && T.orbit.pe > 0 && T.orbit.ecc < 0.3`,
        maxWall: 400,
        every: 60,
      });
      legs.miller = { end: e3.end, label: lab.T.label, orbit: lab.T.orbit, stage: lab.T.xfer };
      const w = await watched(lab);
      return {
        ok: ok(e3) && w.nan === 0 && w.viol === 0 && w.worst < 0.02,
        why: `${e3.why} · ${lab.T.label} ${JSON.stringify(lab.T.orbit)}`,
        metrics: { ...legs, crossJump: w.worst, warpOver: w.viol, simS: lab.T.t },
      };
    },
  },
];
