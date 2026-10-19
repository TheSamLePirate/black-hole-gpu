// The tracer's static feature bits (renderer.ts featuresOf: 1 band, 2 polarization, 4 jet, 8 hot spot,
// 16 hot flow, 32 wormhole, 64 thick disk) of every preset, grouped by the name's prefix — which scenes share a
// kernel family. Read-only: no GPU. The bits set at run time (128 bodies, 256 runways, 512 metrics, 1024 weather,
// 2048 shadow) depend on what the camera sees and are not counted here.
import { defaultSettings, presets } from "../src/settings";

const NAMES: Record<number, string> = { 1: "band", 2: "pol", 4: "jet", 8: "spot", 16: "flow", 32: "wh", 64: "disk" };
const bits = (s: ReturnType<typeof defaultSettings>) =>
  (s.band !== "visible" ? 1 : 0) |
  (s.polarization && !s.wormhole ? 2 : 0) |
  (s.jet ? 4 : 0) |
  (s.hotSpot ? 8 : 0) |
  (s.hotFlow ? 16 : 0) |
  (s.wormhole ? 32 : 0) |
  (s.diskThickness > 0 ? 64 : 0);
const label = (k: number) =>
  Object.entries(NAMES)
    .filter(([b]) => k & Number(b))
    .map(([, n]) => n)
    .join("+") || "none";

const groups = new Map<string, Map<number, string[]>>();
for (const [name, p] of Object.entries(presets)) {
  const { time: _t, mission: _m, pose: _p, issDistance: _i, issOffset: _o, ...preset } = p;
  const key = bits({ ...defaultSettings(), ...preset });
  const group = name.includes(":") ? name.split(":")[0]! : "(no prefix)";
  const g = groups.get(group) ?? new Map<number, string[]>();
  g.set(key, [...(g.get(key) ?? []), name]);
  groups.set(group, g);
}
for (const [group, g] of groups) {
  console.log(`\n${group}`);
  for (const [k, names] of [...g].sort((a, b) => b[1].length - a[1].length))
    console.log(`  ${String(k).padStart(3)} ${label(k).padEnd(18)} ×${names.length}  e.g. ${names.slice(0, 2).join(" | ")}`);
}
console.log(`\n${Object.keys(presets).length} presets`);
