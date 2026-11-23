import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readCrewCmd } from "../src/net/crewcmd";
import { readInstruments } from "../src/net/instruments";
import { OBC_PALETTES } from "../src/obc/fb-renderer";
import { emptyTelemetry, formatTauText, normalizeWispUrl, parseObcCommand } from "../src/obc/protocol";
import { distroLabel, normalizeDistro, normalizeMemoryMiB } from "../src/obc/runtime";
import { findObcScript, OBC_PILOT_KIT_FILES, OBC_SCRIPTS } from "../src/obc/scripts-catalog";
import { radAttitudeToDeg } from "../src/obc/sim-adapter";
import { DEFAULT_OBC_CONFIG, OBC_MEMORY_OPTIONS } from "../src/obc/types";
import { keyEventToAnsi } from "../src/ui/obc-console";

test("parseObcCommand: validates and clamps throttle, stick, flaps, autopilot, hold, sas, gear, say, ping", () => {
  expect(parseObcCommand({ kind: "throttle", value: 1.5 })).toEqual({ kind: "throttle", value: 1 });
  expect(parseObcCommand({ kind: "throttle", value: -0.2 })).toEqual({ kind: "throttle", value: 0 });
  expect(parseObcCommand('{"throttle":0.65}')).toEqual({ kind: "throttle", value: 0.65 });
  expect(parseObcCommand({ kind: "stick", pitch: 2, roll: -3, yaw: 0.4, duration_ms: 99999 })).toEqual({
    kind: "stick",
    pitch: 1,
    roll: -1,
    yaw: 0.4,
    duration_ms: 5000,
  });
  expect(parseObcCommand({ pitch: 0.25 })).toEqual({ kind: "stick", pitch: 0.25 });
  expect(parseObcCommand({ kind: "autopilot", mode: "circularize" })).toEqual({ kind: "autopilot", mode: "circularize" });
  expect(parseObcCommand({ autopilot: "ils" })).toEqual({ kind: "autopilot", mode: "ils" });
  expect(parseObcCommand({ kind: "hold", mode: "prograde" })).toEqual({ kind: "hold", mode: "prograde" });
  expect(parseObcCommand({ sas: true })).toEqual({ kind: "sas", on: true });
  expect(parseObcCommand({ gear: false })).toEqual({ kind: "gear", down: false });
  expect(parseObcCommand({ kind: "flaps", value: 0.5 })).toEqual({ kind: "flaps", value: 0.5 });
  expect(parseObcCommand({ say: "  Orbit achieved  " })).toEqual({ kind: "say", text: "Orbit achieved" });
  expect(parseObcCommand({ kind: "ping", id: 42 })).toEqual({ kind: "ping", id: 42 });
});

test("parseObcCommand: rejects malformed, unknown, non-finite, or oversized commands", () => {
  expect(parseObcCommand("")).toBeNull();
  expect(parseObcCommand("not json")).toBeNull();
  expect(parseObcCommand([])).toBeNull();
  expect(parseObcCommand(null)).toBeNull();
  expect(parseObcCommand({ kind: "throttle", value: Number.NaN })).toBeNull();
  expect(parseObcCommand({ kind: "throttle", value: Number.POSITIVE_INFINITY })).toBeNull();
  expect(parseObcCommand({ kind: "autopilot", mode: "rm -rf /" })).toBeNull();
  expect(parseObcCommand({ kind: "hold", mode: "invalid" })).toBeNull();
  expect(parseObcCommand({ kind: "stick" })).toBeNull();
  expect(parseObcCommand({ kind: "say", text: "   " })).toBeNull();
  expect(parseObcCommand({ kind: "unknown" })).toBeNull();
  expect(parseObcCommand("x".repeat(5000))).toBeNull();
});

test("formatTauText produces parseable key=value lines", () => {
  const txt = formatTauText({
    dtau_dt: 0.000016123,
    proper_time_s: 1234.567,
    sim_time_s: 98765.432,
    warp: 10,
    frozen: false,
    body: "miller",
  });
  expect(txt).toContain("dtau_dt=0.000016123");
  expect(txt).toContain("proper_time_s=1234.567");
  expect(txt).toContain("warp=10");
  expect(txt).toContain("frozen=0");
  expect(txt).toContain("body=miller");
});

test("normalizeWispUrl accepts ws/wss URLs and rejects http/javascript/invalid", () => {
  expect(normalizeWispUrl("wss://wisp.domaine.fr/")).toBe("wss://wisp.domaine.fr/");
  expect(normalizeWispUrl("  ws://localhost:8080/wisp  ")).toBe("ws://localhost:8080/wisp");
  expect(normalizeWispUrl("https://example.com")).toBe("");
  expect(normalizeWispUrl("javascript:alert(1)")).toBe("");
  expect(normalizeWispUrl("")).toBe("");
});

test("OBC_SCRIPTS catalog & emptyTelemetry contract", () => {
  expect(OBC_SCRIPTS.length).toBeGreaterThanOrEqual(27);
  expect(findObcScript("diag")?.name).toBe("obc-diag");
  expect(findObcScript("obc-orbit")?.id).toBe("orbit");
  expect(findObcScript("bh")?.name).toBe("bh");
  expect(findObcScript("bh-tui")?.category).toBe("tui");
  expect(findObcScript("airports")?.name).toBe("obc-airports");
  expect(findObcScript("f35")?.name).toBe("obc-f35");
  expect(findObcScript("a320")?.name).toBe("obc-a320");
  expect(findObcScript("f35-tui")?.category).toBe("tui");
  expect(findObcScript("a320-tui")?.category).toBe("tui");
  expect(findObcScript("f35-fb")?.graphical).toBe(true);
  expect(findObcScript("a320-fb")?.graphical).toBe(true);
  expect(findObcScript("ils-fb")?.graphical).toBe(true);
  expect(findObcScript("fuel")?.lang).toBe("python");
  expect(findObcScript("nav")?.lang).toBe("node");
  expect(findObcScript("top")?.category).toBe("tui");
  expect(findObcScript("mission-tui")?.category).toBe("tui");
  expect(findObcScript("fmc-tui")?.category).toBe("tui");
  expect(findObcScript("pfd-fb")?.graphical).toBe(true);
  expect(findObcScript("radar-fb")?.graphical).toBe(true);
  expect(findObcScript("kerr-fb")?.graphical).toBe(true);
  expect(findObcScript("fb-demo")?.graphical).toBe(true);
  const tel = emptyTelemetry();
  expect(tel.v).toBe(1);
  expect(tel.dtau_dt).toBe(1);
  expect(tel.position.height_ellipsoid_m).toBe(0);
});

test("DEFAULT_OBC_CONFIG, RAM/distro normalizers & OBC_PALETTES include all 4 avionics themes", () => {
  expect(DEFAULT_OBC_CONFIG.distro).toBe("alpine");
  expect(DEFAULT_OBC_CONFIG.memoryMiB).toBe(2048);
  expect(OBC_MEMORY_OPTIONS).toEqual([512, 1024, 2048, 4096]);
  expect(normalizeMemoryMiB(512)).toBe(512);
  expect(normalizeMemoryMiB(1024)).toBe(1024);
  expect(normalizeMemoryMiB(2048)).toBe(2048);
  expect(normalizeMemoryMiB(4096)).toBe(4096);
  expect(normalizeMemoryMiB(256)).toBe(2048);
  expect(normalizeMemoryMiB("invalid")).toBe(2048);
  expect(normalizeDistro("debian")).toBe("debian");
  expect(normalizeDistro("alpine")).toBe("alpine");
  expect(normalizeDistro("other")).toBe("alpine");
  expect(distroLabel("alpine")).toBe("alpine-3.24");
  expect(distroLabel("debian")).toBe("debian-13");
  expect(DEFAULT_OBC_CONFIG.fbWidth).toBe(512);
  expect(DEFAULT_OBC_CONFIG.crtFx).toBe(true);
  expect(OBC_PALETTES.interstellar.accent).toBe("#62e6ff");
  expect(OBC_PALETTES.f35.accent).toBe("#4be38a");
  expect(OBC_PALETTES.a320.accent).toBe("#3ec8ff");
  expect(OBC_PALETTES.amber.accent).toBe("#ffb347");
});

test("Crew remote relay validates cfg.obc orders and bounds obc snapshot block", () => {
  const ok = readCrewCmd({ v: 1, id: "obc-1", to: 0, act: "cfg.obc", args: { action: "script", script: "orbit" } });
  expect(ok.ok).toBe(true);
  const bad = readCrewCmd({ v: 1, id: "obc-2", to: 0, act: "cfg.obc", args: { action: "rm" } });
  expect(bad.ok).toBe(false);

  const snap = readInstruments({
    v: 1,
    t: 100,
    body: "earth",
    metrics: {},
    geo: null,
    radar: null,
    route: [],
    ahead: [],
    obc: {
      phase: "ready",
      distro: "alpine-3.24",
      fbActive: true,
      dtauDt: 0.9999,
      activeScript: "obc-fb-demo",
      lines: ["LINE 1", "x".repeat(200)],
      cursorRow: 99,
      cursorCol: -5,
      seq: 7,
    },
  });
  expect(snap?.obc?.phase).toBe("ready");
  expect(snap?.obc?.fbActive).toBe(true);
  expect(snap?.obc?.lines[1]?.length).toBe(96);
  expect(snap?.obc?.cursorRow).toBe(23);
  expect(snap?.obc?.cursorCol).toBe(0);
});

test("radAttitudeToDeg converts camera.attitudeNow() radians accurately to aviation degrees", () => {
  const a1 = radAttitudeToDeg({ heading: Math.PI / 2, pitch: Math.PI / 6, bank: -Math.PI / 4 });
  expect(a1.heading_deg).toBeCloseTo(90, 4);
  expect(a1.pitch_deg).toBeCloseTo(30, 4);
  expect(a1.roll_deg).toBeCloseTo(-45, 4);

  // Negative heading wraps cleanly into [0, 360)
  const a2 = radAttitudeToDeg({ heading: -Math.PI / 2, pitch: 0, bank: Math.PI / 3 });
  expect(a2.heading_deg).toBeCloseTo(270, 4);
  expect(a2.roll_deg).toBeCloseTo(60, 4);

  expect(radAttitudeToDeg(null)).toEqual({ heading_deg: 0, pitch_deg: 0, roll_deg: 0 });
});

test("keyEventToAnsi translates navigation, TUI, and control keys cleanly for PTY & /dev/fb0 apps", () => {
  const mk = (key: string, extra: Partial<KeyboardEvent> = {}) =>
    keyEventToAnsi({ key, code: "", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...extra });
  expect(mk("ArrowUp")).toBe("\x1b[A");
  expect(mk("ArrowDown")).toBe("\x1b[B");
  expect(mk("ArrowRight")).toBe("\x1b[C");
  expect(mk("ArrowLeft")).toBe("\x1b[D");
  expect(mk("Tab")).toBe("\t");
  expect(mk("Tab", { shiftKey: true })).toBe("\x1b[Z");
  expect(mk("Enter")).toBe("\r");
  expect(mk("Backspace")).toBe("\x7f");
  expect(mk("Escape")).toBe("\x1b");
  expect(mk("q")).toBe("q");
  expect(mk("+")).toBe("+");
  expect(mk("c", { ctrlKey: true })).toBe("\x03");
  expect(mk("k", { metaKey: true })).toBeNull();
});

test("OBC_PILOT_KIT_FILES: every /home/pilot doc and Claude/Pi SKILL.md exists with valid frontmatter", () => {
  const root = join(import.meta.dir, "..", "scripts", "obc", "pilot-kit");
  expect(OBC_PILOT_KIT_FILES.length).toBeGreaterThanOrEqual(12);
  let skillCount = 0;
  for (const rel of OBC_PILOT_KIT_FILES) {
    const abs = join(root, rel);
    expect(existsSync(abs)).toBe(true);
    const body = readFileSync(abs, "utf8");
    expect(body.length).toBeGreaterThan(200);
    if (rel.endsWith("SKILL.md")) {
      skillCount++;
      expect(body).toMatch(/^---\nname: [a-z0-9-]+\ndescription: .+\n---/m);
    }
  }
  expect(skillCount).toBe(5);
});
