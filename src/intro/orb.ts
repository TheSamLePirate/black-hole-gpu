// The loading orb (PLAN-TITRE-AAA): thinking-orbs' engine (MIT, © Jakub Antalik — pure geometry, no DOM, no
// React) drawn by us, in the game's colours: the near dots warm white, the far ones the disk's amber. Its
// state follows the boot's stages (loading.ts). No DOM here either: it draws into any 2D context — the intro's
// Worker's OffscreenCanvas, a canvas in the page.

import { MODE_FRAMES, type OrbSize, type OrbState, resolvePreset } from "thinking-orbs/engine";

export type { OrbState };

export type RGB = readonly [number, number, number];

/** the far dots' colour (the disk's amber) and the near ones' (a warm white) */
const FAR: RGB = [255, 179, 92];
const NEAR: RGB = [255, 246, 232];

/** How an orb is drawn beyond its state: the tuned design (the engine's 64 px one by default — 20 px for an
 *  orb inline with text, its own dot count and size), its colours (TARS's are tinted by his state). */
export interface OrbLook {
  design?: OrbSize;
  far?: RGB;
  near?: RGB;
}

/**
 * One frame of the orb in the `size`-pixel square whose top-left corner is (x, y) of `ctx`, `t` seconds into its animation.
 * `fade` (0…1) dims it whole (its entry and exit); `look`, its design and colours (the loading orb's by default).
 */
export function drawOrb(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  state: OrbState,
  x: number,
  y: number,
  size: number,
  t: number,
  fade = 1,
  look: OrbLook = {},
) {
  const base = look.design ?? 64;
  const far = look.far ?? FAR;
  const near = look.near ?? NEAR;
  const { mode, speed, opts } = resolvePreset(state, base);
  const { dots, lines } = MODE_FRAMES[mode](base, t * speed, opts);
  const k = size / base;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  for (const l of lines) {
    const [r, g, b, a] = ink(l.white, (l.a ?? 1) * fade, far, near);
    ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
    ctx.lineWidth = l.w;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
  }
  for (const d of dots) {
    const [r, g, b, a] = ink(d.white, (d.a ?? 1) * fade, far, near);
    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** An ink value (the engine's paper convention: 0 the darkest) as our colour on the dark: near bright and warm white,
 *  far dim and amber. */
export function ink(white: number, alpha: number, far: RGB = FAR, near: RGB = NEAR): [number, number, number, number] {
  const n = 1 - Math.min(1, Math.max(0, white));
  const lum = 0.3 + 0.7 * n;
  const c = (i: 0 | 1 | 2) => Math.round((far[i] + (near[i] - far[i]) * n) * lum);
  return [c(0), c(1), c(2), Math.round(alpha * 1000) / 1000];
}

/** The stages of the boot (loading.ts ids) still running, the first image drawn or not: the orb's state. */
export function orbStateFor(active: readonly string[], firstImage: boolean): OrbState {
  if (firstImage) return active.length ? "composing" : "breathing";
  if (active.includes("pipelines") || active.includes("scene-tracer")) return "solving";
  if (active.includes("shaders")) return "weaving";
  if (active.includes("gpu")) return "connecting";
  if (active.some((id) => DOWNLOADS.has(id))) return "searching";
  return "working";
}

const DOWNLOADS = new Set(["ephemeris", "sky", "stars", "maps", "earth", "ranger", "endurance", "iss"]);
