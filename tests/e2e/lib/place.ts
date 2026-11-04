// A craft placed low over the Earth for a shot, reliably (Q4 L2a's lesson, 4 Nov 2026): flyAt reckons its height over the relief
// known when called — before the fine tiles, a mountainside or a building stood higher: the F-35 was put inside them, the
// collision rolled it over, and the "ground" filled the top of the image. Here: placed and frozen at once; the relief's fine
// tiles awaited (none pending for 3 s, a z 12 level at least, 90 s at most); placed again on it; the view applied by a few steps;
// then its attitude and its height over the ground checked — a craft rolled, pitched or off its height is an error said, not a
// shot taken.
import type { App } from "./app";

export interface Placed {
  agl: number;
  pitchDeg: number;
  bankDeg: number;
  finest: number;
  reliefIn: boolean;
  mount: string;
}

/** `at`: flyAt's arguments — lat, lon, height over the ground [m], heading [°], speed [m/s]; `look`: the look's pitch [°] */
export async function placeLow(app: App, at: [number, number, number, number, number], look = 0): Promise<Placed> {
  const fly = `__bh.game.flyAt(${at.join(", ")}); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
  await app.js(`(() => { __bh.freeze(false); ${fly} __bh.freeze(true); return 1; })()`);
  const relief = await app.js<{ ok: boolean; finest: number }>(`(async () => {
    const t = __bh.renderer.earthTiles, frame = () => new Promise((q) => requestAnimationFrame(q));
    const t0 = performance.now(); let calm = 0;
    while (performance.now() - t0 < 90000) {
      const ok = t.pending === 0 && t.finest >= 12; calm = ok ? calm || performance.now() : 0;
      if (calm && performance.now() - calm > 3000) break; __bh.touch(); await frame(); }
    return { ok: calm > 0, finest: t.finest }; })()`);
  // (placed again over the relief now in; the rig applied by three steps of 1/30 s — a mount set while frozen is not)
  await app.js(`(async () => { __bh.freeze(false); ${fly} __bh.freeze(true); const frame = () => new Promise((q) => requestAnimationFrame(q));
    for (let i = 0; i < 3; i++) { __bh.step(1 / 30); __bh.touch(); await frame(); }
    __bh.camera.setLook(0, ${look}); __bh.touch(); return 1; })()`);
  const p = await app.js<{ agl: number; pitch: number; bank: number; mount: string }>(`(() => {
    const F = __bh.fleet, t = __bh.sim.time, pose = F.pose(F.active, t), a = __bh.camera.attitudeNow();
    return { agl: __bh.sys.heightOverGround("earth", pose.X, t), pitch: (a.pitch ?? NaN) * 180 / Math.PI,
      bank: (a.bank ?? NaN) * 180 / Math.PI, mount: __bh.settings.shipMount }; })()`);
  const placed: Placed = {
    agl: +p.agl.toFixed(1),
    pitchDeg: +p.pitch.toFixed(1),
    bankDeg: +p.bank.toFixed(1),
    finest: relief.finest,
    reliefIn: relief.ok,
    mount: p.mount,
  };
  const want = at[2];
  if (!(Math.abs(p.bank) < 10 && Math.abs(p.pitch) < 15) || !(p.agl > 0.5 * want && p.agl < 2 * want + 20) || p.mount !== "cockpit")
    throw new Error(`placeLow: the craft not level at its height — ${JSON.stringify(placed)} (asked ${want} m over the ground)`);
  return placed;
}
