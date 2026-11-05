import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// Q6-ISS ISS4 — the ISS's live-stream cameras in the game (src/system/iss-cameras.ts the registry, camera/subjectcam.ts the view,
// main.ts issCameraView the one action), by real clicks: the free camera out of the Ranger (F3) and taken to the ISS, then the
// Camera panel's "The ISS's live cameras" — Sen's horizon (aft, 47.5° down, 95° across) and NASA's (down, 36°) —: the eye at the
// camera's mount on the station's LVLH axes, looking along its line of sight, its field across as the registry's; TARS's tool
// takes the same action (issCamera); "Back to the view before" gives the view held before back, the ISS camera off. The scene's
// clock is not moved by any of it.
// ISS_JS: a statement run once the scene is set (an A/B's switch: __bh.renderer.msLutOn = false, aerosolOverride = 0.001).
// ISS_TUNE: the tracer's tuning (JSON, __bh.renderer.tune) for an A/B of the image's parts.
// ISS_AT: an instant (ISO, e.g. "2026-11-05T11:02:00Z" — the dense capture's) the scene is set at, the image's profile neutral:
// the shots to compare with the live streams' frames of that instant (ISS3, scripts/iss-response.py); ISS_OUT: the shots' folder.
// Duration: ~2 min on this Mac.
// Done when: both cameras shot and checked under remote-results/iss-cameras/, the view back, no page error.

const OUT = process.env.ISS_OUT ?? "remote-results/iss-cameras";
const AT = process.env.ISS_AT;

describe.skipIf(!E2E)("the ISS's live-stream cameras", () => {
  let app: App;
  // (the view against a camera's framing: the eye's distance to its mount [m], the look's angle to its line of sight [°], the
  // horizontal field drawn [°], the issView setting)
  const check = (id: string) =>
    app.js<{ eyeM: number; lookDeg: number; upDeg: number; fovAcross: number; issView: string }>(`(() => {
      const vc = __bh.camera.viewController(), w = vc.rigWorld(), t = Number.isFinite(vc.frameEnd) ? vc.frameEnd : vc.nowTime();
      const st = __bh.iss.track.peek(t);
      const [x, y, z] = __bh.iss.axes(st.X, st.V, t);
      const fr = __bh.iss.cameraFrame("${id}");
      const on = (v) => [0, 1, 2].map((k) => x[k] * v[0] + y[k] * v[1] + z[k] * v[2]);
      const M = 1.476625e11;
      const m = on(fr.mount);
      const eye = [0, 1, 2].map((k) => (w.X[k] - st.X[k]) * M - m[k]);
      const ang = (a, b) => (Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))))) * 180) / Math.PI;
      const asp = innerWidth / innerHeight, v = vc.s.fov * Math.PI / 180;
      return { eyeM: Math.hypot(...eye), lookDeg: ang(w.fwd, on(fr.look)), upDeg: ang(w.up, on(fr.up)), fovAcross: (2 * Math.atan(Math.tan(v / 2) * asp) * 180) / Math.PI, issView: vc.s.issView };
    })()`);
  const pick = async (testid: string) => {
    if (!(await app.js<boolean>(`!document.getElementById("cam-pop").hidden`))) await app.click("#btn-camera");
    await app.click(`[data-testid=${testid}]`);
    // (the panel closed: the view seen; the lens eased to its field)
    await app.click("#btn-camera");
    await Bun.sleep(3000);
  };

  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1280, height: 720, hash: "scene=Earth: the Blue Marble", tiles: false });
    await app.waitFor("__bh.renderer.completedFrames > 30", 120_000);
    if (AT) {
      // (the scene at that instant — the station where SGP4 puts it then —, the image's profile neutral: a measure's)
      await app.js(
        `(__bh.setDate(${Date.parse(AT)}), __bh.preset("Earth: the Blue Marble"), __bh.settings.lookProfile = "neutral", __bh.touch(), 1)`,
      );
      await app.waitFor("__bh.renderer.completedFrames > 60", 120_000);
      // (the game's own clock at that instant: the Sun's light as it was — __bh.setDate fixes the real-time scenes' "now" alone)
      console.log(`  game clock: ${await app.js<string>(`__bh.game.setDate("${AT}")`)}`);
      // (ISS_TUNE: the tracer's tuning for an A/B of the image's parts — e.g. {"TUNE_GSKIP":512} —, respecialised)
      // (ISS_JS: a statement run then — an A/B's switch, e.g. "__bh.renderer.msLutOn = false")
      if (process.env.ISS_JS) {
        await app.js(`(() => { ${process.env.ISS_JS}; __bh.touch(); return 1; })()`);
        await app.settled(120_000);
      }
      if (process.env.ISS_TUNE) {
        await app.js(`(() => { __bh.renderer.tune = ${process.env.ISS_TUNE}; __bh.touch(); return 1; })()`);
        await app.settled(120_000);
      }
    }
    await app.press("F3", "F3");
    await app.waitFor(`__bh.camera.spectating`, 10_000);
    await app.js(`__bh.goTo("iss")`);
    await app.waitFor(`!__bh.camera.viewController().voyage`, 90_000);
    await Bun.sleep(1500);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("Sen's horizon, NASA's view, TARS's same action, the view given back — each framed as the registry says", async () => {
    const t0 = await app.js<number>(`__bh.time()`);
    const before = await app.js<{ X: number[]; target: string }>(
      `(() => { const vc = __bh.camera.viewController(); return { X: [...vc.rigWorld().X], target: vc.s.target }; })()`,
    );
    await pick("cp-iss-sen-horizon");
    await app.settled();
    const hz = await check("sen-horizon");
    console.log(
      `  Sen horizon: eye ${hz.eyeM.toFixed(2)} m off its mount, look ${hz.lookDeg.toFixed(2)}° off, up ${hz.upDeg.toFixed(2)}° off, ${hz.fovAcross.toFixed(1)}° across (${hz.issView})`,
    );
    await app.shot(`${OUT}/sen-horizon.png`);
    expect(hz.issView).toBe("sen-horizon");
    expect(hz.eyeM).toBeLessThan(1);
    expect(hz.lookDeg).toBeLessThan(1);
    expect(hz.upDeg).toBeLessThan(1);
    expect(Math.abs(hz.fovAcross - 95)).toBeLessThan(1.5);
    await pick("cp-iss-nasa-harmony");
    await app.settled();
    const ns = await check("nasa-harmony");
    console.log(
      `  NASA: eye ${ns.eyeM.toFixed(2)} m off its mount, look ${ns.lookDeg.toFixed(2)}° off, up ${ns.upDeg.toFixed(2)}° off, ${ns.fovAcross.toFixed(1)}° across (${ns.issView})`,
    );
    await app.shot(`${OUT}/nasa.png`);
    expect(ns.issView).toBe("nasa-harmony");
    expect(ns.eyeM).toBeLessThan(1);
    expect(ns.lookDeg).toBeLessThan(1);
    expect(Math.abs(ns.fovAcross - 36)).toBeLessThan(1.5);
    // (TARS's camera tool: the same action — Sen's horizon again through it)
    const tars = await app.js<unknown>(
      `Promise.resolve(__bh.tars.tools().find((x) => x.name === "camera").run({ issCamera: "sen-horizon" }, new AbortController().signal)).then((r) => r?.result ?? r)`,
    );
    await Bun.sleep(2500);
    console.log(`  TARS camera tool: ${JSON.stringify(tars)}`);
    expect((await check("sen-horizon")).issView).toBe("sen-horizon");
    // (back: the view before, the ISS camera off)
    await pick("cp-iss-back");
    const after = await app.js<{ X: number[]; issView: string; target: string }>(
      `(() => { const vc = __bh.camera.viewController(); return { X: [...vc.rigWorld().X], issView: vc.s.issView, target: vc.s.target }; })()`,
    );
    const backM = Math.hypot(...after.X.map((v, k) => (v - before.X[k]!) * 1.476625e11));
    console.log(
      `  back: ${after.issView}, target ${after.target}, ${backM.toFixed(0)} m from the view's place before (the ISS flown on meanwhile)`,
    );
    await app.shot(`${OUT}/back.png`);
    expect(after.issView).toBe("off");
    // (the view before was about the ISS: given back about it, not where it was on the Earth — the station flown on)
    const near = await app.js<number>(
      `(() => { const vc = __bh.camera.viewController(), w = vc.rigWorld(), t = Number.isFinite(vc.frameEnd) ? vc.frameEnd : vc.nowTime(); const st = __bh.iss.track.peek(t); return Math.hypot(...[0, 1, 2].map((k) => (w.X[k] - st.X[k]) * 1.476625e11)); })()`,
    );
    console.log(`  back: ${near.toFixed(0)} m from the ISS`);
    expect(near).toBeLessThan(5000);
    const t1 = await app.js<number>(`__bh.time()`);
    console.log(`  the scene's clock: ${t0} → ${t1}`);
    expect(app.cdp.errors).toEqual([]);
  }, 180_000);
});
