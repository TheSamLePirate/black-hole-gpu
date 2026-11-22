import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// AAA Embedded Linux On-Board Computer (OBC) via Unkernel aarch64 Web Worker (docs/PLAN-LINUX-OBC.md):
// lazy boot (0 ms startup impact), real Linux kernel boot via F11 HUD console, live 9p /obc/telemetry.json
// & /dev/tau reads, real bidirectional /obc/cmd -> __bh throttle control, live Wisp v1 handshake test,
// built-in /home/pilot script editor, live VM snapshot suspend/resume, /dev/fb0 XRGB8888 rendering + PNG export,
// 3D cockpit displays (Ranger OBC + touch keys, F-35 PCD wide OBC portal, A320 MCDU OBC LINK + Lower ECAM), and FPS check.
// Duration: ~60 s on this Mac.
// Done when: all OBC subsystems pass end-to-end and PNG captures + metrics.json are written under remote-results/obc/ with zero console or WebGPU errors.

const OUT = "remote-results/obc";

interface ObcMetrics {
  baselineFps: number;
  baselineFrameMs: number;
  bootMs: number;
  wispOk: boolean;
  wispLatencyMs: number;
  toolchainInstallMs: number;
  pythonVersion: string;
  nodeVersion: string;
  suspendResumeMs: number;
  obcActiveFps: number;
  obcActiveFrameMs: number;
  uname: string;
  fbWidth: number;
  fbHeight: number;
  fbPngBytes: number;
  throttleBefore: number;
  throttleAfterCmd: number;
  dtauDt: number;
  tarsToolCount: number;
  ksfoApproaches: number;
  lfpbApproaches: number;
}

describe.skipIf(!E2E)("Linux OBC AAA (Unkernel aarch64, Wisp, Snapshot, Editor, /dev/fb0 & 3 Cockpits)", () => {
  let app: App;
  const metrics: Partial<ObcMetrics> = {};

  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    process.env.KERR_WISP_RELAY = "1";
    app = await App.boot({ hash: "scene=game:artemis", width: 1440, height: 900 });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.settled();
    app.steps([
      "Baseline FPS (OBC éteint)",
      "Boot Linux aarch64, Pont __bh, Wisp & Éditeur",
      "Installation Python 3 + Node.js & CLI __bh / Airports",
      "TUIs Temps Réel & Graphiques /dev/fb0 (PFD, Radar, Kerr)",
      "Snapshot Suspend/Resume & Cockpit 3D Ranger",
      "F-35 100% piloté depuis Linux (CLI, TUI, ILS/TSD FB0 & PCD 3D)",
      "A320 100% piloté depuis Linux (CLI, MCDU, TUI, ND FB0 & LECAM 3D) + FPS",
    ]);
    app.estimate(220);
  }, 180_000);

  afterAll(() => {
    if (Object.keys(metrics).length > 0) {
      writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 2));
    }
    app?.close();
    stopServer();
  });

  test("stays completely off at simulator startup with zero boot overhead", async () => {
    await app.step("Baseline FPS (OBC éteint)");
    const st = await app.js<{ phase: string; consoleOpen: boolean }>("__bh.obc.status()");
    expect(st.phase).toBe("off");
    expect(st.consoleOpen).toBe(false);

    const base = await app.js<{ fps: number; ms: number }>(`(async () => {
      const times = [];
      let prev = performance.now();
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        times.push(now - prev);
        prev = now;
      }
      times.sort((a, b) => a - b);
      const med = times[Math.floor(times.length / 2)] || 16.7;
      return { ms: +med.toFixed(2), fps: +(1000 / med).toFixed(1) };
    })()`);
    metrics.baselineFps = base.fps;
    metrics.baselineFrameMs = base.ms;
    await app.stepDone(`OBC off · baseline ${base.fps} fps (${base.ms} ms)`);
    expect(app.cdp.errors).toEqual([]);
  });

  test("boots Linux aarch64 via F11, bridges __bh, verifies Wisp v1 relay & built-in script editor", async () => {
    await app.step("Boot Linux aarch64, Pont __bh, Wisp & Éditeur");
    await app.press("F11");
    await app.waitFor(`__bh.obc.status().consoleOpen === true`, 10_000);
    await app.waitFor(`__bh.obc.status().phase === "ready"`, 60_000);

    const st = await app.js<{ phase: string; bootMs: number; arch: string; worker: boolean }>("__bh.obc.status()");
    expect(st.phase).toBe("ready");
    expect(st.arch).toBe("aarch64");
    expect(st.worker).toBe(true);
    metrics.bootMs = st.bootMs;

    // Verify real Linux kernel & architecture via vm.exec
    const uname = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("uname -a")`);
    expect(uname.ok).toBe(true);
    expect(uname.stdout).toContain("Linux");
    expect(uname.stdout).toContain("aarch64");
    metrics.uname = uname.stdout.trim();

    // Verify live 9p /obc/telemetry.json & /dev/tau symlink (retry once on transient 9p rename)
    let parsedTel: { v: number; vessel_id: string; dtau_dt: number } | null = null;
    for (let attempt = 0; attempt < 3 && !parsedTel; attempt++) {
      const telCheck = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("cat /obc/telemetry.json")`);
      expect(telCheck.ok).toBe(true);
      try {
        parsedTel = JSON.parse(telCheck.stdout) as { v: number; vessel_id: string; dtau_dt: number };
      } catch {
        await Bun.sleep(150);
      }
    }
    expect(parsedTel).not.toBeNull();
    expect(parsedTel!.v).toBe(1);
    expect(parsedTel!.vessel_id).toBe("ranger");
    expect(Number.isFinite(parsedTel!.dtau_dt)).toBe(true);
    metrics.dtauDt = parsedTel!.dtau_dt;

    const tauOut = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("cat /dev/tau")`);
    expect(tauOut.ok).toBe(true);
    expect(tauOut.stdout).toContain("dtau_dt=");

    // Verify bidirectional /obc/cmd control -> real simulator throttle
    const thrBefore = await app.js<number>("__bh.camera.pilot.throttle");
    metrics.throttleBefore = thrBefore;
    const cmdRes = await app.js<{ ok: boolean }>(`__bh.obc.exec("printf '{\\"kind\\":\\"throttle\\",\\"value\\":0.42}\\n' > /obc/cmd")`);
    expect(cmdRes.ok).toBe(true);
    await app.waitFor("Math.abs(__bh.camera.pilot.throttle - 0.42) < 0.01", 5_000);
    const thrAfter = await app.js<number>("__bh.camera.pilot.throttle");
    metrics.throttleAfterCmd = thrAfter;
    expect(thrAfter).toBeCloseTo(0.42, 2);
    await app.js(`__bh.obc.exec("printf '{\\"kind\\":\\"throttle\\",\\"value\\":0}\\n' > /obc/cmd")`);

    // Verify live local Wisp v1 relay handshake
    const wisp = await app.js<{ ok: boolean; latencyMs: number; msg: string }>(`__bh.obc.testWisp()`);
    expect(wisp.ok).toBe(true);
    metrics.wispOk = wisp.ok;
    metrics.wispLatencyMs = wisp.latencyMs;

    // Verify built-in /home/pilot script editor API (save, read back, execute)
    const saved = await app.js<{ ok: boolean }>(
      `__bh.obc.writeGuestFile("/home/pilot/pilot-test.sh", "#!/bin/sh\\necho PILOT_SCRIPT_AAA_OK\\n")`,
    );
    expect(saved.ok).toBe(true);
    const readBack = await app.js<string | null>(`__bh.obc.readGuestFile("/home/pilot/pilot-test.sh")`);
    expect(readBack).toContain("PILOT_SCRIPT_AAA_OK");
    const runPilot = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("/home/pilot/pilot-test.sh")`);
    expect(runPilot.ok).toBe(true);
    expect(runPilot.stdout).toContain("PILOT_SCRIPT_AAA_OK");

    // Verify offline avionics scripts execute cleanly
    const diag = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-diag && obc-orbit")`);
    expect(diag.ok).toBe(true);
    expect(diag.stdout).toContain("LINUX ON-BOARD COMPUTER");
    expect(diag.stdout).toContain("HOHMANN");

    // Open Options drawer to verify UI + capture AAA HUD console with Options open
    await app.js(`document.querySelector('[data-testid="obc-options-toggle"]')?.click()`);
    await app.js(`document.querySelector('[data-testid="obc-wisp-test"]')?.click()`);
    await app.waitFor(`(document.querySelector('[data-testid="obc-wisp-status"]')?.textContent || "").includes("OK")`, 5_000);
    await app.shot(`${OUT}/hud-options.png`);
    // Close Options drawer before next step
    await app.js(`document.querySelector('[data-testid="obc-options-toggle"]')?.click()`);

    await app.stepDone(`Boot ${st.bootMs} ms · Wisp ${wisp.latencyMs} ms · /obc/cmd + Editor OK`);
    expect(app.cdp.errors).toEqual([]);
  }, 90_000);

  test("installs Python 3 & Node.js over Wisp and verifies __bh CLI, Airports, Python & Node.js CLIs", async () => {
    await app.step("Installation Python 3 + Node.js & CLI __bh / Airports");

    // Install Python 3 + Node.js over local Wisp v1 relay
    const tInst0 = performance.now();
    const inst = await app.js<{ ok: boolean; stdout: string; stderr: string }>(`__bh.obc.installToolchain("full")`);
    metrics.toolchainInstallMs = Math.round(performance.now() - tInst0);
    expect(inst.ok).toBe(true);

    const vers = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("python3 --version && node --version")`);
    expect(vers.ok).toBe(true);
    const vLines = vers.stdout.trim().split(/\r?\n/);
    metrics.pythonVersion = vLines[0] ?? "";
    metrics.nodeVersion = vLines[1] ?? "";
    expect(metrics.pythonVersion).toContain("Python 3");
    expect(metrics.nodeVersion).toContain("v");

    // 1. CLI programs (Python & Node.js)
    const fuel = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-fuel --json")`);
    expect(fuel.ok).toBe(true);
    const fuelJson = JSON.parse(fuel.stdout) as { dv_avail_mps?: number; fuel_pct: number };
    expect(fuelJson.fuel_pct).toBeGreaterThan(0);

    const nav = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-nav paris --json")`);
    expect(nav.ok).toBe(true);
    const navJson = JSON.parse(nav.stdout) as { legs: { dist_km: number; bearing_deg: number }[] };
    expect(navJson.legs.length).toBe(1);
    expect(Number.isFinite(navJson.legs[0]!.dist_km)).toBe(true);

    const kerr = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-kerr 0.998 2.5 --json")`);
    expect(kerr.ok).toBe(true);
    const kerrJson = JSON.parse(kerr.stdout) as { r_horizon_M: number; r_isco_pro_M: number };
    expect(kerrJson.r_horizon_M).toBeGreaterThan(1.0);
    expect(kerrJson.r_isco_pro_M).toBeLessThan(2.0);

    const autoCmd = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-auto throttle 0.35")`);
    expect(autoCmd.ok).toBe(true);
    await app.waitFor("Math.abs(__bh.camera.pilot.throttle - 0.35) < 0.01", 5_000);
    await app.js(`__bh.obc.exec("obc-auto throttle 0")`);

    // 1b. Universal `__bh` & TARS CLI (`bh`) + Interactive TUI (`bh-tui`) + World Airports (`obc-airports`)
    const bhLs = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("bh ls --json")`);
    expect(bhLs.ok).toBe(true);
    const bhEntries = JSON.parse(bhLs.stdout) as { name: string }[];
    expect(bhEntries.some((e) => e.name === "fleet")).toBe(true);
    expect(bhEntries.some((e) => e.name === "tars")).toBe(true);

    const bhGet = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("bh get fleet.active --raw")`);
    expect(bhGet.ok).toBe(true);
    expect(bhGet.stdout.trim()).toBe("ranger");

    const bhEval = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("bh eval 'bh.fleet.active' --raw")`);
    expect(bhEval.ok).toBe(true);
    expect(bhEval.stdout.trim()).toBe("ranger");

    const bhTools = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("bh tools --json")`);
    expect(bhTools.ok).toBe(true);
    const toolList = JSON.parse(bhTools.stdout) as { name: string }[];
    expect(toolList.length).toBeGreaterThanOrEqual(60);
    metrics.tarsToolCount = toolList.length;

    const bhSearch = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("bh search ils --json")`);
    expect(bhSearch.ok).toBe(true);
    expect(bhSearch.stdout.toLowerCase()).toContain("approach");

    const aptList = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-airports list --json")`);
    expect(aptList.ok).toBe(true);
    const apts = JSON.parse(aptList.stdout) as { icao: string; dist_km: number }[];
    expect(apts.length).toBeGreaterThan(5);

    const ksfoInfo = await app.js<{ ok: boolean; stdout: string }>(
      `__bh.obc.exec("printf '{\\"action\\":\\"list\\",\\"field\\":\\"KSFO\\"}\\n' | bh tool approach --stdin")`,
    );
    expect(ksfoInfo.ok).toBe(true);
    const ksfoJson = JSON.parse(ksfoInfo.stdout) as { field: string; approaches: unknown[] };
    expect(ksfoJson.field).toBe("KSFO");
    expect(ksfoJson.approaches.length).toBeGreaterThan(0);
    metrics.ksfoApproaches = ksfoJson.approaches.length;

    const lfpbInfo = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-airports info LFPB --json")`);
    expect(lfpbInfo.ok).toBe(true);
    const lfpbJson = JSON.parse(lfpbInfo.stdout) as { field: string; approaches: unknown[] };
    expect(lfpbJson.field).toBe("LFPB");
    expect(lfpbJson.approaches.length).toBeGreaterThan(0);
    metrics.lfpbApproaches = lfpbJson.approaches.length;

    const bhTui = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("bh-tui --frames 1")`);
    expect(bhTui.ok).toBe(true);
    expect(bhTui.stdout).toContain("BH-TUI");

    await app.stepDone(
      `${metrics.pythonVersion} + Node ${metrics.nodeVersion} · ${metrics.tarsToolCount} outils TARS, KSFO (${metrics.ksfoApproaches}), LFPB (${metrics.lfpbApproaches})`,
    );
    expect(app.cdp.errors).toEqual([]);
  }, 240_000);

  test("runs interactive TUIs and real-time /dev/fb0 graphics (PFD, Radar, Kerr)", async () => {
    await app.step("TUIs Temps Réel & Graphiques /dev/fb0 (PFD, Radar, Kerr)");

    // 2. Real-time Interactive TUIs (Python & Node.js)
    const topTui = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-top --frames 2")`);
    expect(topTui.ok).toBe(true);
    expect(topTui.stdout).toContain("OBC-TOP");

    const misTui = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-mission-tui --frames 2")`);
    expect(misTui.ok).toBe(true);
    expect(misTui.stdout).toContain("OBC-MISSION-TUI");

    const fmcTui = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-fmc-tui --frames 2")`);
    expect(fmcTui.ok).toBe(true);
    expect(fmcTui.stdout).toContain("OBC-FMC-TUI");

    // Display live Universal BH-TUI in HUD console & wait deterministically for TUI paint before capture
    await app.js(`__bh.obc.runScript("bh-tui --frames 3")`);
    await app.waitFor(`__bh.obc.readScreen().join("\\n").includes("BH-TUI")`, 15_000);
    await Bun.sleep(300);
    await app.shot(`${OUT}/hud-bh-tui.png`);

    // Display live Node.js TUI in HUD console & capture screenshot
    await app.js(`__bh.obc.runScript("obc-top --frames 3")`);
    await app.waitFor(`__bh.obc.readScreen().join("\\n").includes("OBC-TOP")`, 15_000);
    await Bun.sleep(300);
    await app.shot(`${OUT}/hud-tui-top.png`);

    // 3. Full Real-Time Graphical /dev/fb0 Programs (Python PFD, Node.js Radar, Python Kerr)
    // 3a. Python Primary Flight Display (/dev/fb0)
    await app.js(`__bh.obc.runScript("obc-pfd-fb --seconds 5")`);
    await app.waitFor("__bh.obc.status().fbActive === true", 15_000);
    await Bun.sleep(1100);
    await app.shot(`${OUT}/fb0-pfd-python.png`);
    await app.js(`__bh.obc.write("\\x03")`);
    await app.waitFor("__bh.obc.status().fbActive === false", 10_000);

    // 3b. Node.js Tactical Radar & Orbital Scope (/dev/fb0)
    await app.js(`__bh.obc.runScript("obc-radar-fb --seconds 5")`);
    await app.waitFor("__bh.obc.status().fbActive === true", 15_000);
    await Bun.sleep(1100);
    await app.shot(`${OUT}/fb0-radar-node.png`);
    await app.js(`__bh.obc.write("\\x03")`);
    await app.waitFor("__bh.obc.status().fbActive === false", 10_000);

    // 3c. Python Gargantua Kerr Spacetime Visualizer (/dev/fb0)
    await app.js(`__bh.obc.runScript("obc-kerr-fb --seconds 5")`);
    await app.waitFor("__bh.obc.status().fbActive === true", 15_000);
    await Bun.sleep(1100);
    await app.shot(`${OUT}/fb0-kerr-python.png`);
    await app.js(`__bh.obc.write("\\x03")`);
    await app.waitFor("__bh.obc.status().fbActive === false", 10_000);

    await app.stepDone("TUIs (bh-tui, top, mission, fmc) & /dev/fb0 (PFD, Radar, Kerr) OK");
    expect(app.cdp.errors).toEqual([]);
  }, 180_000);

  test("suspends/resumes VM snapshot, renders live /dev/fb0 graphics, and shows 3D Ranger cockpit", async () => {
    await app.step("Snapshot Suspend/Resume & Cockpit 3D Ranger");

    // Live VM snapshot suspend & resume round-trip
    const tSnap = await app.js<{
      ok: boolean;
      phaseAfterSuspend: string;
      phaseAfterResume: string;
      ms: number;
      unameOk: boolean;
    }>(`(async () => {
      const t0 = performance.now();
      const s = await __bh.obc.suspend();
      const p1 = __bh.obc.status().phase;
      await __bh.obc.resume();
      const p2 = __bh.obc.status().phase;
      const ms = Math.round(performance.now() - t0);
      const u = await __bh.obc.exec("uname -m");
      return { ok: s.ok, phaseAfterSuspend: p1, phaseAfterResume: p2, ms, unameOk: u.ok && u.stdout.includes("aarch64") };
    })()`);
    expect(tSnap.ok).toBe(true);
    expect(tSnap.phaseAfterSuspend).toBe("suspended");
    expect(tSnap.phaseAfterResume).toBe("ready");
    expect(tSnap.unameOk).toBe(true);
    metrics.suspendResumeMs = tSnap.ms;

    // Put OBC on Ranger cockpit display slot 2 (right beside PFD!) and persist via settings.cockpitPages
    await app.js(`(() => {
      __bh.cockpitScreens.setPage(2, "obc");
      __bh.settings.cockpitPages = __bh.cockpitScreens.pagesSetting();
      __bh.settings.shipMount = "cockpit";
      __bh.refresh();
      return true;
    })()`);

    // Launch upgraded /dev/fb0 live orbital + telemetry scope
    await app.js(`__bh.obc.runScript("fb-demo")`);
    await app.waitFor("__bh.obc.status().fbActive === true", 15_000);

    const st = await app.js<{ fbActive: boolean; fbWidth: number; fbHeight: number }>("__bh.obc.status()");
    expect(st.fbActive).toBe(true);
    expect(st.fbWidth).toBe(512);
    expect(st.fbHeight).toBe(512);
    metrics.fbWidth = st.fbWidth;
    metrics.fbHeight = st.fbHeight;

    // Verify /dev/fb0 PNG export API
    const pngUrl = await app.js<string | null>(`__bh.obc.captureFbDataUrl()`);
    expect(pngUrl).toBeTruthy();
    expect(pngUrl?.startsWith("data:image/png;base64,")).toBe(true);
    metrics.fbPngBytes = pngUrl?.length ?? 0;

    await app.js(`(async () => {
      for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
    })()`);
    await app.shot(`${OUT}/hud-split-fb0.png`);

    // Close HUD console via F11 so the 3D Ranger cockpit OBC screen + touch buttons are fully visible
    await app.press("F11");
    await app.waitFor(`__bh.obc.status().consoleOpen === false`, 5_000);
    await app.js(`(async () => {
      for (let i = 0; i < 8; i++) {
        __bh.touch();
        await new Promise((r) => requestAnimationFrame(r));
      }
    })()`);
    await app.shot(`${OUT}/ranger-cockpit-obc.png`);
    // Stop fb-demo cleanly so the interactive TTY is ready for Step 5 TUIs
    await app.js(`__bh.obc.write("\\x03")`);
    await app.waitFor("__bh.obc.status().fbActive === false", 10_000);
    await app.stepDone(`Suspend/Resume ${tSnap.ms} ms · /dev/fb0 ${st.fbWidth}×${st.fbHeight} sur HUD + Ranger`);
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);

  test("controls F-35 end-to-end from Linux (obc-f35, obc-f35-tui, obc-ils-fb, obc-f35-fb & 3D PCD)", async () => {
    await app.step("F-35 100% piloté depuis Linux (CLI, TUI, ILS/TSD FB0 & PCD 3D)");

    // Measure FPS with Linux OBC actively running in background Web Worker
    const active = await app.js<{ fps: number; ms: number }>(`(async () => {
      const times = [];
      let prev = performance.now();
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        times.push(now - prev);
        prev = now;
      }
      times.sort((a, b) => a - b);
      const med = times[Math.floor(times.length / 2)] || 16.7;
      return { ms: +med.toFixed(2), fps: +(1000 / med).toFixed(1) };
    })()`);
    metrics.obcActiveFps = active.fps;
    metrics.obcActiveFrameMs = active.ms;

    // ── 1. F-35 100% controlled from Linux (obc-f35, obc-f35-tui, obc-f35-fb, obc-ils-fb) ──
    const f35Fly = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-f35 fly LFPB final")`);
    expect(f35Fly.ok).toBe(true);
    await app.waitFor(`__bh.fleet.active === "f35"`, 20_000);

    // Control F-35 radar, weapon, ILS approach & PCD entirely from Linux CLI
    const f35Ops = await app.js<{ ok: boolean; stdout: string }>(
      `__bh.obc.exec("obc-f35 radar TWS && obc-f35 weapon aim120 && obc-airports select LFPB && obc-f35 pcd 0 OBC && obc-f35 status --json")`,
    );
    expect(f35Ops.ok).toBe(true);
    expect(f35Ops.stdout).toContain("f35");

    // Verify F-35 WSO TUI renders live stores, radar, and traffic
    const f35Tui = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-f35-tui --frames 2")`);
    expect(f35Tui.ok).toBe(true);
    expect(f35Tui.stdout).toContain("OBC-F35-TUI");

    // Open HUD console to capture live F-35 TUI + /dev/fb0 F-35 TSD & ILS Approach scopes
    await app.js(`(() => { __bh.obc.openConsole(); document.querySelector('[data-testid="obc-mode-term"]')?.click(); })()`);
    await app.js(`__bh.obc.runScript("obc-f35-tui --frames 3")`);
    await app.waitFor(`__bh.obc.readScreen().join("\\n").includes("OBC-F35-TUI")`, 15_000);
    await Bun.sleep(300);
    await app.shot(`${OUT}/hud-f35-tui.png`);

    await app.js(`document.querySelector('[data-testid="obc-mode-split"]')?.click()`);
    await app.js(`__bh.obc.runScript("obc-ils-fb --seconds 6")`);
    await app.waitFor("__bh.obc.status().fbActive === true", 15_000);
    await Bun.sleep(1500);
    await app.shot(`${OUT}/fb0-ils-approach.png`);
    await app.js(`__bh.obc.write("\\x03")`);
    await app.waitFor("__bh.obc.status().fbActive === false", 10_000);

    // Launch real-time F-35 TSD Radar on /dev/fb0, capture on HUD AND inside the 3D F-35 PCD!
    await app.js(`__bh.obc.runScript("obc-f35-fb --seconds 14")`);
    await app.waitFor("__bh.obc.status().fbActive === true", 15_000);
    await Bun.sleep(1500);
    await app.shot(`${OUT}/fb0-f35-tsd.png`);

    await app.js(`(() => {
      __bh.obc.closeConsole();
      __bh.settings.shipMount = "cockpit";
      __bh.refresh();
      const pcd = __bh.pcd?.pcd;
      if (pcd) {
        pcd.halves[0] = "full";
        pcd.show(0, "OBC");
      }
      __bh.camera.setLook(0, -22);
      return true;
    })()`);
    await Bun.sleep(600);
    await app.js(`(async () => {
      for (let i = 0; i < 10; i++) {
        __bh.touch();
        await new Promise((r) => requestAnimationFrame(r));
      }
    })()`);
    await app.shot(`${OUT}/f35-pcd-obc.png`);
    await app.js(`__bh.obc.write("\\x03")`);
    await app.waitFor("__bh.obc.status().fbActive === false", 10_000);

    await app.stepDone(`F-35 piloté depuis Linux · OBC actif ${active.fps} fps · TUI, ILS FB0, TSD FB0 & PCD 3D OK`);
    expect(app.cdp.errors).toEqual([]);
  }, 180_000);

  test("controls A320 end-to-end from Linux (obc-a320, MCDU, ECAM, obc-a320-tui, obc-a320-fb & 3D LECAM)", async () => {
    await app.step("A320 100% piloté depuis Linux (CLI, MCDU, TUI, ND FB0 & LECAM 3D) + FPS");

    // ── 2. Airbus A320 100% controlled from Linux (obc-a320, obc-a320-tui, obc-a320-fb) ──
    const a320Fly = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-a320 fly LFPB")`);
    expect(a320Fly.ok).toBe(true);
    await app.waitFor(`__bh.fleet.active === "a320"`, 20_000);

    // Build LFPB -> LFMN flight plan, drive Captain MCDU & Lower ECAM entirely from Linux!
    const a320Route = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-airports route LFPB LFMN")`);
    expect(a320Route.ok).toBe(true);

    const a320McduPage = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-a320 mcdu page obc --json")`);
    expect(a320McduPage.ok).toBe(true);
    const mcduPageJson = JSON.parse(a320McduPage.stdout) as { pageId: string; title: string };
    expect(mcduPageJson.pageId).toBe("obc");
    expect(mcduPageJson.title).toContain("OBC LINUX LINK");

    const a320Type = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-a320 mcdu type LFPB --json")`);
    expect(a320Type.ok).toBe(true);
    expect(JSON.parse(a320Type.stdout).scratchpad).toBe("LFPB");

    const a320Ecam = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-a320 ecam obcPage --json")`);
    expect(a320Ecam.ok).toBe(true);
    expect(JSON.parse(a320Ecam.stdout).ecam).toBe("obcPage");

    const a320Tui = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-a320-tui --frames 2")`);
    expect(a320Tui.ok).toBe(true);
    expect(a320Tui.stdout).toContain("OBC-A320-TUI");
    expect(a320Tui.stdout).toContain("OBC LINUX LINK");

    // Capture live A320 FCU+MCDU TUI and live A320 ARC-mode ND on /dev/fb0 (HUD + 3D Lower ECAM!)
    await app.js(`(() => { __bh.obc.openConsole(); document.querySelector('[data-testid="obc-mode-term"]')?.click(); })()`);
    await app.js(`__bh.obc.runScript("obc-a320-tui --frames 3")`);
    await app.waitFor(`__bh.obc.readScreen().join("\\n").includes("OBC-A320-TUI")`, 15_000);
    await Bun.sleep(300);
    await app.shot(`${OUT}/hud-a320-tui.png`);

    await app.js(`document.querySelector('[data-testid="obc-mode-split"]')?.click()`);
    await app.js(`__bh.obc.runScript("obc-a320-fb --seconds 12")`);
    await app.waitFor("__bh.obc.status().fbActive === true", 15_000);
    await Bun.sleep(2600);
    await app.shot(`${OUT}/fb0-a320-nd.png`);

    await app.js(`(() => {
      __bh.obc.closeConsole();
      __bh.settings.shipMount = "cockpit";
      __bh.refresh();
      __bh.camera.setLook(24, -18);
      return true;
    })()`);
    await Bun.sleep(700);
    await app.js(`(async () => {
      for (let i = 0; i < 10; i++) {
        __bh.touch();
        await new Promise((r) => requestAnimationFrame(r));
      }
    })()`);
    await app.shot(`${OUT}/a320-cockpit-obc.png`);
    await app.js(`__bh.obc.write("\\x03")`);
    await app.waitFor("__bh.obc.status().fbActive === false", 10_000);

    // Cleanly stop OBC worker before exit
    await app.js("__bh.obc.stop()");
    const afterStop = await app.js<{ phase: string }>("__bh.obc.status()");
    expect(afterStop.phase).toBe("off");

    await app.stepDone("A320 piloté depuis Linux · MCDU, ECAM, TUI, ND FB0 & LECAM 3D OK");
    expect(app.cdp.errors).toEqual([]);
  }, 180_000);
});
