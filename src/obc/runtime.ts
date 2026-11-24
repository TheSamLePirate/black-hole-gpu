// Lazy-booting AAA Linux On-Board Computer (OBC) runtime powered by Unkernel (WASM Linux 7.x + aarch64 JIT).
// Zero startup cost: unkernel/web, unkernel.wasm, and alpine.erofs are only loaded on first `boot()`.
// Runs inside a dedicated Web Worker (`worker: true`) with:
//   - 9p host mount (/obc) + AF_VSOCK:4747 JSONL avionics bus
//   - /dev/fb0 XRGB8888 live framebuffer + interactive evdev mouse/keyboard forwarding
//   - /dev/dsp & ALSA audio output bridged to WebAudio (opt-in)
//   - Live VM snapshot suspend/resume & persistent IndexedDB /data management
//   - File explorer / script editor API for /home/pilot & /obc/scripts
//   - Wisp v1 connectivity tester & persistent user configuration

import type { DisplayMode, KernelHandle, KernelSnapshot, Pty, SoundChunk } from "unkernel/web";
import { store } from "../util/storage";
import { startObcVsockServer, wireObcMountFs, type ObcHostAdapter, type ObcMountHandle, type ObcVsockHandle } from "./bridge";
import type { ObcDrawSource } from "./fb-renderer";
import { createObcHostCommands } from "./host-commands";
import { emptyTelemetry, normalizeWispUrl } from "./protocol";
import { findObcScript, loadProjectScripts, OBC_SCRIPTS } from "./scripts-catalog";
import { TermBuffer } from "./term-buffer";
import {
  DEFAULT_OBC_CONFIG,
  type ObcConfig,
  type ObcCpuCount,
  type ObcCrewSnapshot,
  type ObcDiskInfo,
  type ObcDistro,
  type ObcGuestMount,
  type ObcGuestProbe,
  type ObcGuestProcess,
  type ObcKernelTelemetry,
  type ObcMemoryMiB,
  type ObcPhase,
  type ObcStatus,
  type ObcTelemetry,
  type ObcTerminalTabInfo,
  type ObcToolchainProfile,
  type ObcViewMode,
  type ObcWarmupState,
  type ObcWispMode,
} from "./types";

const WISP_STORAGE_KEY = "kerr.obc.wisp";
const CFG_STORAGE_KEY = "kerr.obc.cfg";
export const DEFAULT_PROD_WISP_URL = "wss://code.samlepirate.org/";
const FB_POLL_MS = 33; // up to 30 Hz smooth real-time framebuffer updates while /dev/fb0 is open

export function normalizeMemoryMiB(raw: unknown): ObcMemoryMiB {
  if (raw === 512 || raw === 1024 || raw === 2048 || raw === 4096) return raw;
  return DEFAULT_OBC_CONFIG.memoryMiB;
}

export function normalizeCpus(raw: unknown): ObcCpuCount {
  if (raw === 1 || raw === 2 || raw === 4) return raw;
  return DEFAULT_OBC_CONFIG.cpus;
}

export function normalizeWispMode(raw: unknown): ObcWispMode {
  if (raw === "auto" || raw === "prod" || raw === "local" || raw === "custom" || raw === "off") return raw;
  return DEFAULT_OBC_CONFIG.wispMode;
}

export function normalizeDistro(raw: unknown): ObcDistro {
  return raw === "debian" ? "debian" : "alpine";
}

export function distroLabel(distro: ObcDistro): string {
  return distro === "debian" ? "debian-13" : "alpine-3.24";
}

export interface ObcFbFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  rev: number;
}

function loadSavedConfig(): ObcConfig {
  try {
    const raw = store.get(CFG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OBC_CONFIG };
    const o = JSON.parse(raw) as Partial<ObcConfig>;
    const distro = normalizeDistro(o.distro);
    const mem = normalizeMemoryMiB(o.memoryMiB);
    const fbWidth =
      typeof o.fbWidth === "number" && o.fbWidth >= 256 && o.fbWidth <= 1024 ? Math.round(o.fbWidth) : DEFAULT_OBC_CONFIG.fbWidth;
    const fbHeight =
      typeof o.fbHeight === "number" && o.fbHeight >= 256 && o.fbHeight <= 1024 ? Math.round(o.fbHeight) : DEFAULT_OBC_CONFIG.fbHeight;
    const theme =
      o.theme === "auto" || o.theme === "interstellar" || o.theme === "f35" || o.theme === "a320" || o.theme === "amber" ? o.theme : "auto";
    return {
      distro,
      memoryMiB: mem,
      cpus: normalizeCpus(o.cpus),
      fbWidth,
      fbHeight,
      jit: typeof o.jit === "boolean" ? o.jit : DEFAULT_OBC_CONFIG.jit,
      shm: typeof o.shm === "boolean" ? o.shm : DEFAULT_OBC_CONFIG.shm,
      profile: typeof o.profile === "boolean" ? o.profile : DEFAULT_OBC_CONFIG.profile,
      persistData: typeof o.persistData === "boolean" ? o.persistData : DEFAULT_OBC_CONFIG.persistData,
      wispMode: normalizeWispMode(o.wispMode),
      crtFx: typeof o.crtFx === "boolean" ? o.crtFx : DEFAULT_OBC_CONFIG.crtFx,
      soundEnabled: typeof o.soundEnabled === "boolean" ? o.soundEnabled : DEFAULT_OBC_CONFIG.soundEnabled,
      termMouse: typeof o.termMouse === "boolean" ? o.termMouse : DEFAULT_OBC_CONFIG.termMouse,
      theme,
      syncMode: o.syncMode === "strict" ? "strict" : "interactive",
      fontSize:
        typeof o.fontSize === "number" && o.fontSize >= 11 && o.fontSize <= 16 ? Math.round(o.fontSize) : DEFAULT_OBC_CONFIG.fontSize,
      panelOpacity:
        typeof o.panelOpacity === "number" && o.panelOpacity >= 0.72 && o.panelOpacity <= 1
          ? Math.round(o.panelOpacity * 100) / 100
          : DEFAULT_OBC_CONFIG.panelOpacity,
    };
  } catch {
    return { ...DEFAULT_OBC_CONFIG };
  }
}

interface ObcPtyTabInternal {
  id: string;
  title: string;
  cmd: string | null;
  pty: Pty;
  running: boolean;
  exitCode: number | null;
  replayChunks: Uint8Array[];
  replayBytes: number;
  listeners: Set<(bytes: Uint8Array) => void>;
}

export class ObcRuntime {
  private vm: KernelHandle | null = null;
  private bootPromise: Promise<ObcStatus> | null = null;
  private savedSnapshot: KernelSnapshot | null = null;
  private hibernatedState: { activeScript: string | null } | null = null;
  private vsockHandle: ObcVsockHandle | null = null;
  private mountHandle: ObcMountHandle | null = null;
  private fbTimer: ReturnType<typeof setInterval> | null = null;
  private crewTimer: ReturnType<typeof setInterval> | null = null;
  private bc: BroadcastChannel | null = null;

  // WebAudio playback state for guest /dev/dsp & ALSA
  private audioCtx: AudioContext | null = null;
  private audioNextTime = 0;

  private phase: ObcPhase = "off";
  private bootMs: number | null = null;
  private config: ObcConfig = loadSavedConfig();
  private actualMemoryMiB: number = this.config.memoryMiB;
  private activeCpus = 1;
  private transport = "none";
  private warmupState: ObcWarmupState = "idle";
  private hostCommandNames: string[] = [];
  private ptyTabs = new Map<string, ObcPtyTabInternal>();
  private tabListeners = new Set<() => void>();
  private currentTabId = "main";
  private nextTabSeq = 1;
  private fbMode: DisplayMode | null = null;
  private fbFrame: ObcFbFrame | null = null;
  private fbRev = 0;
  private fbFramesInWindow = 0;
  private fbWindowStart = 0;
  private fbFps = 0;
  private lastError: string | null = null;
  private commandsHandled = 0;
  private activeScript: string | null = null;
  private wispUrl = "";
  private activeWispUrl = "";
  private netEnabled = false;
  private lastSyncAt: number | null = null;
  private cpuBlocker: string | null = null;
  private hostLogs: string[] = [];
  private termCols = 100;
  private termRows = 26;
  private crewSeq = 0;
  private lastCrewTermRev = -1;

  /** Console HUD UI state mirrored here so __bh.obc & TARS stay consistent. */
  consoleOpen = false;
  viewMode: ObcViewMode = "term";

  /** Pure VT100 terminal screen mirror (100×26) for 3D cockpit displays, Crew, MCDU, and __bh.obc.readScreen(). */
  readonly term = new TermBuffer(100, 26);

  private outListeners = new Set<(bytes: Uint8Array) => void>();
  private stateListeners = new Set<() => void>();
  private replayChunks: Uint8Array[] = [];
  private replayBytes = 0;

  private adapter: ObcHostAdapter;
  private onConsoleToggle: ((open: boolean) => void) | null = null;

  constructor(adapter?: ObcHostAdapter) {
    this.adapter = adapter ?? {
      sampleTelemetry: emptyTelemetry,
      executeCommand: () => ({ ok: false, msg: "no simulator host attached" }),
    };
    this.wispUrl = normalizeWispUrl(store.get(WISP_STORAGE_KEY) ?? "");
    this.initBroadcastChannel();
  }

  setAdapter(adapter: ObcHostAdapter) {
    this.adapter = adapter;
  }

  setConsoleController(fn: (open: boolean) => void) {
    this.onConsoleToggle = fn;
  }

  getConfig(): ObcConfig {
    return { ...this.config };
  }

  setConfig(partial: Partial<ObcConfig>): ObcConfig {
    const next: ObcConfig = { ...this.config, ...partial };
    next.distro = normalizeDistro(next.distro);
    next.memoryMiB = normalizeMemoryMiB(next.memoryMiB);
    next.cpus = normalizeCpus(next.cpus);
    next.wispMode = normalizeWispMode(next.wispMode);
    next.fbWidth = Math.max(256, Math.min(1024, Math.round(next.fbWidth)));
    next.fbHeight = Math.max(256, Math.min(1024, Math.round(next.fbHeight)));
    next.fontSize = Math.max(11, Math.min(16, Math.round(next.fontSize)));
    next.panelOpacity = Math.max(0.72, Math.min(1, Math.round(next.panelOpacity * 100) / 100));
    this.config = next;
    if (this.phase !== "ready") this.actualMemoryMiB = next.memoryMiB;
    try {
      store.set(CFG_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota
    }
    this.emitState();
    return { ...this.config };
  }

  /** Switch Linux distribution ("alpine" or "debian") and reboot if currently running. */
  async switchDistro(distro: ObcDistro): Promise<ObcStatus> {
    const target = normalizeDistro(distro);
    const changed = this.config.distro !== target;
    this.setConfig({ distro: target });
    if (changed && (this.phase === "ready" || this.phase === "suspended")) {
      return this.reboot();
    }
    return this.status();
  }

  get displayRev(): number {
    return this.term.rev + this.fbRev * 100003;
  }

  get fbActive(): boolean {
    return this.fbMode !== null && this.fbFrame !== null;
  }

  get currentFbFrame(): ObcFbFrame | null {
    return this.fbMode ? this.fbFrame : null;
  }

  drawSource(): ObcDrawSource {
    const t = this.adapter.sampleTelemetry();
    return {
      phase: this.phase,
      term: this.term,
      fbFrame: this.fbMode ? this.fbFrame : null,
      fbFps: this.fbFps,
      dtauDt: t.dtau_dt,
      activeScript: this.activeScript,
      lastError: this.lastError,
      bootMs: this.bootMs,
      crtFx: this.config.crtFx,
      themeOverride: this.config.theme,
      vessel: t.vessel_id,
      body: t.body,
      altMsl: t.position.altitude_msl_m,
      tasMps: t.flight.true_airspeed_mps,
    };
  }

  onOutput(fn: (bytes: Uint8Array) => void): () => void {
    this.outListeners.add(fn);
    for (const chunk of this.replayChunks) fn(chunk);
    return () => this.outListeners.delete(fn);
  }

  onState(fn: () => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private emitState() {
    for (const fn of this.stateListeners) fn();
    this.broadcastCrewSnapshot();
  }

  private pushOutput(bytes: Uint8Array) {
    this.term.write(bytes);
    this.replayChunks.push(bytes);
    this.replayBytes += bytes.byteLength;
    while (this.replayBytes > 65_536 && this.replayChunks.length > 1) {
      const drop = this.replayChunks.shift()!;
      this.replayBytes -= drop.byteLength;
    }
    for (const fn of this.outListeners) fn(bytes);
  }

  private async resolveWispUrl(): Promise<string> {
    if (this.config.wispMode === "off") return "";
    if (this.config.wispMode === "prod") return DEFAULT_PROD_WISP_URL;
    if (this.config.wispMode === "local") {
      if (typeof location === "undefined") return "";
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      return `${proto}//${location.host}/__wisp`;
    }
    if (this.config.wispMode === "custom") return this.wispUrl || DEFAULT_PROD_WISP_URL;
    // "auto": explicit custom URL wins, else dev /__wisp when available, else production Wisp server
    if (this.wispUrl) return this.wispUrl;
    if (typeof location === "undefined") return DEFAULT_PROD_WISP_URL;
    try {
      const r = await fetch("/__wisp", { method: "GET" });
      if (r.ok) {
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        return `${proto}//${location.host}/__wisp`;
      }
    } catch {
      // no local dev wisp relay — fall back to production Portainer Wisp server
    }
    return DEFAULT_PROD_WISP_URL;
  }

  /** Probe a Wisp v1 WebSocket server (expects initial CONTINUE packet 0x03 on stream 0). */
  async testWisp(overrideUrl?: string): Promise<{ ok: boolean; url: string; latencyMs: number; msg: string }> {
    const url = overrideUrl ? normalizeWispUrl(overrideUrl) : await this.resolveWispUrl();
    if (!url) return { ok: false, url: "", latencyMs: 0, msg: "No Wisp URL configured" };
    const t0 = performance.now();
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean, msg: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {}
        resolve({ ok, url, latencyMs: Math.round(performance.now() - t0), msg });
      };
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      const timer = setTimeout(() => finish(false, "timeout (3s)"), 3000);
      ws.onmessage = (ev) => {
        const buf = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : null;
        if (buf && buf.byteLength >= 9 && buf[0] === 0x03) {
          finish(true, "Wisp v1 CONTINUE OK");
        } else {
          finish(false, "unexpected packet");
        }
      };
      ws.onerror = () => finish(false, "connection error");
      ws.onclose = () => finish(false, "closed before handshake");
    });
  }

  setWispUrl(raw: string): string {
    const clean = normalizeWispUrl(raw);
    this.wispUrl = clean;
    if (clean) store.set(WISP_STORAGE_KEY, clean);
    else store.remove(WISP_STORAGE_KEY);
    this.emitState();
    return clean;
  }

  getWispUrl(): string {
    return this.wispUrl;
  }

  openConsole() {
    this.consoleOpen = true;
    this.onConsoleToggle?.(true);
    this.emitState();
  }

  closeConsole() {
    this.consoleOpen = false;
    this.onConsoleToggle?.(false);
    this.emitState();
  }

  toggleConsole(): boolean {
    if (this.consoleOpen) this.closeConsole();
    else this.openConsole();
    return this.consoleOpen;
  }

  setViewMode(mode: ObcViewMode) {
    this.viewMode = mode;
    this.emitState();
  }

  status(): ObcStatus {
    return {
      phase: this.phase,
      bootMs: this.bootMs,
      memoryMiB: this.phase === "ready" ? this.actualMemoryMiB : this.config.memoryMiB,
      distro: distroLabel(this.config.distro),
      arch: "aarch64",
      worker: true,
      transport: this.transport,
      fbActive: this.fbActive,
      fbWidth: this.fbMode?.width ?? 0,
      fbHeight: this.fbMode?.height ?? 0,
      fbFps: this.fbFps,
      hasSnapshot: this.savedSnapshot !== null || this.hibernatedState !== null,
      wispUrl: this.wispUrl,
      netEnabled: this.netEnabled,
      lastError: this.lastError,
      vsockClients: this.vsockHandle?.clients ?? 0,
      commandsHandled: this.commandsHandled,
      consoleOpen: this.consoleOpen,
      viewMode: this.viewMode,
      activeScript: this.activeScript,
      config: { ...this.config },
    };
  }

  telemetry(): ObcTelemetry {
    return this.adapter.sampleTelemetry();
  }

  readScreen(): string[] {
    return this.term.lines();
  }

  scripts() {
    return [...OBC_SCRIPTS];
  }

  crewSnapshot(): ObcCrewSnapshot {
    const t = this.adapter.sampleTelemetry();
    return {
      phase: this.phase,
      distro: distroLabel(this.config.distro),
      fbActive: this.fbActive,
      dtauDt: t.dtau_dt,
      activeScript: this.activeScript,
      lines: this.term.tail(20),
      cursorRow: this.term.row,
      cursorCol: this.term.col,
      seq: ++this.crewSeq,
    };
  }

  /** Export the current `/dev/fb0` frame as a PNG data URL (null if `/dev/fb0` is not active). */
  async captureFbDataUrl(): Promise<string | null> {
    const fb = this.currentFbFrame;
    if (!fb || typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = fb.width;
    c.height = fb.height;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(fb.data), fb.width, fb.height), 0, 0);
    return c.toDataURL("image/png");
  }

  /** Forward normalized [0..1] pointer coordinates & click events into Linux `/dev/input/event*` (evdev). */
  sendPointer(nx: number, ny: number, buttonDown?: boolean) {
    if (!this.vm?.evdev) return;
    const absX = Math.max(0, Math.min(32767, Math.round(nx * 32767)));
    const absY = Math.max(0, Math.min(32767, Math.round(ny * 32767)));
    this.vm.evdev.moveTo(absX, absY);
    if (buttonDown !== undefined) {
      this.vm.evdev.tabletButton(0x110 /* BTN_LEFT */, buttonDown);
    }
  }

  sendWheel(deltaY: number) {
    if (!this.vm?.evdev) return;
    this.vm.evdev.wheel(deltaY > 0 ? -1 : 1);
  }

  /** Lazy-boot the embedded Linux kernel inside its dedicated Web Worker. Safe to call repeatedly. */
  async boot(restore?: KernelSnapshot): Promise<ObcStatus> {
    if (this.phase === "ready" && this.vm && !restore) return this.status();
    if (this.bootPromise) return this.bootPromise;

    this.bootPromise = this.doBoot(restore).finally(() => {
      this.bootPromise = null;
    });
    return this.bootPromise;
  }

  private async doBoot(restore?: KernelSnapshot): Promise<ObcStatus> {
    const t0 = performance.now();
    this.phase = "booting";
    this.lastError = null;
    this.fbMode = null;
    this.fbFrame = null;
    this.fbFps = 0;
    if (!restore) {
      this.term.clear();
      this.replayChunks = [];
      this.replayBytes = 0;
      const label = distroLabel(this.config.distro);
      this.pushOutput(
        new TextEncoder().encode(
          `\x1b[1;36m[OBC] Booting Unkernel Linux 7.x (${label} · aarch64 · ${this.config.memoryMiB}MiB · ${this.config.fbWidth}×${this.config.fbHeight}${this.config.jit ? " · JIT" : ""})...\r\n\x1b[0m`,
        ),
      );
    } else {
      this.pushOutput(new TextEncoder().encode("\x1b[1;33m[OBC] Resuming VM snapshot...\r\n\x1b[0m"));
    }
    this.emitState();

    try {
      const mod = await import("unkernel/web");
      const support = await mod.checkSupport();
      if (!support.ok) {
        throw new Error(`Browser missing JSPI/WASM support: ${support.problems.join("; ")}`);
      }

      const base = new URL("./", location.href);
      const loadRustBinary = async (): Promise<Uint8Array | null> => {
        try {
          const r = await fetch(new URL("obc/obc-rs", base).toString());
          if (!r.ok) return null;
          return new Uint8Array(await r.arrayBuffer());
        } catch {
          return null;
        }
      };

      const [projectFiles, effectiveWisp, rustBinary] = await Promise.all([
        loadProjectScripts(new URL("obc/scripts", base).toString(), new URL("obc/pilot-kit", base).toString()),
        this.resolveWispUrl(),
        loadRustBinary(),
      ]);
      this.activeWispUrl = effectiveWisp;
      this.netEnabled = Boolean(effectiveWisp);
      this.cpuBlocker = mod.webCpuBlocker({ worker: true }) ?? null;
      const iso = typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : false;
      const hwCores =
        typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : 4;
      const maxSmp = Math.max(1, Math.min(4, Math.floor(hwCores / 2) || 1));
      const requestedCpus = iso && !this.cpuBlocker ? Math.max(1, Math.min(this.config.cpus, maxSmp)) : 1;

      const memFs = new mod.MemoryFs();
      this.mountHandle = wireObcMountFs(
        memFs,
        this.adapter,
        () => this.status(),
        projectFiles.scripts,
        projectFiles.lib,
        () => {
          this.commandsHandled++;
        },
        rustBinary,
        projectFiles.pilotKit,
        { cols: this.termCols, rows: this.termRows },
      );

      const hostCommands = createObcHostCommands({
        adapter: this.adapter,
        getStatus: () => this.status(),
        getKernelStats: () => this.kernelStats(),
        getWarmupState: () => this.warmupState,
        getHostCommandNames: () => [...this.hostCommandNames],
      });
      this.hostCommandNames = Object.keys(hostCommands);
      this.warmupState = "idle";

      const kernelUrl = new URL("obc/unkernel.wasm", base).toString();
      const distroFile = this.config.distro === "debian" ? "obc/debian.erofs" : "obc/alpine.erofs";
      const distroUrl = new URL(distroFile, base).toString();
      let lastPct = -1;

      const vm = await mod.createKernel({
        worker: true,
        kernel: kernelUrl,
        distro: distroUrl,
        ...(restore ? { restore } : {}),
        memoryMiB: this.config.memoryMiB,
        memoryFallbackMiB: [2048, 1024, 512, 256],
        cpus: requestedCpus,
        jit: this.config.jit,
        shm: this.config.shm,
        profile: this.config.profile,
        consoleSize: { cols: this.termCols, rows: this.termRows },
        disks: [{ kind: "data", template: "bundled", mode: this.config.persistData ? "persistent" : "snapshot" }],
        mounts: { "/obc": memFs },
        commands: hostCommands,
        display: { width: this.config.fbWidth, height: this.config.fbHeight },
        vsock: true,
        ...(this.config.soundEnabled
          ? {
              sound: {
                onChunk: (chunk: SoundChunk) => this.playAudioChunk(mod.pcmToFloat32, chunk),
              },
            }
          : {}),
        ...(effectiveWisp ? { net: { kind: "net" as const, backend: { kind: "wisp" as const, servers: [effectiveWisp] } } } : {}),
        log: (msg) => this.pushLog(msg),
        onOutput: (bytes) => this.pushOutput(bytes),
        onDisplay: (mode) => this.handleDisplayChange(mode),
        onProgress: (p) => {
          if (p.stage === "download" && p.loaded && p.total) {
            const pct = Math.min(100, Math.floor((p.loaded / p.total) * 4) * 25);
            if (pct > lastPct && pct > 0) {
              lastPct = pct;
              this.pushOutput(new TextEncoder().encode(`\x1b[2;36m[OBC] Loading kernel... ${pct}%\r\n\x1b[0m`));
            }
          }
        },
      });

      this.vm = vm;
      this.actualMemoryMiB = vm.memoryMiB || this.config.memoryMiB;
      this.activeCpus = vm.stats().cpus ?? requestedCpus;
      this.transport = vm.transport;
      if (vm.vsock) {
        this.vsockHandle = startObcVsockServer(vm.vsock, this.adapter, () => {
          this.commandsHandled++;
        });
      }

      if (!restore) {
        await this.configureGuestEnvironment(vm);
      }
      // Push exact live xterm dimensions into the freshly booted kernel immediately
      try {
        vm.resize(this.termCols, this.termRows);
      } catch {}
      this.mountHandle?.setTtySize(this.termCols, this.termRows);

      this.bootMs = Math.round(performance.now() - t0);
      this.phase = "ready";
      this.startCrewBroadcastLoop();
      this.emitState();
      this.emitTabs();

      if (!restore) {
        const envLine = this.buildGuestEnvLine();
        vm.write(`${envLine}; cd /home/pilot 2>/dev/null; clear; obc-diag\n`);
        void this.warmupPageCache(vm);
      }

      void vm.exited.then((res) => {
        if (this.vm !== vm) return;
        this.cleanupVmHandles();
        this.phase = res.code === 0 ? "off" : "error";
        if (res.code !== 0) this.lastError = `Kernel exited (${res.kind}, code ${res.code})`;
        this.emitState();
      });

      return this.status();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.phase = "error";
      this.pushOutput(new TextEncoder().encode(`\r\n\x1b[1;31m[OBC] Boot failed: ${msg}\r\n\x1b[0m`));
      this.cleanupVmHandles();
      this.emitState();
      return this.status();
    }
  }

  private playAudioChunk(pcmToFloat32: (data: Uint8Array, format: SoundChunk["format"]) => Float32Array, chunk: SoundChunk) {
    if (!this.config.soundEnabled || typeof AudioContext === "undefined") return;
    try {
      this.audioCtx ??= new AudioContext();
      if (this.audioCtx.state === "suspended") void this.audioCtx.resume();
      const samples = pcmToFloat32(chunk.data, chunk.format);
      const ch = Math.max(1, chunk.format.channels);
      const frames = Math.floor(samples.length / ch);
      if (frames <= 0) return;
      const buf = this.audioCtx.createBuffer(ch, frames, chunk.format.rate);
      for (let c = 0; c < ch; c++) {
        const dest = buf.getChannelData(c);
        for (let i = 0; i < frames; i++) dest[i] = samples[i * ch + c] ?? 0;
      }
      const src = this.audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(this.audioCtx.destination);
      const now = this.audioCtx.currentTime;
      if (this.audioNextTime < now) this.audioNextTime = now + 0.02;
      src.start(this.audioNextTime);
      this.audioNextTime += buf.duration;
    } catch {
      // ignore audio decode error
    }
  }

  /**
   * Suspend the live Linux VM to release Worker CPU & RAM.
   * Uses Unkernel's native RAM `vm.snapshot()` when supported, or falls back to a clean
   * disk-flushed hibernate (`vm.sync()` + persistent IndexedDB `/data` + Worker shutdown).
   */
  async suspend(): Promise<{ ok: boolean; mode?: "snapshot" | "hibernate"; msg: string }> {
    if (this.phase !== "ready" || !this.vm) return { ok: false, msg: "OBC not running" };
    const vm = this.vm;
    try {
      const snap = await vm.snapshot();
      this.savedSnapshot = snap;
      this.hibernatedState = null;
      this.cleanupVmHandles();
      await vm.stop();
      this.phase = "suspended";
      this.emitState();
      return { ok: true, mode: "snapshot", msg: "VM suspended to RAM snapshot" };
    } catch {
      // Worker mode with 9p host mounts (/obc) flushes persistent /data to IndexedDB and hibernates cleanly
      try {
        await vm.sync({ timeout: 2500 });
      } catch {
        // best-effort sync
      }
      this.savedSnapshot = null;
      this.hibernatedState = { activeScript: this.activeScript };
      this.cleanupVmHandles();
      try {
        await vm.stop();
      } catch {
        // already stopped
      }
      this.phase = "suspended";
      this.emitState();
      return { ok: true, mode: "hibernate", msg: "VM hibernated (0% CPU, /data persisted)" };
    }
  }

  /** Resume a previously suspended or hibernated VM. */
  async resume(): Promise<ObcStatus> {
    if (this.savedSnapshot) {
      const snap = this.savedSnapshot;
      this.savedSnapshot = null;
      this.hibernatedState = null;
      return this.boot(snap);
    }
    this.hibernatedState = null;
    return this.boot();
  }

  /** Wipe persisted IndexedDB `/data` disk (re-seeded cleanly on next boot). */
  async resetDataDisk(): Promise<{ ok: boolean; msg: string }> {
    await this.stop();
    try {
      const mod = await import("unkernel/web");
      await mod.resetDataDisk();
      return { ok: true, msg: "IndexedDB /data disk reset" };
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : String(e) };
    }
  }

  private nodeMaxOldSpaceMiB(): number {
    // 35% of guest RAM (256..768 MiB) avoids long V8 mark-sweep pauses on emulated aarch64 while leaving room for pi/tools.
    return Math.max(256, Math.min(768, Math.floor(this.actualMemoryMiB * 0.35)));
  }

  private buildGuestEnvRecord(): Record<string, string> {
    const heapMb = this.nodeMaxOldSpaceMiB();
    return {
      PATH: "/run/kw/bin:/obc/bin:/obc/scripts:/home/user/.local/bin:/home/user/.bun/bin:/root/.local/bin:/root/.bun/bin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/kw/bin",
      PYTHONPATH: "/obc/lib",
      NODE_PATH: "/obc/lib",
      PYTHONDONTWRITEBYTECODE: "1",
      NODE_COMPILE_CACHE: "/home/pilot/.cache/v8-compile-cache",
      NODE_OPTIONS: `--max-old-space-size=${heapMb}`,
      TMPDIR: "/tmp",
      XDG_CACHE_HOME: "/tmp/.cache",
      BUN_INSTALL_CACHE_DIR: "/tmp/.bun-cache",
      NPM_CONFIG_CACHE: "/tmp/.npm-cache",
      PIP_CACHE_DIR: "/tmp/.pip-cache",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_AUTOUPDATER: "1",
      DISABLE_TELEMETRY: "1",
    };
  }

  private buildGuestEnvLine(): string {
    const heapMb = this.nodeMaxOldSpaceMiB();
    return [
      'export PATH="/run/kw/bin:/obc/bin:/obc/scripts:$HOME/.local/bin:$HOME/.bun/bin:/home/user/.local/bin:/home/user/.bun/bin:/usr/local/bin:$PATH:/usr/lib/kw/bin"',
      "PYTHONPATH=/obc/lib",
      "NODE_PATH=/obc/lib",
      "PYTHONDONTWRITEBYTECODE=1",
      "NODE_COMPILE_CACHE=/home/pilot/.cache/v8-compile-cache",
      `NODE_OPTIONS="--max-old-space-size=${heapMb}"`,
      "TMPDIR=/tmp",
      "XDG_CACHE_HOME=/tmp/.cache",
      "BUN_INSTALL_CACHE_DIR=/tmp/.bun-cache",
      // (bun's global packages and bins: without BUN_INSTALL they follow XDG_CACHE_HOME into /tmp — RAM, off PATH)
      'BUN_INSTALL="$HOME/.bun"',
      "NPM_CONFIG_CACHE=/tmp/.npm-cache",
      "PIP_CACHE_DIR=/tmp/.pip-cache",
      "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
      "DISABLE_AUTOUPDATER=1",
      "DISABLE_TELEMETRY=1",
    ].join(" ");
  }

  /** Silently pre-warm Linux RAM page cache for heavy installed binaries (claude, bun, node, pi) so first launch skips IndexedDB I/O. */
  private async warmupPageCache(vm: KernelHandle): Promise<void> {
    if (this.vm !== vm) return;
    this.warmupState = "warming";
    const warmCmd = [
      "for b in claude bun node pi; do",
      '  p=$(PATH="/home/user/.local/bin:/home/user/.bun/bin:/usr/local/bin:/usr/bin:/bin" command -v "$b" 2>/dev/null || true);',
      '  case "$p" in ""|/usr/lib/kw/bin/*) continue;; esac;',
      '  [ -r "$p" ] && nice -n 19 cat "$p" >/dev/null 2>&1 || true;',
      "done;",
      'for f in /home/pilot/.cache/v8-compile-cache/*; do [ -r "$f" ] && nice -n 19 cat "$f" >/dev/null 2>&1 || true; done',
    ].join(" ");
    try {
      await vm.exec("sh", ["-c", warmCmd], { timeout: 25_000 });
      if (this.vm === vm) {
        this.warmupState = "ready";
        this.pushLog("Page-cache pre-warm complete");
      }
    } catch {
      if (this.vm === vm) this.warmupState = "idle";
    }
  }

  private async configureGuestEnvironment(vm: KernelHandle): Promise<void> {
    const heapMb = this.nodeMaxOldSpaceMiB();
    const setupScript = [
      "mkdir -p /home/pilot/docs /home/pilot/.claude/skills /home/pilot/.pi /home/pilot/.agents /home/pilot/.cache/v8-compile-cache /tmp/.cache /tmp/.bun-cache /tmp/.npm-cache /tmp/.pip-cache /etc/profile.d /home/user/.local/bin",
      // Sync AAA docs & Claude/Pi agent skills from /obc/pilot-kit into /home/pilot (preserving user files)
      "if [ -d /obc/pilot-kit ]; then for f in CLAUDE.md AGENTS.md README.md; do [ -f /obc/pilot-kit/$f ] && cp -f /obc/pilot-kit/$f /home/pilot/$f; done; [ -d /obc/pilot-kit/docs ] && cp -Rf /obc/pilot-kit/docs/. /home/pilot/docs/; [ -d /obc/pilot-kit/skills ] && cp -Rf /obc/pilot-kit/skills/. /home/pilot/.claude/skills/; fi",
      // Mirror skills into .pi/skills and .agents/skills so BOTH Claude Code and Pi auto-discover every skill
      "rm -rf /home/pilot/.pi/skills /home/pilot/.agents/skills 2>/dev/null || true",
      "ln -sfn /home/pilot/.claude/skills /home/pilot/.pi/skills",
      "ln -sfn /home/pilot/.claude/skills /home/pilot/.agents/skills",
      // Also link CLAUDE.md / AGENTS.md into /home/user and /root if not already customized
      'for h in /home/user /root; do if [ -d "$h" ]; then [ -e "$h/CLAUDE.md" ] || ln -sfn /home/pilot/CLAUDE.md "$h/CLAUDE.md"; [ -e "$h/AGENTS.md" ] || ln -sfn /home/pilot/AGENTS.md "$h/AGENTS.md"; fi; done',
      "chmod 777 /home/pilot /home/pilot/.cache /home/pilot/.cache/v8-compile-cache /tmp/.cache /tmp/.bun-cache /tmp/.npm-cache /tmp/.pip-cache 2>/dev/null || true",
      "chmod -R a+rX /home/pilot/docs /home/pilot/.claude /home/pilot/CLAUDE.md /home/pilot/AGENTS.md /home/pilot/README.md 2>/dev/null || true",
      "chown -R 1000:1000 /home/user/.local 2>/dev/null || true",
      "ln -sf /obc/tau /dev/tau",
      `printf 'export PATH="/run/kw/bin:/obc/bin:/obc/scripts:$HOME/.local/bin:$HOME/.bun/bin:/home/user/.local/bin:/home/user/.bun/bin:/usr/local/bin:$PATH:/usr/lib/kw/bin"\\nexport PYTHONPATH=/obc/lib\\nexport NODE_PATH=/obc/lib\\nexport PYTHONDONTWRITEBYTECODE=1\\nexport NODE_COMPILE_CACHE=/home/pilot/.cache/v8-compile-cache\\nexport NODE_OPTIONS="--max-old-space-size=${heapMb}"\\nexport TMPDIR=/tmp\\nexport XDG_CACHE_HOME=/tmp/.cache\\nexport BUN_INSTALL_CACHE_DIR=/tmp/.bun-cache\\nexport BUN_INSTALL="$HOME/.bun"\\nexport NPM_CONFIG_CACHE=/tmp/.npm-cache\\nexport PIP_CACHE_DIR=/tmp/.pip-cache\\nexport CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1\\nexport DISABLE_AUTOUPDATER=1\\nexport DISABLE_TELEMETRY=1\\nobc_reset_tty() { printf "\\033[?1000l\\033[?1002l\\033[?1003l\\033[?1005l\\033[?1006l\\033[?1015l\\033[?1004l\\033[?25h"; }\\n[ -n "$BASH_VERSION" ] && PROMPT_COMMAND="obc_reset_tty\${PROMPT_COMMAND:+; \$PROMPT_COMMAND}"\\n' > /etc/profile.d/obc.sh`,
      "chmod 644 /etc/profile.d/obc.sh 2>/dev/null || true",
      "if [ -f /etc/bash.bashrc ] && ! grep -q '/etc/profile.d/obc.sh' /etc/bash.bashrc 2>/dev/null; then printf '\\n[ -r /etc/profile.d/obc.sh ] && . /etc/profile.d/obc.sh\\n' >> /etc/bash.bashrc; fi",
    ].join(" && ");
    try {
      await vm.exec("sh", ["-c", setupScript], { user: 0, timeout: 12_000 });
    } catch (e) {
      console.warn("[OBC] Guest environment setup warning:", e);
    }
  }

  private handleDisplayChange(mode: DisplayMode | null) {
    this.fbMode = mode;
    if (mode) {
      this.fbFramesInWindow = 0;
      this.fbWindowStart = performance.now();
      this.startFbPolling();
    } else {
      this.stopFbPolling();
      this.fbFrame = null;
      this.fbFps = 0;
      this.fbRev++;
    }
    this.emitState();
  }

  private startFbPolling() {
    this.stopFbPolling();
    const pull = () => {
      if (!this.vm || !this.fbMode) return;
      const frame = this.vm.frame();
      if (frame && frame.data.byteLength > 0) {
        const wasNull = this.fbFrame === null;
        this.fbRev++;
        this.fbFramesInWindow++;
        const now = performance.now();
        let fpsChanged = false;
        if (now - this.fbWindowStart >= 1000) {
          const nextFps = Math.round((this.fbFramesInWindow * 1000) / (now - this.fbWindowStart));
          fpsChanged = nextFps !== this.fbFps;
          this.fbFps = nextFps;
          this.fbFramesInWindow = 0;
          this.fbWindowStart = now;
        }
        this.fbFrame = {
          width: frame.width,
          height: frame.height,
          data: frame.data,
          rev: this.fbRev,
        };
        // Avoid triggering DOM/xterm UI reflows at 30 Hz — HUD & 3D cockpits watch `displayRev` directly.
        if (wasNull || fpsChanged) this.emitState();
      }
    };
    pull();
    this.fbTimer = setInterval(pull, FB_POLL_MS);
  }

  private stopFbPolling() {
    if (this.fbTimer) {
      clearInterval(this.fbTimer);
      this.fbTimer = null;
    }
  }

  async exec(command: string, timeoutMs = 15_000): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }> {
    if (this.phase !== "ready" || !this.vm) {
      const st = await this.boot();
      if (st.phase !== "ready" || !this.vm) {
        return { ok: false, code: -1, stdout: "", stderr: st.lastError ?? "OBC not booted" };
      }
    }
    try {
      const wrapped = `${this.buildGuestEnvLine()}; ${command}`;
      const res = await this.vm.exec("sh", ["-c", wrapped], { timeout: timeoutMs, encoding: "utf8" });
      const code = res.exitCode ?? -1;
      return {
        ok: code === 0,
        code,
        stdout: res.stdout,
        stderr: res.stderr,
      };
    } catch (e) {
      return { ok: false, code: -1, stdout: "", stderr: e instanceof Error ? e.message : String(e) };
    }
  }

  /** List files inside `/home/pilot` or `/obc/scripts` for the built-in script editor. */
  async listFiles(dir = "/home/pilot"): Promise<string[]> {
    const safeDir = dir.replace(/[^a-zA-Z0-9_./-]/g, "");
    const res = await this.exec(`ls -1 "${safeDir}" 2>/dev/null || true`);
    if (!res.ok) return [];
    return res.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** Read a guest text file for the built-in script editor. */
  async readGuestFile(path: string): Promise<string | null> {
    const safe = path.replace(/[^a-zA-Z0-9_./-]/g, "");
    const res = await this.exec(`cat "${safe}"`);
    return res.ok ? res.stdout : null;
  }

  /** Save a script inside `/home/pilot/` (persisted on IndexedDB `/data`) and make it executable. */
  async writeGuestFile(path: string, content: string): Promise<{ ok: boolean; msg: string }> {
    if (!path.startsWith("/home/pilot/")) return { ok: false, msg: "Only /home/pilot/* files can be edited" };
    const safe = path.replace(/[^a-zA-Z0-9_./-]/g, "");
    if (!this.vm || this.phase !== "ready") await this.boot();
    if (!this.vm) return { ok: false, msg: "OBC not ready" };
    try {
      const res = await this.vm.exec("sh", ["-c", `mkdir -p /home/pilot && cat > "${safe}" && chmod +x "${safe}"`], {
        input: content,
        timeout: 8000,
      });
      return { ok: res.exitCode === 0, msg: res.exitCode === 0 ? `Saved ${safe}` : res.stderr || "write failed" };
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : String(e) };
    }
  }

  write(input: string) {
    if (this.phase !== "ready" || !this.vm) {
      void this.boot().then(() => {
        if (this.vm && this.phase === "ready") this.vm.write(input);
      });
      return;
    }
    this.vm.write(input);
  }

  /** Forward live console dimensions to Unkernel (`SIGWINCH`), 9p `/obc/tty_size`, and the 3D cockpit TermBuffer. */
  resize(cols: number, rows: number, force = false) {
    const c = Math.max(40, Math.min(240, Math.round(cols)));
    const r = Math.max(10, Math.min(80, Math.round(rows)));
    if (!force && c === this.termCols && r === this.termRows) return;
    this.termCols = c;
    this.termRows = r;
    this.term.resize(c, r);
    this.mountHandle?.setTtySize(c, r);
    try {
      this.vm?.resize(c, r);
    } catch {
      // ignore if worker exited
    }
  }

  private pushLog(msg: string) {
    const d = new Date();
    const ts = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    this.hostLogs.push(`[${ts}] ${msg}`);
    if (this.hostLogs.length > 160) this.hostLogs.splice(0, this.hostLogs.length - 160);
    console.debug("[OBC]", msg);
  }

  getLogs(): string[] {
    return [...this.hostLogs];
  }

  clearLogs() {
    this.hostLogs = [];
  }

  /** Return live active SMP vCPU count (1 if UP or not cross-origin isolated). */
  get cpusActive(): number {
    return this.phase === "ready" ? this.activeCpus : this.config.cpus;
  }

  /** Return current page-cache warmup state (`idle` | `warming` | `ready`). */
  getWarmupState(): ObcWarmupState {
    return this.warmupState;
  }

  /** Return the names of all registered Level 3 native HostCommands (`/run/kw/bin/*`). */
  getHostCommandNames(): string[] {
    return [...this.hostCommandNames];
  }

  /** Return live Unkernel VM hardware & I/O counters (`vm.stats()`) plus browser host capabilities. */
  kernelStats(): ObcKernelTelemetry {
    const iso = typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : false;
    if (!this.vm || this.phase !== "ready") {
      return {
        running: false,
        uptimeMs: 0,
        compileMs: 0,
        cpus: this.config.cpus,
        memoryMiB: this.config.memoryMiB,
        memory64: false,
        cmdline: "",
        transport: this.transport,
        crossOriginIsolated: iso,
        cpuBlocker: this.cpuBlocker,
        activeWispUrl: this.activeWispUrl || this.wispUrl,
        switches: 0,
        idles: 0,
        yields: 0,
        jit: null,
        block: null,
        net: null,
        vsock: null,
        display: null,
        sound: null,
        shm: null,
      };
    }
    const s = this.vm.stats();
    return {
      running: true,
      uptimeMs: Math.round(s.uptimeMs ?? 0),
      compileMs: Math.round(s.compileMs ?? 0),
      cpus: s.cpus ?? 1,
      memoryMiB: this.vm.memoryMiB || this.actualMemoryMiB,
      memory64: Boolean(this.vm.memory64),
      cmdline: this.vm.cmdline ?? "",
      transport: this.transport,
      crossOriginIsolated: iso,
      cpuBlocker: this.cpuBlocker,
      activeWispUrl: this.activeWispUrl,
      switches: s.switches ?? 0,
      idles: s.idles ?? 0,
      yields: s.yields ?? 0,
      jit: s.jit
        ? {
            enabled: s.jit.enabled,
            requested: s.jit.requested,
            compiled: s.jit.compiled,
            live: s.jit.live,
            maxLive: s.jit.maxLive,
            freed: s.jit.freed,
            failed: s.jit.failed,
          }
        : null,
      block: s.block
        ? {
            reads: s.block.reads,
            writes: s.block.writes,
            flushes: s.block.flushes,
            discards: s.block.discards,
            bytesRead: s.block.bytesRead,
            bytesWritten: s.block.bytesWritten,
          }
        : null,
      net: s.net ? { rx: s.net.rx, tx: s.net.tx, tcpOpened: s.net.tcpOpened, dns: s.net.dns } : null,
      vsock: s.vsock
        ? {
            open: s.vsock.open,
            accepted: s.vsock.accepted,
            connected: s.vsock.connected,
            bytesIn: s.vsock.bytesIn,
            bytesOut: s.vsock.bytesOut,
            resets: s.vsock.resets,
          }
        : null,
      display: s.display
        ? {
            attaches: s.display.attaches,
            detaches: s.display.detaches,
            width: this.fbMode?.width ?? 0,
            height: this.fbMode?.height ?? 0,
            fps: this.fbFps,
          }
        : null,
      sound: s.sound
        ? {
            opens: s.sound.opens,
            starts: s.sound.starts,
            chunks: s.sound.chunks,
            frames: s.sound.frames,
            playing: Boolean(this.vm.sound?.playing),
          }
        : null,
      shm: s.shm
        ? {
            open: s.shm.open,
            reads: s.shm.reads,
            writes: s.shm.writes,
            bytesRead: s.shm.bytesRead,
            bytesWritten: s.shm.bytesWritten,
          }
        : null,
    };
  }

  /** Flush Linux guest filesystems and persistent IndexedDB `/data` disk right now. */
  async syncDisk(): Promise<{ ok: boolean; msg: string; ms: number }> {
    if (!this.vm || this.phase !== "ready") return { ok: false, msg: "OBC not running", ms: 0 };
    const t0 = performance.now();
    try {
      const ok = await this.vm.sync({ timeout: 5000 });
      const ms = Math.round(performance.now() - t0);
      if (ok) this.lastSyncAt = Date.now();
      this.pushLog(`Disk sync ${ok ? "OK" : "timeout"} (${ms} ms)`);
      return { ok, msg: ok ? `Flushed /data (${ms} ms)` : "Sync timeout", ms };
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : String(e), ms: Math.round(performance.now() - t0) };
    }
  }

  /** Inspect persistent IndexedDB `/data` block count & browser storage quota. */
  async diskInfo(): Promise<ObcDiskInfo> {
    let storageUsageBytes: number | null = null;
    let storageQuotaBytes: number | null = null;
    try {
      if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        storageUsageBytes = typeof est.usage === "number" ? est.usage : null;
        storageQuotaBytes = typeof est.quota === "number" ? est.quota : null;
      }
    } catch {
      // ignore
    }
    let idbBlocks: number | null = null;
    try {
      if (typeof indexedDB !== "undefined") {
        const mod = await import("unkernel/web");
        const storeObj = new mod.IdbStore(`${mod.DATA_DISK_NAME}-${mod.DATA_DISK_VERSION}`);
        idbBlocks = await storeObj.count();
        await storeObj.close();
      }
    } catch {
      idbBlocks = null;
    }
    return {
      persistData: this.config.persistData,
      idbBlocks,
      storageUsageBytes,
      storageQuotaBytes,
      lastSyncAt: this.lastSyncAt,
      hasSnapshot: this.savedSnapshot !== null || this.hibernatedState !== null,
    };
  }

  /** Export `/home/pilot` as a gzipped tar archive for local backup. */
  async exportPilotArchive(): Promise<{ ok: boolean; bytes?: Uint8Array; filename?: string; msg: string }> {
    if (!this.vm || this.phase !== "ready") return { ok: false, msg: "OBC must be running to export /home/pilot" };
    const res = await this.exec("tar -czf - -C /home pilot 2>/dev/null | base64 | tr -d '\\n'", 20_000);
    if (!res.ok || !res.stdout.trim()) return { ok: false, msg: res.stderr || "tar export failed" };
    try {
      const bin = atob(res.stdout.trim());
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { ok: true, bytes, filename: `obc-pilot-${Date.now()}.tar.gz`, msg: `Exported ${(bytes.byteLength / 1024).toFixed(1)} KiB` };
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Import a `.tar.gz` backup into `/home/pilot` and sync to IndexedDB. */
  async importPilotArchive(bytes: Uint8Array): Promise<{ ok: boolean; msg: string }> {
    if (!this.vm || this.phase !== "ready") return { ok: false, msg: "OBC must be running to import /home/pilot" };
    let b64 = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      b64 += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    try {
      const res = await this.vm.exec("sh", ["-c", "base64 -d | tar -xzf - -C /home"], { input: btoa(b64), timeout: 20_000 });
      if (res.exitCode !== 0) return { ok: false, msg: res.stderr || "tar import failed" };
      await this.syncDisk();
      return { ok: true, msg: `Imported ${(bytes.byteLength / 1024).toFixed(1)} KiB into /home/pilot` };
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Export a full binary Unkernel VM RAM snapshot (`.kwsnap`) when supported. */
  async exportVmSnapshot(): Promise<{ ok: boolean; bytes?: Uint8Array; filename?: string; msg: string }> {
    if (!this.vm || this.phase !== "ready") return { ok: false, msg: "OBC must be running" };
    try {
      const mod = await import("unkernel/web");
      const snap = await this.vm.snapshot();
      const bytes = mod.encodeSnapshot(snap);
      return {
        ok: true,
        bytes,
        filename: `obc-vm-${this.config.distro}-${Date.now()}.kwsnap`,
        msg: `Snapshot ${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MiB`,
      };
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Restore a binary `.kwsnap` VM snapshot file. */
  async importVmSnapshot(bytes: Uint8Array): Promise<{ ok: boolean; msg: string }> {
    try {
      const mod = await import("unkernel/web");
      const snap = mod.decodeSnapshot(bytes);
      await this.stop();
      const st = await this.boot(snap);
      return { ok: st.phase === "ready", msg: st.phase === "ready" ? "VM snapshot restored" : st.lastError || "Restore failed" };
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Collect live guest OS telemetry (RAM, uptime, mounts, processes, toolchains) in a single fast probe. */
  async probeGuest(): Promise<ObcGuestProbe | null> {
    if (!this.vm || this.phase !== "ready") return null;
    const cmd = [
      "echo '@@UNAME'; uname -srm",
      "echo '@@DISTRO'; sed -n 's/^PRETTY_NAME=\"\\([^\"]*\\)\"/\\1/p' /etc/os-release 2>/dev/null | head -n 1",
      "echo '@@UPTIME'; cat /proc/uptime 2>/dev/null; cat /proc/loadavg 2>/dev/null",
      "echo '@@MEM'; awk '/^(MemTotal|MemAvailable|MemFree|Buffers|Cached):/{print $1,$2}' /proc/meminfo 2>/dev/null",
      "echo '@@DF'; df -h 2>/dev/null | tail -n +2",
      "echo '@@PS'; (ps -o pid,user,vsz,args 2>/dev/null || ps 2>/dev/null) | head -n 22",
      "echo '@@TOOLS'",
      'has_real(){ P=$(command -v "$1" 2>/dev/null || true); [ -n "$P" ] || return 1; case "$P" in /usr/lib/kw/bin/*) return 1;; esac; if [ "$1" = python3 ] || [ "$1" = node ]; then head -n 1 "$P" 2>/dev/null | grep -q \'^#!\' && return 1; fi; return 0; }',
      'echo "obc-rs=$([ -x /obc/bin/obc-rs ] && echo native || echo off)"',
      'echo "pilot-kit=$([ -r /home/pilot/CLAUDE.md ] && echo docs+5skills || echo off)"',
      "echo \"python3=$(has_real python3 && python3 --version 2>&1 | awk '{print $2}' || echo off)\"",
      "echo \"pip=$(has_real pip && pip --version 2>&1 | awk '{print $2}' || (has_real pip3 && pip3 --version 2>&1 | awk '{print $2}' || echo off))\"",
      'echo "node=$(has_real node && node --version 2>&1 || echo off)"',
      'echo "npm=$(has_real npm && npm --version 2>&1 | head -n 1 || echo off)"',
      'echo "bun=$(has_real bun && bun --version 2>&1 | head -n 1 || echo off)"',
      "echo \"rustc=$(has_real rustc && rustc --version 2>&1 | awk '{print $2}' || echo off)\"",
      "echo \"cargo=$(has_real cargo && cargo --version 2>&1 | awk '{print $2}' || echo off)\"",
      'echo "pi=$(has_real pi && pi --version 2>&1 | head -n 1 || echo off)"',
      'echo "claude=$(has_real claude && claude --version 2>&1 | head -n 1 || echo off)"',
    ].join("; ");
    const res = await this.exec(cmd, 8000);
    if (!res.ok) return null;

    const sections: Record<string, string[]> = {};
    let cur = "";
    for (const rawLine of res.stdout.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (line.startsWith("@@")) {
        cur = line.slice(2);
        sections[cur] = [];
      } else if (cur && line.trim()) {
        sections[cur]!.push(line);
      }
    }

    const memMap: Record<string, number> = {};
    for (const l of sections.MEM ?? []) {
      const [k, v] = l.split(/\s+/);
      if (k && v) memMap[k.replace(":", "")] = Number(v) || 0;
    }
    const totalKb = memMap.MemTotal ?? 0;
    const availKb = memMap.MemAvailable ?? (memMap.MemFree ?? 0) + (memMap.Buffers ?? 0) + (memMap.Cached ?? 0);
    const usedKb = Math.max(0, totalKb - availKb);

    const upSec = Number((sections.UPTIME?.[0] ?? "0").split(/\s+/)[0]) || 0;
    const hh = Math.floor(upSec / 3600);
    const mm = Math.floor((upSec % 3600) / 60);
    const ss = Math.floor(upSec % 60);
    const uptime = hh > 0 ? `${hh}h ${mm}m ${ss}s` : mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
    const loadAvg = (sections.UPTIME?.[1] ?? "0.00 0.00 0.00").split(/\s+/).slice(0, 3).join(" ");

    const mounts: ObcGuestMount[] = [];
    for (const l of sections.DF ?? []) {
      const p = l.trim().split(/\s+/);
      if (p.length >= 6) {
        mounts.push({ fs: p[0]!, size: p[1]!, used: p[2]!, avail: p[3]!, pct: p[4]!, mount: p.slice(5).join(" ") });
      }
    }

    const processes: ObcGuestProcess[] = [];
    for (const l of (sections.PS ?? []).slice(1)) {
      const p = l.trim().split(/\s+/);
      const pid = Number(p[0]);
      if (Number.isFinite(pid) && pid > 0 && p.length >= 4) {
        processes.push({ pid, user: p[1]!, mem: p[2]!, cmd: p.slice(3).join(" ").slice(0, 80) });
      }
    }

    const tools: Record<string, string> = {};
    for (const l of sections.TOOLS ?? []) {
      const idx = l.indexOf("=");
      if (idx > 0) tools[l.slice(0, idx)] = l.slice(idx + 1).trim() || "off";
    }

    return {
      uname: sections.UNAME?.[0] ?? "Linux aarch64",
      distro: sections.DISTRO?.[0] ?? distroLabel(this.config.distro),
      uptime,
      loadAvg,
      memTotalMiB: Math.round(totalKb / 1024),
      memUsedMiB: Math.round(usedKb / 1024),
      memAvailMiB: Math.round(availKb / 1024),
      tools,
      processes,
      mounts,
    };
  }

  /** Terminate a guest process (refuses PID 1). */
  async killProcess(pid: number, signal: "TERM" | "KILL" = "TERM"): Promise<{ ok: boolean; msg: string }> {
    const p = Math.round(pid);
    if (!Number.isFinite(p) || p <= 1) return { ok: false, msg: "Refusing to signal PID <= 1" };
    const sig = signal === "KILL" ? "-KILL" : "-TERM";
    const res = await this.exec(`kill ${sig} ${p}`, 4000);
    return { ok: res.ok, msg: res.ok ? `Sent SIG${signal} to PID ${p}` : res.stderr.trim() || `kill ${p} failed` };
  }

  /** Read Unkernel CPU profiler report when `config.profile` is enabled. */
  async getProfile(): Promise<string | null> {
    if (!this.vm || this.phase !== "ready") return null;
    try {
      const rep = await this.vm.profile();
      if (!rep) return null;
      const mod = await import("unkernel/web");
      return mod.formatProfile(rep);
    } catch {
      return null;
    }
  }

  private getScreenCaptureFn: (() => unknown) | null = null;
  private releaseScreenCaptureFn: (() => void) | null = null;

  /** Register 3D cockpit screen capture hooks from main.ts for `__bh.obc` inspection & release. */
  setScreenCaptureHandlers(getFn: () => unknown, releaseFn: () => void) {
    this.getScreenCaptureFn = getFn;
    this.releaseScreenCaptureFn = releaseFn;
  }

  /** Return the currently captured 3D cockpit screen target (or null). */
  screenCapture(): unknown {
    return this.getScreenCaptureFn?.() ?? null;
  }

  /** Release any active 3D cockpit screen keyboard/mouse capture. */
  releaseScreenCapture() {
    this.releaseScreenCaptureFn?.();
  }

  /** 1-click route Linux OBC onto a 3D cockpit display (Ranger MFD, F-35 PCD, or A320 MCDU+LECAM). */
  routeToCockpit(target: "ranger" | "f35" | "a320"): { ok: boolean; msg: string } {
    const bh = (globalThis as unknown as { __bh?: Record<string, unknown> }).__bh;
    if (!bh) return { ok: false, msg: "Simulator __bh unavailable" };
    try {
      const settings = bh.settings as { shipMount?: string; cockpitPages?: string } | undefined;
      const refresh = bh.refresh as (() => void) | undefined;
      if (target === "ranger") {
        const screens = bh.cockpitScreens as { setPage?: (i: number, p: string) => void; pagesSetting?: () => string } | undefined;
        screens?.setPage?.(2, "obc");
        if (settings && screens?.pagesSetting) settings.cockpitPages = screens.pagesSetting();
        if (settings) settings.shipMount = "cockpit";
        refresh?.();
        return { ok: true, msg: "Routed OBC to Ranger MFD slot 2" };
      }
      if (target === "f35") {
        const pcdWrap = bh.pcd as { pcd?: { halves: string[]; show: (half: number, page: string) => void } } | undefined;
        if (pcdWrap?.pcd) {
          pcdWrap.pcd.halves[0] = "full";
          pcdWrap.pcd.show(0, "OBC");
        }
        if (settings) settings.shipMount = "cockpit";
        refresh?.();
        return { ok: true, msg: "Routed OBC to F-35 PCD" };
      }
      const mcduFn = bh.a320Mcdu as
        | ((side: 0 | 1) => { open?: (p: string) => void; host?: { setSdPage?: (p: string) => void } } | null)
        | undefined;
      const mcdu = mcduFn?.(0);
      mcdu?.open?.("obc");
      mcdu?.host?.setSdPage?.("obcPage");
      if (settings) {
        (settings as Record<string, unknown>).a320EcamPage = "obcPage";
        settings.shipMount = "cockpit";
      }
      refresh?.();
      return { ok: true, msg: "Routed OBC to A320 MCDU + Lower ECAM" };
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : String(e) };
    }
  }

  async runScript(idOrName: string): Promise<{ ok: boolean; script: string }> {
    const meta = findObcScript(idOrName);
    const cmd = meta ? meta.cmd : idOrName.trim();
    if (!cmd) return { ok: false, script: "" };
    const st = await this.boot();
    if (st.phase !== "ready" || !this.vm) return { ok: false, script: cmd };
    this.activeScript = meta?.name ?? cmd.split(/\s+/)[0] ?? cmd;
    // Send Ctrl+C first and clear any stuck terminal mouse/alt-screen modes in xterm before launching `cmd`.
    this.pushOutput(
      new TextEncoder().encode("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1004l\x1b[?1049l\x1b[?25h"),
    );
    this.vm.write("\x03");
    await new Promise((r) => setTimeout(r, 80));
    if (this.vm && this.phase === "ready") this.vm.write(`${cmd}\n`);
    this.emitState();
    return { ok: true, script: this.activeScript };
  }

  async installToolchain(profile: ObcToolchainProfile = "all"): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const st = await this.boot();
    if (st.phase !== "ready" || !this.vm) return { ok: false, stdout: "", stderr: "OBC not ready" };
    this.activeScript = `obc-install ${profile}`;
    this.emitState();
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const label = distroLabel(this.config.distro);
    this.pushOutput(enc.encode(`\r\n\x1b[1;36m[OBC] Installing ${profile} toolchain on ${label} via Wisp...\r\n\x1b[0m`));
    let stdout = "";
    let stderr = "";
    const appendCap = (cur: string, chunk: string) => (cur.length > 64_000 ? cur.slice(-32_000) + chunk : cur + chunk);
    try {
      const envLine = this.buildGuestEnvLine();
      const proc = await this.vm.spawn("sh", ["-lc", `${envLine}; sh /obc/scripts/obc-install "${profile}"`], { pty: false });
      const drain = async (stream: ReadableStream<Uint8Array>, isErr: boolean) => {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = dec.decode(value, { stream: true });
            if (isErr) {
              stderr = appendCap(stderr, text);
              this.pushOutput(enc.encode(`\x1b[33m${text.replace(/\r?\n/g, "\r\n")}\x1b[0m`));
            } else {
              stdout = appendCap(stdout, text);
              this.pushOutput(enc.encode(text.replace(/\r?\n/g, "\r\n")));
            }
          }
        } catch {
          // stream closed on timeout or stop
        } finally {
          reader.releaseLock();
        }
      };
      const timer = setTimeout(() => {
        try {
          void proc.kill("SIGTERM");
        } catch {}
      }, 900_000);
      const [, , ended] = await Promise.all([drain(proc.stdout, false), drain(proc.stderr, true), proc.ended]).finally(() =>
        clearTimeout(timer),
      );
      const ok = ended.type === "exit" && ended.code === 0;
      if (ok && this.config.persistData) {
        try {
          await this.vm.sync({ timeout: 5000 });
        } catch {
          // best-effort sync
        }
      }
      if (ok && this.vm) {
        void this.warmupPageCache(this.vm);
      }
      this.pushOutput(
        enc.encode(ok ? "\x1b[1;32m[OBC] Toolchain ready!\r\n\x1b[0m" : "\x1b[1;31m[OBC] Toolchain install failed.\r\n\x1b[0m"),
      );
      return { ok, stdout, stderr };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.pushOutput(enc.encode(`\x1b[1;31m[OBC] Install error: ${msg}\r\n\x1b[0m`));
      return { ok: false, stdout, stderr: stderr ? `${stderr}\n${msg}` : msg };
    } finally {
      this.activeScript = null;
      this.emitState();
    }
  }

  async stop(): Promise<void> {
    const vm = this.vm;
    this.savedSnapshot = null;
    this.hibernatedState = null;
    this.cleanupVmHandles();
    if (vm) {
      try {
        await vm.stop();
      } catch {
        // already stopped
      }
    }
    this.phase = "off";
    this.bootMs = null;
    this.activeScript = null;
    this.lastError = null;
    this.fbFps = 0;
    this.emitState();
  }

  async reboot(): Promise<ObcStatus> {
    await this.stop();
    return this.boot();
  }

  /** Multi-Tab Persistent PTY Sessions (keep claude/pi/shells warm in parallel without cold restarts!). */
  onTabsChange(fn: () => void): () => void {
    this.tabListeners.add(fn);
    return () => this.tabListeners.delete(fn);
  }

  private emitTabs() {
    for (const fn of this.tabListeners) fn();
  }

  activeTabId(): string {
    return this.currentTabId;
  }

  listTabs(): ObcTerminalTabInfo[] {
    const tabs: ObcTerminalTabInfo[] = [
      {
        id: "main",
        title: "Main",
        kind: "main",
        pid: null,
        running: this.phase === "ready",
        exitCode: null,
        cmd: null,
        active: this.currentTabId === "main",
      },
    ];
    for (const t of this.ptyTabs.values()) {
      tabs.push({
        id: t.id,
        title: t.title,
        kind: "pty",
        pid: t.pty.pid,
        running: t.running,
        exitCode: t.exitCode,
        cmd: t.cmd,
        active: this.currentTabId === t.id,
      });
    }
    return tabs;
  }

  async openTab(opts: { title?: string; cmd?: string; cwd?: string } = {}): Promise<ObcTerminalTabInfo | null> {
    if (this.phase !== "ready" || !this.vm) {
      const st = await this.boot();
      if (st.phase !== "ready" || !this.vm) return null;
    }
    const vm = this.vm;
    const id = `pty-${this.nextTabSeq++}`;
    const title = opts.title?.trim() || (opts.cmd ? opts.cmd.split(/\s+/)[0]!.slice(0, 14) : `Shell ${this.nextTabSeq - 1}`);
    const cmd = opts.cmd?.trim() || null;
    try {
      const pty = await vm.spawn("sh", ["-l"], {
        pty: true,
        cols: this.termCols,
        rows: this.termRows,
        cwd: opts.cwd || "/home/pilot",
        env: this.buildGuestEnvRecord(),
        detachable: true,
      });
      const tab: ObcPtyTabInternal = {
        id,
        title,
        cmd,
        pty,
        running: true,
        exitCode: null,
        replayChunks: [],
        replayBytes: 0,
        listeners: new Set(),
      };
      this.ptyTabs.set(id, tab);
      this.currentTabId = id;
      this.emitTabs();

      // Drain pull-stream continuously so guest never blocks on vsock flow control
      void (async () => {
        const reader = pty.output.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value || value.byteLength === 0) continue;
            tab.replayChunks.push(value);
            tab.replayBytes += value.byteLength;
            while (tab.replayBytes > 65_536 && tab.replayChunks.length > 1) {
              const drop = tab.replayChunks.shift()!;
              tab.replayBytes -= drop.byteLength;
            }
            for (const fn of tab.listeners) fn(value);
          }
        } catch {
          // pty closed or kernel stopped
        } finally {
          try {
            reader.releaseLock();
          } catch {}
        }
      })();

      void pty.ended
        .then((res) => {
          tab.running = false;
          tab.exitCode = res.type === "exit" ? res.code : -1;
          const notice = new TextEncoder().encode(`\r\n\x1b[2;33m[Tab "${tab.title}" exited (${tab.exitCode})]\r\n\x1b[0m`);
          tab.replayChunks.push(notice);
          for (const fn of tab.listeners) fn(notice);
          this.emitTabs();
        })
        .catch(() => {
          tab.running = false;
          this.emitTabs();
        });

      // Kick off requested command inside the fresh login shell (keeping the shell alive if it finishes)
      if (cmd) {
        void pty.write(`cd /home/pilot 2>/dev/null; ${cmd}\n`);
      } else {
        void pty.write("cd /home/pilot 2>/dev/null\n");
      }

      return this.listTabs().find((t) => t.id === id) ?? null;
    } catch (e) {
      this.pushLog(`openTab(${title}) failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  switchTab(id: string): boolean {
    if (id !== "main" && !this.ptyTabs.has(id)) return false;
    if (this.currentTabId === id) return true;
    this.currentTabId = id;
    this.emitTabs();
    return true;
  }

  async closeTab(id: string): Promise<boolean> {
    if (id === "main") return false;
    const tab = this.ptyTabs.get(id);
    if (!tab) return false;
    this.ptyTabs.delete(id);
    if (this.currentTabId === id) this.currentTabId = "main";
    try {
      await tab.pty.close();
    } catch {
      try {
        tab.pty.kill("SIGHUP");
      } catch {}
    }
    this.emitTabs();
    return true;
  }

  writeTab(id: string, input: string) {
    if (id === "main") {
      this.write(input);
      return;
    }
    const tab = this.ptyTabs.get(id);
    if (!tab || !tab.running) return;
    void tab.pty.write(input).catch(() => {});
  }

  resizeTab(id: string, cols: number, rows: number) {
    const c = Math.max(40, Math.min(240, Math.round(cols)));
    const r = Math.max(10, Math.min(80, Math.round(rows)));
    if (id === "main") {
      this.resize(c, r);
      return;
    }
    const tab = this.ptyTabs.get(id);
    if (!tab || !tab.running) return;
    try {
      tab.pty.resize(c, r);
    } catch {}
  }

  onTabOutput(id: string, fn: (bytes: Uint8Array) => void): () => void {
    if (id === "main") return this.onOutput(fn);
    const tab = this.ptyTabs.get(id);
    if (!tab) return () => {};
    tab.listeners.add(fn);
    for (const chunk of tab.replayChunks) fn(chunk);
    return () => tab.listeners.delete(fn);
  }

  private cleanupVmHandles() {
    this.stopFbPolling();
    this.stopCrewBroadcastLoop();
    for (const tab of this.ptyTabs.values()) {
      try {
        void tab.pty.close();
      } catch {}
    }
    this.ptyTabs.clear();
    this.currentTabId = "main";
    this.activeCpus = 1;
    this.warmupState = "idle";
    this.vsockHandle?.close();
    this.vsockHandle = null;
    this.mountHandle?.dispose();
    this.mountHandle = null;
    this.vm = null;
    this.fbMode = null;
    this.fbFrame = null;
    this.fbFps = 0;
    this.emitTabs();
  }

  private initBroadcastChannel() {
    if (typeof BroadcastChannel === "undefined") return;
    try {
      this.bc = new BroadcastChannel("kerr-obc");
      this.bc.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as { kind?: string; text?: string; script?: string } | null;
        if (!msg || typeof msg !== "object") return;
        if (msg.kind === "obc-req-sync") {
          this.broadcastCrewSnapshot();
        } else if (msg.kind === "obc-boot") {
          void this.boot();
        } else if (msg.kind === "obc-input" && typeof msg.text === "string") {
          this.write(msg.text);
        } else if (msg.kind === "obc-script" && typeof msg.script === "string") {
          void this.runScript(msg.script);
        }
      };
    } catch {
      this.bc = null;
    }
  }

  private startCrewBroadcastLoop() {
    this.stopCrewBroadcastLoop();
    this.crewTimer = setInterval(() => {
      if (this.term.rev !== this.lastCrewTermRev) {
        this.lastCrewTermRev = this.term.rev;
        this.broadcastCrewSnapshot();
      }
    }, 250);
  }

  private stopCrewBroadcastLoop() {
    if (this.crewTimer) {
      clearInterval(this.crewTimer);
      this.crewTimer = null;
    }
  }

  private broadcastCrewSnapshot() {
    if (!this.bc) return;
    try {
      this.bc.postMessage({ kind: "obc-state", snap: this.crewSnapshot() });
    } catch {
      // ignore closed channel
    }
  }
}

/** Shared simulator-wide OBC runtime instance (lazy: does zero work until booted). */
export const obc = new ObcRuntime();
