// Chrome's CPU profile (CDP Profiler) read for the main loop's long iterations: the runs of samples that stay inside script for longer
// than `minMs` (an iteration of the frame loop that overran — what the loop's 95th percentile is made of), and in them the time each
// function holds, its callees included (inclusive) and alone (self). tests/e2e/j0-reference.e2e.test.ts J0_CPU_PROFILE=1.

export interface CdpProfile {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[];
  startTime: number;
  samples: number[];
  timeDeltas: number[];
}

/** The long runs of script (≥ minMs) and the functions they were spent in: top `top` by inclusive time, with their self time. */
export function longRuns(pr: CdpProfile, minMs = 4, top = 25) {
  const name = new Map(
    pr.nodes.map((n) => [
      n.id,
      `${n.callFrame.functionName || "(anonymous)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`,
    ]),
  );
  const idle = new Set(pr.nodes.filter((n) => /^\((idle|program|garbage collector)\)$/.test(n.callFrame.functionName)).map((n) => n.id));
  const gc = new Set(pr.nodes.filter((n) => n.callFrame.functionName === "(garbage collector)").map((n) => n.id));
  const parent = new Map<number, number>();
  for (const n of pr.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  // (the samples' durations [ms]: each sample holds until the next)
  const dt = pr.samples.map((_, i) => (pr.timeDeltas[i + 1] ?? 0) / 1000);
  // (runs: consecutive samples in script — idle and "(program)" break a run; the garbage collector counted in it, named)
  const runs: { from: number; to: number; ms: number }[] = [];
  let s = -1,
    acc = 0;
  for (let i = 0; i <= pr.samples.length; i++) {
    const busy = i < pr.samples.length && (!idle.has(pr.samples[i]!) || gc.has(pr.samples[i]!));
    if (busy) {
      if (s < 0) (s = i), (acc = 0);
      acc += dt[i]!;
    } else if (s >= 0) {
      if (acc >= minMs) runs.push({ from: s, to: i, ms: acc });
      s = -1;
    }
  }
  const incl = new Map<string, number>();
  const self = new Map<string, number>();
  for (const r of runs)
    for (let i = r.from; i < r.to; i++) {
      const leaf = name.get(pr.samples[i]!)!;
      self.set(leaf, (self.get(leaf) ?? 0) + dt[i]!);
      const seen = new Set<string>();
      for (let id: number | undefined = pr.samples[i]!; id !== undefined; id = parent.get(id)) {
        const g = name.get(id)!;
        if (seen.has(g)) continue;
        seen.add(g);
        incl.set(g, (incl.get(g) ?? 0) + dt[i]!);
      }
    }
  const total = runs.reduce((a, r) => a + r.ms, 0);
  const fns = [...incl]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([f, ms]) => ({ f, inclMs: +ms.toFixed(1), selfMs: +(self.get(f) ?? 0).toFixed(1) }));
  const lengths = runs.map((r) => r.ms).sort((a, b) => b - a);
  return { runs: runs.length, totalMs: +total.toFixed(1), longest: lengths.slice(0, 8).map((x) => +x.toFixed(1)), fns };
}
