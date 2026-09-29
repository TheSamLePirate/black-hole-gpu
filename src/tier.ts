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

/** The pixel ratio that keeps a CSS area of w × h within the tier's cap (and the settings' ratio). */
export function cappedRatio(ratio: number, w: number, h: number, capMpx: number) {
  const area = Math.max(w * h, 1);
  return Math.min(ratio, Math.sqrt((capMpx * 1e6) / area));
}
