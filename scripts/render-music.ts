// Renders the score's themes offline (headless Chrome's OfflineAudioContext — the game's own engine and
// instruments) to listen to them and check them: each theme's WAV (MP3 too when ffmpeg is there), its peak, its
// loudness (RMS), its sub's weight. Exit 1 when a theme clips past −0.1 dBFS, is near silent, or has no sub when
// its band has a bass.
//
//   bun scripts/render-music.ts [out-dir] [--secs 45] [--only id,id] [--seed 0]
import { mkdirSync } from "node:fs";
import { THEMES } from "../src/audio/music/themes";
import { withGpuPage } from "./lib/headless-gpu";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1]! : d;
};
const out = args[0] && !args[0].startsWith("--") ? args[0] : "remote-results/music";
const secs = Number(opt("--secs", "45"));
const only = opt("--only", "").split(",").filter(Boolean);
const seed = Number(opt("--seed", "0"));
mkdirSync(out, { recursive: true });

const built = await Bun.build({ entrypoints: [`${import.meta.dir}/lib/music-render-entry.ts`], target: "browser", minify: false });
if (!built.success) throw new Error(built.logs.join("\n"));
const js = await built.outputs[0]!.text();

const themes = THEMES.filter((t) => !only.length || only.includes(t.id));
let bad = 0;
await withGpuPage(
  async (ev) => {
    await ev(
      `(()=>{const s=document.createElement("script");s.type="module";s.src="/render.js";document.head.append(s);return new Promise(r=>s.onload=()=>r(true))})()`,
    );
    await ev(`new Promise(r=>{const w=()=>window.renderTheme?r(true):setTimeout(w,50);w();})`);
    for (const t of themes) {
      // (the intensity: quiet, rising to full, easing back — the band entering and leaving)
      const curve = [
        [0, 0.35],
        [secs * 0.35, 0.6],
        [secs * 0.6, 1],
        [secs * 0.85, 0.8],
        [secs, 0.5],
      ];
      const a = performance.now();
      const r = await ev<{ wav: string; peak: number; rms: number; sub: number }>(
        `renderTheme(${JSON.stringify(t.id)}, ${secs}, ${JSON.stringify(curve)}, ${seed})`,
      );
      const file = `${out}/${t.id}.wav`;
      await Bun.write(file, Buffer.from(r.wav, "base64"));
      const db = (x: number) => (20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
      const why: string[] = [];
      if (r.peak > 0.989) why.push("clips");
      if (r.rms < 0.01) why.push("near silent");
      if (t.bass && r.sub < 0.004) why.push("no sub");
      if (why.length) bad++;
      console.log(
        `${why.length ? "✗" : "✓"} ${t.name.padEnd(20)} peak ${db(r.peak)} dBFS · RMS ${db(r.rms)} dBFS · sub ${db(r.sub)} dBFS · ${((performance.now() - a) / 1000).toFixed(1)} s${why.length ? ` — ${why.join(", ")}` : ""}`,
      );
      if (Bun.which("ffmpeg"))
        Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-i", file, "-codec:a", "libmp3lame", "-b:a", "192k", `${out}/${t.id}.mp3`]);
    }
  },
  { files: { "/render.js": js } },
);
process.exit(bad ? 1 : 0);
