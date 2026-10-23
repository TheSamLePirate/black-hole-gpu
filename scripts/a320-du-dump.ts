// The A320's displays' canvases as PNGs (docs/PLAN-A320.md, A7): a headless Chrome on the app (tests/e2e/lib/app.ts), the
// A320 lined up at Le Bourget (SITE), the camera in its seat (the displays drawn while the deck is), then a script run
// (JS: the state wanted — in the air, a speed, a configuration…) and each display's canvas saved (its 1024² picture).
//
//   bun scripts/a320-du-dump.ts [out-dir] [PFD1,ND1,UECAM,LECAM,IESI,DCDU1]
//   JS='…' (run before the dumps)  WAIT=ms  SITE=…  DATE=…  FLY=1 (in the air: 3000 m, 250 kt, CONF clean, gear up)
import { App, stopServer } from "../tests/e2e/lib/app";

const out = process.argv[2] ?? "a320-du";
const names = (process.argv[3] ?? "PFD1,ND1,UECAM,LECAM,IESI,DCDU1").split(",");
const site = process.env.SITE ?? "Paris – Le Bourget";
const date = process.env.DATE ?? "2026-06-21T12:00";

const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false, telemetry: false });
try {
  await app.waitFor("__bh.camera.piloting", 120_000);
  await app.js(`(() => {
    __bh.game.setDate(${JSON.stringify(date)});
    __bh.settings.vessel = "a320";
    __bh.refresh();
    __bh.game.lineUp(${JSON.stringify(site)});
    __bh.settings.shipMount = "cockpit";
    __bh.refresh();
    return true;
  })()`);
  await app.waitFor("!!__bh.renderer.a320Du", 120_000);
  // (in the air: 3000 m over Le Bourget's area heading 270, 128 m/s, clean, gear up, the levers in CL)
  if (process.env.FLY)
    await app.js(`(() => {
      __bh.game.flyAt(48.97, 2.2, 3000, 270, 128);
      const c = __bh.camera;
      c.gearDown = false; c.gearExt = 0;
      c.airFlight.cfg.flaps = 0;
      c.pilot.throttle = 0.65;
      __bh.settings.shipMount = "cockpit";
      __bh.refresh();
      return true;
    })()`);
  if (process.env.JS) console.log("JS:", await app.js(process.env.JS));
  await Bun.sleep(Number(process.env.WAIT ?? 6000));
  for (const n of names) {
    const b64 = await app.js<string | null>(`(async () => {
      const c = __bh.renderer.a320Du?.canvasOf(${JSON.stringify(n)});
      if (!c) return null;
      const blob = await c.convertToBlob({ type: "image/png" });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    })()`);
    if (!b64) {
      console.log(`${n}: none`);
      continue;
    }
    await Bun.write(`${out}/${n}.png`, Buffer.from(b64, "base64"));
    console.log(`${out}/${n}.png`);
  }
} finally {
  app.close();
  stopServer();
}
