// A whole return flown live, as a player sees it: from a 400 km orbit, the entry autopilot to a runway —
// the deorbit planned, the wait (time sped up), the burn (real time), the fall to the entry interface,
// the entry, the glide, the touchdown, the rollout — in the page's own frame loop (not at fixed steps),
// its progress printed every 10 s (every 2 s on the runway). On the remote Mac it opens full screen (scripts/remote.ts):
//
//   bun scripts/remote.ts run --name live-entry -- bun scripts/live-entry.ts [--site Edwards] [--inc 40] [--max-min 75] [--align]
//
// --align: first the flight computer's plane change that puts a pass over the site (`plan_maneuver` align_over_site,
// src/fc/land-ops.ts), flown by its node autopilot, then the entry autopilot. Shots (cockpit) at each step in
// remote-results/live-entry/<site>/.
//
// Ends 0 landed and stopped on the runway, 1 otherwise (crashed, off the runway, no deorbit found, over time).
// The terrain tiles stay off (a tile streamed in mid-approach changes the ground under the autopilot).
import { RUNWAY_LENGTH, SITES } from "../src/game/sites";
import { App, stopServer } from "../tests/e2e/lib/app";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const SITE = arg("site", "Edwards");
const INC = Number(arg("inc", "40"));
const MAX_MIN = Number(arg("max-min", "75"));
const ALIGN = process.argv.includes("--align");
// --tiles: the terrain tiles and their imagery on (the e2e blocks them by default): the landing zone's data logged as it comes
const TILES = process.argv.includes("--tiles");
const site = SITES.find((q) => q.runway && q.name.toLowerCase().includes(SITE.toLowerCase()));
if (!site)
  throw new Error(
    `no runway "${SITE}" — ${SITES.filter((q) => q.runway)
      .map((q) => q.name)
      .join(", ")}`,
  );

const t0 = Date.now();
const clock = () => {
  const s = Math.round((Date.now() - t0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const say = (s: string) => console.log(`[${clock()}] ${s}`);
const SHOTS = `remote-results/live-entry/${SITE.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
let shotN = 0;

const app = await App.boot({ hash: "scene=game:artemis", tiles: TILES });
// (a shot at a key state: once the tracer settled, 30 s at most — else the page as it is, said)
const shot = async (what: string) => {
  const f = `${SHOTS}/${String(++shotN).padStart(2, "0")}-${what}.png`;
  const ok = await Promise.race([app.shot(f).then(() => true), Bun.sleep(30_000).then(() => false)]);
  if (!ok) await app.snap(f);
  const mount = await app.js<string>(`__bh.settings.shipMount`);
  say(`shot ${f} (${mount}${ok ? "" : ", tracer not settled — taken as is"})`);
};
let code = 1;
try {
  await app.waitFor("__bh.camera.piloting", 60_000);
  let seenAlign = 0;
  // (the Earth's relief in — one global map: Edwards's 700 m tell it has come, whatever the site)
  await app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 120_000);
  const setup = await app.js<string>(`(() => {
    const g = __bh.game, c = __bh.camera;
    g.orbit("earth", { altKm: 400, inc: ${INC} });
    window.__live = { msgs: [] };
    const prev = c.onPilotMessage;
    c.onPilotMessage = (t) => { window.__live.msgs.push(t); prev?.(t); };
    const site = ${JSON.stringify(site)};
    c.entrySite = site;
    __bh.settings.shipMount = "cockpit";
    const st = g.status();
    return site.name + " — from " + st.label + ", " + st.altKm.toFixed(0) + " km, inc " + (st.orbit?.incDeg ?? 0).toFixed(1) + "°";
  })()`);
  say(`in orbit for ${setup}`);
  await Bun.sleep(2000);
  await shot("orbit");
  if (ALIGN) {
    const r = await app.js<unknown>(`(async () => {
      const tool = __bh.tars.tools().find((t) => t.name === "plan_maneuver");
      try { return await tool.run({ op: "align_over_site", site: ${JSON.stringify(site.name)} }, new AbortController().signal); }
      catch (e) { return { error: String(e?.message ?? e) }; }
    })()`);
    say(`align over the site: ${JSON.stringify(r)}`);
    if ((r as { error?: string })?.error || (r as { ok?: boolean })?.ok === false) throw new Error("align_over_site refused");
    // (the node autopilot flies the plane change: done when it lets go)
    const a0 = Date.now();
    let burnShot = false;
    for (;;) {
      await Bun.sleep(5000);
      const q = await app.js<{
        auto: string;
        plan: { t: number; dv: number; label: string }[] | null;
        msgs: string[];
        inc: number;
      }>(`(() => {
        const c = __bh.camera, P = c.fcPlan(), st = __bh.game.status();
        return { auto: c.pilot.auto, plan: P ? P.burns.map((b) => ({ t: b.t, dv: Math.hypot(...b.dv), label: b.label })) : null,
          msgs: window.__live.msgs, inc: st.orbit?.incDeg ?? 0 };
      })()`);
      for (const m of q.msgs.slice(seenAlign)) say(`» ${m}`);
      seenAlign = q.msgs.length;
      say(
        `align: ${q.auto} · inc ${q.inc.toFixed(2)}° · ${q.plan?.map((b) => `${b.label} in ${b.t.toFixed(0)} s, ${b.dv.toFixed(0)} m/s`).join("; ") ?? "no plan"}`,
      );
      if (!burnShot && q.plan && q.plan[0] && q.plan[0].t < 5) {
        burnShot = true;
        await shot("align-burn");
      }
      if (q.auto !== "node" && q.auto !== "burns") break;
      if (Date.now() - a0 > 20 * 60_000) throw new Error("the plane change not flown within 20 min");
    }
    say(
      `plane change flown — ${await app.js<string>(`(() => { const o = __bh.game.status().orbit; return o ? "inc " + o.incDeg.toFixed(2) + "°, " + o.peKm.toFixed(0) + " × " + o.apKm.toFixed(0) + " km" : "?"; })()`)}`,
    );
    await shot("aligned");
  }
  await app.js(`(__bh.settings.shipMount = "cockpit", __bh.camera.pilot.setAuto("entry"))`);
  say(`entry autopilot engaged`);

  let seen = 0,
    errSeen = 0,
    touched = 0,
    every = 10_000,
    lastAlong: number | null = null,
    lastAt = 0;
  let stopped = 0;
  let lastPhase: string | null = null;
  seen = seenAlign;
  for (;;) {
    await Bun.sleep(every);
    const r = await app.js<{
      msgs: string[];
      phase: string | null;
      label: string;
      altKm: number;
      speed: number;
      vVert: number;
      warp: number;
      app: { along: number; across: number; agl: number; speed: number } | null;
      landed: boolean;
      fail: string | null;
      auto: string;
      rwy: { along: number; across: number } | null;
      errors: number;
      guid: { along: number; across: number; bank: number } | null;
      leg: string | null;
      brake: number;
      energy: { e: number; need: number; toGo: number; ld: number; low: boolean } | null;
      data: string | null;
    }>(`(() => {
      const c = __bh.camera, st = __bh.game.status(), R = c.entryRun;
      const Msec = 4.925490947e-6 * __bh.settings.massSolar;
      let rwy = null;
      try { rwy = c.runwayView ? c.runwayView() : null; } catch {}
      return {
        msgs: window.__live.msgs, phase: R ? R.phase : null, label: st.label, altKm: st.altKm, speed: st.speed, vVert: st.vVert,
        warp: __bh.settings.timeSpeed * Msec, app: R?.app ? { along: R.app.along, across: R.app.across, agl: R.app.agl, speed: R.app.speed } : null,
        landed: !!c.ourLanded, fail: c.airFlight?.failure ?? null, auto: c.pilot.auto,
        rwy: rwy ? { along: rwy.along, across: rwy.across } : null, errors: __bh.game.errors?.length ?? 0,
        guid: R?.guid?.lastMiss ? { along: R.guid.lastMiss.along, across: R.guid.lastMiss.across, bank: (R.bankFlown ?? R.bank ?? 0) * 57.2958 } : null,
        leg: R?.leg ?? null, brake: c.airBrake ?? 0, energy: R?.app?.energy ?? null,
        data: ${TILES} ? (() => {
          const r = __bh.renderer, et = r.earthTiles, sc = r.earthScenery.stats(), site = c.entrySite;
          const at = site ? et.contactAt(site.lat, site.lon) : null;
          return "maps " + r.earthMaps.tier + " · relief pending " + et.pending + ", failing " + et.failing + ", failed " + et.failed +
            " · photos pending " + et.orthoPending + " · scenery " + sc.status +
            (at ? " · at the site: drawn z" + at.drawnZ + " (contact z" + at.contactZ + "), " + at.src + " z" + at.z : "") +
            (r.arrival?.key ? " · arrival asked " + r.arrival.stats.urls + ", in " + r.arrival.stats.done + ", failed " + r.arrival.stats.failed +
              ", " + (r.arrival.stats.bytes / 1e6).toFixed(0) + " MB" + (r.arrival.stats.t1 ? " (done in " + ((r.arrival.stats.t1 - r.arrival.stats.t0) / 1000).toFixed(0) + " s)" : "") : "");
        })() : null,
      };
    })()`);
    for (const m of r.msgs.slice(seen)) say(`» ${m}`);
    seen = r.msgs.length;
    // (the page's errors as they come: before or after what went wrong)
    for (const e of app.cdp.errors.slice(errSeen)) say(`PAGE ERROR: ${e.split("\n").slice(0, 4).join(" ⏎ ")}`);
    errSeen = app.cdp.errors.length;
    const where = r.app
      ? `approach: ${(r.app.along / 1000).toFixed(1)} km along, ${r.app.across.toFixed(0)} m across, ${r.app.agl.toFixed(0)} m up`
      : `${r.altKm.toFixed(1)} km up`;
    say(
      `${r.phase ?? r.auto} · ${r.label} · ${where} · ${r.speed.toFixed(0)} m/s (${r.vVert.toFixed(0)} vertical) · ×${r.warp.toFixed(0)}` +
        (r.phase === "entry" && r.guid
          ? ` · guidance: miss ${(r.guid.along / 1000).toFixed(1)} km along, ${(r.guid.across / 1000).toFixed(1)} km across, bank ${r.guid.bank.toFixed(0)}°`
          : "") +
        (r.phase === "glide" ? ` · leg ${r.leg ?? "—"}, air brake ${(100 * r.brake).toFixed(0)} %` : "") +
        (r.phase === "glide" && r.energy
          ? ` · energy ${(r.energy.e / 1000).toFixed(1)} km for ${(r.energy.need / 1000).toFixed(1)} (${(r.energy.toGo / 1000).toFixed(0)} km to go, L/D ${r.energy.ld.toFixed(1)}${r.energy.low ? ", LOW" : ""})`
          : ""),
    );
    if (r.data) say(`  data: ${r.data}`);
    if (r.phase !== lastPhase) {
      lastPhase = r.phase;
      if (r.phase) await shot(`phase-${r.phase}`);
    }
    if (r.fail) {
      say(`FAILED: ${r.fail}`);
      await shot("failed");
      break;
    }
    // (on its wheels: the entry autopilot lets go at the touchdown, the Ranger rolls on — "landed" only
    // once it stands; from there every 2 s, until it stops)
    if (!touched && r.msgs.some((m) => m.startsWith("Touchdown"))) {
      touched = Date.now();
      every = 2000;
      await shot("touchdown");
    }
    // (stopped: by its place on the runway — the status's speed is against the Earth's centre, its turning
    // ground's 300 m/s and more in it)
    const now = Date.now();
    const gs = touched && r.rwy && lastAlong !== null ? Math.abs(r.rwy.along - lastAlong) / ((now - lastAt) / 1000) : null;
    if (touched && r.rwy)
      say(
        `  rollout: ${r.rwy.along.toFixed(0)} m past the threshold, ${r.rwy.across.toFixed(1)} m off its axis${gs === null ? "" : `, ${gs.toFixed(1)} m/s`}`,
      );
    lastAlong = r.rwy ? r.rwy.along : null;
    lastAt = now;
    if (gs !== null && gs < 0.25) {
      if (++stopped >= 2) {
        const on = Math.abs(r.rwy!.across) < 45 && r.rwy!.along > 0 && r.rwy!.along < RUNWAY_LENGTH;
        say(
          `STOPPED ${on ? "on" : "OFF"} the runway: ${r.rwy!.along.toFixed(0)} m past the threshold (of ${RUNWAY_LENGTH}), ${r.rwy!.across.toFixed(1)} m off its axis`,
        );
        code = on ? 0 : 1;
        await shot("stopped");
        break;
      }
    } else stopped = 0;
    if (touched && Date.now() - touched > 5 * 60_000) {
      say("still rolling 5 min after the touchdown — stopped");
      break;
    }
    if (!touched && !r.phase && r.auto !== "entry" && !r.landed) {
      say("the entry autopilot let go before the ground (see its last message)");
      break;
    }
    if (Date.now() - t0 > MAX_MIN * 60_000) {
      say(`over ${MAX_MIN} min — stopped`);
      break;
    }
  }
  for (const e of app.cdp.errors.slice(errSeen)) say(`PAGE ERROR: ${e.split("\n").slice(0, 4).join(" ⏎ ")}`);
  // (the autopilot's flight record — its plan, samples, events, the deviations summed up: controller/entry-log.ts)
  const rec = await app.js<{ summary: unknown; samples: unknown[] } | null>(`__bh.camera.entryLog?.json() ?? null`).catch(() => null);
  if (rec) {
    await Bun.write(`${SHOTS}/entry-log.json`, JSON.stringify(rec));
    say(`flight record: ${rec.samples.length} samples → ${SHOTS}/entry-log.json`);
    say(`summary: ${JSON.stringify(rec.summary)}`);
  }
} finally {
  app.close();
  stopServer();
}
process.exit(code);
