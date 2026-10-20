// The boot's timeline (PLAN-TITRE-AAA E0): its stages marked as they come (performance.mark "boot:…"), and the
// main thread watched from the page's first byte by index.html's inline script — the long tasks (> 50 ms) and
// the gaps between animation frames, what a menu or an animation on this thread would have suffered while the
// game started. Read by __bh.boot(); no DOM, nothing sent anywhere.

interface BootWatch {
  /** [start, duration] of each long task [ms since the navigation] */
  long: [number, number][];
  /** [start, length] of each gap between two animation frames longer than 50 ms */
  gaps: [number, number][];
  /** the watch stopped (the first image + 2 s): no more frames counted */
  stop?: boolean;
}

declare global {
  interface Window {
    __boot?: BootWatch;
  }
}

const marks: { name: string; t: number }[] = [];

/** A stage of the boot reached (once per name: the first time counts). */
export function bootMark(name: string) {
  if (marks.some((m) => m.name === name)) return;
  const t = Math.round(performance.now());
  marks.push({ name, t });
  try {
    performance.mark(`boot:${name}`);
  } catch {
    /* (no User Timing: the list is enough) */
  }
}

export interface BootReport {
  marks: { name: string; t: number }[];
  /** when the first image was drawn [ms since the navigation] (null: not yet) */
  firstImage: number | null;
  long: { count: number; totalMs: number; maxMs: number; list: [number, number][] };
  gaps: { count: number; maxMs: number; list: [number, number][] };
  /** the main thread's time in long tasks before the first image, and the share of that wait */
  blockedMs: number;
  blockedShare: number;
}

/** The timeline so far. `firstImage`: when the first image was drawn (performance.now() ms), if it was. */
export function bootReport(firstImage: number | null): BootReport {
  const w = (typeof window !== "undefined" && window.__boot) || { long: [], gaps: [] };
  const end = firstImage ?? performance.now();
  const before = w.long.filter(([s]) => s < end);
  const blockedMs = before.reduce((a, [s, d]) => a + Math.min(d, end - s), 0);
  return {
    marks: [...marks].sort((a, b) => a.t - b.t),
    firstImage: firstImage === null ? null : Math.round(firstImage),
    long: {
      count: w.long.length,
      totalMs: w.long.reduce((a, [, d]) => a + d, 0),
      maxMs: Math.max(0, ...w.long.map(([, d]) => d)),
      list: w.long,
    },
    gaps: { count: w.gaps.length, maxMs: Math.max(0, ...w.gaps.map(([, d]) => d)), list: w.gaps },
    blockedMs: Math.round(blockedMs),
    blockedShare: end > 0 ? Math.round((1000 * blockedMs) / end) / 1000 : 0,
  };
}

/** The frame watch stopped (the boot over: it would only count the game's own frames). */
export function bootWatchStop() {
  if (typeof window !== "undefined" && window.__boot) window.__boot.stop = true;
}
