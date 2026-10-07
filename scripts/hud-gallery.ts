// The HUD pictured in fixed flight states — the before and after of a change to the hub, its cards, the
// telemetry or the graphs. States are games saved by the flight lab beside its pictures
// (LAB_STATES=1 bun scripts/flightlab.ts run …: shots/<n>-<moment>.save.json), kept in tests/hud/states/.
//
//   bun scripts/hud-gallery.ts <out-dir> [state.save.json …]     (default: every tests/hud/states/*.json)
//   options: --settle <s> (real seconds flown after the load before the picture, default 3) · --sheet <file.jpg>
//
// Each state is loaded in one headless page (__bh.game.importSave), flown a few seconds at its own warp so
// the cards, graphs and trends fill in, then pictured (<out-dir>/<state>.png). With --sheet, a contact sheet
// of them all (scripts/compose.py).
import { mkdirSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { Lab } from "../tests/flight/lib/lab";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  if (i < 0) return null;
  const v = args[i + 1] ?? null;
  args.splice(i, 2);
  return v;
};
const settle = Number(opt("--settle") ?? 3);
const sheet = opt("--sheet");
const out = args.shift();
if (!out) {
  console.error("usage: bun scripts/hud-gallery.ts <out-dir> [state.save.json …] [--settle s] [--sheet file.jpg]");
  process.exit(2);
}
const dir = "tests/hud/states";
const states = args.length
  ? args
  : readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => `${dir}/${f}`);
mkdirSync(out, { recursive: true });
const lab = await Lab.open({ dir: `${out}/.lab` });
const shots: [string, string][] = [];
try {
  for (const file of states) {
    const name = basename(file).replace(/(\.save)?\.json$/, "");
    const json = await Bun.file(file).text();
    const ok = await lab.js<boolean>(`(__bh.freeze(false), __bh.game.importSave(${JSON.stringify(json)}, false), true)`).catch((e) => {
      console.error(`${name}: ${e}`);
      return false;
    });
    if (!ok) continue;
    await Bun.sleep(settle * 1000);
    const png = `${out}/${name}.png`;
    await lab.app.shot(png);
    shots.push([png, name]);
    console.log(`${name} → ${png}`);
  }
} finally {
  lab.close();
}
if (sheet && shots.length) {
  const p = Bun.spawnSync(["python3", "scripts/compose.py", sheet, `HUD — ${new Date().toISOString().slice(0, 10)}`, ...shots.flat()], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (p.exitCode === 0) console.log(`sheet → ${sheet}`);
}
process.exit(0);
