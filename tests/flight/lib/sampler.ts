// The flight lab's page-side sampler (window.__lab): every figure of the flight read loosely from __bh — the
// craft, its orbit, the autopilot and its hold, the hub's card, the entry and its guidance (commanded bank,
// predicted miss, the approach's aimed and flown slopes), the air, the attitude, the rollout, the docking,
// the planner's nodes, the propellant — and the assistants' own graphs (optimum, corridor, flown) with the
// craft's point on them. Shared by the flight lab (tests/flight/lib/lab.ts) and every e2e test's recorder
// (tests/e2e/lib/telemetry.ts).

/** What the page reports each sample — `window.__lab.sample()` (the fields absent where they do not apply). */
// biome-ignore lint/suspicious/noExplicitAny: the page's own state, read loosely (a field missing is null)
export type Sample = Record<string, any>;

/** The page side: the sampler, the messages caught — installed once per page. */
export const LAB_PAGE = `(() => {
  if (window.__lab) return true;
  const safe = (f) => { try { const v = f(); return v === undefined ? null : v; } catch { return null; } };
  const r = (x, k = 1) => typeof x === "number" && Number.isFinite(x) ? Math.round(x * k) / k : x;
  const msgs = [];
  const c = __bh.camera;
  const prev = c.onPilotMessage;
  c.onPilotMessage = (t) => { msgs.push({ t: __bh.sim.time * 4.925490947e-6 * __bh.settings.massSolar, text: String(t) }); prev?.(t); };
  // (the assistants' own graphs — the corridor, the optimum, what was flown — the latest of each kind, and
  // where the craft was on it at each sample: the corridor charts of the report)
  const graphs = {}, onGraph = {};
  // (light: the hub's and the runway's caches kept — cheaper, sampled every half second of a test's stepped
  // flight; their caches are keyed on the autopilot and the wheels, so a read never returns a state before's)
  const sample = (light = false) => {
    const c = __bh.camera, p = c.pilot, s = __bh.settings, st = safe(() => __bh.game.status()) ?? {};
    // (the hub's card and the runway's view anew: their caches last a fraction of a wall second — at fixed
    // steps, many seconds of flight: a sample read the card of the final's turn on its flare)
    if (!light) c.hubCache = c.runwayCache = null;
    const h = safe(() => c.hubInfo()), R = c.entryRun, A = c.airFlight, i = safe(() => c.flightInfo()) ?? {};
    const G = h?.graph;
    if (G && G.kind) {
      graphs[G.kind] = { kind: G.kind, title: G.title, x: G.x, y: G.y, ideal: G.ideal, lo: G.lo, hi: G.hi, flown: G.flown,
        marks: G.marks, levels: G.levels ?? null, state: G.state, about: G.about ?? null };
      if (G.now) (onGraph[G.kind] ??= []).push([__bh.sim.time * 4.925490947e-6 * s.massSolar, G.now[0], G.now[1], G.state]);
    }
    const warp = s.timeSpeed * 4.925490947e-6 * s.massSolar;
    return {
      t: r(__bh.sim.time * 4.925490947e-6 * s.massSolar, 1000), tM: __bh.sim.time, wall: Math.round(performance.now()),
      warp: r(warp, 100), autoWarp: s.autoWarp, rails: safe(() => c.railsNote),
      vessel: s.vessel, mode: s.flightMode, auto: p.auto, hold: p.hold, assist: p.assist, thr: r(p.throttle, 1000),
      label: st.label ?? null, side: st.side ?? null, soi: st.soi ?? null,
      alt: r(st.altKm, 1000), v: r(st.speed, 100), vz: r(st.vVert, 100),
      orbit: st.orbit ? { pe: r(st.orbit.peKm, 10), ap: r(st.orbit.apKm, 10), inc: r(st.orbit.incDeg, 100), ecc: r(st.orbit.ecc, 1e5) } : null,
      target: st.target ? { id: st.target.id, km: r(st.target.distKm, 1000), rate: r(st.target.rate, 1000), ca: r(st.target.caKm, 1000) } : null,
      next: st.next ? st.next.kind + ":" + st.next.body + " " + Math.round(st.next.inS) + "s" : null,
      hub: h ? { title: h.title, phase: h.phase, next: h.next, rows: h.rows, say: h.say, graph: h.graph ? h.graph.kind + ":" + h.graph.state : null } : null,
      entry: R ? { ph: R.phase, site: R.site?.name ?? null, tBurn: r(R.tBurn), dv: r(R.dv, 10), prof: R.prof?.phase ?? null, leg: R.leg ?? null,
        ga: R.gaN ?? 0, dh: R.dhCheck ? { across: r(R.dhCheck.across, 10), dh: r(R.dhCheck.dh, 10), ga: R.dhCheck.ga } : null,
        miss: R.guid?.lastMiss ? { along: r(R.guid.lastMiss.along / 1000, 10), across: r(R.guid.lastMiss.across / 1000, 10) } : null,
        app: R.app ? { along: r(R.app.along), across: r(R.app.across, 10), agl: r(R.app.agl), speed: r(R.app.speed, 10), gRef: r(((R.app.gRef ?? NaN) * 180) / Math.PI, 100), gam: r(((R.app.gam ?? NaN) * 180) / Math.PI, 100), brake: r(c.airBrake, 100), spiral: R.spiral ? { r: r(R.spiral.r), side: R.spiral.side } : null } : null } : null,
      runway: safe(() => { const w = c.runwayView?.(); return w ? { along: r(w.along), across: r(w.across, 10) } : null; }),
      air: A ? { g: r(A.g, 100), gPeak: r(A.gPeak, 100), fail: A.failure ?? null, body: A.body || null,
        mach: r(A.last?.out?.mach, 100), q: r((A.last?.out?.q ?? 0) / 1000, 100), alpha: r(((A.last?.out?.alpha ?? 0) * 180) / Math.PI, 100),
        beta: r(((A.last?.out?.beta ?? 0) * 180) / Math.PI, 100), heat: r((A.last?.out?.heat ?? 0) / 1000, 10), stalled: !!A.last?.out?.stalled,
        ld: A.last?.out?.D > 0 ? r(A.last.out.L / A.last.out.D, 100) : null, h: r(A.last?.h), aspeed: r(A.last?.speed, 10) } : null,
      att: safe(() => { const a = c.attitudeNow(); return a.pitch === undefined ? null : { pitch: r((a.pitch * 180) / Math.PI, 100), bank: r((a.bank * 180) / Math.PI, 100), hdg: r((a.heading * 180) / Math.PI, 10) }; }),
      bankCmd: R && typeof R.bank === "number" ? r((R.bank * 180) / Math.PI, 100) : null,
      landed: !!c.ourLanded, landedOn: c.ourLanded?.body ?? null, rolling: !!c.rolling,
      rollSite: c.rollSite?.name ?? null, steer: r(((c.noseSteer ?? 0) * 180) / Math.PI, 100),
      dock: c.dockAuto?.phase ?? null,
      dockInfo: c.dockInfo ? { range: r(c.dockInfo.range, 100), lateral: r(c.dockInfo.lateral, 100), closing: r(c.dockInfo.closing, 1000), angle: r(c.dockInfo.angle, 10) } : null,
      docked: !!c.docked, links: safe(() => __bh.fleet?.links?.length ?? null),
      nodes: c.plan?.nodes?.length ?? 0,
      refine: safe(() => { const q = c.lastRefine; if (!q) return null; const n = q.result && q.result.node; return { role: q.role, at: r(q.at, 1), err: (q.result && q.result.error) || null, node: n ? { t: r(n.t, 1), dvMps: r(Math.hypot(...n.dv) * 299792458, 10), aim: n.aim ? { ok: n.aim.ok, passKm: r(n.aim.passKm, 10) } : null } : null }; }), burning: i.plan?.burning ?? null, xfer: c.transfer?.stage ?? null,
      fuel: r(i.engine?.fuel?.fraction, 1000), spent: r(c.spent * 299792458, 10),
      mission: safe(() => __bh.mission?.active ? __bh.mission.phase : null),
      animate: s.animate, frozen: safe(() => __bh.frozen ?? null),
    };
  };
  // (the flight waiting on the planner's worker — a node's re-aim, the entry's next bank: a player's
  // frames go on at the wall's pace meanwhile, so the fixed steps do too, not hundreds ahead of it)
  const waiting = () => !!(c.plan?.nodes?.some((n) => c.refineState?.get(n)?.pending) || c.entryRun?.pending);
  window.__lab = { msgs, sample, graphs, onGraph, waiting };
  return true;
})()`;
