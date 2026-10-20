// A number setting's value as its controls show and move it (the Lab's sliders, the player's bars — PLAN-TITRE-AAA
// E9): its display, its place on a slider (a log scale: 0…1000), a step of the arrows. Pure.

import type { NumberDef } from "../schema";

export function decimalsFor(step: number) {
  return Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
}

export function formatValue(d: NumberDef, v: number): string {
  if (d.offAtZero && v === 0) return "off";
  if (d.scale === "log") {
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-3))
      return v
        .toExponential(Math.max(0, (d.precision ?? 3) - 1))
        .replace(/\.?0+e/, "e")
        .replace("e+", "e");
    return String(Number(v.toPrecision(d.precision ?? 3)));
  }
  return v.toFixed(decimalsFor(d.step ?? 0.01));
}

export function toSlider(d: NumberDef, v: number): number {
  if (d.scale === "log") {
    if (d.offAtZero && v <= 0) return 0;
    return (Math.log(Math.max(v, d.min) / d.min) / Math.log(d.max / d.min)) * 1000;
  }
  return v;
}

export function fromSlider(d: NumberDef, x: number): number {
  if (d.scale === "log") {
    if (d.offAtZero && x <= 0) return 0;
    const v = d.min * (d.max / d.min) ** (x / 1000);
    return Number(v.toPrecision(d.precision ?? 3));
  }
  const step = d.step ?? 0.01;
  return Number((Math.round(x / step) * step).toFixed(decimalsFor(step)));
}

export function sliderPercent(d: NumberDef, v: number) {
  const x = toSlider(d, v);
  return d.scale === "log" ? x / 10 : ((x - d.min) / (d.max - d.min)) * 100;
}

export function sameValue(a: unknown, b: unknown) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  return a === b;
}

/** A press of an arrow on a number's bar: a fortieth of its range (a log scale: of its slider), on its step. */
export function stepNumber(d: NumberDef, v: number, dir: 1 | -1): number {
  if (d.scale === "log") {
    const x = Math.min(1000, Math.max(0, toSlider(d, v) + dir * 25));
    return fromSlider(d, x);
  }
  const step = d.step ?? 0.01;
  const n = Math.max(1, Math.round((d.max - d.min) / 40 / step));
  const x = Math.min(d.max, Math.max(d.min, v + dir * n * step));
  return Number((Math.round(x / step) * step).toFixed(decimalsFor(step)));
}

/** A bar's value at a share of its width (0…1). */
export function numberAt(d: NumberDef, share: number): number {
  const f = Math.min(1, Math.max(0, share));
  if (d.scale === "log") return fromSlider(d, f * 1000);
  return fromSlider(d, d.min + f * (d.max - d.min));
}

/** A setting's GPU cost (ui/settings/costs.ts) as a share of its view's frame: what its heavy value adds. */
export function costShare(c: { lightMs: number; heavyMs: number }): number {
  return c.lightMs > 0 ? (c.heavyMs - c.lightMs) / c.lightMs : 0;
}

/** The cost's dots (0…5): under 3 % none (within the measure's noise), then 10, 25, 50, 100 % of the frame. */
export function costDots(share: number): number {
  return share < 0.03 ? 0 : share < 0.1 ? 1 : share < 0.25 ? 2 : share < 0.5 ? 3 : share < 1 ? 4 : 5;
}
