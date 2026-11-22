// Lazy-booting AAA Linux On-Board Computer (OBC) runtime powered by Unkernel (WASM Linux 7.x + aarch64 JIT).
// Zero startup cost: unkernel/web, unkernel.wasm, and alpine.erofs are only loaded on first `boot()`.
// Runs inside a dedicated Web Worker (`worker: true`) with:
//   - 9p host mount (/obc) + AF_VSOCK:4747 JSONL avionics bus
//   - /dev/fb0 XRGB8888 live framebuffer + interactive evdev mouse/keyboard forwarding
//   - /dev/dsp & ALSA audio output bridged to WebAudio (opt-in)
//   - Live VM snapshot suspend/resume & persistent IndexedDB /data management
//   - File explorer / script editor API for /home/pilot & /obc/scripts
//   - Wisp v1 connectivity tester & persistent user configuration

import type { DisplayMode, KernelHandle, KernelSnapshot, SoundChunk } from "unkernel/web";
import { store } from "../util/storage";
import { startObcVsockServer, wireObcMountFs, type ObcHostAdapter, type ObcVsockHandle } from "./bridge";
import type { ObcDrawSource } from "./fb-renderer";
import { emptyTelemetry, normalizeWispUrl } from "./protocol";
import { findObcScript, loadProjectScripts, OBC_SCRIPTS } from "./scripts-catalog";
import { TermBuffer } from "./term-buffer";
import {
  DEFAULT_OBC_CONFIG,
  type ObcConfig,
  type ObcCrewSnapshot,
  type ObcDistro,
  type ObcMemoryMiB,
  type ObcPhase,
  type ObcStatus,
  type ObcTelemetry,
  type ObcToolchainProfile,
  type ObcViewMode,
} from "./types";

const WISP_STORAGE_KEY = "kerr.obc.wisp";
const CFG_STORAGE_KEY = "kerr.obc.cfg";
export const DEFAULT_PROD_WISP_URL = "wss://code.samlepirate.org/";
const FB_POLL_MS = 33; // up to 30 Hz smooth real-time framebuffer updates while /dev/fb0 is open

export function normalizeMemoryMiB(raw: unknown): ObcMemoryMiB {
  if (raw === 512 || raw === 1024 || raw === 2048 || raw === 4096) return raw;
  return DEFAULT_OBC_CONFIG.memoryMiB;
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
      fbWidth,
      fbHeight,
      jit: typeof o.jit === "boolean" ? o.jit : DEFAULT_OBC_CONFIG.jit,
      persistData: typeof o.persistData === "boolean" ? o.persistData : DEFAULT_OBC_CONFIG.persistData,
      crtFx: typeof o.crtFx === "boolean" ? o.crtFx : DEFAULT_OBC_CONFIG.crtFx,
      soundEnabled: typeof o.soundEnabled === "boolean" ? o.soundEnabled : DEFAULT_OBC_CONFIG.soundEnabled,
      theme,
      syncMode: o.syncMode === "strict" ? "strict" : "interactive",
    };
  } catch {
    return { ...DEFAULT_OBC_CONFIG };
  }
}

export class ObcRuntime {
  private vm: KernelHandle | null = null;
  private bootPromise: Promise<ObcStatus> | null = null;
  private savedSnapshot: KernelSnapshot | null = null;
  private hibernatedState: { activeScript: string | null } | null = null;
  private vsockHandle: ObcVsockHandle | null = null;
  private unsubMount: (() => void) | null = null;
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
  private transport = "none";
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
  private netEnabled = false;
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
    next.fbWidth = Math.max(256, Math.min(1024, Math.round(next.fbWidth)));
    next.fbHeight = Math.max(256, Math.min(1024, Math.round(next.fbHeight)));
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

      const [projectFiles, effectiveWisp, rustBinary] = await Promise.all([loadProjectScripts(), this.resolveWispUrl(), loadRustBinary()]);
      this.netEnabled = Boolean(effectiveWisp);

      const memFs = new mod.MemoryFs();
      this.unsubMount = wireObcMountFs(
        memFs,
        this.adapter,
        () => this.status(),
        projectFiles.scripts,
        projectFiles.lib,
        () => {
          this.commandsHandled++;
        },
        rustBinary,
      );

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
        jit: this.config.jit,
        disks: [{ kind: "data", template: "bundled", mode: this.config.persistData ? "persistent" : "snapshot" }],
        mounts: { "/obc": memFs },
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
        log: (msg) => console.debug("[OBC]", msg),
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
      this.transport = vm.transport;
      if (vm.vsock) {
        this.vsockHandle = startObcVsockServer(vm.vsock, this.adapter, () => {
          this.commandsHandled++;
        });
      }

      if (!restore) {
        await this.configureGuestEnvironment(vm);
      }

      this.bootMs = Math.round(performance.now() - t0);
      this.phase = "ready";
      this.startCrewBroadcastLoop();
      this.emitState();

      if (!restore) {
        const heapMb = this.nodeMaxOldSpaceMiB();
        vm.write(
          `export PATH="/obc/bin:/obc/scripts:$HOME/.local/bin:$HOME/.bun/bin:/home/user/.local/bin:/home/user/.bun/bin:/usr/local/bin:$PATH:/usr/lib/kw/bin" PYTHONPATH=/obc/lib NODE_PATH=/obc/lib NODE_OPTIONS="--max-old-space-size=${heapMb}"; cd /home/pilot 2>/dev/null; clear; obc-diag\n`,
        );
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
    return Math.max(256, Math.min(1536, Math.floor(this.actualMemoryMiB * 0.45)));
  }

  private async configureGuestEnvironment(vm: KernelHandle): Promise<void> {
    const heapMb = this.nodeMaxOldSpaceMiB();
    const setupScript = [
      "mkdir -p /home/pilot /etc/profile.d /home/user/.local/bin",
      "chmod 777 /home/pilot 2>/dev/null || true",
      "chown -R 1000:1000 /home/user/.local 2>/dev/null || true",
      "ln -sf /obc/tau /dev/tau",
      `printf 'export PATH="/obc/bin:/obc/scripts:$HOME/.local/bin:$HOME/.bun/bin:/home/user/.local/bin:/home/user/.bun/bin:/usr/local/bin:$PATH:/usr/lib/kw/bin"\\nexport PYTHONPATH=/obc/lib\\nexport NODE_PATH=/obc/lib\\nexport PYTHONDONTWRITEBYTECODE=1\\nexport NODE_OPTIONS="--max-old-space-size=${heapMb}"\\n' > /etc/profile.d/obc.sh`,
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
      const heapMb = this.nodeMaxOldSpaceMiB();
      const wrapped = `export PATH="/obc/bin:/obc/scripts:$HOME/.local/bin:$HOME/.bun/bin:/home/user/.local/bin:/home/user/.bun/bin:/usr/local/bin:$PATH:/usr/lib/kw/bin" PYTHONPATH=/obc/lib NODE_PATH=/obc/lib PYTHONDONTWRITEBYTECODE=1 NODE_OPTIONS="--max-old-space-size=${heapMb}"; ${command}`;
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

  async runScript(idOrName: string): Promise<{ ok: boolean; script: string }> {
    const meta = findObcScript(idOrName);
    const cmd = meta ? meta.cmd : idOrName.trim();
    if (!cmd) return { ok: false, script: "" };
    const st = await this.boot();
    if (st.phase !== "ready" || !this.vm) return { ok: false, script: cmd };
    this.activeScript = meta?.name ?? cmd.split(/\s+/)[0] ?? cmd;
    // Send Ctrl+C first and yield briefly so Debian bash's SIGINT readline flush never eats the 1st byte of `cmd`.
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
      const heapMb = this.nodeMaxOldSpaceMiB();
      const proc = await this.vm.spawn(
        "sh",
        [
          "-lc",
          `export PATH="/obc/scripts:$HOME/.local/bin:/usr/local/bin:$PATH:/usr/lib/kw/bin" NODE_OPTIONS="--max-old-space-size=${heapMb}"; sh /obc/scripts/obc-install "${profile}"`,
        ],
        { pty: false },
      );
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

  private cleanupVmHandles() {
    this.stopFbPolling();
    this.stopCrewBroadcastLoop();
    this.vsockHandle?.close();
    this.vsockHandle = null;
    this.unsubMount?.();
    this.unsubMount = null;
    this.vm = null;
    this.fbMode = null;
    this.fbFrame = null;
    this.fbFps = 0;
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
