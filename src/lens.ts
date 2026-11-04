// The GoPro mode's lens (docs/PLAN-REFRACTION-HORIZONS.md Q6 I8, VIPER 11 A5, decision 38): outside the cockpit, the view as an
// action camera films it — rectilinear within 28° of the axis, then the angles compressed towards the edges; 100° across the
// output, a 2.39:1 band. The raster's visibility draws rectilinear only: the image is rendered rectilinear and wider (its field
// covers the output's corners: 104.6° across) and 1.2 × larger (the centre ~0.84 of a source pixel per output pixel — "nearly
// sharp", ~1.5 × the outside view's cost: decision 38), then remapped in display.wgsl (lensUv — this file's lensSource, the same).

/** the lens's shape: the output's half-width angle, the rectilinear part, the compression past it (radians, ratio) */
export const GOPRO = {
  halfOut: (50 * Math.PI) / 180,
  theta0: (28 * Math.PI) / 180,
  compress: 0.75,
  /** the render's size over the canvas's */
  renderScale: 1.2,
  /** the output's band: width over height */
  band: 2.39,
} as const;

/** the lens's focal [output half-widths per unit tangent]: the output's edge at halfOut */
export const GOPRO_F = (() => {
  const { halfOut, theta0, compress } = GOPRO;
  const t0 = Math.tan(theta0);
  return 1 / (t0 + (1 + t0 * t0) * compress * (halfOut - theta0));
})();

/** the angle off the axis [rad] at a radius r of the output [its half-widths] */
export function lensAngle(r: number): number {
  const { theta0, compress } = GOPRO;
  const t0 = Math.tan(theta0);
  const r0 = GOPRO_F * t0;
  return r <= r0 ? Math.atan(r / GOPRO_F) : theta0 + (r - r0) / (GOPRO_F * (1 + t0 * t0) * compress);
}

/** the render's half-width tangent: the output's corners covered (the band's) */
export const GOPRO_SRC_TAN = (() => {
  const rc = Math.hypot(1, 1 / GOPRO.band);
  const th = lensAngle(rc);
  return Math.tan(th) / rc;
})();

/** the share of the canvas's height the render needs (Q6 I8): the band's corners at the render's edge by construction
 *  (GOPRO_SRC_TAN — their source radius one), its rows within ±(aspect / band) of the middle — 0.744 at 16:9 —, 2 % more for the
 *  display's filter; the rows above and below never read, not rendered */
export const goproRowShare = (aspect: number) => Math.min(1, (aspect / GOPRO.band) * 1.02);

/** the render's vertical field [degrees] for a canvas of this aspect (width over height): its half-width tangent GOPRO_SRC_TAN */
export const goproRenderFov = (aspect: number) => (2 * Math.atan(GOPRO_SRC_TAN / Math.max(aspect, 1e-3)) * 180) / Math.PI;

/**
 * Where an output point (u, v) [half-widths from the centre, v down] reads the rectilinear render (its uv, 0…1), for a canvas
 * of this aspect; null outside the band.
 */
export function lensSource(u: number, v: number, aspect: number): [number, number] | null {
  if (Math.abs(v) > 1 / GOPRO.band) return null;
  const r = Math.hypot(u, v);
  const k = r > 1e-9 ? Math.tan(lensAngle(r)) / (r * GOPRO_SRC_TAN) : 1 / (GOPRO_F * GOPRO_SRC_TAN);
  return [0.5 + 0.5 * u * k, 0.5 + 0.5 * v * k * aspect];
}

/**
 * Where a point of the canvas looks through the GoPro lens (Q6 I8: the pointer's picks in the bent view): its ndc on the canvas
 * (x right, y up, −1…1) → the rectilinear render's ndc there, with the render's vertical field [°] and aspect — the display's
 * own mapping (lensSource, the render's rows goproRowShare); null outside the band.
 */
export function goproLook(ndcX: number, ndcY: number, aspect: number): { ndcX: number; ndcY: number; fov: number; aspect: number } | null {
  const ra = aspect / goproRowShare(aspect);
  const s = lensSource(ndcX, -ndcY / Math.max(aspect, 1e-3), ra);
  if (!s) return null;
  return { ndcX: 2 * s[0] - 1, ndcY: 1 - 2 * s[1], fov: goproRenderFov(ra), aspect: ra };
}
