// The app on a real iPad, driven by Safari's own WebDriver (safaridriver, W3C) from the Mac the iPad is
// plugged into by USB — docs/IPAD-TESTS.md. Usually run there through scripts/remote.ts:
//
//   bun scripts/remote.ts run --cpu --name ipad-check -- bun scripts/ipad.ts check
//   bun scripts/remote.ts run --cpu --name ipad-flight -- bun scripts/ipad.ts flight --site Bourget --inc 52
//
//   check     the session, WebGPU, the boot, a scene flying: its frame rate, its errors, screenshots (~1 min)
//   flight    a whole return flown live: orbit → the entry autopilot → a runway, every 10 s (1 s in the last
//             400 m, 2 s on the runway), a screenshot at each phase; ends 0 stopped on the runway (~15 min)
//   settings  the app's settings, its tier and the screen, as JSON (to diff against another browser)
//
//   --url <u>     the site (default: the deployed one — WebGPU wants HTTPS: a LAN http:// server has none)
//   --scene <s>   check's scene (game:artemis)      --site <name>  flight's runway (Bourget)
//   --inc <deg>   flight's orbit inclination (52: over Paris; ≥ the site's latitude)
//   --max-min <m> flight's cap (60)                 --out <dir>    the screenshots (remote-results/ipad-<time>)
//   --no-shots    no screenshots (a full-resolution one is 3180 × 2384: memory the iPad's Safari may lack)
//
// Ends 0 on success, 1 otherwise; prints the page's errors as they come.
import { mkdirSync } from "node:fs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1]! : d;
};
const URL = arg("url", "https://thesamlepirate.github.io/black-hole-gpu/");
const d = new Date();
const p2 = (n: number) => String(n).padStart(2, "0");
const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
const OUT = arg("out", `remote-results/ipad-${stamp}-${cmd}`);
const SHOTS = !argv.includes("--no-shots");
const PORT = 4700 + Math.floor(Math.random() * 100);

const t0 = Date.now();
const clock = () => {
  const s = Math.round((Date.now() - t0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const say = (s: string) => console.log(`[${clock()}] ${s}`);

/** A WebDriver session on the iPad's Safari: its JavaScript, its URL, its screenshots. */
class IPad {
  private n = 0;
  private constructor(
    private base: string,
    private sid: string,
    private drv: ReturnType<typeof Bun.spawn>,
  ) {}

  static async open() {
    const drv = Bun.spawn(["safaridriver", "-p", String(PORT)], { stdout: "ignore", stderr: "ignore" });
    const base = `http://127.0.0.1:${PORT}`;
    for (let i = 0; i < 50; i++) {
      if (
        await fetch(`${base}/status`).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      await Bun.sleep(100);
    }
    const caps = { capabilities: { alwaysMatch: { platformName: "iOS", "safari:deviceType": "iPad" } } };
    // (the last session lingers on the iPad a while after its end: asked again for up to 2 min)
    for (let k = 0; ; k++) {
      try {
        const s = await req(base, "POST", "/session", caps);
        const c = s.capabilities ?? {};
        say(`session on ${c["safari:deviceName"] ?? "the iPad"} (Safari ${c.browserVersion}, iOS ${c["safari:platformVersion"] ?? "?"})`);
        const ipad = new IPad(base, s.sessionId, drv);
        await ipad.wd("POST", "/timeouts", { script: 60000, pageLoad: 180000 });
        return ipad;
      } catch (e) {
        // (just started, safaridriver has not yet looked the iPad over: "could not be used", no reason given)
        const early = /could not be used:\\n"/.test(String(e)) && k < 10;
        if (early) {
          await Bun.sleep(1000);
          continue;
        }
        if (!/already paired/.test(String(e)) || k >= 24) {
          drv.kill();
          throw e;
        }
        if (k === 0) say("the iPad still holds the last session — waiting");
        await Bun.sleep(5000);
      }
    }
  }

  wd(method: string, path: string, body?: unknown) {
    return req(this.base, method, `/session/${this.sid}${path}`, body);
  }
  // biome-ignore lint/suspicious/noExplicitAny: what the page returns, typed at the call
  js<T = any>(body: string): Promise<T> {
    return this.wd("POST", "/execute/sync", { script: body, args: [] });
  }
  /** A page load (a scene is read at the load: a new one, never a hash change). */
  async go(hash = "") {
    await this.wd("POST", "/url", { url: `${URL}${URL.includes("?") ? "&" : "?"}ipad=${Date.now()}${hash ? `#${hash}` : ""}` });
  }
  /** The app up: __bh, the scene flying, the splash lifted (and the Earth's relief, when asked). */
  async scene(relief = false, maxS = 600) {
    for (let i = 0; i < maxS; i++) {
      const s = await this.js(`const L = document.getElementById("loading");
        return { bh: !!window.__bh, piloting: !!(window.__bh && __bh.camera && __bh.camera.piloting),
          loading: L ? (L.classList.contains("done") ? "done" : (L.querySelector(".ld-stage")?.textContent || "") + " " + (L.querySelector(".ld-pct")?.textContent || "")) : "done",
          relief: window.__bh && __bh.relief ? __bh.relief("earth", 34.905, -117.884) : 0 };`).catch(() => null);
      if (s?.piloting && s.loading === "done" && (!relief || s.relief > 100)) return;
      if (i % 15 === 0 && s)
        say(`  loading: ${s.bh ? (s.loading === "done" ? (relief ? "the Earth's relief…" : "the scene…") : s.loading) : s.loading}`);
      await Bun.sleep(1000);
    }
    throw new Error(`the scene never came up (${maxS} s)`);
  }
  /** The page's errors from here on (window errors, rejections, console.error), read by errors(). */
  async watchErrors() {
    await this.js(`window.__ipad = { errors: [] };
      addEventListener("error", (e) => __ipad.errors.push(String(e.message)), true);
      addEventListener("unhandledrejection", (e) => __ipad.errors.push(String(e.reason)));
      const ce = console.error.bind(console);
      console.error = (...a) => { __ipad.errors.push("console.error: " + a.map(String).join(" ").slice(0, 300)); ce(...a); };
      return 1;`);
  }
  private seen = 0;
  async errors() {
    const all: string[] = await this.js("return window.__ipad ? __ipad.errors : []").catch(() => []);
    const fresh = all.slice(this.seen);
    this.seen = all.length;
    for (const e of fresh) say(`PAGE ERROR: ${e}`);
    return fresh;
  }
  async shot(name: string) {
    if (!SHOTS) return;
    try {
      const b64 = await this.wd("GET", "/screenshot");
      mkdirSync(OUT, { recursive: true });
      const f = `${OUT}/${String(++this.n).padStart(2, "0")}-${name}.png`;
      await Bun.write(f, Buffer.from(b64, "base64"));
      say(`  screenshot ${f}`);
    } catch (e) {
      say(`  screenshot failed: ${String(e).slice(0, 120)}`);
    }
  }
  async close() {
    await req(this.base, "DELETE", `/session/${this.sid}`).catch(() => {});
    this.drv.kill();
  }
}

async function req(base: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  // biome-ignore lint/suspicious/noExplicitAny: WebDriver's values, typed at the call
  const j = (await r.json()) as { value: any };
  if (!r.ok) throw new Error(`${method} ${path}: ${JSON.stringify(j.value).slice(0, 300)}`);
  return j.value;
}

const PERF = `let p = null; try { p = __bh.game.perf(); } catch {}
  return p && { fps: p.loopFps, render: p.renderFps, worst: p.worstLoopMs, gpuMs: p.gpuFrameMs, image: p.image, quality: p.quality, tier: p.tier && p.tier.label };`;

async function check(ipad: IPad) {
  const scene = arg("scene", "game:artemis");
  await ipad.go();
  say(`loaded ${URL}`);
  const env = await ipad.js(
    `return { gpu: !!navigator.gpu, secure: isSecureContext, lang: navigator.language, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, touch: navigator.maxTouchPoints };`,
  );
  say(`env: ${JSON.stringify(env)}`);
  if (!env.gpu || !env.secure) throw new Error("no WebGPU here (navigator.gpu missing or not a secure context — HTTPS?)");
  for (let i = 0; i < 600 && !(await ipad.js("return !!(window.__bh && __bh.game)")); i++) await Bun.sleep(1000);
  say("the app is up (the title)");
  await ipad.shot("title");
  await ipad.go(`scene=${scene}`);
  await ipad.scene();
  await ipad.watchErrors();
  say(`${scene} flying, the splash lifted`);
  await Bun.sleep(3000);
  await ipad.shot(scene.replace(/[^a-z0-9]+/gi, "-"));
  const fps = await ipad.wd("POST", "/execute/async", {
    script: `const done = arguments[arguments.length - 1]; let n = 0; const t = performance.now();
      const f = () => { n++; if (performance.now() - t < 5000) requestAnimationFrame(f); else done(n / ((performance.now() - t) / 1000)); };
      requestAnimationFrame(f);`,
    args: [],
  });
  const st = await ipad.js(`const s = __bh.game.status(); return { status: s.label, altKm: s.altKm };`);
  say(`frames: ${fps.toFixed(1)} /s over 5 s · app: ${JSON.stringify(await ipad.js(PERF))} · ${JSON.stringify(st)}`);
  const errs = await ipad.errors();
  return errs.length === 0;
}

async function settings(ipad: IPad) {
  await ipad.go("scene=game:artemis");
  await ipad.scene();
  console.log(
    await ipad.js(`const o = {}; for (const [k, v] of Object.entries(__bh.settings)) if (v === null || ["number", "string", "boolean"].includes(typeof v)) o[k] = v;
      let tier = null; try { tier = __bh.game.perf().tier; } catch {}
      return JSON.stringify({ settings: o, tier, touch: navigator.maxTouchPoints, dpr: devicePixelRatio, w: innerWidth, h: innerHeight });`),
  );
  return true;
}

async function flight(ipad: IPad) {
  const { RUNWAY_LENGTH, SITES } = await import("../src/game/sites");
  const name = arg("site", "Bourget");
  const site = SITES.find((q) => q.runway && q.name.toLowerCase().includes(name.toLowerCase()));
  if (!site)
    throw new Error(
      `no runway "${name}" — ${SITES.filter((q) => q.runway)
        .map((q) => q.name)
        .join(", ")}`,
    );
  const inc = Number(arg("inc", String(Math.ceil(Math.abs(site.lat)) + 3)));
  const maxMin = Number(arg("max-min", "60"));
  await ipad.go("scene=game:artemis");
  await ipad.scene(true);
  say("Artemis flying, the splash lifted, the Earth's relief in");
  await ipad.watchErrors();
  const from = await ipad.js(`const g = __bh.game, c = __bh.camera;
    g.orbit("earth", { altKm: 400, inc: ${inc} });
    window.__ipad.msgs = [];
    const prev = c.onPilotMessage;
    c.onPilotMessage = (t) => { __ipad.msgs.push(t); prev?.(t); };
    c.entrySite = ${JSON.stringify(site)};
    c.pilot.setAuto("entry");
    const st = g.status();
    return st.label + ", " + st.altKm.toFixed(0) + " km, inc " + (st.orbit?.incDeg ?? 0).toFixed(1) + "°";`);
  say(`entry autopilot engaged to ${site.name} — from ${from}`);
  await Bun.sleep(3000);
  await ipad.shot("orbit");

  let seen = 0,
    touched = 0,
    every = 10_000,
    stopped = 0,
    lastPhase = "",
    lastAlong: number | null = null;
  for (;;) {
    await Bun.sleep(every);
    const r = await ipad.js(`const c = __bh.camera, st = __bh.game.status(), R = c.entryRun;
      const Msec = 4.925490947e-6 * __bh.settings.massSolar;
      let rwy = null; try { rwy = c.runwayView ? c.runwayView() : null; } catch {}
      let fps = null, worst = null; try { const p = __bh.game.perf(); fps = p.loopFps; worst = p.worstLoopMs; } catch {}
      return { msgs: __ipad.msgs, phase: R ? R.phase : null, label: st.label, altKm: st.altKm, vVert: st.vVert,
        warp: __bh.settings.timeSpeed * Msec, fps, worst, auto: c.pilot.auto, landed: !!c.ourLanded,
        fail: c.airFlight ? c.airFlight.failure : null,
        app: R && R.app ? { along: R.app.along, across: R.app.across, agl: R.app.agl } : null,
        rwy: rwy ? { along: rwy.along, across: rwy.across } : null };`);
    for (const m of r.msgs.slice(seen)) say(`» ${m}`);
    seen = r.msgs.length;
    await ipad.errors();
    // (no speed here: the status's is against the Earth's centre — its turning ground's 300 m/s in it)
    const where = r.app
      ? `${(r.app.along / 1000).toFixed(1)} km along, ${r.app.across.toFixed(0)} m across, ${r.app.agl.toFixed(0)} m up`
      : `${r.altKm.toFixed(1)} km up`;
    say(
      `${r.phase ?? r.auto} · ${r.label} · ${where} · ${r.vVert.toFixed(1)} m/s vertical · ×${r.warp.toFixed(0)} · ${r.fps?.toFixed(0) ?? "?"} fps (worst ${r.worst ?? "?"} ms)`,
    );
    if (!touched && r.app && r.app.agl < 400) every = 1000;
    // (the messages follow the page's language: "Touchdown" / "Toucher")
    if (!touched && r.msgs.some((m: string) => /^(Touchdown|Toucher)/.test(m))) {
      touched = Date.now();
      every = 2000;
      await ipad.shot("touchdown");
    }
    const phase = r.phase ?? (touched ? "rollout" : r.auto);
    if (phase !== lastPhase) {
      lastPhase = phase;
      await ipad.shot(phase);
    }
    if (r.fail) {
      say(`FAILED: ${r.fail}`);
      await ipad.shot("failed");
      return false;
    }
    // (stopped: by its place along the runway)
    const gs = touched && r.rwy && lastAlong !== null ? Math.abs(r.rwy.along - lastAlong) / (every / 1000) : null;
    if (touched && r.rwy)
      say(
        `  rollout: ${r.rwy.along.toFixed(0)} m past the threshold, ${r.rwy.across.toFixed(1)} m off its axis${gs === null ? "" : `, ${gs.toFixed(1)} m/s`}`,
      );
    lastAlong = r.rwy ? r.rwy.along : null;
    if (gs !== null && gs < 0.25) {
      if (++stopped >= 2) {
        const on = Math.abs(r.rwy.across) < 45 && r.rwy.along > 0 && r.rwy.along < RUNWAY_LENGTH;
        say(
          `STOPPED ${on ? "on" : "OFF"} the runway: ${r.rwy.along.toFixed(0)} m past the threshold (of ${RUNWAY_LENGTH}), ${r.rwy.across.toFixed(1)} m off its axis`,
        );
        await ipad.shot("stopped");
        return on;
      }
    } else stopped = 0;
    if (touched && Date.now() - touched > 5 * 60_000) {
      say("still rolling 5 min after the touchdown — stopped");
      return false;
    }
    if (!touched && !r.phase && r.auto !== "entry" && !r.landed) {
      say("the entry autopilot let go before the ground");
      await ipad.shot("let-go");
      return false;
    }
    if (Date.now() - t0 > maxMin * 60_000) {
      say(`over ${maxMin} min — stopped`);
      return false;
    }
  }
}

const COMMANDS: Record<string, (ipad: IPad) => Promise<boolean>> = { check, flight, settings };
const run = COMMANDS[cmd ?? ""];
if (!run) {
  console.error("bun scripts/ipad.ts check | flight | settings [options] — see the header of scripts/ipad.ts");
  process.exit(2);
}
let ok = false;
let ipad: IPad | null = null;
try {
  ipad = await IPad.open();
  ok = await run(ipad);
} catch (e) {
  say(`ERROR: ${(e as Error).message}`);
} finally {
  await ipad?.close();
}
process.exit(ok ? 0 : 1);
