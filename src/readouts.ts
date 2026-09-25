import type { CameraFrame } from "./camera";
import { horizon, isco, photonOrbits } from "./physics";

// SI constants (CODATA 2018)
const G = 6.6743e-11;
const C = 2.99792458e8;
const HBAR = 1.054571817e-34;
const KB = 1.380649e-23;
const MSUN = 1.98892e30;

export interface Readout {
  label: string;
  value: string;
  hint?: string;
}

function fmt(x: number, unit = "", digits = 3): string {
  if (!Number.isFinite(x)) return "∞";
  const ax = Math.abs(x);
  const s = ax !== 0 && (ax >= 1e5 || ax < 1e-3) ? x.toExponential(digits - 1).replace("e", "×10^").replace("+", "") : x.toPrecision(digits);
  return unit ? `${s} ${unit}` : s;
}

function fmtTime(sec: number): string {
  if (sec < 1e-3) return fmt(sec * 1e6, "µs");
  if (sec < 1) return fmt(sec * 1e3, "ms");
  if (sec < 120) return fmt(sec, "s");
  if (sec < 7200) return fmt(sec / 60, "min");
  if (sec < 172800) return fmt(sec / 3600, "h");
  if (sec < 3.15e7 * 2) return fmt(sec / 86400, "days");
  return fmt(sec / 3.156e7, "yr");
}

function fmtLength(m: number): string {
  if (m < 1e3) return fmt(m, "m");
  if (m < 1.496e10) return fmt(m / 1e3, "km");
  if (m < 9.46e14) return fmt(m / 1.496e11, "AU");
  return fmt(m / 9.461e15, "ly");
}

/** Specific energy of the circular orbit at the ISCO → radiative efficiency η = 1 − E_isco. */
function iscoEnergy(a: number): number {
  const r = isco(a);
  const x = Math.pow(r, 1.5);
  return (1 - 2 / r + a / x) / Math.sqrt(1 - 3 / r + (2 * a) / x);
}

export function physicalReadouts(spin: number, massSolar: number, cam: CameraFrame): Readout[] {
  const M = massSolar * MSUN;
  const rg = (G * M) / (C * C); // gravitational radius [m]
  const tg = rg / C; // GM/c³ [s]
  const a = spin;
  const rp = horizon(a);
  const rm = 1 - Math.sqrt(Math.max(0, 1 - a * a));
  const rI = isco(a);
  const po = photonOrbits(a);
  const area = 4 * Math.PI * (rp * rp + a * a) * rg * rg;
  const kappa = (rp - rm) / (2 * (rp * rp + a * a)); // surface gravity × GM/c⁴
  const TH = (HBAR * C * C * C * kappa) / (2 * Math.PI * KB * G * M);
  const S = (KB * area * C * C * C) / (4 * G * HBAR);
  const omegaH = a / (2 * rp); // horizon angular velocity × GM/c³
  const Mirr = Math.sqrt(rp * rp + a * a) / 2;
  const eta = 1 - iscoEnergy(a);
  const tIsco = 2 * Math.PI * (Math.pow(rI, 1.5) + a) * tg;
  const evap = (5120 * Math.PI * G * G * M * M * M) / (HBAR * C ** 4); // Schwarzschild estimate

  return [
    { label: "gravitational radius GM/c²", value: fmtLength(rg) },
    { label: "time unit GM/c³", value: fmtTime(tg) },
    { label: "event horizon r₊", value: `${rp.toFixed(3)} M · ${fmtLength(rp * rg)}` },
    { label: "inner horizon r₋", value: `${rm.toFixed(3)} M` },
    { label: "ergosphere (equator)", value: "2.000 M" },
    { label: "photon orbits (pro / retro)", value: `${po.pro.toFixed(3)} / ${po.retro.toFixed(3)} M` },
    { label: "ISCO", value: `${rI.toFixed(3)} M · period ${fmtTime(tIsco)}` },
    { label: "radiative efficiency η", value: `${(eta * 100).toFixed(1)} %`, hint: "1 − E_isco (Novikov–Thorne)" },
    { label: "horizon angular velocity Ω_H", value: `${fmt(omegaH / tg / (2 * Math.PI), "Hz")}` },
    { label: "irreducible mass", value: `${Mirr.toFixed(4)} M`, hint: `extractable rotational energy ${((1 - Mirr) * 100).toFixed(1)} %` },
    { label: "Hawking temperature", value: fmt(TH, "K") },
    { label: "Bekenstein–Hawking entropy", value: `${fmt(S / KB)} k_B` },
    { label: "evaporation time (a=0 est.)", value: fmtTime(evap) },
    { label: "observer lapse dτ/dt", value: cam.zamo.alpha.toFixed(4), hint: "ZAMO clock rate relative to infinity" },
    { label: "observer speed β / γ", value: `${cam.speed.toFixed(3)} / ${cam.gamma.toFixed(3)}` },
    { label: "frame dragging ω at observer", value: `${fmt(cam.zamo.omega / tg / (2 * Math.PI), "Hz")}` },
  ];
}
