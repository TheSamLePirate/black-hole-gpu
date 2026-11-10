// J0's reference flight scene (docs/J0-CONTRAT.md §3; strategy §22.4 D2: Toulon-Hyères, the coast). One definition read by
// the e2e that measures it (tests/e2e/j0-reference.e2e.test.ts) and by anyone who wants to fly it again: changing a value here
// changes the scene — a new fiche, never compared with the old one as if it were the same.
//
// The F-35 from its cockpit, 500 m over the sea of the Rade d'Hyères, heading west along the coast at 140 m/s, its autopilot
// holding height and heading, its autothrottle its speed, gear down (the stable-flight protocol, E2E-VOLS §5.4); then a right turn
// of 70° that crosses the coastline towards La Londe and the Maures: sea and its glint (the sun low in the west), the coast, the
// relief, the IGN imagery and relief, the towns' buildings, scattered clouds. 10 July 2026, 15:30 UTC (17:30 local).

export const J0_SCENE = {
  id: "toulon-hyeres-v1",
  /** the start: lat, lon [° WGS84], height over the ground (here the sea) [m], heading [° true], speed [m/s] */
  start: [43.06, 6.32, 500, 270, 140] as [number, number, number, number, number],
  /** UTC */
  date: "2026-07-10T15:30:00Z",
  weather: "fair",
  earthClouds: 0.5,
  /** the turn: started TURN_AT_S after the measure begins, to this heading [° true] */
  turnAtS: 25,
  turnTo: 340,
  /** the measured flight [s, real time] */
  flightS: 70,
};

/** the settings that make the scene the same every run (and only those — the rest is the player's profile, as shipped) */
export const J0_FIXED = `{ vessel: "f35", traffic: false, autosave: false, wind: 0, damage: false, crashSpeed: 1e9,
  f35Invulnerable: true, f35AutoProtect: false, weather: "${J0_SCENE.weather}", earthClouds: ${J0_SCENE.earthClouds} }`;

/** the intervals between new images [ms] and their statistics: each over 33.3 ms counted with its duration; the GPU time of the
 * images (renderer.lastGpuMs). Frames: [ms since the measure began, images finished since the last rAF, GPU ms] */
export function intervals(frames: [number, number, number][]) {
  const iv: number[] = [];
  for (let i = 1; i < frames.length; i++) iv.push(frames[i]![0] - frames[i - 1]![0]);
  const s = [...iv].sort((a, b) => a - b);
  const q = (p: number) => +(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0).toFixed(2);
  const over = iv.filter((x) => x > 33.3);
  const gpu = frames.map((f) => f[2]).filter((x) => x > 0);
  const gs = [...gpu].sort((a, b) => a - b);
  const gq = (p: number) => +(gs[Math.min(gs.length - 1, Math.floor(p * gs.length))] ?? 0).toFixed(2);
  const span = frames.length > 1 ? (frames[frames.length - 1]![0] - frames[0]![0]) / 1000 : 0;
  return {
    images: frames.length,
    imagesPerS: span ? +(iv.length / span).toFixed(1) : 0,
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    max: +(s[s.length - 1] ?? 0).toFixed(1),
    over33: over.length,
    over33ms: Math.round(over.reduce((a, b) => a + b, 0)),
    gpuP50: gq(0.5),
    gpuP95: gq(0.95),
  };
}
