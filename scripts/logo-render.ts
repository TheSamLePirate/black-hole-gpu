// The logo's mark (PLAN-TITRE-AAA E1), rendered by the game's own ray tracer: offline, converged, the sky black,
// no flare nor depth of field — candidates saved as snapshots/logo-*.png by the dev server (__bh.render posts
// there: run `bun run dev` first). Then `python3 scripts/build-logo.py snapshots/logo-c2.png` makes
// assets/title/kerr-mark.webp from the one chosen (C: spin 0.6, 87°, the thin disk).
//   bun scripts/logo-render.ts            (E2E_URL: another dev server than http://localhost:3000/)
import { App, stopServer } from "../tests/e2e/lib/app";
process.env.E2E_URL ??= "http://localhost:3000/";
const base = {
  bgIntensity: 0,
  starBrightness: 0,
  lensFlare: 0,
  dof: false,
  bloom: 0.25,
  jet: false,
  sun: false,
  yaw: 0,
  pitch: 0,
  roll: 0,
  azimuth: 0,
  motion: "static",
  animate: false,
};
const V: [string, Record<string, unknown>][] = [
  [
    "logo-a2",
    {
      spin: 0.6,
      inclination: 84,
      distance: 34,
      fov: 44,
      diskOuter: 11,
      diskTemp: 4500,
      shiftMode: "none",
      diskThickness: 0.02,
      diskTau: 6,
      turbulence: 0.9,
      diskEmission: "bolometric",
      tonemap: "Film",
    },
  ],
  [
    "logo-b2",
    {
      spin: 0.94,
      inclination: 83,
      distance: 34,
      fov: 44,
      diskOuter: 11,
      diskTemp: 4500,
      diskThickness: 0.015,
      diskTau: 8,
      turbulence: 0.7,
      tonemap: "Film",
    },
  ],
  [
    "logo-c2",
    {
      spin: 0.6,
      inclination: 87,
      distance: 34,
      fov: 42,
      diskOuter: 11,
      diskTemp: 4500,
      shiftMode: "none",
      diskThickness: 0.009,
      diskTau: 59,
      turbulence: 0.95,
      diskEmission: "bolometric",
      diskHaze: 0.4,
      tonemap: "Film",
    },
  ],
];
const app = await App.boot({ hash: "scene=" + encodeURIComponent("Interstellar (no shifts)"), width: 900, height: 900, telemetry: false });
try {
  for (const [name, patch] of V) {
    const r = await app.js<string>(
      `__bh.render(${JSON.stringify(name)}, "Interstellar (no shifts)", ${JSON.stringify({ ...base, ...patch })}, { width: 1024, height: 1024, spp: 96 })`,
    );
    console.log(r);
  }
} finally {
  app.close();
  stopServer();
}
