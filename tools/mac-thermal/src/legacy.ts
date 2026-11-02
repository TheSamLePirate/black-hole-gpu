#!/usr/bin/env bun
/** macOS Apple Silicon thermal monitor. No dependencies; Bun >= 1.3. */
import { parseArgs } from "node:util";
import { appendFileSync } from "node:fs";

type Dict = Record<string, any>;
type Result = { code: number; stdout: string; stderr: string };
type Runner = (args: string[], timeout?: number) => Promise<Result>;

export function parsePower(raw: string) {
  const sections: { title: string; lines: string[] }[] = [];
  const fields: { section: string; key: string; value: string }[] = [];
  const relevantLines: string[] = [];
  let section = "General";
  for (const line of raw.split(/\r?\n/)) {
    const title = line.match(/^\*{2,}\s*(.*?)\s*\*{2,}\s*$/);
    if (title) {
      section = title[1]!;
      sections.push({ title: section, lines: [] });
    } else {
      sections.at(-1)?.lines.push(line);
    }
    const kv = line.match(/^\s*([^:]+):\s*(.*?)\s*$/);
    if (kv) fields.push({ section, key: kv[1]!.trim(), value: kv[2]! });
    if (/thermal|pressure|throttl|limit|plimit|forced idle|temperature|fan.*(?:rpm|speed)/i.test(line)
        && line.trim() && !title) relevantLines.push(line.trim());
  }
  const pressure = fields.find(f => /^(?:current |thermal )?pressure(?: level)?$/i.test(f.key))?.value ?? null;
  const gpuFields = fields.filter(f => /^GPU usage$/i.test(f.section));
  const gpuField = (key: string) => gpuFields.find(f => f.key === key)?.value ?? null;
  const numeric = (key: string) => {
    const text = gpuField(key);
    const match = text?.match(/^([\d.]+)\s*(?:MHz|%|mW)/);
    return match ? Number(match[1]) : null;
  };
  const frequencyDistribution = [...(gpuField("GPU HW active residency") ?? "")
    .matchAll(/([\d.]+)\s*MHz:\s*([\d.]+)%/g)]
    .map(m => ({ frequencyMHz: Number(m[1]), percent: Number(m[2]) }));
  const gpu = {
    frequencyMHz: numeric("GPU HW active frequency"),
    activePercent: numeric("GPU HW active residency"),
    idlePercent: numeric("GPU idle residency"),
    powerWatts: numeric("GPU Power") === null ? null : numeric("GPU Power")! / 1000,
    requestedState: gpuField("GPU SW requested state"), frequencyDistribution,
  };
  return { pressure, relevantLines, fields, sections, gpu, raw };
}

/** Driver-provided counters are undocumented: keep their original names and missing values. */
export function parseGpuRegistry(raw: string) {
  const match = raw.match(/"PerformanceStatistics"\s*=\s*\{([^\n}]*)\}/);
  if (!match) return null;
  const statistics: Record<string, number> = {};
  for (const value of match[1]!.matchAll(/"([^"]+)"\s*=\s*(-?\d+(?:\.\d+)?)/g)) {
    const n = Number(value[2]);
    if (Number.isFinite(n)) statistics[value[1]!] = n;
  }
  if (!Object.keys(statistics).length) return null;
  const get = (key: string) => statistics[key] ?? null;
  const count = raw.match(/"gpu-core-count"\s*=\s*(\d+)/);
  return {
    model: raw.match(/"model"\s*=\s*"([^"]+)"/)?.[1] ?? null,
    cores: count ? Number(count[1]) : null,
    deviceUtilizationPercent: get("Device Utilization %"),
    rendererUtilizationPercent: get("Renderer Utilization %"),
    tilerUtilizationPercent: get("Tiler Utilization %"),
    memoryInUseBytes: get("In use system memory"),
    memoryAllocatedBytes: get("Alloc system memory"),
    recoveryCount: get("recoveryCount"), statistics,
  };
}

export function normalizeMacmon(m: Dict) {
  const number = (v: any) => typeof v === "number" && Number.isFinite(v) ? v : null;
  const celsius = (v: any) => (number(v) ?? 0) > 0 ? v as number : null;
  const tier = (label: string, old: string) => {
    const current = m.cpu_tiers?.find((t: Dict) => t.label === label);
    return {
      frequencyMHz: number(current?.freq_mhz ?? m[`${old}_freq_mhz`] ?? m[`${old}_usage`]?.[0]),
      scaledRatio: number(current?.scaled_ratio ?? m[`${old}_scaled_ratio`] ?? m[`${old}_usage`]?.[1]),
      activeRatio: number(current?.active_ratio ?? m[`${old}_active_ratio`]),
    };
  };
  return {
    // (macmon writes 0 where it finds no sensor — the M1's GPU: unavailable, never 0 °C)
    cpuCelsius: celsius(m.temp?.cpu_temp_avg), gpuCelsius: celsius(m.temp?.gpu_temp_avg),
    efficiency: tier("E", "ecpu"), performance: tier("P", "pcpu"),
    gpu: {
      frequencyMHz: number(m.gpu_freq_mhz ?? m.gpu_usage?.[0]),
      scaledRatio: number(m.gpu_scaled_ratio ?? m.gpu_usage?.[1]),
      activeRatio: number(m.gpu_active_ratio),
    },
    watts: Object.fromEntries(["cpu", "gpu", "ane", "ram", "sys", "all"].map(k => [k, number(m[`${k}_power`])])),
    fans: m.fans ?? null,
  };
}

export function assess(state: number | null, pressure: string | null, pmset: string) {
  // pmset percentages express CPU limits; they do not identify the cause.
  const limits = [...pmset.matchAll(/CPU_(Speed|Scheduler)_Limit\s*=\s*(\d+)/g)]
    .filter(m => Number(m[2]) < 100).map(m => `${m[1]}=${m[2]}%`);
  const pressureIndex = pressure === null ? -1 : ["nominal", "moderate", "heavy", "trapping", "sleeping"].indexOf(pressure.trim().toLowerCase());
  const known = state !== null || pressureIndex >= 0;
  const elevated = (state !== null && state > 0) || pressureIndex > 0;
  const severe = state !== null && state >= 2;
  let message = "Aucune pression thermique signalée par les sources disponibles.";
  if (!known) message = "État thermique indisponible.";
  if (elevated) message = "Pression thermique présente ; bridage matériel non confirmé.";
  if (severe) message = "État thermique sérieux/critique : risque de réduction des performances.";
  if (limits.length) message += ` Limitation CPU signalée (${limits.join(", ")}), cause non déterminée.`;
  return { thermalPressureDetected: known ? elevated : null,
    cpuLimits: limits, hardwareThermalThrottling: "unknown", message };
}

const children = new Set<any>();
let interrupted = false;
const run: Runner = async (args, timeout = 15_000) => {
  const child = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, LC_ALL: "C", LANG: "C" } });
  children.add(child);
  let expired = false;
  const timer = setTimeout(() => { expired = true; child.kill("SIGTERM"); }, timeout);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    return { code: expired ? 124 : code, stdout,
      stderr: expired ? `Délai dépassé (${timeout} ms). ${stderr}` : stderr };
  } finally { clearTimeout(timer); children.delete(child); }
};
const checked = async (args: string[], timeout?: number) => {
  const r = await run(args, timeout);
  if (r.code !== 0) throw new Error(`${args[0]} : ${r.stderr.trim() || r.stdout.trim() || `code ${r.code}`}`);
  return r.stdout;
};

const stateScript = 'ObjC.import("Foundation"); Number($.NSProcessInfo.processInfo.thermalState);';

export async function collect(macmon: string, interval: number, powerArgs: string[] | null, runner: Runner = run) {
  const start = new Date().toISOString();
  const calls: [string, string[]][] = [
    ["macmon", [macmon, "pipe", "-s", "1", "-i", String(interval), "--soc-info"]],
    ["thermalState", ["/usr/bin/osascript", "-l", "JavaScript", "-e", stateScript]],
    ["pmset", ["/usr/bin/pmset", "-g", "therm"]],
    ["gpuRegistry", ["/usr/sbin/ioreg", "-r", "-d", "1", "-l", "-c", "AGXAccelerator"]],
  ];
  if (powerArgs) calls.push(["powermetrics", powerArgs]);
  // (the OS's thermal pressure level, the one powermetrics prints, published by notifyd to every user: no root)
  calls.push(["osPressure", ["/usr/bin/notifyutil", "-g", PRESSURE_KEY]]);
  const results = await Promise.allSettled(calls.map(async ([name, args]) => {
    const r = await runner(args, Math.max(15_000, interval + 10_000));
    if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || `code ${r.code}`);
    return { name, raw: r.stdout, collectedAt: new Date().toISOString() };
  }));
  const data: Record<string, string> = {};
  const errors: Record<string, string> = {};
  const sourceTimestamps: Record<string, string> = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      data[r.value.name] = r.value.raw;
      sourceTimestamps[r.value.name] = r.value.collectedAt;
    }
    else errors[calls[i]![0]] = String(r.reason?.message ?? r.reason);
  });
  return assemble(start, interval, data, errors, sourceTimestamps, powerArgs !== null);
}

export const PRESSURE_KEY = "com.apple.system.thermalpressurelevel";
/** OSThermalPressureLevel (<libkern/OSThermalNotification.h>), spelled as powermetrics prints it */
export const PRESSURE_LABELS = ["Nominal", "Moderate", "Heavy", "Trapping", "Sleeping"];
export function parseOsPressure(raw: string | undefined) {
  const m = raw?.match(/(-?\d+)\s*$/);
  const value = m ? Number(m[1]) : null;
  return value !== null && value >= 0 && value < PRESSURE_LABELS.length ? { value, label: PRESSURE_LABELS[value]! } : null;
}

/** One sample from the sources' raw outputs — collect()'s one-shot reads, or the service's stream (service.ts). */
export function assemble(start: string, interval: number, data: Record<string, string>, errors: Record<string, string>,
  sourceTimestamps: Record<string, string>, powermetricsEnabled: boolean) {
  let mac: Dict | null = null;
  if (data.macmon) {
    try { mac = JSON.parse(data.macmon.trim().split(/\r?\n/).at(-1)!); }
    catch { errors.macmon = "Sortie JSON macmon invalide."; }
  }
  const value = data.thermalState?.trim();
  const state = value && /^[0-3]$/.test(value) ? Number(value) : null;
  if (state === null && !errors.thermalState) errors.thermalState = "Valeur thermalState inconnue.";
  const power = data.powermetrics ? parsePower(data.powermetrics) : null;
  if (powermetricsEnabled && !errors.powermetrics && power?.pressure == null)
    errors.powermetrics = "Pression thermique absente ou format non reconnu ; consulter la sortie brute.";
  const gpuRegistry = data.gpuRegistry ? parseGpuRegistry(data.gpuRegistry) : null;
  const warnings: Record<string, string> = {};
  if (!gpuRegistry) warnings.gpuRegistry = errors.gpuRegistry ?? "Compteurs GPU du pilote indisponibles.";
  delete errors.gpuRegistry; // Optional driver counters must not stop the thermal monitor.
  const osPressure = parseOsPressure(data.osPressure);
  if (!osPressure) warnings.osPressure = errors.osPressure ?? "Niveau de pression de l'OS illisible.";
  delete errors.osPressure;
  return {
    startedAt: start, timestamp: new Date().toISOString(), sampleIntervalMs: interval, sourceTimestamps,
    macmon: mac, summary: mac ? normalizeMacmon(mac) : null,
    thermalState: { value: state, label: state === null ? null : ["nominal", "fair", "serious", "critical"][state] },
    powermetrics: power, pmset: data.pmset ?? null,
    gpuRegistry, osPressure,
    assessment: assess(state, power?.pressure ?? osPressure?.label ?? null, data.pmset ?? ""),
    errors, warnings, powermetricsEnabled,
  };
}

type Sample = Awaited<ReturnType<typeof collect>>;
const fmt = (v: any, unit: string, digits = 1) => typeof v === "number" ? `${v.toFixed(digits)} ${unit}` : "N/D";
function render(s: Sample, details: boolean, peaks: { cpu: number | null; gpu: number | null }) {
  const m = s.summary;
  const g = s.powermetrics?.gpu;
  const registry = s.gpuRegistry;
  const reportedFrequencies = s.macmon?.soc?.gpu_freqs;
  const maxMHz = Array.isArray(reportedFrequencies)
    ? Math.max(0, ...reportedFrequencies.filter((v: any) => typeof v === "number" && Number.isFinite(v))) || null : null;
  const freq = (v: any) => `${fmt(v?.frequencyMHz, "MHz", 0)} · capacité utilisée ${fmt(v?.scaledRatio == null ? null : v.scaledRatio * 100, "%")}`;
  const out = [
    `THERMIQUE MAC — ${s.macmon?.soc?.chip_name ?? "Apple Silicon"} — ${new Date(s.timestamp).toLocaleString("fr-FR")}`,
    `CPU ${fmt(m?.cpuCelsius, "°C")} (pic ${fmt(peaks.cpu, "°C")})  |  GPU ${fmt(m?.gpuCelsius, "°C")} (pic ${fmt(peaks.gpu, "°C")})`,
    `État macOS : ${s.thermalState.label ?? "N/D"}  |  Pression powermetrics : ${s.powermetrics?.pressure ?? "N/D"}`,
    `Diagnostic : ${s.assessment.message}`,
    `CPU E : ${freq(m?.efficiency)}`,
    `CPU P : ${freq(m?.performance)}`,
    `GPU   : ${freq(m?.gpu)}`,
    `Puissance macmon : CPU ${fmt(m?.watts.cpu, "W")} | GPU ${fmt(m?.watts.gpu, "W")} | ANE ${fmt(m?.watts.ane, "W")} | RAM ${fmt(m?.watts.ram, "W")} | Système ${fmt(m?.watts.sys, "W")}`,
    `Ventilateurs macmon : ${m?.fans == null ? "N/D (non exposés par cette version)" : JSON.stringify(m.fans)}`,
    "", `GPU DÉTAILLÉ — ${registry?.cores ?? "N/D"} cœurs`,
    `Temps GPU actif : ${fmt(g?.activePercent, "%")} | Inactif : ${fmt(g?.idlePercent, "%")} (powermetrics)`,
    `Fréquence GPU active : ${fmt(g?.frequencyMHz, "MHz", 0)} | Maximum déclaré : ${fmt(maxMHz, "MHz", 0)} | Puissance : ${fmt(g?.powerWatts, "W")}`,
    `Pilote : Device ${fmt(registry?.deviceUtilizationPercent, "%")} | Renderer ${fmt(registry?.rendererUtilizationPercent, "%")} | Tiler ${fmt(registry?.tilerUtilizationPercent, "%")}`,
    `Mémoire unifiée GPU selon pilote : utilisée ${fmt(registry?.memoryInUseBytes == null ? null : registry.memoryInUseBytes / 2 ** 30, "GiB", 2)} | allouée ${fmt(registry?.memoryAllocatedBytes == null ? null : registry.memoryAllocatedBytes / 2 ** 30, "GiB", 2)}`,
    `Compteur pilote recoveryCount : ${fmt(registry?.recoveryCount, "", 0).trim()}`,
  ];
  if (g?.frequencyDistribution.length) out.push("Répartition des fréquences GPU (powermetrics) : " +
    g.frequencyDistribution.map(f => `${f.frequencyMHz} MHz : ${f.percent}%`).join(" | "));
  if (g?.requestedState) out.push(`États GPU demandés : ${g.requestedState}`);
  out.push("Capacité macmon, temps actif et compteurs pilote : métriques et fenêtres distinctes ; ne pas les additionner.");
  if (!s.powermetricsEnabled) out.push("Mode sans sudo : powermetrics désactivé, diagnostic incomplet.");
  if (s.powermetrics) {
    out.push("", "Informations thermiques / limitations rapportées par powermetrics :",
      ...(s.powermetrics.relevantLines.length ? s.powermetrics.relevantLines : ["Aucun champ reconnu ; consulter --details ou --json."]));
  }
  if (s.pmset) out.push("", "pmset (certaines informations sont historiques) :", s.pmset.trim());
  for (const [source, error] of Object.entries(s.errors)) out.push(`ERREUR ${source} : ${error}`);
  for (const [source, warning] of Object.entries(s.warnings)) out.push(`INFO ${source} : ${warning}`);
  if (details) out.push("", "—— macmon JSON complet ——", JSON.stringify(s.macmon, null, 2),
    "—— Compteurs GPU du pilote ——", JSON.stringify(s.gpuRegistry, null, 2),
    "—— powermetrics complet ——", s.powermetrics?.raw ?? "Indisponible");
  out.push("", "N/D = indisponible. Une baisse de fréquence seule ne prouve pas un bridage thermique.", "Ctrl+C pour arrêter.");
  return out.join("\n");
}

const help = `Usage : bun mac-thermal.ts [options]

  --once              Une mesure puis arrêt
  --interval <ms>     Fenêtre de mesure et période minimale (défaut : 2000 ; minimum : 1000)
  --json              Un objet JSON par mesure (JSONL), sorties brutes incluses
  --log <fichier>     Ajouter les mesures JSONL dans ce fichier
  --details           Afficher aussi toutes les sorties brutes
  --no-sudo           Mode partiel sans powermetrics, pour diagnostic sans droits root
  --help              Afficher cette aide

Par défaut, sudo demande le mot de passe de ton compte administrateur dans le terminal.
Le script ne lit et ne stocke aucun mot de passe. Seul powermetrics est exécuté en root.
Les températures, capteurs et indicateurs accessibles dépendent de macOS et de macmon.
`;

export async function main() {
  const { values } = parseArgs({ args: Bun.argv.slice(2), strict: true, options: {
    once: { type: "boolean" }, interval: { type: "string", default: "2000" },
    json: { type: "boolean" }, log: { type: "string" }, details: { type: "boolean" },
    "no-sudo": { type: "boolean" }, help: { type: "boolean" },
  } });
  if (values.help) { console.log(help); return; }
  const interval = Number(values.interval);
  if (!Number.isSafeInteger(interval) || interval < 1000 || interval > 60_000)
    throw new Error("--interval doit être un entier entre 1000 et 60000 ms.");
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Ce script requiert macOS sur Apple Silicon.");
  if (process.getuid?.() === 0) throw new Error("Lance Bun avec ton compte habituel, sans sudo : le script élève uniquement powermetrics.");
  const macmon = Bun.which("macmon");
  if (!macmon) throw new Error("macmon introuvable. Installation : brew install macmon");
  // Validate the log destination before requesting administrator authentication.
  if (values.log) appendFileSync(values.log, "", { mode: 0o600 });
  let powerArgs: string[] | null = null;
  if (!values["no-sudo"]) {
    const powerHelp = await checked(["/usr/bin/powermetrics", "--help"]);
    const samplers = ["thermal", "cpu_power", "gpu_power", "ane_power", "sfi", "battery", "smc"]
      .filter(name => new RegExp(`^\\s+${name}\\s+`, "m").test(powerHelp));
    if (!samplers.includes("thermal")) throw new Error("Le sampler thermal n'est pas disponible sur ce macOS.");
    const cached = await run(["/usr/bin/sudo", "-n", "-v"]);
    if (cached.code !== 0) {
      if (!process.stdin.isTTY) throw new Error("Authentification sudo requise. Lance le script dans un terminal interactif, ou utilise --no-sudo pour une mesure partielle.");
      console.error("Authentification administrateur pour powermetrics (saisie gérée par sudo).");
      const auth = Bun.spawn(["/usr/bin/sudo", "-v"], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      children.add(auth);
      const code = await auth.exited;
      children.delete(auth);
      if (code !== 0) throw new Error("Authentification sudo annulée ou refusée.");
    }
    powerArgs = ["/usr/bin/sudo", "-n", "/usr/bin/powermetrics", "--samplers", samplers.join(","),
      "-i", String(interval), "-n", "1"];
    for (const flag of ["--show-plimits", "--show-extra-power-info"]) {
      if (powerHelp.includes(flag)) powerArgs.push(flag);
    }
  }
  const peaks: { cpu: number | null; gpu: number | null } = { cpu: null, gpu: null };
  const interactive = process.stdout.isTTY && !values.json && !values.once;
  if (interactive) process.stdout.write("\x1b[?25l");
  let delay: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  const stop = () => {
    interrupted = true;
    for (const child of children) { try { child.kill("SIGTERM"); } catch {} }
    if (delay) clearTimeout(delay);
    wake?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    do {
      const tick = Date.now();
      // Keep sudo's credential timestamp valid during an explicitly running monitor.
      if (powerArgs) {
        const refresh = await run(["/usr/bin/sudo", "-n", "-v"]);
        if (interrupted) break;
        if (refresh.code !== 0) throw new Error("Session sudo expirée. Relance le script pour t'authentifier.");
      }
      const sample = await collect(macmon, interval, powerArgs);
      if (interrupted) break;
      for (const [key, value] of [["cpu", sample.summary?.cpuCelsius], ["gpu", sample.summary?.gpuCelsius]] as const) {
        if (typeof value === "number") peaks[key] = Math.max(peaks[key] ?? value, value);
      }
      const json = JSON.stringify(sample);
      if (values.log) appendFileSync(values.log, json + "\n");
      if (interactive) process.stdout.write("\x1b[H\x1b[2J");
      console.log(values.json ? json : render(sample, Boolean(values.details), peaks));
      if (Object.keys(sample.errors).length) { process.exitCode = 1; break; }
      if (values.once) break;
      const remaining = Math.max(0, interval - (Date.now() - tick));
      if (remaining) await new Promise<void>(resolve => { wake = resolve; delay = setTimeout(resolve, remaining); });
      wake = undefined;
    } while (!interrupted);
  } finally {
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    if (interactive) process.stdout.write("\x1b[?25h\n");
  }
}

