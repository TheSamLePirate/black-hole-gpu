// A whole return flown live, as a player sees it: from a 400 km orbit, the entry autopilot to a runway —
// the deorbit planned, the wait (time sped up), the burn (real time), the fall to the entry interface,
// the entry, the glide, the touchdown, the rollout — in the page's own frame loop (not at fixed steps),
// its progress printed every 10 s (every 2 s on the runway). On the remote Mac it opens full screen (scripts/remote.ts):
//
//   bun scripts/remote.ts run --name live-entry -- bun scripts/live-entry.ts [--site Edwards] [--inc 40] [--max-min 75]
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

const app = await App.boot({ hash: "scene=game:artemis" });
let code = 1;
try {
  await app.waitFor("__bh.camera.piloting", 60_000);
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
    c.pilot.setAuto("entry");
    const st = g.status();
    return site.name + " — from " + st.label + ", " + st.altKm.toFixed(0) + " km, inc " + (st.orbit?.incDeg ?? 0).toFixed(1) + "°";
  })()`);
  say(`entry autopilot engaged to ${setup}`);

  let seen = 0,
    errSeen = 0,
    touched = 0,
    every = 10_000,
    lastAlong: number | null = null;
  let stopped = 0;
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
      `${r.phase ?? r.auto} · ${r.label} · ${where} · ${r.speed.toFixed(0)} m/s (${r.vVert.toFixed(0)} vertical) · ×${r.warp.toFixed(0)}`,
    );
    if (r.fail) {
      say(`FAILED: ${r.fail}`);
      break;
    }
    // (on its wheels: the entry autopilot lets go at the touchdown, the Ranger rolls on — "landed" only
    // once it stands; from there every 2 s, until it stops)
    if (!touched && r.msgs.some((m) => m.startsWith("Touchdown"))) {
      touched = Date.now();
      every = 2000;
    }
    // (stopped: by its place on the runway — the status's speed is against the Earth's centre, its turning
    // ground's 300 m/s and more in it)
    const gs = touched && r.rwy && lastAlong !== null ? Math.abs(r.rwy.along - lastAlong) / (every / 1000) : null;
    if (touched && r.rwy)
      say(
        `  rollout: ${r.rwy.along.toFixed(0)} m past the threshold, ${r.rwy.across.toFixed(1)} m off its axis${gs === null ? "" : `, ${gs.toFixed(1)} m/s`}`,
      );
    lastAlong = r.rwy ? r.rwy.along : null;
    if (gs !== null && gs < 0.25) {
      if (++stopped >= 2) {
        const on = Math.abs(r.rwy!.across) < 45 && r.rwy!.along > 0 && r.rwy!.along < RUNWAY_LENGTH;
        say(
          `STOPPED ${on ? "on" : "OFF"} the runway: ${r.rwy!.along.toFixed(0)} m past the threshold (of ${RUNWAY_LENGTH}), ${r.rwy!.across.toFixed(1)} m off its axis`,
        );
        code = on ? 0 : 1;
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
} finally {
  app.close();
  stopServer();
}
process.exit(code);
