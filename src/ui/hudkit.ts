// Shared by the flight HUD and the map: colours, fonts, the markers, number formats.
import type { Settings } from "../settings";

/** our universe's bodies on the map */
export const OUR_COLOURS: Record<string, string> = {
  sun: "255, 236, 170",
  mercury: "190, 180, 170",
  venus: "240, 220, 170",
  earth: "120, 180, 255",
  moon: "210, 210, 210",
  mars: "240, 130, 90",
  phobos: "170, 150, 130",
  deimos: "170, 150, 130",
  ceres: "180, 180, 180",
  jupiter: "230, 200, 160",
  io: "240, 220, 120",
  europa: "220, 210, 190",
  ganymede: "190, 180, 170",
  callisto: "160, 150, 140",
  saturn: "235, 215, 160",
  mimas: "210, 210, 210",
  enceladus: "240, 245, 255",
  tethys: "220, 220, 220",
  dione: "210, 210, 210",
  rhea: "210, 210, 210",
  titan: "235, 170, 90",
  iapetus: "200, 190, 170",
  uranus: "160, 220, 230",
  neptune: "110, 150, 255",
  triton: "220, 210, 220",
  pluto: "220, 190, 160",
  charon: "190, 190, 190",
  iss: "95, 255, 208",
  ranger: "255, 214, 120",
  lander: "255, 160, 200",
  endurance: "200, 225, 255",
};

export const AMBER = "#ffb35c";
export const CYAN = "#7cd6ff";
export const RED = "#ff5a46";
export const COL: Record<string, string> = {
  prograde: "#d6f55b",
  retrograde: "#d6f55b",
  radialOut: "#5fd3ff",
  radialIn: "#5fd3ff",
  normal: "#e07bff",
  antinormal: "#e07bff",
  target: "#ff8a5c",
  burn: "#4d8dff",
  tgtPrograde: "#ff8a5c",
  tgtRetrograde: "#ff8a5c",
  antiTarget: "#ff8a5c",
  maneuver: "#4d8dff",
  dock: "#5fffd0",
};
/** the HUD's technical face for labels (sized ~1.2× Inter's: narrower), mono for figures */
export const FONT = "Rajdhani, Inter, system-ui, sans-serif";
export const MONO = '"JetBrains Mono", ui-monospace, monospace';

export function marker(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, r: number, col: string) {
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.beginPath();
  if (kind === "dock") {
    // (a docking port: its ring in a square, its centre)
    ctx.rect(x - r * 1.1, y - r * 1.1, r * 2.2, r * 2.2);
    ctx.moveTo(x + r * 0.55, y);
    ctx.arc(x, y, r * 0.55, 0, 2 * Math.PI);
    ctx.moveTo(x + r * 0.1, y);
    ctx.arc(x, y, r * 0.1, 0, 2 * Math.PI);
    ctx.stroke();
    return;
  }
  if (kind === "prograde") {
    ctx.arc(x, y, r * 0.6, 0, 2 * Math.PI);
    ctx.moveTo(x, y - r * 0.6);
    ctx.lineTo(x, y - r * 1.2);
    ctx.moveTo(x - r * 0.6, y);
    ctx.lineTo(x - r * 1.2, y);
    ctx.moveTo(x + r * 0.6, y);
    ctx.lineTo(x + r * 1.2, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.15, 0, 2 * Math.PI);
    ctx.fill();
  } else if (kind === "burn") {
    ctx.arc(x, y, r * 0.8, 0, 2 * Math.PI);
    ctx.moveTo(x - r * 0.5, y);
    ctx.lineTo(x + r * 0.5, y);
    ctx.moveTo(x, y - r * 0.5);
    ctx.lineTo(x, y + r * 0.5);
    ctx.stroke();
  } else if (kind === "target") {
    ctx.rect(x - r * 0.6, y - r * 0.6, r * 1.2, r * 1.2);
    ctx.stroke();
  } else {
    ctx.arc(x, y, r * 0.6, 0, 2 * Math.PI);
    ctx.moveTo(x - r * 0.42, y - r * 0.42);
    ctx.lineTo(x + r * 0.42, y + r * 0.42);
    ctx.moveTo(x + r * 0.42, y - r * 0.42);
    ctx.lineTo(x - r * 0.42, y + r * 0.42);
    ctx.stroke();
  }
}

export function niceStep(x: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(x, 1e-9)));
  const m = x / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}

export function fmtShort(t: number) {
  return t >= 1000 ? `${+(t / 1000).toFixed(1)}k M` : `${t} M`;
}

/** A distance in M, in km (m) for the chosen mass below 0.1 M: near a planet, M is far too coarse. */
export function fmtLen(d: number, s: Settings) {
  if (d >= 0.1) return `${d.toFixed(1)} M`;
  const m = d * 1476.625 * s.massSolar;
  return m >= 1e4 ? `${Math.round(m / 1000).toLocaleString("en-US")} km` : `${Math.round(m).toLocaleString("en-US")} m`;
}

/** A velocity change (c): m/s, km/s or c. */
export function fmtDv(v: number) {
  const k = v * 299792.458;
  if (Math.abs(k) >= 3000) return `${v.toFixed(3)}c`;
  if (Math.abs(k) >= 1) return `${k.toFixed(2)} km/s`;
  return `${(k * 1000).toFixed(0)} m/s`;
}

/** A duration (coordinate time in M) for the chosen mass: s, min, h, d, y. */
export function fmtDur(t: number, s: Settings) {
  const sec = Math.max(t, 0) * 4.925490947e-6 * s.massSolar;
  if (sec < 120) return `${sec.toFixed(0)} s`;
  if (sec < 7200) return `${Math.floor(sec / 60)}m${String(Math.floor(sec % 60)).padStart(2, "0")}s`;
  if (sec < 172800) return `${Math.floor(sec / 3600)}h${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;
  if (sec < 365.25 * 86400 * 2) return `${(sec / 86400).toFixed(1)} d`;
  return `${(sec / (365.25 * 86400)).toFixed(1)} y`;
}
