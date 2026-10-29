// The camera's moves filmed (docs/PLAN-CAMERA-AAA.md): 720p, 30 images a second, frame by frame — the game frozen and
// stepped by a thirtieth of a second, each image drawn then shot (DevTools), so the film runs smooth whatever the
// machine's pace — then encoded with ffmpeg (H.264). The clips:
//   voyage   F3 out of the Ranger, G to Mars at ~0.93 c — the card's two clocks, a look back on the way
//   cine     ⇧G Earth → Moon in one shot: the low pass over the Earth, the voyage, the low pass over the Moon
//   montage  ⇧G to Mars, cut: looking back at the Earth, ahead in the void, on Mars coming
//   subject  a craft (the Ranger; --subject iss): chase, cockpit, tower, around
//   tour     the itinerary Earth → Saturn → the wormhole → down its throat → Gargantua (__bh.tour), a pause at each
//
//   bun scripts/camera-video.ts [voyage cine montage subject tour] [--out dir] [--seconds-max 90]
// Takes the Mac's Chrome lock (tests/e2e/lib/app.ts). Needs ffmpeg.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { App, stopServer } from "../tests/e2e/lib/app";

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : (process.argv[i + 1] ?? d);
};
const OUT = arg("out", "remote-results/camera-video")!;
const MAX = Number(arg("seconds-max", "90"));
const CLIPS = process.argv.slice(2).filter((a) => !a.startsWith("--") && !/^\d/.test(a) && a !== OUT);
const W = 1280,
  H = 720,
  FPS = 30;

type Shot = (k: number) => Promise<boolean>;

/** Films until `go(frame)` says the clip is over (or the cap): each frame a step of the game, a draw, a shot. */
async function film(app: App, name: string, go: Shot) {
  const dir = `${OUT}/${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await app.js(`(__bh.freeze(true), 1)`);
  let k = 0;
  for (; k < MAX * FPS; k++) {
    const more = await go(k);
    await app.js(`(__bh.step(${1 / FPS}), 1)`);
    // (the image of that step drawn: two of the page's frames)
    await app.js(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`);
    const shot = (await app.cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 90 })) as { data: string };
    writeFileSync(`${dir}/${String(k).padStart(6, "0")}.jpg`, Buffer.from(shot.data, "base64"));
    if (k % 60 === 0) console.log(`  ${name}: ${(k / FPS).toFixed(0)} s`);
    if (!more) break;
  }
  await app.js(`(__bh.freeze(false), 1)`);
  const out = `${OUT}/${name}.mp4`;
  const p = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      String(FPS),
      "-i",
      `${dir}/%06d.jpg`,
      "-vf",
      `scale=${W}:${H}:flags=lanczos`,
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "slow",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      out,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  await p.exited;
  console.log(`${name}: ${k + 1} images → ${out}`);
  return out;
}

const out = async (app: App) => {
  if (!(await app.js<boolean>(`__bh.camera.spectating`))) {
    await app.press("F3", "F3");
    await app.waitFor(`__bh.camera.spectating`, 10_000);
  }
};
const target = (app: App, id: string) =>
  app.js(
    `(() => { __bh.camera.viewController().s.target = ${JSON.stringify(id)}; __bh.settings.target = ${JSON.stringify(id)}; return 1; })()`,
  );
/** a voyage there first, unfilmed (the shot's start) */
const reach = async (app: App, id: string) => {
  await app.js(`__bh.goTo(${JSON.stringify(id)})`);
  await app.waitFor(`!__bh.camera.viewController().voyage && !__bh.camera.viewController().cineVoyage`, 120_000);
  await Bun.sleep(1500);
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const app = await App.boot({ width: W, height: H, hash: "scene=Earth: the Blue Marble", tiles: true, telemetry: false });
  try {
    await app.waitFor("__bh.renderer.completedFrames > 30", 120_000);
    // (the tracer's shaders compiled before any film: none pending for 5 s)
    await app.waitFor(`!__bh.renderer.compiling`, 240_000).catch(() => {});
    await out(app);
    const want = (c: string) => !CLIPS.length || CLIPS.includes(c);
    if (want("voyage")) {
      await target(app, "mars");
      await app.js(`(__bh.settings.voyageWall = 24, 1)`);
      let started = false;
      await film(app, "voyage-mars", async (k) => {
        if (k === 15) {
          await app.press("KeyG", "g");
          started = true;
        }
        const v = await app.js<{ u: number } | null>(`__bh.voyage()`);
        // (halfway: the head turned round to look back — the sky behind reddened, thinned — then ahead again)
        if (v && v.u > 0.42 && v.u < 0.62) await app.js(`(__bh.camera.viewController().voyageLook(${v.u < 0.52 ? 6 : -6}, 0), 1)`);
        return !started || !!v || k < 15;
      });
    }
    if (want("cine")) {
      await reach(app, "earth");
      await target(app, "moon");
      await app.js(`(__bh.settings.voyageCine = "sequence", __bh.settings.voyageWall = 20, 1)`);
      let started = false;
      await film(app, "cine-earth-moon", async (k) => {
        if (k === 10) {
          await app.press("KeyG", "G", { shift: true });
          started = true;
        }
        return !started || (await app.js<boolean>(`!!__bh.camera.viewController().cineVoyage`)) || k < 12;
      });
    }
    if (want("montage")) {
      await target(app, "mars");
      await app.js(`(__bh.settings.voyageCine = "montage", __bh.settings.voyageWall = 20, 1)`);
      let started = false;
      await film(app, "cine-montage-mars", async (k) => {
        if (k === 10) {
          await app.press("KeyG", "G", { shift: true });
          started = true;
        }
        return !started || (await app.js<boolean>(`!!__bh.camera.viewController().cineVoyage`)) || k < 12;
      });
    }
    if (want("tour")) {
      await app.js(`(__bh.settings.voyageWall = 20, 1)`);
      let started = false,
        tail = 0;
      await film(app, "tour-saturn-gargantua", async (k) => {
        if (k === 15) {
          await app.js(`__bh.tour(["saturn", "wormhole", "hole"], 2.5)`);
          started = true;
        }
        if (k % 150 === 0) console.log(`    ${JSON.stringify(await app.js(`[__bh.touring(), __bh.voyage()?.beta]`))}`);
        if (started && !(await app.js<boolean>(`!!__bh.touring()`))) tail++;
        // (at Gargantua: four seconds about it)
        return !started || tail < 4 * FPS;
      });
    }
    if (want("subject")) {
      // (a craft in the light: the Ranger the free camera came out of — or another, --subject iss)
      const who = arg("subject", "ranger")!;
      if (who !== "ranger") await reach(app, who);
      await target(app, who);
      await app.js(`(__bh.camera.setSpectatorFollow(false), 1)`);
      const views = ["chase", "aboard", "tower", "around"];
      await film(app, `camera-${who}`, async (k) => {
        const i = Math.floor(k / (6 * FPS));
        if (k % (6 * FPS) === 0 && i < views.length)
          await app.js(
            `(() => { const c = __bh.camera.viewController(); __bh.settings.subjectView = c.s.subjectView = ${JSON.stringify(views[i])}; c.subject.yaw = c.subject.pitch = 0; c.subject.tower = null; if (${JSON.stringify(views[i])} === "around") c.s.rotation = "orbit"; return 1; })()`,
          );
        // (in chase, the drag swinging round it)
        if (i === 0 && k > 2 * FPS) await app.js(`(__bh.camera.viewController().subjectLook(1.2, 0), 1)`);
        return i < views.length;
      });
    }
  } finally {
    app.close();
    stopServer();
  }
}

await main();
