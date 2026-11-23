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
  alpineMemoryMiB: number;
  debianBootMs: number;
  debianMemoryMiB: number;
  ram4gAllocatedMiB: number;
  wispOk: boolean;
  wispLatencyMs: number;
  toolchainInstallMs: number;
  debianInstallMs: number;
  pythonVersion: string;
  pipVersion: string;
  nodeVersion: string;
  npmVersion: string;
  bunVersion: string;
  rustVersion: string;
  cargoVersion: string;
  obcRsVersion: string;
  piVersion: string;
  claudeVersion: string;
  debianTools: {
    python: string;
    pip: string;
    node: string;
    npm: string;
    bun: string;
    pi: string;
    claude: string;
  };
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
      "Boot Alpine 3.24 (2 GiB), Pont __bh, Wisp & Options RAM/Distro",
      "Alpine : Python, pip, Node, npm, Bun, Pi & Claude Code + CLI __bh",
      "TUIs Temps Réel & Graphiques /dev/fb0 (PFD, Radar, Kerr)",
      "Snapshot Suspend/Resume & Cockpit 3D Ranger",
      "F-35 100% piloté depuis Linux (CLI, TUI, ILS/TSD FB0 & PCD 3D)",
      "A320 100% piloté depuis Linux (CLI, MCDU, TUI, ND FB0 & LECAM 3D)",
      "Debian 13 Trixie (2 GiB / 4 GiB) : Python, pip, Node, npm, Bun, Pi & Claude Code",
    ]);
    app.estimate(540);
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
    await app.step("Boot Alpine 3.24 (2 GiB), Pont __bh, Wisp & Options RAM/Distro");
    await app.press("F11");
    await app.waitFor(`__bh.obc.status().consoleOpen === true`, 10_000);
    await app.waitFor(`__bh.obc.status().phase === "ready"`, 60_000);

    const st = await app.js<{ phase: string; bootMs: number; arch: string; worker: boolean; distro: string; memoryMiB: number }>(
      "__bh.obc.status()",
    );
    expect(st.phase).toBe("ready");
    expect(st.arch).toBe("aarch64");
    expect(st.worker).toBe(true);
    expect(st.distro).toBe("alpine-3.24");
    expect(st.memoryMiB).toBe(2048);
    metrics.bootMs = st.bootMs;
    metrics.alpineMemoryMiB = st.memoryMiB;

    // Verify Options drawer exposes 512 / 1024 / 2048 (default) / 4096 MiB and Alpine / Debian selectors
    const uiOpts = await app.js<{ rams: string[]; distros: string[]; quickDistros: string[] }>(`(() => {
      const vals = (sel) => [...document.querySelectorAll(sel + ' option')].map((o) => o.value);
      return {
        rams: vals('[data-testid="obc-opt-ram"]'),
        distros: vals('[data-testid="obc-opt-distro"]'),
        quickDistros: vals('[data-testid="obc-distro-quick"]'),
      };
    })()`);
    expect(uiOpts.rams).toEqual(["512", "1024", "2048", "4096"]);
    expect(uiOpts.distros).toEqual(["alpine", "debian"]);
    expect(uiOpts.quickDistros).toEqual(["alpine", "debian"]);

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

    // Verify native compiled Rust + Ratatui / /dev/fb0 multi-call binary works IMMEDIATELY on first boot (no Python/Node needed!)
    const obcRsVer = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-rs --version")`);
    expect(obcRsVer.ok).toBe(true);
    expect(obcRsVer.stdout).toContain("obc-rs");
    expect(obcRsVer.stdout).toContain("ratatui");
    metrics.obcRsVersion = obcRsVer.stdout.trim();
    const hasRustBtn = await app.js<boolean>(`Boolean(document.querySelector('[data-testid="obc-install-rust"]'))`);
    expect(hasRustBtn).toBe(true);

    // Verify offline avionics scripts & /home/pilot AAA docs + Claude/Pi skills on first boot
    const kitCheck = await app.js<{ ok: boolean; stdout: string }>(
      `__bh.obc.exec("test -r /home/pilot/CLAUDE.md && test -r /home/pilot/AGENTS.md && test -r /home/pilot/README.md && test -r /home/pilot/docs/OBC-ARCHITECTURE.md && test -r /home/pilot/docs/BH-API-GUIDE.md && test -r /home/pilot/docs/TTY-AND-FB0.md && test -r /home/pilot/docs/UNKERNEL-LINUX.md && test -r /home/pilot/.claude/skills/obc-build-fb-app/SKILL.md && test -r /home/pilot/.pi/skills/obc-build-tui-app/SKILL.md && test -r /home/pilot/.agents/skills/obc-rust-dev/SKILL.md && echo PILOT_KIT_OK")`,
    );
    expect(kitCheck.ok).toBe(true);
    expect(kitCheck.stdout).toContain("PILOT_KIT_OK");

    const diag = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-diag && obc-orbit")`);
    expect(diag.ok).toBe(true);
    expect(diag.stdout).toContain("LINUX ON-BOARD COMPUTER");
    expect(diag.stdout).toContain("obc-rs=native");
    expect(diag.stdout).toContain("kit=docs+5skills");
    expect(diag.stdout).toContain("HOHMANN");

    // Open AAA Linux Machine Manager to verify all 6 tabs, live Unkernel stats, Disk, Wisp, Drag & Resize!
    await app.js(`document.querySelector('[data-testid="obc-options-toggle"]')?.click()`);
    await app.waitFor(`(document.querySelector('[data-testid="obc-mgr-kpis"]')?.children.length || 0) >= 6`, 5_000);
    await Bun.sleep(500);
    await app.shot(`${OUT}/hud-manager-monitor.png`);

    // Verify live kernelStats(), diskInfo(), syncDisk(), and probeGuest() APIs
    const mgrApi = await app.js<{
      running: boolean;
      jitLive: number;
      syncOk: boolean;
      persist: boolean;
      procCount: number;
      toolKeys: number;
    }>(`(async () => {
      const ks = __bh.obc.kernelStats();
      const s = await __bh.obc.syncDisk();
      const d = await __bh.obc.diskInfo();
      const p = await __bh.obc.probeGuest();
      return {
        running: ks.running,
        jitLive: ks.jit?.compiled ?? 0,
        syncOk: s.ok,
        persist: d.persistData,
        procCount: p?.processes.length ?? 0,
        toolKeys: Object.keys(p?.tools ?? {}).length,
      };
    })()`);
    expect(mgrApi.running).toBe(true);
    expect(mgrApi.jitLive).toBeGreaterThan(0);
    expect(mgrApi.syncOk).toBe(true);
    expect(mgrApi.persist).toBe(true);
    expect(mgrApi.procCount).toBeGreaterThan(0);
    expect(mgrApi.toolKeys).toBeGreaterThanOrEqual(10);

    // Switch to Network & Wisp tab, run live Wisp probe & capture screenshot
    await app.js(`document.querySelector('[data-testid="obc-mgr-tab-network"]')?.click()`);
    await app.js(`document.querySelector('[data-testid="obc-wisp-test"]')?.click()`);
    await app.waitFor(`(document.querySelector('[data-testid="obc-wisp-status"]')?.textContent || "").includes("OK")`, 5_000);
    await app.shot(`${OUT}/hud-options.png`);

    // Verify real panel Drag, Resize (SE handle), Maximize & Dock Reset
    const geom = await app.js<{
      movedX: number;
      movedY: number;
      resizedW: number;
      resizedH: number;
      maxW: number;
      resetOk: boolean;
    }>(`(() => {
      const box = document.querySelector('[data-testid="obc-console"]');
      const bar = document.querySelector('[data-testid="obc-drag-bar"]');
      const se = document.querySelector('[data-testid="obc-resize-se"]');
      const r0 = box.getBoundingClientRect();
      // Drag panel by (-40, -50)
      bar.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: r0.left + 80, clientY: r0.top + 12, pointerId: 1 }));
      bar.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, button: 0, clientX: r0.left + 40, clientY: r0.top - 38, pointerId: 1 }));
      bar.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: r0.left + 40, clientY: r0.top - 38, pointerId: 1 }));
      const r1 = box.getBoundingClientRect();
      // Resize SE handle by (-80, -40)
      se.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: r1.right - 4, clientY: r1.bottom - 4, pointerId: 2 }));
      se.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, button: 0, clientX: r1.right - 84, clientY: r1.bottom - 44, pointerId: 2 }));
      se.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: r1.right - 84, clientY: r1.bottom - 44, pointerId: 2 }));
      const r2 = box.getBoundingClientRect();
      // Maximize then Dock Reset
      document.querySelector('[data-testid="obc-maximize"]')?.click();
      const rMax = box.getBoundingClientRect();
      document.querySelector('[data-testid="obc-dock-reset"]')?.click();
      const rReset = box.getBoundingClientRect();
      return {
        movedX: Math.round(r1.left - r0.left),
        movedY: Math.round(r1.top - r0.top),
        resizedW: Math.round(r2.width - r1.width),
        resizedH: Math.round(r2.height - r1.height),
        maxW: Math.round(rMax.width),
        resetOk: Math.abs(rReset.width - r0.width) <= 2,
      };
    })()`);
    expect(geom.movedX).toBeLessThanOrEqual(-30);
    expect(geom.movedY).toBeLessThanOrEqual(-40);
    expect(geom.resizedW).toBeLessThanOrEqual(-70);
    expect(geom.resizedH).toBeLessThanOrEqual(-30);
    expect(geom.maxW).toBeGreaterThanOrEqual(1400);
    expect(geom.resetOk).toBe(true);

    // Close Manager drawer before next step
    await app.js(`document.querySelector('[data-testid="obc-options-toggle"]')?.click()`);

    // Verify mouse movements over xterm NEVER emit raw escape characters ([<35;...) even after a program enables ?1003h+?1006h
    await app.js(`__bh.obc.write("printf '\\\\033[?1003h\\\\033[?1006hMOUSE_TEST\\\\n'\\n")`);
    await app.waitFor(`__bh.obc.readScreen().join("\\n").includes("MOUSE_TEST")`, 8_000);
    await app.js(`(() => {
      const wrap = document.querySelector('[data-testid="obc-xterm"] .xterm-screen') || document.querySelector('[data-testid="obc-xterm"]');
      const r = wrap.getBoundingClientRect();
      for (let i = 0; i < 10; i++) {
        const x = r.left + 40 + i * 24;
        const y = r.top + 40 + i * 10;
        wrap.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
        wrap.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y }));
      }
      return true;
    })()`);
    await Bun.sleep(250);
    const afterMouse = await app.js<string>(`__bh.obc.readScreen().join("\\n")`);
    expect(afterMouse).not.toContain("[<35;");
    expect(afterMouse).not.toContain("35;");

    await app.stepDone(`Boot ${st.bootMs} ms · Wisp ${wisp.latencyMs} ms · /obc/cmd + Editor OK`);
    expect(app.cdp.errors).toEqual([]);
  }, 90_000);

  const installAndWait = async (profile: string): Promise<{ ok: boolean; stdout: string; stderr: string }> => {
    await app.js(`(() => {
      window.__obcInst = null;
      __bh.obc.installToolchain(${JSON.stringify(profile)}).then(
        (r) => { window.__obcInst = r; },
        (e) => { window.__obcInst = { ok: false, stdout: "", stderr: String(e) }; }
      );
      return true;
    })()`);
    // Poll in 60 s liveness windows (never a silent >120 s wait; aborts early if the VM leaves "ready")
    for (let w = 0; w < 18; w++) {
      if (await app.waitOptional("window.__obcInst !== null", 60_000)) break;
      const st = await app.js<{ phase: string }>("__bh.obc.status()");
      if (st.phase !== "ready") {
        throw new Error(`obc-install ${profile} aborted: OBC phase became ${st.phase}`);
      }
    }
    const res = await app.js<{ ok: boolean; stdout: string; stderr: string } | null>("window.__obcInst");
    if (!res) throw new Error(`obc-install ${profile} timed out`);
    if (!res.ok) {
      console.error(`[obc-install ${profile}] FAILED\nSTDOUT tail:\n${res.stdout.slice(-1200)}\nSTDERR tail:\n${res.stderr.slice(-1200)}`);
    }
    return res;
  };

  test("installs Python, pip, Node, npm, Bun, Pi & Claude Code on Alpine and verifies __bh CLI & Airports", async () => {
    await app.step("Alpine : Python, pip, Node, npm, Bun, Pi & Claude Code + CLI __bh");

    // Install all 7 toolchains over local Wisp v1 relay on Alpine 3.24
    const tInst0 = performance.now();
    const inst = await installAndWait("all");
    metrics.toolchainInstallMs = Math.round(performance.now() - tInst0);
    expect(inst.ok).toBe(true);

    const vers = await app.js<{ ok: boolean; stdout: string }>(
      `__bh.obc.exec("python3 --version && pip --version && node --version && npm --version && bun --version && pi --version && claude --version")`,
    );
    expect(vers.ok).toBe(true);
    const vLines = vers.stdout.trim().split(/\r?\n/);
    metrics.pythonVersion = vLines[0] ?? "";
    metrics.pipVersion = vLines[1] ?? "";
    metrics.nodeVersion = vLines[2] ?? "";
    metrics.npmVersion = vLines[3] ?? "";
    metrics.bunVersion = vLines[4] ?? "";
    metrics.piVersion = vLines[5] ?? "";
    metrics.claudeVersion = vLines[6] ?? "";
    expect(metrics.pythonVersion).toContain("Python 3");
    expect(metrics.pipVersion.toLowerCase()).toContain("pip");
    expect(metrics.nodeVersion).toContain("v");
    expect(metrics.npmVersion).toMatch(/^\d+\.\d+/);
    expect(metrics.bunVersion).toMatch(/^\d+\.\d+/);
    expect(metrics.piVersion).toMatch(/^\d+\.\d+/);
    expect(metrics.claudeVersion.toLowerCase()).toContain("claude");

    // Install Rust (rustc + cargo) on Alpine too so Rust + Ratatui development is available in-guest
    const rustInst = await installAndWait("rust");
    expect(rustInst.ok).toBe(true);
    const rustVers = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("rustc --version && cargo --version")`);
    expect(rustVers.ok).toBe(true);
    const rLines = rustVers.stdout.trim().split(/\r?\n/);
    metrics.rustVersion = rLines[0] ?? "";
    metrics.cargoVersion = rLines[1] ?? "";
    expect(metrics.rustVersion).toContain("rustc");
    expect(metrics.cargoVersion).toContain("cargo");

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
      `Alpine OK: ${metrics.pythonVersion} · pip · Node ${metrics.nodeVersion} · npm ${metrics.npmVersion} · Bun ${metrics.bunVersion} · pi ${metrics.piVersion} · Claude ${metrics.claudeVersion}`,
    );
    expect(app.cdp.errors).toEqual([]);
  }, 760_000);

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

    // Display live Universal BH-TUI interactively (real TTY, NO --frames!) & prove real DOM keys + Split-mode live reflow!
    await app.js(`__bh.obc.runScript("bh-tui")`);
    await app.waitFor(`__bh.obc.readScreen().join("\\n").includes("BH-TUI")`, 15_000);
    await Bun.sleep(300);
    await app.shot(`${OUT}/hud-bh-tui.png`);

    // Switch live to Split mode while bh-tui is running: /obc/tty_size + TermBuffer must reflow cleanly with BH-TUI still on row 0!
    await app.js(`document.querySelector('[data-testid="obc-mode-split"]')?.click()`);
    await app.waitFor(`(__bh.obc.readScreen()[0] || "").includes("BH-TUI")`, 6_000);
    await Bun.sleep(250);
    const splitScreen = await app.js<string[]>(`__bh.obc.readScreen()`);
    expect(splitScreen[0] ?? "").toContain("BH-TUI");
    expect(splitScreen.at(-1) ?? "").toContain("Quit");
    await app.shot(`${OUT}/hud-bh-tui-split.png`);
    await app.js(`document.querySelector('[data-testid="obc-mode-term"]')?.click()`);
    await app.waitFor(`(__bh.obc.readScreen()[0] || "").includes("BH-TUI")`, 6_000);
    await Bun.sleep(200);

    // Send real DOM Tab key: bh-tui MUST switch from __bh tree to TARS TOOLS (and never trigger simulator Tab wheel!)
    await app.press("Tab");
    await app.waitFor(`__bh.obc.readScreen().join("\\n").includes("TARS TOOLS")`, 8_000);

    // Open Global Fuzzy Search ('f'), type "get_state", verify live fuzzy match, open Runner Modal & execute live!
    await app.press("KeyF");
    await app.waitFor(`__bh.obc.readScreen().join("\\n").includes("FUZZY COMMAND PALETTE")`, 6_000);
    await app.js(`__bh.obc.write("get_state")`);
    await app.waitFor(`__bh.obc.readScreen().join("\\n").includes("get_state")`, 6_000);
    await Bun.sleep(250);
    await app.shot(`${OUT}/hud-bh-tui-fuzzy.png`);
    // Enter opens RUN TARS TOOL modal (or executes Quick Action if matched first); handle either cleanly:
    await app.press("Enter");
    await Bun.sleep(350);
    const afterFirstEnter = await app.js<string>(`__bh.obc.readScreen().join("\\n")`);
    if (afterFirstEnter.includes("RUN TARS TOOL")) {
      await app.shot(`${OUT}/hud-bh-tui-modal.png`);
      await app.press("Enter");
    }
    await app.waitFor(`__bh.obc.readScreen().join("\\n").includes("RESULT")`, 8_000);
    await Bun.sleep(250);
    await app.shot(`${OUT}/hud-bh-tui-result.png`);

    // Clear search (Esc) and send real DOM 'q' key: bh-tui MUST exit cleanly back to shell prompt
    await app.press("Escape");
    await Bun.sleep(150);
    await app.press("KeyQ");
    await Bun.sleep(400);

    // Display live Node.js TUI in HUD console & capture screenshot
    await app.js(`__bh.obc.runScript("obc-top --frames 3")`);
    await app.waitFor(`__bh.obc.readScreen().join("\\n").includes("OBC-TOP")`, 15_000);
    await Bun.sleep(300);
    await app.shot(`${OUT}/hud-tui-top.png`);

    // 3. Full Real-Time Graphical /dev/fb0 Programs (Python PFD, Node.js Radar, Python Kerr)
    // 3a. Python Primary Flight Display (/dev/fb0) — ALSO verify real DOM key 'q' in /dev/fb0-only mode cleanly quits it!
    await app.js(`__bh.obc.runScript("obc-pfd-fb --seconds 20")`);
    await app.waitFor("__bh.obc.status().fbActive === true", 15_000);
    await Bun.sleep(2200);
    const pfdScreen1 = await app.js<string>(`__bh.obc.readScreen().join("\\n")`);
    expect(pfdScreen1).not.toContain("Traceback");
    await app.shot(`${OUT}/fb0-pfd-python.png`);
    // Switch to /dev/fb0-only view (xterm hidden!) and send real DOM 'q' — must reach obc-pfd-fb and close /dev/fb0!
    await app.js(`document.querySelector('[data-testid="obc-mode-fb"]')?.click()`);
    await Bun.sleep(250);
    await app.press("KeyQ");
    await app.waitFor("__bh.obc.status().fbActive === false", 10_000);
    await app.js(`document.querySelector('[data-testid="obc-mode-split"]')?.click()`);

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

    // Launch native Rust /dev/fb0 live orbital + telemetry scope (zero Python dependency, 30 Hz!)
    await app.js(`__bh.obc.runScript("obc-radar-fb --seconds 15")`);
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
    // Stop fb-demo cleanly so the interactive TTY is ready on the 3D Ranger OBC screen
    await app.js(`__bh.obc.write("\\x03")`);
    await app.waitFor("__bh.obc.status().fbActive === false", 10_000);

    // Verify AAA 3D cockpit screen capture: clicking 3D OBC screen captures keyboard+mouse, dblclick does NOT reset camera!
    const capCheck = await app.js<{
      ptFound: boolean;
      capturedKind: string | null;
      badgeVisible: boolean;
      lookKeptAfterDblClick: boolean;
    }>(`(async () => {
      __bh.camera.setLook(8, -12);
      for (let i = 0; i < 4; i++) {
        __bh.touch();
        await new Promise((r) => requestAnimationFrame(r));
      }
      let pt = null;
      for (let ny = 0.6; ny >= -0.85 && !pt; ny -= 0.03) {
        for (let nx = -0.85; nx <= 0.85 && !pt; nx += 0.03) {
          const h = __bh.cabinPick(nx, ny);
          if (h?.screen?.slot === 2 && h.screen.v > 0.15 && h.screen.v < 0.65) pt = [nx, ny];
        }
      }
      if (!pt) return { ptFound: false, capturedKind: null, badgeVisible: false, lookKeptAfterDblClick: false };
      const cv = document.querySelector("canvas");
      const r = cv.getBoundingClientRect();
      const cx = r.left + ((pt[0] + 1) / 2) * r.width;
      const cy = r.top + ((1 - pt[1]) / 2) * r.height;
      cv.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: cx, clientY: cy, pointerId: 9 }));
      cv.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: cx, clientY: cy, pointerId: 9 }));
      const cap = __bh.obc.screenCapture();
      const badge = document.querySelector('[data-testid="obc-screen-capture-badge"]');
      const badgeVisible = !!badge && getComputedStyle(badge).display !== "none";
      const yawBefore = __bh.settings.shipLookYaw;
      cv.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0, clientX: cx, clientY: cy }));
      const lookKeptAfterDblClick = Math.abs(__bh.settings.shipLookYaw - yawBefore) < 0.01 && Math.abs(__bh.settings.shipLookYaw) > 1;
      return { ptFound: true, capturedKind: cap?.kind ?? null, badgeVisible, lookKeptAfterDblClick };
    })()`);
    expect(capCheck.ptFound).toBe(true);
    expect(capCheck.capturedKind).toBe("obc");
    expect(capCheck.badgeVisible).toBe(true);
    expect(capCheck.lookKeptAfterDblClick).toBe(true);

    // Type directly on the captured 3D screen (HUD console CLOSED!) and verify text arrives in the Linux TTY!
    await app.js(`(() => {
      for (const ch of "echo CAP3D_OK") {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true }));
      }
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      return true;
    })()`);
    await app.waitFor(`__bh.obc.readScreen().join("\\n").includes("CAP3D_OK")`, 6_000);
    await app.shot(`${OUT}/ranger-cockpit-obc-captured.png`);
    await app.js(`document.querySelector('[data-testid="obc-screen-capture-release"]')?.click()`);
    const capAfterRelease = await app.js<unknown>(`__bh.obc.screenCapture()`);
    expect(capAfterRelease).toBeNull();
    await app.js(`__bh.camera.setLook(0, 0)`);

    await app.stepDone(`Suspend/Resume ${tSnap.ms} ms · /dev/fb0 ${st.fbWidth}×${st.fbHeight} sur HUD + Ranger + Capture 3D`);
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

    // Verify F-35 attitude in /obc/telemetry.json matches real __bh.camera.attitudeNow() in DEGREES (not radians!)
    const attCheck = await app.js<{
      simHdg: number;
      obcHdg: number;
      simPitch: number;
      obcPitch: number;
      simRoll: number;
      obcRoll: number;
    }>(`(() => {
      const a = __bh.camera.attitudeNow();
      const t = __bh.obc.telemetry().attitude;
      const r2d = 180 / Math.PI;
      return {
        simHdg: ((((a.heading ?? 0) * r2d) % 360) + 360) % 360,
        obcHdg: t.heading_deg,
        simPitch: (a.pitch ?? 0) * r2d,
        obcPitch: t.pitch_deg,
        simRoll: (a.bank ?? 0) * r2d,
        obcRoll: t.roll_deg,
      };
    })()`);
    expect(Math.abs(attCheck.obcHdg - attCheck.simHdg)).toBeLessThan(1.0);
    expect(Math.abs(attCheck.obcPitch - attCheck.simPitch)).toBeLessThan(1.0);
    expect(Math.abs(attCheck.obcRoll - attCheck.simRoll)).toBeLessThan(1.0);

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

    // Capture AAA PFD artificial horizon in live F-35 flight (turning to HDG 150°, climbing to 1800m -> real bank & pitch!)
    await app.js(`__bh.obc.exec("obc-f35 fly LFPB cruise && obc-f35 ap hdg=150 alt=1800 spd=210 ap=on athr=on")`);
    await Bun.sleep(1800);
    await app.js(`(() => { __bh.obc.openConsole(); document.querySelector('[data-testid="obc-mode-split"]')?.click(); })()`);
    await app.js(`__bh.obc.runScript("obc-pfd-fb --seconds 12")`);
    await app.waitFor("__bh.obc.status().fbActive === true", 15_000);
    await Bun.sleep(2200);
    const pfdScreen2 = await app.js<string>(`__bh.obc.readScreen().join("\\n")`);
    expect(pfdScreen2).not.toContain("Traceback");
    await app.shot(`${OUT}/fb0-pfd-banked.png`);
    await app.press("KeyQ");
    await app.waitFor("__bh.obc.status().fbActive === false", 10_000);

    // Return to LFPB final approach for ILS + TSD + 3D PCD verification
    await app.js(`__bh.obc.exec("obc-f35 fly LFPB final")`);
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
    await app.step("A320 100% piloté depuis Linux (CLI, MCDU, TUI, ND FB0 & LECAM 3D)");

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

    await app.stepDone("A320 piloté depuis Linux · MCDU, ECAM, TUI, ND FB0 & LECAM 3D OK");
    expect(app.cdp.errors).toEqual([]);
  }, 180_000);

  test("switches live to Debian 13 (2 GiB & 4 GiB) and verifies Python, pip, Node, npm, Bun, Pi & Claude Code", async () => {
    await app.step("Debian 13 Trixie (2 GiB / 4 GiB) : Python, pip, Node, npm, Bun, Pi & Claude Code");

    // Switch live from Alpine 3.24 to Debian 13 Trixie
    await app.js(`(() => { __bh.obc.openConsole(); document.querySelector('[data-testid="obc-mode-term"]')?.click(); })()`);
    const debSt = await app.js<{ phase: string; bootMs: number; distro: string; memoryMiB: number }>(`__bh.obc.switchDistro("debian")`);
    expect(debSt.phase).toBe("ready");
    expect(debSt.distro).toBe("debian-13");
    expect(debSt.memoryMiB).toBe(2048);
    metrics.debianBootMs = debSt.bootMs;
    metrics.debianMemoryMiB = debSt.memoryMiB;

    const osRel = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("cat /etc/os-release")`);
    expect(osRel.ok).toBe(true);
    expect(osRel.stdout).toContain("Debian GNU/Linux 13");

    // Install all 7 toolchains on Debian 13 over local Wisp v1 relay
    const tDeb0 = performance.now();
    const debInst = await installAndWait("all");
    metrics.debianInstallMs = Math.round(performance.now() - tDeb0);
    expect(debInst.ok).toBe(true);

    const debVers = await app.js<{ ok: boolean; stdout: string }>(
      `__bh.obc.exec("python3 --version && pip --version && node --version && npm --version && bun --version && pi --version && claude --version")`,
    );
    expect(debVers.ok).toBe(true);
    const dLines = debVers.stdout.trim().split(/\r?\n/);
    metrics.debianTools = {
      python: dLines[0] ?? "",
      pip: dLines[1] ?? "",
      node: dLines[2] ?? "",
      npm: dLines[3] ?? "",
      bun: dLines[4] ?? "",
      pi: dLines[5] ?? "",
      claude: dLines[6] ?? "",
    };
    expect(metrics.debianTools.python).toContain("Python 3");
    expect(metrics.debianTools.pip.toLowerCase()).toContain("pip");
    expect(metrics.debianTools.node).toContain("v");
    expect(metrics.debianTools.npm).toMatch(/^\d+\.\d+/);
    expect(metrics.debianTools.bun).toMatch(/^\d+\.\d+/);
    expect(metrics.debianTools.pi).toMatch(/^\d+\.\d+/);
    expect(metrics.debianTools.claude.toLowerCase()).toContain("claude");

    // Verify native Rust obc-rs binary + OBC scripts & __bh CLI work seamlessly on Debian 13 too
    const debRs = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("obc-rs --version && obc-top --frames 1")`);
    expect(debRs.ok).toBe(true);
    expect(debRs.stdout).toContain("obc-rs");
    expect(debRs.stdout).toContain("OBC-TOP");

    const debBh = await app.js<{ ok: boolean; stdout: string }>(`__bh.obc.exec("bh get fleet.active --raw")`);
    expect(debBh.ok).toBe(true);
    expect(debBh.stdout.trim()).toBe("a320");

    await app.js(`__bh.obc.runScript("obc-diag")`);
    await app.waitFor(`__bh.obc.readScreen().join("\\n").includes("Debian")`, 15_000);
    await Bun.sleep(400);
    await app.shot(`${OUT}/hud-debian-13.png`);

    // Verify 4 GiB RAM option boots cleanly (or falls back gracefully if host caps wasm32 memory)
    await app.js(`__bh.obc.setConfig({ memoryMiB: 4096 })`);
    const st4g = await app.js<{ phase: string; memoryMiB: number; distro: string }>(`__bh.obc.reboot()`);
    expect(st4g.phase).toBe("ready");
    expect(st4g.distro).toBe("debian-13");
    expect(st4g.memoryMiB).toBeGreaterThanOrEqual(2048);
    metrics.ram4gAllocatedMiB = st4g.memoryMiB;

    // Restore default config (alpine, 2048 MiB) & cleanly stop OBC worker before exit
    await app.js(`__bh.obc.setConfig({ distro: "alpine", memoryMiB: 2048 })`);
    await app.js("__bh.obc.stop()");
    const afterStop = await app.js<{ phase: string }>("__bh.obc.status()");
    expect(afterStop.phase).toBe("off");

    await app.stepDone(
      `Debian 13 OK (${metrics.debianBootMs} ms · 4G→${st4g.memoryMiB} MiB): ${metrics.debianTools.python} · pip · Node ${metrics.debianTools.node} · npm · Bun ${metrics.debianTools.bun} · pi ${metrics.debianTools.pi} · Claude`,
    );
    expect(app.cdp.errors).toEqual([]);
  }, 900_000);
});
