// What this repository added to the toolkit: notifyd's pressure level, the root daemon's powermetrics feed, the service.
import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync, chmodSync, utimesSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fixture, CAP } from "./fixtures.ts";
import { parseOsPressure } from "../src/legacy.ts";
import { normalizeSnapshot, powerFeed, powerArguments } from "../src/runtime.ts";
import { thermalStateNative } from "../src/service.ts";
import { latest } from "../src/files.ts";
const directory = mkdtempSync(join(tmpdir(), "mac-thermal-service-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const darwin = process.platform === "darwin" && process.arch === "arm64";

test("notifyd's pressure level parses to powermetrics' spelling; garbage stays null", () => {
  expect(parseOsPressure("com.apple.system.thermalpressurelevel 2\n")).toEqual({ value: 2, label: "Heavy" });
  expect(parseOsPressure("com.apple.system.thermalpressurelevel 0")?.label).toBe("Nominal");
  expect(parseOsPressure("com.apple.system.thermalpressurelevel 9")).toBeNull();
  expect(parseOsPressure(undefined)).toBeNull();
});

test("pressure comes from powermetrics when it ran, else from the OS, and says which", () => {
  const withPower = normalizeSnapshot({ ...fixture(), osPressure: { value: 0, label: "Nominal" } }, CAP, "auto");
  expect(withPower.thermal.pressureSource).toBe("powermetrics");
  const raw = { ...fixture(), powermetrics: null, powermetricsEnabled: false, osPressure: { value: 2, label: "Heavy" } };
  const s = normalizeSnapshot(raw, { ...CAP, powermetrics: { ...CAP.powermetrics, authorized: false } }, "auto");
  expect(s.thermal).toMatchObject({ pressure: "Heavy", pressureSource: "os" });
  expect(s.sources.powermetrics.status).toBe("authorization_required");
  expect(s.findings.some(f => f.code === "thermal_pressure_elevated")).toBe(true);
});

test("the root feed: fresh within its age, stale after, absent or 'none' → null; fresh → read with cat, no sudo", () => {
  const feed = join(directory, "feed.txt");
  expect(powerFeed(feed)).toBeNull();
  expect(powerFeed("none")).toBeNull();
  writeFileSync(feed, "x");
  expect(powerFeed(feed)?.fresh).toBe(true);
  const old = (Date.now() - 60_000) / 1000;
  utimesSync(feed, old, old);
  expect(powerFeed(feed)).toMatchObject({ fresh: false });
  const cap = { ...CAP, powermetrics: { ...CAP.powermetrics, feed: { path: feed, ageMs: 100, fresh: true } } };
  expect(powerArguments(cap, 2000)).toEqual(["/bin/cat", feed]);
  expect(powerArguments(CAP, 2000)[0]).toBe("/usr/bin/sudo");
});

test.skipIf(!darwin)("NSProcessInfo.thermalState is read in-process", () => {
  expect([0, 1, 2, 3]).toContain(thermalStateNative()!);
});

test.skipIf(!darwin)("the service streams one macmon, writes latest/log snapshots, takes powermetrics from the feed", async () => {
  // (a macmon of our own: a line a second, as `macmon pipe` writes them)
  const bin = join(directory, "bin");
  rmSync(bin, { recursive: true, force: true });
  mkdirSync(bin);
  const line = JSON.stringify(fixture().macmon);
  writeFileSync(join(bin, "macmon"), `#!/bin/sh\n[ "$1" = "--version" ] && { echo "macmon 0.7.0"; exit 0; }\nwhile :; do echo '${line}'; sleep 1; done\n`);
  chmodSync(join(bin, "macmon"), 0o755);
  const feed = join(directory, "service-feed.txt");
  copyFileSync(`${import.meta.dir}/fixtures/powermetrics-m1-max.txt`, feed);
  const latestPath = join(directory, "service-latest.json");
  const logPath = join(directory, "service-history.jsonl");
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../mac-thermal.ts"), "service", "--interval", "1000", "--duration", "4",
    "--latest", latestPath, "--log", logPath, "--quiet"], {
    cwd: directory, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MAC_THERMAL_POWER_FEED: feed },
  });
  const [, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code).toBe(0);
  expect(err).toContain("service_stopped");
  const snap = latest(latestPath, 15);
  expect(snap.sources.macmon.status).toBe("available");
  expect(snap.sources.powermetrics.status).toBe("available");
  expect(snap.thermal.pressureSource).toBe("powermetrics");
  expect(snap.metrics["gpu.frequency_mhz"]!.value).not.toBeNull();
  expect(snap.thermal.state).not.toBeNull();
  expect(readFileSync(logPath, "utf8").trim().split("\n").length).toBeGreaterThanOrEqual(2);
}, 20_000);
