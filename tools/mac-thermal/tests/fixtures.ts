import { readFileSync } from "node:fs";
import { parsePower, parseGpuRegistry } from "../src/legacy.ts";
import { normalizeSnapshot, type LegacySample, type Capabilities } from "../src/runtime.ts";
export const CAP: Capabilities = {
  schemaVersion: "2.0.0", kind: "capabilities", supported: true, platform: "darwin", architecture: "arm64", osVersion: "26.6.2",
  macmonPath: "/opt/homebrew/bin/macmon", macmonVersion: "macmon 0.7.0", notes: [],
  powermetrics: { available: true, authorized: true, samplers: ["thermal", "gpu_power"], flags: [] },
};
export function fixture(time = Date.parse("2026-10-29T22:29:31.000Z")) {
  const raw: LegacySample = {
    startedAt: new Date(time - 2000).toISOString(), timestamp: new Date(time).toISOString(), sampleIntervalMs: 2000,
    sourceTimestamps: {},
    macmon: { temp: { cpu_temp_avg: 87.3, gpu_temp_avg: 87.8 },
      gpu_usage: [1153, 0.89], pcpu_usage: [2216, 0.393], ecpu_usage: [1636, 0.603],
      cpu_power: 6.3, gpu_power: 14.8, ane_power: 0, sys_power: 55.7,
      soc: { chip_name: "Apple M1 Max", mac_model: "MacBookPro18,4", gpu_cores: 24, gpu_freqs: [388, 972, 1296] } },
    summary: null, thermalState: { value: 1, label: "fair" },
    powermetrics: parsePower(readFileSync(`${import.meta.dir}/fixtures/powermetrics-m1-max.txt`, "utf8")),
    gpuRegistry: parseGpuRegistry('"model" = "Apple M1 Max"\n"gpu-core-count" = 24\n"PerformanceStatistics" = {"Device Utilization %"=85,"recoveryCount"=0,"In use system memory"=3000000000,"Alloc system memory"=9000000000}'),
    pmset: "Note: No CPU power status has been recorded\n", assessment: { thermalPressureDetected: true, cpuLimits: [], hardwareThermalThrottling: "unknown", message: "" },
    osPressure: null, errors: {}, warnings: {}, powermetricsEnabled: true,
  };
  return raw;
}
export function sample(time?: number) { return normalizeSnapshot(fixture(time), CAP, "auto"); }
