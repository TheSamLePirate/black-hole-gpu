// The hardware's tier, guessed at start from what WebGPU and the browser tell (vendor, architecture,
// fallback adapter, the device's memory, a touch screen): it caps the realtime image's pixels — a
// pixel budget, not a ratio of the CSS size (a 4K screen at ratio 1 was 8.3 Mpx in the Game quality,
// four times a laptop's). The dynamic resolution then works under that cap.

export interface Tier {
  /** 0 software … 4 high-end */
  level: 0 | 1 | 2 | 3 | 4;
  /** the realtime image's pixels at most [Mpx] */
  capMpx: number;
  /** what it was guessed from */
  label: string;
}

import { store } from "./util/storage";

const CAP = [0.5, 0.9, 2.2, 3.5, 6] as const;

export function guessTier(adapter: GPUAdapter): Tier {
  const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
  const vendor = (info?.vendor ?? "").toLowerCase();
  const arch = (info?.architecture ?? "").toLowerCase();
  const desc = (info?.description ?? "").toLowerCase();
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const fallback = (info as GPUAdapterInfo & { isFallbackAdapter?: boolean })?.isFallbackAdapter ?? false;
  let level: Tier["level"];
  if (fallback || /swiftshader|llvmpipe|software/.test(desc + arch)) level = 0;
  else if (touch || mem <= 4) level = 1;
  else if (vendor.includes("intel")) level = 1;
  else if (vendor.includes("nvidia") || vendor.includes("amd") || vendor.includes("ati")) level = /mobile|laptop|max-q/.test(desc) ? 2 : 3;
  // (Apple: the base chips and the Pro/Max cannot be told apart from here — the middle, the dynamic
  // resolution adjusting)
  else level = 2;
  return { level, capMpx: CAP[level], label: [vendor || "?", arch || "?", `${mem} GB`, touch ? "touch" : ""].filter(Boolean).join(" · ") };
}

/**
 * The tier one step up, the measure having shown the GPU idle at the cap (audit P3: every Apple chip is
 * guessed at the middle — the base M1 and the M1 Max alike, a factor 4 to 8 apart): its pixel budget
 * raised, the dynamic resolution then taking it back down if need be. Null at the top.
 */
export function promoted(t: Tier): Tier | null {
  if (t.level >= 4) return null;
  const level = (t.level + 1) as Tier["level"];
  return { level, capMpx: CAP[level], label: `${t.label} · measured ↑` };
}

/**
 * The tier one step down, the measure having shown the GPU over its budget at the coarsest block
 * and the smallest scale — the dynamic resolution with nowhere left to retreat but the pixel
 * budget itself (the promotion's missing half, plan §3.4). Null at the bottom.
 */
export function demoted(t: Tier): Tier | null {
  if (t.level <= 0) return null;
  const level = (t.level - 1) as Tier["level"];
  return { level, capMpx: CAP[level], label: `${t.label} · measured ↓` };
}

/** A tier by its level (the pixel budget's table), with the given label. */
export function tierAt(level: Tier["level"], label: string): Tier {
  return { level, capMpx: CAP[level], label };
}

/** The adapter's identity, under which its measured tier is remembered between sessions. */
export function adapterId(a: { vendor: string; architecture: string; device: string }): string {
  return `${a.vendor}|${a.architecture}|${a.device}`;
}

const TIER_KEY = "kerr.tier";
const TIER_VERSION = 1;
const TIER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** A remembered measurement is a temporary starting hint, not a hardware benchmark. */
export function rememberedLevel(id: string, now = Date.now()): Tier["level"] | null {
  const kept = store.getJSON<{ version?: number; adapter?: string; level?: number; measuredAt?: number } | null>(TIER_KEY, null);
  if (
    !id.replaceAll("|", "").trim() ||
    !kept ||
    kept.version !== TIER_VERSION ||
    kept.adapter !== id ||
    !Number.isInteger(kept.level) ||
    kept.level! < 0 ||
    kept.level! >= CAP.length ||
    !Number.isFinite(kept.measuredAt) ||
    kept.measuredAt! > now ||
    now - kept.measuredAt! > TIER_MAX_AGE_MS
  )
    return null;
  return kept.level as Tier["level"];
}

/** Remember only an identified adapter, with a schema version and an expiry. */
export function rememberLevel(id: string, t: Tier, now = Date.now()) {
  if (!id.replaceAll("|", "").trim()) return;
  store.setJSON(TIER_KEY, { version: TIER_VERSION, adapter: id, level: t.level, measuredAt: now });
}

/** Return to hardware detection at the next startup. */
export function resetRememberedTier() {
  store.remove(TIER_KEY);
}

/** The pixel ratio that keeps a CSS area of w × h within the tier's cap (and the settings' ratio). */
export function cappedRatio(ratio: number, w: number, h: number, capMpx: number) {
  const area = Math.max(w * h, 1);
  return Math.min(ratio, Math.sqrt((capMpx * 1e6) / area));
}
