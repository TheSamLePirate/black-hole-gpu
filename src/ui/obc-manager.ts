// AAA Linux Machine Manager panel embedded inside the OBC HUD Console.
// Full Admin / Monitor / Unkernel Hardware / Persistent Disk / Wisp Network / Toolchains / Game & Logs suite.

import {
  DEFAULT_PROD_WISP_URL,
  normalizeCpus,
  normalizeDistro,
  normalizeMemoryMiB,
  normalizeWispMode,
  type ObcRuntime,
} from "../obc/runtime";
import type { ObcConfig, ObcDistro, ObcGuestProbe, ObcKernelTelemetry, ObcToolchainProfile, ObcWispMode } from "../obc/types";

export type ObcManagerTab = "monitor" | "system" | "storage" | "network" | "toolchains" | "game";

function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "n/a";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function fmtUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function triggerDownload(bytes: Uint8Array, filename: string, mime = "application/octet-stream") {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export interface ObcManagerCallbacks {
  onApplyVisual: () => void;
  onResetWindow: () => void;
  onCloseAfterApply: () => void;
}

export class ObcMachineManager {
  readonly el: HTMLDivElement;

  private activeTab: ObcManagerTab = "monitor";
  private tabBtns = new Map<ObcManagerTab, HTMLButtonElement>();
  private tabPanes = new Map<ObcManagerTab, HTMLDivElement>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private probing = false;
  private lastProbe: ObcGuestProbe | null = null;

  // Exposed controls (preserve all existing data-testid hooks)
  readonly distroSel: HTMLSelectElement;
  readonly ramSel: HTMLSelectElement;
  readonly cpuSel: HTMLSelectElement;
  readonly resSel: HTMLSelectElement;
  readonly themeSel: HTMLSelectElement;
  readonly syncSel: HTMLSelectElement;
  readonly wispModeSel: HTMLSelectElement;
  readonly wispInput: HTMLInputElement;
  readonly wispStatusEl: HTMLSpanElement;
  readonly jitChk: HTMLInputElement;
  readonly shmChk: HTMLInputElement;
  readonly profileChk: HTMLInputElement;
  readonly persistChk: HTMLInputElement;
  readonly crtChk: HTMLInputElement;
  readonly soundChk: HTMLInputElement;
  readonly fontRange: HTMLInputElement;
  readonly fontValEl: HTMLSpanElement;
  readonly opacityRange: HTMLInputElement;
  readonly opacityValEl: HTMLSpanElement;

  // Dynamic live views
  private kpiGrid: HTMLDivElement;
  private procBody: HTMLTableSectionElement;
  private guestSummaryEl: HTMLDivElement;
  private hostCapsEl: HTMLDivElement;
  private cmdlineEl: HTMLDivElement;
  private profileOutEl: HTMLPreElement;
  private diskKpisEl: HTMLDivElement;
  private mountsBody: HTMLTableSectionElement;
  private diskStatusEl: HTMLSpanElement;
  private netStatsEl: HTMLDivElement;
  private toolGridEl: HTMLDivElement;
  private gameInfoEl: HTMLDivElement;
  private gameStatusEl: HTMLSpanElement;
  private logsPreEl: HTMLPreElement;

  constructor(
    private runtime: ObcRuntime,
    private cbs: ObcManagerCallbacks,
  ) {
    this.el = document.createElement("div");
    this.el.className = "obc-drawer obc-mgr";
    this.el.dataset.testid = "obc-options-drawer";
    this.el.hidden = true;

    const cfg = this.runtime.getConfig();

    const mkBtn = (label: string, onClick: () => void, opts: { cls?: string; testid?: string; title?: string } = {}) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `obc-btn${opts.cls ? ` ${opts.cls}` : ""}`;
      b.textContent = label;
      if (opts.testid) b.dataset.testid = opts.testid;
      if (opts.title) b.title = opts.title;
      b.onclick = onClick;
      return b;
    };

    const mkSelect = (opts: [string, string][], val: string, testid: string) => {
      const s = document.createElement("select");
      s.className = "obc-select";
      s.dataset.testid = testid;
      for (const [v, lbl] of opts) {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = lbl;
        s.append(o);
      }
      s.value = val;
      return s;
    };

    const mkCheck = (label: string, checked: boolean, testid: string) => {
      const wrap = document.createElement("label");
      wrap.className = "obc-check";
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.checked = checked;
      inp.dataset.testid = testid;
      const sp = document.createElement("span");
      sp.textContent = label;
      wrap.append(inp, sp);
      return { wrap, inp };
    };

    const mkField = (label: string, ctrl: HTMLElement) => {
      const f = document.createElement("label");
      f.className = "obc-field";
      const sp = document.createElement("span");
      sp.textContent = label;
      f.append(sp, ctrl);
      return f;
    };

    // ── Header Tab Bar + Quick Apply & Reboot ────────────────────────────────
    const header = document.createElement("div");
    header.className = "obc-mgr-header";
    const tabBar = document.createElement("div");
    tabBar.className = "obc-mgr-tabs";

    const tabs: [ObcManagerTab, string][] = [
      ["monitor", "Monitor"],
      ["system", "System & Unkernel"],
      ["storage", "Disk & Snapshots"],
      ["network", "Network & Wisp"],
      ["toolchains", "Toolchains"],
      ["game", "Game & Logs"],
    ];
    for (const [id, lbl] of tabs) {
      const b = mkBtn(lbl, () => this.selectTab(id), {
        cls: "obc-mgr-tab",
        testid: `obc-mgr-tab-${id}`,
      });
      this.tabBtns.set(id, b);
      tabBar.append(b);
    }

    const applyRebootBtn = mkBtn("Apply & Reboot", () => this.applyHardwareAndReboot(), {
      cls: "on",
      testid: "obc-opt-apply",
      title: "Save all hardware, Unkernel, Disk & Wisp settings and reboot VM if running",
    });
    const refreshAllBtn = mkBtn("↻ Refresh", () => void this.refreshAll(true), {
      testid: "obc-mgr-refresh",
      title: "Refresh live kernel stats, guest OS probe, processes & disk quota",
    });

    const headerActions = document.createElement("div");
    headerActions.className = "obc-mgr-actions";
    headerActions.append(refreshAllBtn, applyRebootBtn);
    header.append(tabBar, headerActions);
    this.el.append(header);

    const panesWrap = document.createElement("div");
    panesWrap.className = "obc-mgr-body";
    this.el.append(panesWrap);

    const mkPane = (id: ObcManagerTab) => {
      const d = document.createElement("div");
      d.className = "obc-mgr-pane";
      d.dataset.testid = `obc-mgr-pane-${id}`;
      d.hidden = id !== this.activeTab;
      this.tabPanes.set(id, d);
      panesWrap.append(d);
      return d;
    };

    // ── TAB 1: MONITOR (Live Kernel Stats, Guest RAM & Processes) ────────────
    const pMon = mkPane("monitor");
    this.kpiGrid = document.createElement("div");
    this.kpiGrid.className = "obc-kpi-grid";
    this.kpiGrid.dataset.testid = "obc-mgr-kpis";

    this.guestSummaryEl = document.createElement("div");
    this.guestSummaryEl.className = "obc-mgr-summary";
    this.guestSummaryEl.textContent = "Boot the Linux OBC to inspect live kernel & OS metrics.";

    const procWrap = document.createElement("div");
    procWrap.className = "obc-table-wrap";
    const procTable = document.createElement("table");
    procTable.className = "obc-table";
    procTable.innerHTML = "<thead><tr><th>PID</th><th>USER</th><th>VSZ</th><th>COMMAND</th><th>SIGNAL</th></tr></thead>";
    this.procBody = document.createElement("tbody");
    procTable.append(this.procBody);
    procWrap.append(procTable);
    pMon.append(this.kpiGrid, this.guestSummaryEl, procWrap);

    // ── TAB 2: SYSTEM & UNKERNEL (Hardware, SMP, JIT, SHM, Profiler) ─────────
    const pSys = mkPane("system");
    this.distroSel = mkSelect(
      [
        ["alpine", "Alpine 3.24 (4 MB, musl, fast)"],
        ["debian", "Debian 13 Trixie (72 MB, glibc)"],
      ],
      cfg.distro,
      "obc-opt-distro",
    );
    this.ramSel = mkSelect(
      [
        ["512", "512 MiB"],
        ["1024", "1 GiB"],
        ["2048", "2 GiB (default)"],
        ["4096", "4 GiB"],
      ],
      String(cfg.memoryMiB),
      "obc-opt-ram",
    );
    this.cpuSel = mkSelect(
      [
        ["1", "1 vCPU (UP)"],
        ["2", "2 vCPUs (SMP)"],
        ["4", "4 vCPUs (SMP)"],
      ],
      String(cfg.cpus),
      "obc-opt-cpus",
    );
    this.resSel = mkSelect(
      [
        ["512x512", "512×512 (Square)"],
        ["640x480", "640×480 (VGA)"],
        ["800x600", "800×600 (SVGA)"],
        ["1024x768", "1024×768 (XGA)"],
      ],
      `${cfg.fbWidth}x${cfg.fbHeight}`,
      "obc-opt-res",
    );

    const jit = mkCheck("Wasm JIT Compiler", cfg.jit, "obc-opt-jit");
    this.jitChk = jit.inp;
    const shm = mkCheck("Shared Mem (/dev/kwshm)", cfg.shm, "obc-opt-shm");
    this.shmChk = shm.inp;
    const prof = mkCheck("CPU Profiler", cfg.profile, "obc-opt-profile");
    this.profileChk = prof.inp;

    const sysRow1 = document.createElement("div");
    sysRow1.className = "obc-drawer-row";
    sysRow1.append(
      mkField("Distro", this.distroSel),
      mkField("RAM", this.ramSel),
      mkField("vCPUs", this.cpuSel),
      mkField("/dev/fb0", this.resSel),
    );
    const sysRow2 = document.createElement("div");
    sysRow2.className = "obc-drawer-row";
    const dumpProfBtn = mkBtn(
      "Dump CPU Profile",
      async () => {
        this.profileOutEl.hidden = false;
        this.profileOutEl.textContent = "Reading Unkernel CPU profile…";
        const rep = await this.runtime.getProfile();
        this.profileOutEl.textContent = rep ?? "Profiler inactive (enable CPU Profiler + Apply & Reboot first).";
      },
      { testid: "obc-mgr-profile-dump" },
    );
    sysRow2.append(jit.wrap, shm.wrap, prof.wrap, dumpProfBtn);

    this.hostCapsEl = document.createElement("div");
    this.hostCapsEl.className = "obc-mgr-summary";
    this.cmdlineEl = document.createElement("div");
    this.cmdlineEl.className = "obc-mgr-code";
    this.profileOutEl = document.createElement("pre");
    this.profileOutEl.className = "obc-mgr-logs";
    this.profileOutEl.hidden = true;
    pSys.append(sysRow1, sysRow2, this.hostCapsEl, this.cmdlineEl, this.profileOutEl);

    // ── TAB 3: DISK & SNAPSHOTS (Persistent IndexedDB /data, Backup/Restore) ─
    const pDisk = mkPane("storage");
    const persist = mkCheck("Persist /data (IndexedDB kwdisk:kwdata-v1)", cfg.persistData, "obc-opt-persist");
    this.persistChk = persist.inp;
    this.diskStatusEl = document.createElement("span");
    this.diskStatusEl.className = "obc-status-pill";
    this.diskStatusEl.dataset.testid = "obc-disk-status";

    const syncDiskBtn = mkBtn(
      "Flush / Sync Disk",
      async () => {
        this.diskStatusEl.textContent = "Syncing…";
        this.diskStatusEl.dataset.ok = "";
        const r = await this.runtime.syncDisk();
        this.diskStatusEl.textContent = r.ok ? `✓ ${r.msg}` : `✕ ${r.msg}`;
        this.diskStatusEl.dataset.ok = r.ok ? "1" : "0";
        void this.refreshDisk();
      },
      { testid: "obc-disk-sync" },
    );

    const exportPilotBtn = mkBtn(
      "Export /home/pilot (.tar.gz)",
      async () => {
        this.diskStatusEl.textContent = "Archiving /home/pilot…";
        const r = await this.runtime.exportPilotArchive();
        this.diskStatusEl.textContent = r.ok ? `✓ ${r.msg}` : `✕ ${r.msg}`;
        this.diskStatusEl.dataset.ok = r.ok ? "1" : "0";
        if (r.ok && r.bytes && r.filename) triggerDownload(r.bytes, r.filename, "application/gzip");
      },
      { testid: "obc-pilot-export" },
    );

    const importPilotInp = document.createElement("input");
    importPilotInp.type = "file";
    importPilotInp.accept = ".tar.gz,.tgz";
    importPilotInp.hidden = true;
    importPilotInp.onchange = async () => {
      const f = importPilotInp.files?.[0];
      if (!f) return;
      this.diskStatusEl.textContent = `Importing ${f.name}…`;
      const r = await this.runtime.importPilotArchive(new Uint8Array(await f.arrayBuffer()));
      this.diskStatusEl.textContent = r.ok ? `✓ ${r.msg}` : `✕ ${r.msg}`;
      this.diskStatusEl.dataset.ok = r.ok ? "1" : "0";
      importPilotInp.value = "";
    };
    const importPilotBtn = mkBtn("Import /home/pilot", () => importPilotInp.click(), { testid: "obc-pilot-import" });

    const exportSnapBtn = mkBtn(
      "Save VM Snapshot (.kwsnap)",
      async () => {
        this.diskStatusEl.textContent = "Capturing VM snapshot…";
        const r = await this.runtime.exportVmSnapshot();
        this.diskStatusEl.textContent = r.ok ? `✓ ${r.msg}` : `✕ ${r.msg}`;
        this.diskStatusEl.dataset.ok = r.ok ? "1" : "0";
        if (r.ok && r.bytes && r.filename) triggerDownload(r.bytes, r.filename);
      },
      { testid: "obc-snap-export" },
    );

    const importSnapInp = document.createElement("input");
    importSnapInp.type = "file";
    importSnapInp.accept = ".kwsnap";
    importSnapInp.hidden = true;
    importSnapInp.onchange = async () => {
      const f = importSnapInp.files?.[0];
      if (!f) return;
      this.diskStatusEl.textContent = `Restoring ${f.name}…`;
      const r = await this.runtime.importVmSnapshot(new Uint8Array(await f.arrayBuffer()));
      this.diskStatusEl.textContent = r.ok ? `✓ ${r.msg}` : `✕ ${r.msg}`;
      this.diskStatusEl.dataset.ok = r.ok ? "1" : "0";
      importSnapInp.value = "";
    };
    const importSnapBtn = mkBtn("Load VM Snapshot", () => importSnapInp.click(), { testid: "obc-snap-import" });

    const resetDiskBtn = mkBtn(
      "Reset /data",
      async () => {
        const res = await this.runtime.resetDataDisk();
        this.diskStatusEl.textContent = res.ok ? `✓ ${res.msg}` : `✕ ${res.msg}`;
        this.diskStatusEl.dataset.ok = res.ok ? "1" : "0";
        this.wispStatusEl.textContent = this.diskStatusEl.textContent;
        this.wispStatusEl.dataset.ok = this.diskStatusEl.dataset.ok;
        void this.refreshDisk();
      },
      { cls: "danger", testid: "obc-reset-data", title: "Wipe persisted IndexedDB /data overlay" },
    );

    const diskRow1 = document.createElement("div");
    diskRow1.className = "obc-drawer-row";
    diskRow1.append(persist.wrap, syncDiskBtn, resetDiskBtn, this.diskStatusEl);

    const diskRow2 = document.createElement("div");
    diskRow2.className = "obc-drawer-row";
    diskRow2.append(exportPilotBtn, importPilotBtn, importPilotInp, exportSnapBtn, importSnapBtn, importSnapInp);

    this.diskKpisEl = document.createElement("div");
    this.diskKpisEl.className = "obc-kpi-grid";

    const mountsWrap = document.createElement("div");
    mountsWrap.className = "obc-table-wrap";
    const mountsTable = document.createElement("table");
    mountsTable.className = "obc-table";
    mountsTable.innerHTML =
      "<thead><tr><th>FILESYSTEM</th><th>SIZE</th><th>USED</th><th>AVAIL</th><th>USE%</th><th>MOUNT</th></tr></thead>";
    this.mountsBody = document.createElement("tbody");
    mountsTable.append(this.mountsBody);
    mountsWrap.append(mountsTable);
    pDisk.append(diskRow1, diskRow2, this.diskKpisEl, mountsWrap);

    // ── TAB 4: NETWORK & WISP (Wisp v1 Proxy, Presets, Probe & NetStats) ─────
    const pNet = mkPane("network");
    this.wispModeSel = mkSelect(
      [
        ["auto", "Auto (dev /__wisp → prod)"],
        ["prod", `Production (${DEFAULT_PROD_WISP_URL})`],
        ["local", "Local Dev Relay (/__wisp)"],
        ["custom", "Custom Wisp URL"],
        ["off", "Disabled (Offline / Air-Gapped)"],
      ],
      cfg.wispMode,
      "obc-opt-wisp-mode",
    );
    this.wispModeSel.onchange = () => {
      const m = normalizeWispMode(this.wispModeSel.value);
      this.runtime.setConfig({ wispMode: m });
      if (m === "prod") this.wispInput.value = DEFAULT_PROD_WISP_URL;
      else if (m === "off") this.wispInput.value = "";
    };

    this.wispInput = document.createElement("input");
    this.wispInput.className = "obc-wisp-input";
    this.wispInput.dataset.testid = "obc-wisp-input";
    this.wispInput.placeholder = "wss://code.samlepirate.org/ (empty = Auto)";
    this.wispInput.value = this.runtime.getWispUrl();

    this.wispStatusEl = document.createElement("span");
    this.wispStatusEl.className = "obc-status-pill";
    this.wispStatusEl.dataset.testid = "obc-wisp-status";

    const testWispBtn = mkBtn(
      "Test Wisp",
      async () => {
        this.wispStatusEl.textContent = "Probing…";
        this.wispStatusEl.dataset.ok = "";
        const res = await this.runtime.testWisp(this.wispInput.value || undefined);
        this.wispStatusEl.textContent = res.ok ? `✓ ${res.msg} (${res.latencyMs}ms)` : `✕ ${res.msg}`;
        this.wispStatusEl.dataset.ok = res.ok ? "1" : "0";
      },
      { testid: "obc-wisp-test" },
    );

    const testCurlBtn = mkBtn(
      "Guest HTTPS Check",
      async () => {
        this.wispStatusEl.textContent = "Running curl in Linux…";
        this.wispStatusEl.dataset.ok = "";
        const r = await this.runtime.exec(
          "curl -fsS --max-time 6 https://code.samlepirate.org/health || wget -qO- https://code.samlepirate.org/health",
          9000,
        );
        this.wispStatusEl.textContent = r.ok
          ? `✓ Guest HTTPS OK (${r.stdout.trim().slice(0, 40)})`
          : `✕ ${r.stderr.trim().slice(0, 50) || "failed"}`;
        this.wispStatusEl.dataset.ok = r.ok ? "1" : "0";
      },
      { testid: "obc-wisp-guest-check" },
    );

    const netRow1 = document.createElement("div");
    netRow1.className = "obc-drawer-row";
    netRow1.append(mkField("Wisp Mode", this.wispModeSel), this.wispInput, testWispBtn, testCurlBtn, this.wispStatusEl);

    this.netStatsEl = document.createElement("div");
    this.netStatsEl.className = "obc-kpi-grid";
    pNet.append(netRow1, this.netStatsEl);

    // ── TAB 5: TOOLCHAINS & APPS ─────────────────────────────────────────────
    const pTools = mkPane("toolchains");
    const toolsTop = document.createElement("div");
    toolsTop.className = "obc-drawer-row";
    toolsTop.append(
      mkBtn("Install All Core (7)", () => void this.runtime.installToolchain("all"), { cls: "on", testid: "obc-mgr-install-all" }),
      mkBtn("+Rust (rustc+cargo)", () => void this.runtime.installToolchain("rust"), { testid: "obc-mgr-install-rust" }),
      mkBtn("Run obc-diag", () => void this.runtime.runScript("diag"), { testid: "obc-mgr-run-diag" }),
      mkBtn("Open bh-tui", () => void this.runtime.runScript("bh-tui"), { testid: "obc-mgr-run-bhtui" }),
    );
    this.toolGridEl = document.createElement("div");
    this.toolGridEl.className = "obc-tool-grid";
    pTools.append(toolsTop, this.toolGridEl);

    // ── TAB 6: GAME BRIDGE, DISPLAY & KERNEL LOGS ────────────────────────────
    const pGame = mkPane("game");
    this.themeSel = mkSelect(
      [
        ["auto", "Auto (Craft)"],
        ["interstellar", "Interstellar Cyan"],
        ["f35", "F-35 Tactical"],
        ["a320", "Airbus ECAM"],
        ["amber", "Retro Amber CRT"],
      ],
      cfg.theme,
      "obc-opt-theme",
    );
    this.syncSel = mkSelect(
      [
        ["interactive", "Interactive"],
        ["strict", "Strict Sim-Clock"],
      ],
      cfg.syncMode,
      "obc-opt-sync",
    );
    const crt = mkCheck("CRT / Phosphor FX", cfg.crtFx, "obc-opt-crt");
    this.crtChk = crt.inp;
    const snd = mkCheck("Audio (/dev/dsp)", cfg.soundEnabled, "obc-opt-sound");
    this.soundChk = snd.inp;

    this.fontRange = document.createElement("input");
    this.fontRange.type = "range";
    this.fontRange.min = "11";
    this.fontRange.max = "16";
    this.fontRange.step = "1";
    this.fontRange.value = String(cfg.fontSize);
    this.fontRange.dataset.testid = "obc-opt-fontsize";
    this.fontValEl = document.createElement("span");
    this.fontValEl.textContent = `${cfg.fontSize}px`;

    this.opacityRange = document.createElement("input");
    this.opacityRange.type = "range";
    this.opacityRange.min = "72";
    this.opacityRange.max = "100";
    this.opacityRange.step = "2";
    this.opacityRange.value = String(Math.round(cfg.panelOpacity * 100));
    this.opacityRange.dataset.testid = "obc-opt-opacity";
    this.opacityValEl = document.createElement("span");
    this.opacityValEl.textContent = `${Math.round(cfg.panelOpacity * 100)}%`;

    // Live-apply visual options immediately
    this.themeSel.onchange = () => {
      this.runtime.setConfig({ theme: this.themeSel.value as ObcConfig["theme"] });
      this.cbs.onApplyVisual();
    };
    this.crtChk.onchange = () => {
      this.runtime.setConfig({ crtFx: this.crtChk.checked });
      this.cbs.onApplyVisual();
    };
    this.syncSel.onchange = () => {
      this.runtime.setConfig({ syncMode: this.syncSel.value === "strict" ? "strict" : "interactive" });
    };
    this.fontRange.oninput = () => {
      const sz = Number(this.fontRange.value) || 13;
      this.fontValEl.textContent = `${sz}px`;
      this.runtime.setConfig({ fontSize: sz });
      this.cbs.onApplyVisual();
    };
    this.opacityRange.oninput = () => {
      const op = (Number(this.opacityRange.value) || 94) / 100;
      this.opacityValEl.textContent = `${Math.round(op * 100)}%`;
      this.runtime.setConfig({ panelOpacity: op });
      this.cbs.onApplyVisual();
    };

    const gRow1 = document.createElement("div");
    gRow1.className = "obc-drawer-row";
    const fontCtrl = document.createElement("span");
    fontCtrl.className = "obc-range-wrap";
    fontCtrl.append(this.fontRange, this.fontValEl);
    const opCtrl = document.createElement("span");
    opCtrl.className = "obc-range-wrap";
    opCtrl.append(this.opacityRange, this.opacityValEl);
    gRow1.append(
      mkField("Theme", this.themeSel),
      mkField("Clock", this.syncSel),
      mkField("Font", fontCtrl),
      mkField("Opacity", opCtrl),
      crt.wrap,
      snd.wrap,
      mkBtn("Reset Window", () => this.cbs.onResetWindow(), { testid: "obc-mgr-reset-win" }),
    );

    this.gameStatusEl = document.createElement("span");
    this.gameStatusEl.className = "obc-status-pill";
    const route = (t: "ranger" | "f35" | "a320") => {
      const r = this.runtime.routeToCockpit(t);
      this.gameStatusEl.textContent = r.ok ? `✓ ${r.msg}` : `✕ ${r.msg}`;
      this.gameStatusEl.dataset.ok = r.ok ? "1" : "0";
    };
    const gRow2 = document.createElement("div");
    gRow2.className = "obc-drawer-row";
    gRow2.append(
      mkBtn("Route → Ranger MFD", () => route("ranger"), { testid: "obc-route-ranger" }),
      mkBtn("Route → F-35 PCD", () => route("f35"), { testid: "obc-route-f35" }),
      mkBtn("Route → A320 MCDU+ECAM", () => route("a320"), { testid: "obc-route-a320" }),
      mkBtn("Clear Logs", () => {
        this.runtime.clearLogs();
        this.renderLogs();
      }),
      this.gameStatusEl,
    );

    this.gameInfoEl = document.createElement("div");
    this.gameInfoEl.className = "obc-mgr-summary";
    this.logsPreEl = document.createElement("pre");
    this.logsPreEl.className = "obc-mgr-logs";
    this.logsPreEl.dataset.testid = "obc-mgr-logs";
    pGame.append(gRow1, gRow2, this.gameInfoEl, this.logsPreEl);

    this.selectTab("monitor");
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(tab?: ObcManagerTab) {
    this.el.hidden = false;
    this.syncFormFromConfig();
    if (tab) this.selectTab(tab);
    this.startPolling();
    void this.refreshAll(true);
  }

  close() {
    this.el.hidden = true;
    this.stopPolling();
  }

  selectTab(tab: ObcManagerTab) {
    this.activeTab = tab;
    for (const [id, b] of this.tabBtns) b.classList.toggle("on", id === tab);
    for (const [id, p] of this.tabPanes) p.hidden = id !== tab;
    this.renderFastStats();
    if (tab === "storage") void this.refreshDisk();
    if (tab === "monitor" || tab === "toolchains" || tab === "storage") void this.refreshGuestProbe(false);
  }

  syncFormFromConfig() {
    const cfg = this.runtime.getConfig();
    this.distroSel.value = cfg.distro;
    this.ramSel.value = String(cfg.memoryMiB);
    this.cpuSel.value = String(cfg.cpus);
    this.resSel.value = `${cfg.fbWidth}x${cfg.fbHeight}`;
    this.themeSel.value = cfg.theme;
    this.syncSel.value = cfg.syncMode;
    this.wispModeSel.value = cfg.wispMode;
    this.jitChk.checked = cfg.jit;
    this.shmChk.checked = cfg.shm;
    this.profileChk.checked = cfg.profile;
    this.persistChk.checked = cfg.persistData;
    this.crtChk.checked = cfg.crtFx;
    this.soundChk.checked = cfg.soundEnabled;
    this.fontRange.value = String(cfg.fontSize);
    this.fontValEl.textContent = `${cfg.fontSize}px`;
    this.opacityRange.value = String(Math.round(cfg.panelOpacity * 100));
    this.opacityValEl.textContent = `${Math.round(cfg.panelOpacity * 100)}%`;
    this.wispInput.value = this.runtime.getWispUrl();
  }

  private applyHardwareAndReboot() {
    const [fw, fh] = this.resSel.value.split("x").map(Number);
    const mem = normalizeMemoryMiB(Number(this.ramSel.value));
    const distro: ObcDistro = normalizeDistro(this.distroSel.value);
    const cpus = normalizeCpus(Number(this.cpuSel.value));
    const wispMode: ObcWispMode = normalizeWispMode(this.wispModeSel.value);
    this.runtime.setConfig({
      distro,
      memoryMiB: mem,
      cpus,
      fbWidth: fw || 512,
      fbHeight: fh || 512,
      jit: this.jitChk.checked,
      shm: this.shmChk.checked,
      profile: this.profileChk.checked,
      persistData: this.persistChk.checked,
      wispMode,
      crtFx: this.crtChk.checked,
      soundEnabled: this.soundChk.checked,
      theme: this.themeSel.value as ObcConfig["theme"],
      syncMode: this.syncSel.value === "strict" ? "strict" : "interactive",
      fontSize: Number(this.fontRange.value) || 13,
      panelOpacity: (Number(this.opacityRange.value) || 94) / 100,
    });
    this.runtime.setWispUrl(this.wispInput.value);
    this.cbs.onApplyVisual();
    this.close();
    this.cbs.onCloseAfterApply();
    if (this.runtime.status().phase === "ready") void this.runtime.reboot();
  }

  private startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      if (!this.el.hidden) this.renderFastStats();
    }, 1000);
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async refreshAll(forceProbe = false) {
    this.renderFastStats();
    await Promise.all([this.refreshDisk(), this.refreshGuestProbe(forceProbe)]);
  }

  private mkKpi(label: string, value: string, sub = "", ok?: boolean): HTMLDivElement {
    const card = document.createElement("div");
    card.className = "obc-kpi";
    const v = document.createElement("div");
    v.className = `obc-kpi-val${ok === true ? " ok" : ok === false ? " warn" : ""}`;
    v.textContent = value;
    const l = document.createElement("div");
    l.className = "obc-kpi-lbl";
    l.textContent = label;
    card.append(l, v);
    if (sub) {
      const s = document.createElement("div");
      s.className = "obc-kpi-sub";
      s.textContent = sub;
      card.append(s);
    }
    return card;
  }

  private renderFastStats() {
    const st = this.runtime.status();
    const ks: ObcKernelTelemetry = this.runtime.kernelStats();
    const tel = this.runtime.telemetry();

    // Tab 1: Monitor KPIs
    this.kpiGrid.replaceChildren(
      this.mkKpi(
        "VM STATE",
        st.phase.toUpperCase(),
        ks.running ? `Uptime ${fmtUptime(ks.uptimeMs)} · Boot ${st.bootMs ?? 0}ms` : "Standby",
        ks.running,
      ),
      this.mkKpi(
        "RAM / vCPU",
        `${ks.memoryMiB} MiB · ${ks.cpus} CPU`,
        this.lastProbe
          ? `Used ${this.lastProbe.memUsedMiB} / ${this.lastProbe.memTotalMiB} MiB`
          : `${ks.memory64 ? "wasm64" : "wasm32"} · ${ks.transport}`,
      ),
      this.mkKpi(
        "WASM JIT",
        ks.jit ? `${ks.jit.live} live / ${ks.jit.compiled}` : st.config.jit ? "ENABLED" : "INTERP",
        ks.jit ? `max ${ks.jit.maxLive} · fail ${ks.jit.failed}` : `Compile ${ks.compileMs}ms`,
        ks.jit ? ks.jit.enabled : undefined,
      ),
      this.mkKpi(
        "BLOCK I/O",
        ks.block ? `${fmtBytes(ks.block.bytesRead)} R` : "—",
        ks.block ? `${fmtBytes(ks.block.bytesWritten)} W · ${ks.block.flushes} flush` : "Idle",
      ),
      this.mkKpi(
        "WISP NET",
        ks.net ? `${ks.net.tcpOpened} TCP · ${ks.net.dns} DNS` : st.netEnabled ? "READY" : "OFFLINE",
        ks.net ? `RX ${ks.net.rx} · TX ${ks.net.tx} pkts` : ks.activeWispUrl || "No relay",
        st.netEnabled,
      ),
      this.mkKpi(
        "VSOCK & /dev/fb0",
        ks.display && st.fbActive ? `${st.fbWidth}×${st.fbHeight} @${st.fbFps}Hz` : `VSOCK ${ks.vsock?.open ?? 0} open`,
        ks.vsock ? `In ${fmtBytes(ks.vsock.bytesIn)} · Out ${fmtBytes(ks.vsock.bytesOut)}` : `Cmds ${st.commandsHandled}`,
      ),
    );

    // Tab 2: Host capabilities & cmdline
    this.hostCapsEl.textContent = `Host: worker=true · transport=${ks.transport} · memory64=${ks.memory64} · crossOriginIsolated=${ks.crossOriginIsolated} · SMP=${ks.cpuBlocker ? `1 CPU (${ks.cpuBlocker})` : "available"} · switches=${ks.switches} · yields=${ks.yields}`;
    this.cmdlineEl.textContent = ks.cmdline ? `cmdline: ${ks.cmdline}` : "cmdline: (boot VM to inspect active kernel cmdline)";

    // Tab 4: Network KPIs
    this.netStatsEl.replaceChildren(
      this.mkKpi("STATUS", st.netEnabled ? "CONNECTED" : "OFFLINE", ks.activeWispUrl || "Wisp disabled", st.netEnabled),
      this.mkKpi("PACKETS", ks.net ? `${ks.net.rx} RX / ${ks.net.tx} TX` : "0 / 0", "Virtio kwnet frames"),
      this.mkKpi("TCP STREAMS", ks.net ? String(ks.net.tcpOpened) : "0", "Opened over Wisp v1"),
      this.mkKpi("DNS QUERIES", ks.net ? String(ks.net.dns) : "0", "Resolved via relay"),
    );

    // Tab 6: Game bridge info + Logs
    this.gameInfoEl.textContent = `Craft: ${tel.vessel_id.toUpperCase()} (${tel.vessel_kind}) @ ${tel.body.toUpperCase()} · dτ/dt=${tel.dtau_dt.toFixed(6)} · warp=${tel.warp}x · /obc/cmd=${st.commandsHandled} · vsock=${st.vsockClients}`;
    this.renderLogs();
  }

  private renderLogs() {
    const logs = this.runtime.getLogs();
    this.logsPreEl.textContent = logs.length ? logs.join("\n") : "[OBC] No host kernel logs yet.";
    this.logsPreEl.scrollTop = this.logsPreEl.scrollHeight;
  }

  private async refreshDisk() {
    const info = await this.runtime.diskInfo();
    const quotaPct =
      info.storageUsageBytes !== null && info.storageQuotaBytes
        ? `${((info.storageUsageBytes / info.storageQuotaBytes) * 100).toFixed(1)}%`
        : "n/a";
    this.diskKpisEl.replaceChildren(
      this.mkKpi(
        "PERSIST MODE",
        info.persistData ? "INDEXEDDB" : "EPHEMERAL",
        info.persistData ? "kwdisk:kwdata-v1" : "RAM snapshot",
        info.persistData,
      ),
      this.mkKpi("IDB BLOCKS", info.idbBlocks !== null ? String(info.idbBlocks) : "n/a", "Saved 4 KiB blocks"),
      this.mkKpi("BROWSER QUOTA", fmtBytes(info.storageUsageBytes), `of ${fmtBytes(info.storageQuotaBytes)} (${quotaPct})`),
      this.mkKpi(
        "LAST SYNC",
        info.lastSyncAt ? new Date(info.lastSyncAt).toLocaleTimeString() : "Not synced",
        info.hasSnapshot ? "RAM snapshot held" : "Live disk",
      ),
    );
  }

  private async refreshGuestProbe(force: boolean) {
    if (this.probing || (!force && this.lastProbe && this.runtime.status().phase !== "ready")) return;
    if (this.runtime.status().phase !== "ready") return;
    this.probing = true;
    try {
      const p = await this.runtime.probeGuest();
      if (!p) return;
      this.lastProbe = p;
      this.guestSummaryEl.textContent = `${p.distro} · ${p.uname} · up ${p.uptime} · load ${p.loadAvg} · RAM ${p.memUsedMiB}/${p.memTotalMiB} MiB (${p.memAvailMiB} MiB free)`;

      // Processes table
      this.procBody.replaceChildren();
      for (const proc of p.processes) {
        const tr = document.createElement("tr");
        const td = (txt: string) => {
          const c = document.createElement("td");
          c.textContent = txt;
          return c;
        };
        tr.append(td(String(proc.pid)), td(proc.user), td(proc.mem), td(proc.cmd));
        const actTd = document.createElement("td");
        if (proc.pid > 1) {
          const termBtn = document.createElement("button");
          termBtn.type = "button";
          termBtn.className = "obc-btn obc-btn-xs";
          termBtn.textContent = "TERM";
          termBtn.onclick = async () => {
            await this.runtime.killProcess(proc.pid, "TERM");
            void this.refreshGuestProbe(true);
          };
          const killBtn = document.createElement("button");
          killBtn.type = "button";
          killBtn.className = "obc-btn obc-btn-xs danger";
          killBtn.textContent = "KILL";
          killBtn.onclick = async () => {
            await this.runtime.killProcess(proc.pid, "KILL");
            void this.refreshGuestProbe(true);
          };
          actTd.append(termBtn, killBtn);
        } else {
          actTd.textContent = "init";
        }
        tr.append(actTd);
        this.procBody.append(tr);
      }

      // Mounts table
      this.mountsBody.replaceChildren();
      for (const m of p.mounts) {
        const tr = document.createElement("tr");
        for (const v of [m.fs, m.size, m.used, m.avail, m.pct, m.mount]) {
          const c = document.createElement("td");
          c.textContent = v;
          tr.append(c);
        }
        this.mountsBody.append(tr);
      }

      // Toolchains status grid
      const toolDefs: { key: string; label: string; install?: ObcToolchainProfile }[] = [
        { key: "obc-rs", label: "obc-rs (Rust+Ratatui)" },
        { key: "pilot-kit", label: "/home/pilot Docs+Skills" },
        { key: "python3", label: "Python 3", install: "python" },
        { key: "pip", label: "pip", install: "python" },
        { key: "node", label: "Node.js", install: "node" },
        { key: "npm", label: "npm", install: "node" },
        { key: "bun", label: "Bun", install: "bun" },
        { key: "rustc", label: "Rust (rustc)", install: "rust" },
        { key: "cargo", label: "Cargo", install: "rust" },
        { key: "pi", label: "Pi Agent", install: "pi" },
        { key: "claude", label: "Claude Code", install: "claude" },
      ];
      this.toolGridEl.replaceChildren();
      for (const t of toolDefs) {
        const ver = p.tools[t.key] ?? "off";
        const ok = ver !== "off";
        const row = document.createElement("div");
        row.className = "obc-tool-card";
        const left = document.createElement("div");
        const nm = document.createElement("div");
        nm.className = "obc-tool-name";
        nm.textContent = t.label;
        const vv = document.createElement("div");
        vv.className = `obc-tool-ver${ok ? " ok" : ""}`;
        vv.textContent = ok ? ver : "not installed";
        left.append(nm, vv);
        row.append(left);
        if (t.install && !ok) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "obc-btn obc-btn-xs";
          btn.textContent = "Install";
          btn.onclick = () => void this.runtime.installToolchain(t.install!);
          row.append(btn);
        }
        this.toolGridEl.append(row);
      }

      this.renderFastStats();
    } finally {
      this.probing = false;
    }
  }

  dispose() {
    this.stopPolling();
  }
}
