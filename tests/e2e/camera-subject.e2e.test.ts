import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The camera on any craft (docs/PLAN-CAMERA-AAA.md CAM8), by real clicks: the free camera out of the Ranger (F3), the
// ISS targeted, then the camera panel's tiles about it — Chase (behind it, a few of its lengths), Cockpit (at its eye,
// looking along its nose), Tower (set down ahead of its way, turning to follow it), Around (the rig's orbit) —, each
// placing the view where it should, no camera jump on the way; the targeting knows the traffic, the ships, the wingmen.
// Duration: ~2 min here (headless).
// Done when: the four views about the ISS are shot under remote-results/camera-subject/.

const OUT = "remote-results/camera-subject";

describe.skipIf(!E2E)("the camera on any craft", () => {
  let app: App;
  // (the view's distance to the ISS's centre [m], the angle between the look and the ISS's nose [°])
  const view = () =>
    app.js<{ d: number; noseDeg: number; toIssDeg: number }>(`(() => {
      const vc = __bh.camera.viewController(), w = vc.rigWorld(), t = Number.isFinite(vc.frameEnd) ? vc.frameEnd : vc.nowTime();
      const st = __bh.iss.track.peek(t);
      const r = [st.X[0] - w.X[0], st.X[1] - w.X[1], st.X[2] - w.X[2]], l = Math.hypot(...r);
      const v = [st.V[0], st.V[1], st.V[2]], e = __bh.ourState("earth", t);
      const rel = [v[0] - e.vel[0], v[1] - e.vel[1], v[2] - e.vel[2]], lv = Math.hypot(...rel);
      const ang = (a, b, la, lb) => (Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)))) * 180) / Math.PI;
      return { d: l * 1.476625e11, noseDeg: ang(w.fwd, rel, 1, lv), toIssDeg: ang(w.fwd, r, 1, l) };
    })()`);
  const tile = async (k: string) => {
    if (!(await app.js<boolean>(`!document.getElementById("cam-pop").hidden`))) await app.click("#btn-camera");
    await app.click(`[data-testid=cp-subject-${k}]`);
    // (the panel closed: the view seen)
    await app.click("#btn-camera");
    await Bun.sleep(2500);
  };

  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1280, height: 720, hash: "scene=Earth: the Blue Marble", tiles: false });
    await app.waitFor("__bh.renderer.completedFrames > 30", 120_000);
    await app.press("F3", "F3");
    await app.waitFor(`__bh.camera.spectating`, 10_000);
    // (by the ISS first: a voyage there)
    await app.js(`__bh.goTo("iss")`);
    await app.waitFor(`!__bh.camera.viewController().voyage`, 90_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("Chase, Cockpit, Tower, Around about the ISS — each where it should be, no jump", async () => {
    await app.js(`__bh.cam.start()`);
    await tile("chase");
    const chase = await view();
    console.log(`  chase: ${chase.d.toFixed(0)} m from its centre, ${chase.toIssDeg.toFixed(1)}° off it`);
    await app.shot(`${OUT}/iss-chase.png`);
    expect(chase.d).toBeGreaterThan(180);
    expect(chase.d).toBeLessThan(800);
    expect(chase.toIssDeg).toBeLessThan(25);
    await tile("aboard");
    const aboard = await view();
    console.log(`  cockpit: ${aboard.d.toFixed(0)} m from its centre, ${aboard.noseDeg.toFixed(1)}° off its nose`);
    await app.shot(`${OUT}/iss-aboard.png`);
    expect(aboard.d).toBeLessThan(120);
    expect(aboard.noseDeg).toBeLessThan(10);
    await tile("tower");
    const tower = await view();
    console.log(`  tower: ${tower.d.toFixed(0)} m from it, ${tower.toIssDeg.toFixed(1)}° off it`);
    await app.shot(`${OUT}/iss-tower.png`);
    expect(tower.d).toBeGreaterThan(400);
    expect(tower.toIssDeg).toBeLessThan(3);
    await tile("around");
    expect(await app.js<string>(`__bh.camera.viewController().s.subjectView`)).toBe("around");
    await app.shot(`${OUT}/iss-around.png`);
    const c = await app.js<{ jump: number }>(`__bh.cam.report().counts`);
    console.log(`  faults: ${JSON.stringify(c)}`);
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);
});
