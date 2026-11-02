import { test, expect } from "bun:test";
import { parsePower, parseGpuRegistry, normalizeMacmon, assess, collect } from "../src/legacy.ts";
import { readFileSync } from "node:fs";

// Representative fixtures, not measurements from this Mac.
const power = `Machine model: MacBookPro18,4
*** Sampled system activity (example) (1000ms elapsed) ***
**** Thermal pressure ****
Current pressure level: Heavy
**** Processor usage ****
CPU Power: 7500 mW
CPU Plimit: 0.00
**** GPU usage ****
GPU Power: 9000 mW
GPU HW active frequency: 972 MHz
`;

test("extracts real powermetrics field spelling and preserves duplicate/contextual fields and raw output", () => {
  const p = parsePower(power);
  expect(p.pressure).toBe("Heavy");
  expect(p.raw).toBe(power);
  expect(p.fields.find(f => f.key === "GPU Power")?.section).toBe("GPU usage");
  expect(p.relevantLines).toContain("CPU Plimit: 0.00");
  expect(parsePower("Current pressure: Nominal").pressure).toBe("Nominal");
});

test("supports installed macmon 0.7 schema, zero measurements and missing sensors", () => {
  const m = normalizeMacmon({ temp: { cpu_temp_avg: 80, gpu_temp_avg: null },
    ecpu_usage: [1509, 0.62], pcpu_usage: [2059, 0.19], gpu_usage: [0, 0], ane_power: 0 });
  expect(m.cpuCelsius).toBe(80);
  expect(m.gpuCelsius).toBeNull();
  expect(m.gpu.frequencyMHz).toBe(0);
  expect(m.watts.ane).toBe(0);
  expect(m.performance.frequencyMHz).toBe(2059);
  expect(m.fans).toBeNull();
});

test("supports newer macmon tiers, fans and nulls", () => {
  const m = normalizeMacmon({ cpu_tiers: [{ label: "P", freq_mhz: 2000, scaled_ratio: 0.5, active_ratio: 0.9 }],
    gpu_freq_mhz: 500, fans: [{ rpm: 2400 }], temp: { cpu_temp_avg: null } });
  expect(m.performance.activeRatio).toBe(0.9);
  expect(m.performance.frequencyMHz).toBe(2000);
  expect(m.cpuCelsius).toBeNull();
  expect(m.fans).toEqual([{ rpm: 2400 }]);
});

test("thermal pressure, missing data and CPU limits never become a fabricated hardware throttle flag", () => {
  expect(assess(0, "Nominal", "").thermalPressureDetected).toBe(false);
  expect(assess(1, "Heavy", "").thermalPressureDetected).toBe(true);
  expect(assess(1, "Heavy", "").hardwareThermalThrottling).toBe("unknown");
  expect(assess(null, null, "").thermalPressureDetected).toBeNull();
  expect(assess(null, "Unknown", "").thermalPressureDetected).toBeNull();
  expect(assess(0, "Nominal", "CPU_Speed_Limit = 80\nCPU_Scheduler_Limit = 100").cpuLimits).toEqual(["Speed=80%"]);
});

test("combines both tools and native state into one snapshot", async () => {
  const s = await collect("macmon", 1000, ["sudo", "powermetrics"], async args => {
    let stdout = "";
    if (args[0] === "macmon") stdout = JSON.stringify({ temp: { cpu_temp_avg: 81, gpu_temp_avg: 79 } });
    if (args[0] === "sudo") stdout = power;
    if (args[0]?.includes("osascript")) stdout = "1\n";
    return { code: 0, stdout, stderr: "" };
  });
  expect(s.errors).toEqual({});
  expect(s.powermetrics?.pressure).toBe("Heavy");
  expect(s.summary?.cpuCelsius).toBe(81);
  expect(s.thermalState.label).toBe("fair");
});

test("preserves other measurements if powermetrics fails", async () => {
  const s = await collect("macmon", 1000, ["sudo", "powermetrics"], async args => {
    if (args[0] === "sudo") return { code: 1, stdout: "", stderr: "sudo: a password is required" };
    const stdout = args[0] === "macmon" ? '{"temp":{"cpu_temp_avg":70}}' : args[0]?.includes("osascript") ? "0" : "";
    return { code: 0, stdout, stderr: "" };
  });
  expect(s.summary?.cpuCelsius).toBe(70);
  expect(s.errors.powermetrics).toContain("password");
  expect(s.powermetrics).toBeNull();
});

test("empty successful powermetrics response is reported as missing, not nominal", async () => {
  const s = await collect("macmon", 1000, ["sudo"], async args => ({ code: 0,
    stdout: args[0] === "macmon" ? "{}" : args[0]?.includes("osascript") ? "0" : "", stderr: "" }));
  expect(s.errors.powermetrics).toContain("absente");
});

test("GPU extraction uses the actual user-supplied privileged capture, with section-specific power", () => {
  const p = parsePower(readFileSync(`${import.meta.dir}/fixtures/powermetrics-m1-max.txt`, "utf8"));
  expect(p.pressure).toBe("Moderate");
  expect(p.gpu.activePercent).toBe(100);
  expect(p.gpu.idlePercent).toBe(0);
  expect(p.gpu.frequencyMHz).toBe(1181);
  expect(p.gpu.powerWatts).toBe(15.608);
  expect(p.gpu.frequencyDistribution.find(f => f.frequencyMHz === 1296)?.percent).toBe(65);
  expect(p.gpu.requestedState).toContain("P6 : 100%");
});

test("registry parser retains all driver counters, zero recoveries, memory and core count", () => {
  const r = parseGpuRegistry(`  "model" = "Apple M1 Max"
    "gpu-core-count" = 24
    "PerformanceStatistics" = {"In use system memory"=2930360320,"Alloc system memory"=9698017280,"Device Utilization %"=67,"recoveryCount"=0,"Renderer Utilization %"=66,"Tiler Utilization %"=67,"New counter"=123}`)!;
  expect(r.cores).toBe(24);
  expect(r.memoryInUseBytes).toBe(2930360320);
  expect(r.memoryAllocatedBytes).toBe(9698017280);
  expect(r.recoveryCount).toBe(0);
  expect(r.statistics["New counter"]).toBe(123);
  expect(r.deviceUtilizationPercent).toBe(67);
  expect(parseGpuRegistry("")).toBeNull();
  expect(parseGpuRegistry('"PerformanceStatistics" = {}')).toBeNull();
});

test("missing optional registry counters leave the primary monitor operational", async () => {
  const s = await collect("macmon", 1000, null, async args => {
    if (args[0]?.includes("ioreg")) return { code: 1, stdout: "", stderr: "Unavailable driver" };
    return { code: 0, stdout: args[0] === "macmon" ? "{}" : args[0]?.includes("osascript") ? "0" : "", stderr: "" };
  });
  expect(s.gpuRegistry).toBeNull();
  expect(s.errors).toEqual({});
  expect(s.warnings.gpuRegistry).toBe("Unavailable driver");
});
