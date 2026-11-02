// The machine's heat, read from the thermal service's files (docs/THERMAL.md — tools/mac-thermal, a LaunchAgent on
// each Mac of the lab writing a snapshot every 5 s): no process started, no sudo, nothing thrown — null where the
// service is not (Windows, a Mac without it, a stale file). For the measures (bench.ts, trace-ab.ts), the e2e's
// summaries (tests/e2e/lib/telemetry.ts) and the lab's monitor.
//
//   thermalNow()           the latest snapshot, briefly (null: none, or older than 30 s)
//   thermalWindow(t0, t1)  the history between two instants (ms): pressure counts, the GPU's clock and heat
//   thermalLine(b)         one line for a human; thermalWarning(b): what makes a measure doubtful, or null
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

export const THERMAL_DIR = process.env.KERR_THERMAL_DIR ?? join(homedir(), ".local/state/kerr-thermal");
export const THERMAL_LATEST = join(THERMAL_DIR, "latest.json");
export const THERMAL_LOG = join(THERMAL_DIR, "history.jsonl");
/** the root daemon's powermetrics samples (tools/mac-thermal/service/install-root.sh) */
export const THERMAL_FEED = "/var/run/kerr-thermal/powermetrics.txt";
const PRESSURES = ["Nominal", "Moderate", "Heavy", "Trapping", "Sleeping"];

export interface ThermalBrief {
  host: string;
  at: string;
  ageS: number;
  /** the OS's thermal pressure (Nominal, Moderate, Heavy…), powermetrics' or notifyd's */
  pressure: string | null;
  pressureSource: "powermetrics" | "os" | null;
  /** NSProcessInfo.thermalState: nominal, fair, serious, critical */
  state: string | null;
  /** the GPU's clock: powermetrics' active frequency (root feed) or macmon's */
  gpuMHz: number | null;
  gpuMaxMHz: number | null;
  gpuOfMaxPct: number | null;
  /** powermetrics' active residency (root feed only); else macmon's frequency-scaled activity */
  gpuBusyPct: number | null;
  gpuTempC: number | null;
  cpuTempC: number | null;
  gpuW: number | null;
  sysW: number | null;
  /** powermetrics' figures in it (the root feed ran) */
  feed: boolean;
}

export interface ThermalWindow {
  host: string;
  from: string;
  to: string;
  n: number;
  /** samples per pressure level */
  pressure: Record<string, number>;
  worstPressure: string | null;
  gpuMHz: { min: number; median: number; max: number } | null;
  gpuOfMaxPct: { min: number; median: number } | null;
  gpuTempMaxC: number | null;
  cpuTempMaxC: number | null;
  gpuW: { median: number; max: number } | null;
  feed: boolean;
}

type Metric = { value: number | null };
type Snap = {
  timestamp: string;
  host?: { model?: string | null };
  metrics: Record<string, Metric | undefined>;
  thermal: { state: string | null; pressure: string | null; pressureSource?: "powermetrics" | "os" | null };
  sources?: Record<string, { status: string }>;
};

const host = () => hostname().replace(/\.local$/, "");
const v = (s: Snap, id: string) => s.metrics[id]?.value ?? null;
const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

/** A snapshot (the toolkit's schema 2) → the figures that matter for a measure. */
export function brief(s: Snap, now = Date.now(), name = host()): ThermalBrief {
  const pm = v(s, "gpu.frequency_mhz");
  const mhz = pm ?? v(s, "gpu.macmon_frequency_mhz");
  const max = v(s, "gpu.maximum_frequency_mhz");
  return {
    host: name,
    at: s.timestamp,
    ageS: Math.round((now - Date.parse(s.timestamp)) / 100) / 10,
    pressure: s.thermal.pressure,
    pressureSource: s.thermal.pressureSource ?? (s.thermal.pressure ? "powermetrics" : null),
    state: s.thermal.state,
    gpuMHz: mhz === null ? null : Math.round(mhz),
    gpuMaxMHz: max,
    gpuOfMaxPct: mhz !== null && max ? Math.round((100 * mhz) / max) : null,
    gpuBusyPct: r1(v(s, "gpu.active_percent") ?? v(s, "gpu.scaled_percent")),
    gpuTempC: r1(v(s, "gpu.temperature_c")),
    cpuTempC: r1(v(s, "cpu.temperature_c")),
    gpuW: r1(v(s, "gpu.power_w") ?? v(s, "gpu.macmon_power_w")),
    sysW: r1(v(s, "system.power_w")),
    feed: s.sources?.powermetrics?.status === "available",
  };
}

/** This machine's latest snapshot, or null (no service, or its file older than maxAgeS). */
export function thermalNow(maxAgeS = 30): ThermalBrief | null {
  try {
    const s = JSON.parse(readFileSync(THERMAL_LATEST, "utf8")) as Snap;
    const b = brief(s);
    return b.ageS <= maxAgeS && b.ageS > -5 ? b : null;
  } catch {
    return null;
  }
}

/** The history's samples between t0 and t1 (ms since the epoch), the rotated file's too; [] without the service. */
export function thermalSamples(t0: number, t1: number): Snap[] {
  const out: Snap[] = [];
  for (const f of [`${THERMAL_LOG}.2`, `${THERMAL_LOG}.1`, THERMAL_LOG]) {
    try {
      if (!existsSync(f) || statSync(f).mtimeMs < t0) continue;
      for (const line of readFileSync(f, "utf8").split("\n")) {
        // (the instant read from the line's head; only the window's lines parsed)
        const m = line.slice(0, 200).match(/"timestamp":"([^"]+)"/);
        if (!m) continue;
        const t = Date.parse(m[1]!);
        if (t < t0 || t > t1) continue;
        try {
          out.push(JSON.parse(line) as Snap);
        } catch {
          /* (a line being written) */
        }
      }
    } catch {
      /* (rotated meanwhile) */
    }
  }
  return out;
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

/** The machine's heat over a window (a test, a bench): null without samples in it. */
export function thermalWindow(t0: number, t1 = Date.now()): ThermalWindow | null {
  try {
    return windowOf(thermalSamples(t0, t1), t1);
  } catch {
    return null;
  }
}

function windowOf(S: Snap[], t1: number): ThermalWindow | null {
  if (!S.length) return null;
  const B = S.map((s) => brief(s, t1));
  const pressure: Record<string, number> = {};
  for (const b of B) if (b.pressure) pressure[b.pressure] = (pressure[b.pressure] ?? 0) + 1;
  const worst = Object.keys(pressure).sort((a, b) => PRESSURES.indexOf(b) - PRESSURES.indexOf(a))[0] ?? null;
  const nums = (f: (b: ThermalBrief) => number | null) => B.map(f).filter((x): x is number => x !== null);
  const mhz = nums((b) => b.gpuMHz);
  const pct = nums((b) => b.gpuOfMaxPct);
  const gt = nums((b) => b.gpuTempC);
  const ct = nums((b) => b.cpuTempC);
  const gw = nums((b) => b.gpuW);
  return {
    host: host(),
    from: S[0]!.timestamp,
    to: S[S.length - 1]!.timestamp,
    n: S.length,
    pressure,
    worstPressure: worst,
    gpuMHz: mhz.length ? { min: Math.min(...mhz), median: median(mhz), max: Math.max(...mhz) } : null,
    gpuOfMaxPct: pct.length ? { min: Math.min(...pct), median: median(pct) } : null,
    gpuTempMaxC: gt.length ? Math.max(...gt) : null,
    cpuTempMaxC: ct.length ? Math.max(...ct) : null,
    gpuW: gw.length ? { median: median(gw), max: Math.max(...gw) } : null,
    feed: B.some((b) => b.feed),
  };
}

/** One line: "Heavy · GPU 555/1296 MHz (43 %) busy 98 % · GPU 84 °C CPU 83 °C · GPU 10.4 W · sys 42 W". */
export function thermalLine(b: ThermalBrief | null): string {
  if (!b) return "thermal: no service (bun scripts/thermal.ts install)";
  const p = b.pressure ? `${b.pressure}${b.pressureSource === "os" ? "" : " (pm)"}` : "pressure ?";
  const gpu =
    b.gpuMHz !== null ? `GPU ${b.gpuMHz}/${b.gpuMaxMHz ?? "?"} MHz${b.gpuOfMaxPct !== null ? ` (${b.gpuOfMaxPct} %)` : ""}` : "GPU ?";
  const busy = b.gpuBusyPct !== null ? ` ${b.feed ? "active" : "scaled"} ${b.gpuBusyPct} %` : "";
  const temps = `GPU ${b.gpuTempC ?? "?"} °C CPU ${b.cpuTempC ?? "?"} °C`;
  return `${p} · ${gpu}${busy} · ${temps} · GPU ${b.gpuW ?? "?"} W · sys ${b.sysW ?? "?"} W · state ${b.state ?? "?"}${b.ageS > 15 ? ` · ${b.ageS} s old` : ""}`;
}

/** What makes a GPU measure doubtful now (an elevated pressure, a serious state), or null. A low clock on an idle
 *  GPU is not one: macOS lowers it with the load. */
export function thermalWarning(b: ThermalBrief | null): string | null {
  if (!b) return null;
  const why: string[] = [];
  if (b.pressure && PRESSURES.indexOf(b.pressure) >= 1) why.push(`thermal pressure ${b.pressure}`);
  if (b.state === "serious" || b.state === "critical") why.push(`thermal state ${b.state}`);
  return why.length ? `${why.join(", ")} — figures measured now may be throttled (±40 % seen under Heavy)` : null;
}
