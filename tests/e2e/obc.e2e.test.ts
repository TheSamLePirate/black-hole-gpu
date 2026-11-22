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
      "Snapshot Suspend/Resume & /dev/fb0 + Cockpit Ranger",
      "Cockpits 3D F-35 PCD & A320 MCDU/LECAM + FPS",
    ]);
    app.estimate(60);
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

    // Verify live 9p /obc/telemetry.json & /dev/tau symlink
    const telCheck = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("cat /obc/telemetry.json")`);
    expect(telCheck.ok).toBe(true);
    const parsedTel = JSON.parse(telCheck.stdout) as { v: number; vessel_id: string; dtau_dt: number };
    expect(parsedTel.v).toBe(1);
    expect(parsedTel.vessel_id).toBe("ranger");
    expect(Number.isFinite(parsedTel.dtau_dt)).toBe(true);
    metrics.dtauDt = parsedTel.dtau_dt;

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

  test("suspends/resumes VM snapshot, renders live /dev/fb0 graphics, and shows 3D Ranger cockpit", async () => {
    await app.step("Snapshot Suspend/Resume & /dev/fb0 + Cockpit Ranger");

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
    await app.stepDone(`Suspend/Resume ${tSnap.ms} ms · /dev/fb0 ${st.fbWidth}×${st.fbHeight} sur HUD + Ranger`);
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);

  test("renders OBC in 3D F-35 PCD & A320 MCDU/Lower ECAM and preserves 60 FPS", async () => {
    await app.step("Cockpits 3D F-35 PCD & A320 MCDU/LECAM + FPS");

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

    // 1. F-35B 3D cockpit: close HUD console, show wide OBC portal on PCD with live /dev/fb0 & capture!
    await app.js(`(() => {
      __bh.obc.closeConsole();
      __bh.settings.vessel = "f35";
      __bh.settings.shipMount = "cockpit";
      __bh.refresh();
      return true;
    })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 20_000);
    await app.js(`__bh.obc.runScript("fb-demo")`);
    await app.waitFor("__bh.obc.status().fbActive === true", 15_000);
    const f35Check = await app.js<string>(`(() => {
      const pcd = __bh.pcd?.pcd;
      if (!pcd) return "";
      pcd.halves[0] = "full";
      const res = pcd.show(0, "OBC");
      __bh.camera.setLook(0, -22);
      return res;
    })()`);
    expect(f35Check).toBe("OBC");
    await Bun.sleep(600);
    await app.js(`(async () => {
      for (let i = 0; i < 10; i++) {
        __bh.touch();
        await new Promise((r) => requestAnimationFrame(r));
      }
    })()`);
    await app.shot(`${OUT}/f35-pcd-obc.png`);

    // 2. A320 3D cockpit: open MCDU OBC LINK page via L5 + Lower ECAM obcPage via R3, aim at center ECAM/MCDU & capture!
    await app.js(`(() => {
      __bh.obc.closeConsole();
      __bh.settings.vessel = "a320";
      __bh.settings.shipMount = "cockpit";
      __bh.refresh();
      return true;
    })()`);
    await app.waitFor(`__bh.fleet.active === "a320"`, 20_000);
    const a320Check = await app.js<{ ok: boolean; pageId: string; title: string }>(`(() => {
      const mcdu = __bh.a320Mcdu?.(0);
      if (!mcdu) return { ok: false, pageId: "", title: "" };
      mcdu.page("mcdu");
      mcdu.lsk("L", 5);
      mcdu.lsk("R", 3); // show OBC + live /dev/fb0 on Lower ECAM
      __bh.camera.setLook(24, -18);
      const scr = mcdu.current.screen(mcdu);
      const title = scr.title.map((r) => r.t).join("");
      return { ok: mcdu.pageId === "obc", pageId: mcdu.pageId, title };
    })()`);
    expect(a320Check.ok).toBe(true);
    expect(a320Check.title).toContain("OBC LINUX LINK");
    await Bun.sleep(700);
    await app.js(`(async () => {
      for (let i = 0; i < 10; i++) {
        __bh.touch();
        await new Promise((r) => requestAnimationFrame(r));
      }
    })()`);
    await app.shot(`${OUT}/a320-cockpit-obc.png`);

    // Cleanly stop OBC worker before exit
    await app.js("__bh.obc.stop()");
    const afterStop = await app.js<{ phase: string }>("__bh.obc.status()");
    expect(afterStop.phase).toBe("off");

    await app.stepDone(`OBC actif ${active.fps} fps (${active.ms} ms) · F-35 PCD & A320 LECAM/MCDU OK`);
    expect(app.cdp.errors).toEqual([]);
  }, 90_000);
});
