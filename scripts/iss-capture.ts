// Q6-ISS ISS0 — the ISS cameras' corpus, captured from the official live streams (docs/PLAN-REFRACTION-HORIZONS.md Q6-ISS):
// a frame of each stream every --every seconds for --for minutes, named by its UTC grab time, with a manifest line each
// (stream, video id, grab UTC, file). Sen's frames carry their own UTC in the stream's caption (≈ 19 s behind the grab, measured
// 4 Nov 2026): the capture's time read there. Kept OUTSIDE the repository (Sen's images are not ours to redistribute; NASA's are
// public domain) — ~/.kerr-lab/iss-corpus by default.
//
//   bun scripts/iss-capture.ts [--every 60] [--for 120] [--out ~/.kerr-lab/iss-corpus] [--streams nasa,sen]
//
// Needs yt-dlp and ffmpeg on the PATH. The streams' ids change when NASA or Sen restart them: STREAMS below, checked against
// their channels (yt-dlp --flat-playlist https://www.youtube.com/@NASA/streams, @Sen).
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const STREAMS: Record<string, { id: string; what: string }> = {
  // (NASA: "an external camera mounted on the station's Harmony module … looking forward at an angle so that International Docking
  // Adapter 2 is visible"; a loop "Previously Recorded" when it is not available — the stream's description, 4 Nov 2026)
  nasa: { id: "ROboUHfPUrU", what: "NASA — Live High-Definition Views from the ISS (Harmony, forward, IDA-2)" },
  // (Sen SpaceTV-1: three 4K cameras on Bartolomeo — nadir, horizon, docking —, the stream switching between them)
  sen: { id: "fO9e9jnhYK8", what: "Sen — SpaceTV-1 24/7 livestream (nadir / horizon / docking)" },
};

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const every = Number(arg("every", "60"));
const minutes = Number(arg("for", "120"));
const out = arg("out", join(homedir(), ".kerr-lab", "iss-corpus")).replace(/^~/, homedir());
const streams = arg("streams", "nasa,sen").split(",");
mkdirSync(out, { recursive: true });
const manifest = join(out, "manifest.tsv");

const urls = new Map<string, { url: string; at: number }>();
async function streamUrl(name: string) {
  const u = urls.get(name);
  // (the stream's media URL expires: asked again every 20 minutes)
  if (u && Date.now() - u.at < 20 * 60_000) return u.url;
  const url = (await $`yt-dlp -g -f ${"best[height<=2160]"} ${`https://www.youtube.com/watch?v=${STREAMS[name]!.id}`}`.quiet().text())
    .trim()
    .split("\n")[0]!;
  urls.set(name, { url, at: Date.now() });
  return url;
}

const end = Date.now() + minutes * 60_000;
let n = 0;
console.log(`iss-capture: ${streams.join(", ")} every ${every} s for ${minutes} min → ${out}`);
while (Date.now() < end) {
  const t0 = Date.now();
  for (const name of streams) {
    const utc = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z");
    const file = join(out, `${name}-${utc}.jpg`);
    try {
      // (a live stream can stall: the grab killed after 30 s, its URL asked again next time)
      const p = Bun.spawn(
        ["ffmpeg", "-loglevel", "error", "-y", "-rw_timeout", "15000000", "-i", await streamUrl(name), "-frames:v", "1", "-q:v", "3", file],
        {
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      const kill = setTimeout(() => p.kill(), 30_000);
      const code = await p.exited;
      clearTimeout(kill);
      if (code !== 0) throw new Error(`ffmpeg ${code}`);
      appendFileSync(manifest, `${name}\t${STREAMS[name]!.id}\t${utc}\t${file}\n`);
      n++;
    } catch (e) {
      urls.delete(name);
      console.log(`iss-capture: ${name} at ${utc}: ${String(e).slice(0, 120)}`);
    }
  }
  if (n % 20 === 0) console.log(`iss-capture: ${n} frames`);
  await Bun.sleep(Math.max(0, every * 1000 - (Date.now() - t0)));
}
console.log(`iss-capture: done, ${n} frames — ${manifest}`);
