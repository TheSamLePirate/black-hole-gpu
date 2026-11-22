// AAA In-Game Retractable HUD Console Overlay for the Linux On-Board Computer (docs/PLAN-LINUX-OBC.md §3.2).
// Features:
//   - Lazily loaded @xterm/xterm + FitAddon + ImageAddon (Sixel / IIP graphics)
//   - Live /dev/fb0 canvas with interactive evdev pointer/wheel forwarding & PNG export
//   - Full Options drawer (RAM, FB0 resolution, JIT, Persist /data + Reset, Theme, CRT FX, Audio /dev/dsp, Wisp URL + live probe)
//   - Built-in Script Editor drawer for /home/pilot/* & /obc/scripts/* (Load, Save, Save & Run)
//   - Live VM Snapshot Suspend & Resume

import "@xterm/xterm/css/xterm.css";
import "./obc-console.css";
import { drawObcSurface } from "../obc/fb-renderer";
import { normalizeDistro, normalizeMemoryMiB, type ObcRuntime } from "../obc/runtime";
import { OBC_SCRIPTS } from "../obc/scripts-catalog";
import type { ObcConfig, ObcDistro, ObcTheme, ObcViewMode } from "../obc/types";

interface XtermBundle {
  term: import("@xterm/xterm").Terminal;
  fit: import("@xterm/addon-fit").FitAddon;
}

/** Translate a DOM KeyboardEvent into VT100/ANSI bytes for direct PTY delivery (e.g. in /dev/fb0-only mode). */
export function keyEventToAnsi(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">): string | null {
  if (e.metaKey) return null;
  if (e.ctrlKey && !e.altKey) {
    if (e.key.length === 1) {
      const code = e.key.toUpperCase().charCodeAt(0);
      if (code >= 65 && code <= 90) return String.fromCharCode(code - 64); // Ctrl+A .. Ctrl+Z
    }
    if (e.key === "[" || e.code === "BracketLeft") return "\x1b";
    return null;
  }
  switch (e.key) {
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    case "Home":
      return "\x1b[H";
    case "End":
      return "\x1b[F";
    case "PageUp":
      return "\x1b[5~";
    case "PageDown":
      return "\x1b[6~";
    case "Delete":
      return "\x1b[3~";
    case "Backspace":
      return "\x7f";
    case "Enter":
      return "\r";
    case "Tab":
      return e.shiftKey ? "\x1b[Z" : "\t";
    case "Escape":
      return "\x1b";
    default:
      if (e.key.length === 1 && !e.altKey) return e.key;
      return null;
  }
}

const STARTER_SCRIPT = `#!/bin/sh
# Custom OBC Avionics Script (saved in persistent /home/pilot/)
echo "=== PILOT CUSTOM OBC SCRIPT ==="
cat /obc/tau
echo "--- Telemetry ---"
cat /obc/telemetry.json | head -c 260
echo ""
`;

export class ObcConsoleOverlay {
  readonly el: HTMLDivElement;
  private ledEl: HTMLSpanElement;
  private metaEl: HTMLSpanElement;
  private termWrap: HTMLDivElement;
  private fbWrap: HTMLDivElement;
  private fbCanvas: HTMLCanvasElement;
  private fbCtx: CanvasRenderingContext2D;
  private optionsDrawer: HTMLDivElement;
  private editorDrawer: HTMLDivElement;
  private wispInput: HTMLInputElement;
  private wispStatusEl: HTMLSpanElement;
  private quickDistroSel: HTMLSelectElement;
  private distroSel: HTMLSelectElement;
  private ramSel: HTMLSelectElement;
  private resSel: HTMLSelectElement;
  private themeSel: HTMLSelectElement;
  private syncSel: HTMLSelectElement;
  private jitChk: HTMLInputElement;
  private persistChk: HTMLInputElement;
  private crtChk: HTMLInputElement;
  private soundChk: HTMLInputElement;
  private suspendBtn: HTMLButtonElement;
  private optBtn: HTMLButtonElement;
  private edBtn: HTMLButtonElement;
  private edFileSel: HTMLSelectElement;
  private edPathInput: HTMLInputElement;
  private edText: HTMLTextAreaElement;
  private edStatusEl: HTMLSpanElement;
  private modeBtns = new Map<ObcViewMode, HTMLButtonElement>();

  private xterm: XtermBundle | null = null;
  private xtermLoading: Promise<void> | null = null;
  private unsubOut: (() => void) | null = null;
  private unsubState: (() => void) | null = null;
  private onWinKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private onWinKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private resizeObs: ResizeObserver | null = null;
  private fbRaf: number | null = null;
  private lastFbDrawRev = -1;

  constructor(private runtime: ObcRuntime) {
    this.el = document.createElement("div");
    this.el.className = "obc-overlay";
    this.el.dataset.testid = "obc-console";
    this.el.tabIndex = -1;
    this.el.hidden = true;

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

    // ── Top bar ────────────────────────────────────────────────────────────────
    const bar = document.createElement("div");
    bar.className = "obc-bar";

    const title = document.createElement("div");
    title.className = "obc-title";
    this.ledEl = document.createElement("span");
    this.ledEl.className = "obc-led";
    this.ledEl.dataset.phase = "off";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = "LINUX OBC · UNKERNEL AARCH64";
    this.metaEl = document.createElement("span");
    this.metaEl.className = "obc-meta";
    this.metaEl.textContent = "STANDBY";
    title.append(this.ledEl, nameSpan, this.metaEl);

    const cfg = this.runtime.getConfig();

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

    this.quickDistroSel = mkSelect(
      [
        ["alpine", "Alpine 3.24"],
        ["debian", "Debian 13"],
      ],
      cfg.distro,
      "obc-distro-quick",
    );
    this.quickDistroSel.title = "Switch Linux distribution (Alpine 3.24 musl or Debian 13 Trixie glibc)";
    this.quickDistroSel.onchange = () => {
      const d = normalizeDistro(this.quickDistroSel.value);
      this.distroSel.value = d;
      void this.runtime.switchDistro(d);
      this.focusActiveInput();
    };

    const actions = document.createElement("div");
    actions.className = "obc-actions";
    actions.append(this.quickDistroSel);

    const modes: [ObcViewMode, string][] = [
      ["term", "TTY"],
      ["split", "Split"],
      ["fb", "/dev/fb0"],
    ];
    for (const [m, lbl] of modes) {
      const b = mkBtn(
        lbl,
        () => {
          this.runtime.setViewMode(m);
          this.focusActiveInput();
        },
        { testid: `obc-mode-${m}` },
      );
      this.modeBtns.set(m, b);
      actions.append(b);
    }

    this.suspendBtn = mkBtn(
      "Suspend",
      () => {
        const st = this.runtime.status();
        if (st.phase === "suspended" || st.hasSnapshot) void this.runtime.resume();
        else void this.runtime.suspend();
      },
      { testid: "obc-suspend", title: "Suspend VM to in-memory snapshot or resume instantly" },
    );

    this.edBtn = mkBtn("Editor", () => this.toggleEditor(), {
      testid: "obc-editor-toggle",
      title: "Built-in script editor for /home/pilot/*",
    });

    this.optBtn = mkBtn("Options", () => this.toggleOptions(), {
      testid: "obc-options-toggle",
      title: "Configure RAM, /dev/fb0, JIT, CRT FX, Theme, Audio, Wisp proxy",
    });

    actions.append(
      mkBtn("Boot", () => void this.runtime.boot(), { testid: "obc-boot" }),
      this.suspendBtn,
      mkBtn("Reboot", () => void this.runtime.reboot(), { testid: "obc-reboot" }),
      this.edBtn,
      this.optBtn,
      mkBtn("PNG", () => void this.downloadFbPng(), { testid: "obc-png", title: "Export current /dev/fb0 frame as PNG" }),
      mkBtn("Stop", () => void this.runtime.stop(), { cls: "danger", testid: "obc-stop" }),
      mkBtn("✕", () => this.close(), { testid: "obc-close", title: "Close (Ctrl+\\ or F11)" }),
    );
    bar.append(title, actions);

    // ── Quick avionics script bar (grouped: CLI · TUI · /dev/fb0 · APK) ────────
    const subbar = document.createElement("div");
    subbar.className = "obc-subbar";
    const addGroup = (label: string, cat: "cli" | "tui" | "fb", first = false) => {
      const lbl = document.createElement("span");
      lbl.className = "obc-subbar-label";
      if (!first) lbl.style.marginLeft = "8px";
      lbl.textContent = label;
      subbar.append(lbl);
      for (const s of OBC_SCRIPTS.filter((x) => (x.category ?? "cli") === cat)) {
        subbar.append(
          mkBtn(
            s.label,
            () => {
              void this.runtime.runScript(s.id);
              this.focusActiveInput();
            },
            {
              testid: `obc-script-${s.id}`,
              title: `${s.cmd} — ${s.desc}`,
            },
          ),
        );
      }
    };
    addGroup("CLI:", "cli", true);
    addGroup("TUI:", "tui");
    addGroup("FB0:", "fb");
    const pkgLabel = document.createElement("span");
    pkgLabel.className = "obc-subbar-label";
    pkgLabel.style.marginLeft = "8px";
    pkgLabel.textContent = "PKG:";
    subbar.append(
      pkgLabel,
      mkBtn(
        "+Py",
        () => {
          void this.runtime.installToolchain("python");
          this.focusActiveInput();
        },
        {
          testid: "obc-install-python",
          title: "Install Python 3 & pip (apk on Alpine / apt on Debian, persisted in IndexedDB)",
        },
      ),
      mkBtn(
        "+Node",
        () => {
          void this.runtime.installToolchain("node");
          this.focusActiveInput();
        },
        {
          testid: "obc-install-node",
          title: "Install Node.js & npm (persisted in IndexedDB)",
        },
      ),
      mkBtn(
        "+Bun",
        () => {
          void this.runtime.installToolchain("bun");
          this.focusActiveInput();
        },
        {
          testid: "obc-install-bun",
          title: "Install Bun & bunx via Unkernel shim (Alpine & Debian)",
        },
      ),
      mkBtn(
        "+Rust",
        () => {
          void this.runtime.installToolchain("rust");
          this.focusActiveInput();
        },
        {
          testid: "obc-install-rust",
          title: "Install Rust (rustc + cargo) on Alpine or Debian",
        },
      ),
      mkBtn(
        "+Pi",
        () => {
          void this.runtime.installToolchain("pi");
          this.focusActiveInput();
        },
        {
          testid: "obc-install-pi",
          title: "Install @earendil-works/pi-coding-agent (pi) via npm (Alpine & Debian)",
        },
      ),
      mkBtn(
        "+Claude",
        () => {
          void this.runtime.installToolchain("claude");
          this.focusActiveInput();
        },
        {
          testid: "obc-install-claude",
          title: "Install Claude Code into ~/.local/bin (Alpine & Debian)",
        },
      ),
      mkBtn(
        "+All",
        () => {
          void this.runtime.installToolchain("all");
          this.focusActiveInput();
        },
        {
          testid: "obc-install-all",
          title: "Install Python, pip, Node, npm, Bun, Pi & Claude Code (Alpine & Debian)",
        },
      ),
    );

    // ── Options Drawer (Hardware, Graphics, Audio, Wisp) ───────────────────────
    this.optionsDrawer = document.createElement("div");
    this.optionsDrawer.className = "obc-drawer";
    this.optionsDrawer.dataset.testid = "obc-options-drawer";
    this.optionsDrawer.hidden = true;

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

    this.distroSel = mkSelect(
      [
        ["alpine", "Alpine 3.24 (4 MB, fast)"],
        ["debian", "Debian 13 (72 MB, glibc)"],
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
    this.resSel = mkSelect(
      [
        ["512x512", "512×512 (Square)"],
        ["640x480", "640×480 (VGA)"],
        ["800x600", "800×600 (SVGA)"],
      ],
      `${cfg.fbWidth}x${cfg.fbHeight}`,
      "obc-opt-res",
    );
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

    const jit = mkCheck("JIT Compiler", cfg.jit, "obc-opt-jit");
    this.jitChk = jit.inp;
    const persist = mkCheck("Persist /data", cfg.persistData, "obc-opt-persist");
    this.persistChk = persist.inp;
    const crt = mkCheck("CRT / Phosphor FX", cfg.crtFx, "obc-opt-crt");
    this.crtChk = crt.inp;
    const snd = mkCheck("Audio (/dev/dsp)", cfg.soundEnabled, "obc-opt-sound");
    this.soundChk = snd.inp;

    // Live-apply visual options immediately without requiring reboot
    this.themeSel.onchange = () => {
      this.runtime.setConfig({ theme: this.themeSel.value as ObcConfig["theme"] });
      this.lastFbDrawRev = -1;
    };
    this.crtChk.onchange = () => {
      this.runtime.setConfig({ crtFx: this.crtChk.checked });
      this.lastFbDrawRev = -1;
    };
    this.syncSel.onchange = () => {
      this.runtime.setConfig({ syncMode: this.syncSel.value === "strict" ? "strict" : "interactive" });
    };

    const optRow1 = document.createElement("div");
    optRow1.className = "obc-drawer-row";
    optRow1.append(
      mkField("Distro", this.distroSel),
      mkField("RAM", this.ramSel),
      mkField("/dev/fb0", this.resSel),
      mkField("Theme", this.themeSel),
      mkField("Clock", this.syncSel),
      jit.wrap,
      persist.wrap,
      crt.wrap,
      snd.wrap,
    );

    const optRow2 = document.createElement("div");
    optRow2.className = "obc-drawer-row";
    const wLabel = document.createElement("span");
    wLabel.className = "obc-subbar-label";
    wLabel.textContent = "Wisp Proxy:";
    this.wispInput = document.createElement("input");
    this.wispInput.className = "obc-wisp-input";
    this.wispInput.dataset.testid = "obc-wisp-input";
    this.wispInput.placeholder = "wss://code.samlepirate.org/ (empty = /__wisp dev, wss://code.samlepirate.org/ prod)";
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

    const resetDiskBtn = mkBtn(
      "Reset /data",
      async () => {
        const res = await this.runtime.resetDataDisk();
        this.wispStatusEl.textContent = res.ok ? `✓ ${res.msg}` : `✕ ${res.msg}`;
        this.wispStatusEl.dataset.ok = res.ok ? "1" : "0";
      },
      { cls: "danger", testid: "obc-reset-data", title: "Wipe persisted IndexedDB /data overlay" },
    );

    const applyRebootBtn = mkBtn(
      "Apply & Reboot",
      () => {
        const [fw, fh] = this.resSel.value.split("x").map(Number);
        const mem = normalizeMemoryMiB(Number(this.ramSel.value));
        const distro: ObcDistro = normalizeDistro(this.distroSel.value);
        this.runtime.setConfig({
          distro,
          memoryMiB: mem,
          fbWidth: fw || 512,
          fbHeight: fh || 512,
          jit: this.jitChk.checked,
          persistData: this.persistChk.checked,
          crtFx: this.crtChk.checked,
          soundEnabled: this.soundChk.checked,
          theme: this.themeSel.value as ObcConfig["theme"],
          syncMode: this.syncSel.value === "strict" ? "strict" : "interactive",
        });
        this.runtime.setWispUrl(this.wispInput.value);
        this.lastFbDrawRev = -1;
        this.optionsDrawer.hidden = true;
        this.optBtn.classList.remove("on");
        if (this.runtime.status().phase === "ready") void this.runtime.reboot();
      },
      { cls: "on", testid: "obc-opt-apply" },
    );

    optRow2.append(wLabel, this.wispInput, testWispBtn, this.wispStatusEl, resetDiskBtn, applyRebootBtn);
    this.optionsDrawer.append(optRow1, optRow2);

    // ── Built-in Script Editor Drawer ──────────────────────────────────────────
    this.editorDrawer = document.createElement("div");
    this.editorDrawer.className = "obc-drawer obc-editor-drawer";
    this.editorDrawer.dataset.testid = "obc-editor-drawer";
    this.editorDrawer.hidden = true;

    const edTop = document.createElement("div");
    edTop.className = "obc-drawer-row";
    this.edFileSel = mkSelect([["/home/pilot/custom.sh", "/home/pilot/custom.sh (new)"]], "/home/pilot/custom.sh", "obc-ed-select");
    this.edPathInput = document.createElement("input");
    this.edPathInput.className = "obc-wisp-input";
    this.edPathInput.dataset.testid = "obc-ed-path";
    this.edPathInput.value = "/home/pilot/custom.sh";
    this.edStatusEl = document.createElement("span");
    this.edStatusEl.className = "obc-status-pill";
    this.edStatusEl.dataset.testid = "obc-ed-status";

    this.edFileSel.onchange = () => {
      const p = this.edFileSel.value;
      if (p) {
        this.edPathInput.value = p.startsWith("/obc/scripts/") ? `/home/pilot/${p.split("/").pop()}` : p;
        void this.loadEditorFile(p);
      }
    };

    const edRefresh = mkBtn("Refresh", () => void this.refreshEditorFiles(), { testid: "obc-ed-refresh" });
    const edLoad = mkBtn("Load", () => void this.loadEditorFile(this.edPathInput.value), { testid: "obc-ed-load" });
    const edSave = mkBtn("Save", () => void this.saveEditorFile(false), { testid: "obc-ed-save" });
    const edRun = mkBtn("Save & Run", () => void this.saveEditorFile(true), { cls: "on", testid: "obc-ed-run" });

    edTop.append(this.edFileSel, this.edPathInput, edRefresh, edLoad, edSave, edRun, this.edStatusEl);
    this.edText = document.createElement("textarea");
    this.edText.className = "obc-editor-area";
    this.edText.dataset.testid = "obc-ed-text";
    this.edText.spellcheck = false;
    this.edText.value = STARTER_SCRIPT;
    this.editorDrawer.append(edTop, this.edText);

    // ── Body: terminal + /dev/fb0 canvas ───────────────────────────────────────
    const body = document.createElement("div");
    body.className = "obc-body";

    this.termWrap = document.createElement("div");
    this.termWrap.className = "obc-term-wrap";
    this.termWrap.dataset.testid = "obc-xterm";

    this.fbWrap = document.createElement("div");
    this.fbWrap.className = "obc-fb-wrap";
    this.fbWrap.hidden = true;
    this.fbCanvas = document.createElement("canvas");
    this.fbCanvas.className = "obc-fb-canvas";
    this.fbCanvas.width = cfg.fbWidth;
    this.fbCanvas.height = cfg.fbHeight;
    this.fbCanvas.tabIndex = 0;
    this.fbCanvas.dataset.testid = "obc-fb-canvas";
    this.fbCtx = this.fbCanvas.getContext("2d")!;
    this.fbWrap.append(this.fbCanvas);

    // Interactive evdev mouse/wheel forwarding on /dev/fb0 canvas + keyboard focus
    const sendPtr = (e: PointerEvent, down?: boolean) => {
      const rect = this.fbCanvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      this.runtime.sendPointer(nx, ny, down);
    };
    this.fbCanvas.addEventListener("pointermove", (e) => sendPtr(e));
    this.fbCanvas.addEventListener("pointerdown", (e) => {
      this.fbCanvas.focus();
      sendPtr(e, true);
    });
    this.fbCanvas.addEventListener("pointerup", (e) => sendPtr(e, false));
    this.fbCanvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.runtime.sendWheel(e.deltaY);
      },
      { passive: false },
    );

    body.append(this.termWrap, this.fbWrap);
    this.el.append(bar, subbar, this.optionsDrawer, this.editorDrawer, body);

    const isToggleKey = (e: KeyboardEvent) =>
      (e.code === "F11" && !e.metaKey && !e.ctrlKey && !e.altKey) ||
      (e.ctrlKey && !e.metaKey && !e.altKey && (e.code === "Backslash" || e.code === "Backquote"));

    const isDrawerInput = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      if (el.classList?.contains("xterm-helper-textarea")) return false;
      return Boolean(el.closest?.(".obc-drawer, .obc-bar") && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    };

    // Capture-phase window keyboard router while OBC console is open:
    //   - Guarantees keys reach TUIs & /dev/fb0 apps even in /dev/fb0-only mode or right after clicking a toolbar button
    //   - Blocks Tab/WASD/G/F/1-4/etc. from leaking to the simulator flight controls or target wheel!
    this.onWinKeyDown = (e: KeyboardEvent) => {
      if (!this.isOpen || isToggleKey(e)) return;
      if (isDrawerInput(e.target)) {
        e.stopPropagation();
        return;
      }
      const targetEl = e.target as HTMLElement | null;
      const inXterm = Boolean(targetEl?.classList?.contains("xterm-helper-textarea"));
      if (inXterm && !this.termWrap.hidden) {
        // Let xterm.js handle the key directly; only block Tab from bubbling to simulator wheel
        if (e.key === "Tab") e.preventDefault();
        return;
      }
      // Forward directly to the Linux PTY (covers /dev/fb0-only mode, fbCanvas focus, or post-button click)
      const seq = keyEventToAnsi(e);
      if (seq !== null) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.runtime.write(seq);
        if (!this.termWrap.hidden) this.xterm?.term.focus();
      }
    };
    this.onWinKeyUp = (e: KeyboardEvent) => {
      if (!this.isOpen || isToggleKey(e)) return;
      if (isDrawerInput(e.target)) {
        e.stopPropagation();
        return;
      }
      // Never let keyup (especially Tab/WASD) trigger simulator release actions while OBC console is open
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", this.onWinKeyDown, true);
    window.addEventListener("keyup", this.onWinKeyUp, true);

    // Prevent keystrokes inside the OBC console from reaching simulator flight/scene handlers
    this.el.addEventListener("keydown", (e) => {
      if (isToggleKey(e)) return;
      e.stopPropagation();
    });

    this.runtime.setConsoleController((open) => {
      if (open) this.show(false);
      else this.hide(false);
    });
    this.unsubState = this.runtime.onState(() => this.syncUi());
    this.syncUi();
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open() {
    this.show(true);
  }

  close() {
    this.hide(true);
  }

  toggle(): boolean {
    if (this.isOpen) this.close();
    else this.open();
    return this.isOpen;
  }

  private show(notifyRuntime: boolean) {
    this.el.hidden = false;
    if (notifyRuntime) this.runtime.consoleOpen = true;
    void this.ensureXterm().then(() => {
      this.xterm?.fit.fit();
      this.xterm?.term.focus();
    });
    if (this.runtime.status().phase === "off") {
      void this.runtime.boot();
    }
    this.startFbRenderLoop();
    this.syncUi();
  }

  private hide(notifyRuntime: boolean) {
    this.el.hidden = true;
    if (notifyRuntime) this.runtime.consoleOpen = false;
    this.stopFbRenderLoop();
  }

  private toggleOptions() {
    const next = this.optionsDrawer.hidden;
    this.optionsDrawer.hidden = !next;
    this.optBtn.classList.toggle("on", next);
    if (next) {
      this.editorDrawer.hidden = true;
      this.edBtn.classList.remove("on");
      const cfg = this.runtime.getConfig();
      this.distroSel.value = cfg.distro;
      this.ramSel.value = String(cfg.memoryMiB);
      this.resSel.value = `${cfg.fbWidth}x${cfg.fbHeight}`;
      this.themeSel.value = cfg.theme;
      this.syncSel.value = cfg.syncMode;
      this.jitChk.checked = cfg.jit;
      this.persistChk.checked = cfg.persistData;
      this.crtChk.checked = cfg.crtFx;
      this.soundChk.checked = cfg.soundEnabled;
      this.wispInput.value = this.runtime.getWispUrl();
    }
    this.refitXterm();
  }

  private toggleEditor() {
    const next = this.editorDrawer.hidden;
    this.editorDrawer.hidden = !next;
    this.edBtn.classList.toggle("on", next);
    if (next) {
      this.optionsDrawer.hidden = true;
      this.optBtn.classList.remove("on");
      void this.refreshEditorFiles();
    }
    this.refitXterm();
  }

  private async refreshEditorFiles() {
    const [pilotFiles, sysScripts] = await Promise.all([this.runtime.listFiles("/home/pilot"), this.runtime.listFiles("/obc/scripts")]);
    this.edFileSel.replaceChildren();
    const addOpt = (val: string, lbl: string) => {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = lbl;
      this.edFileSel.append(o);
    };
    addOpt("/home/pilot/custom.sh", "/home/pilot/custom.sh (new)");
    for (const f of pilotFiles) addOpt(`/home/pilot/${f}`, `/home/pilot/${f}`);
    for (const f of sysScripts) addOpt(`/obc/scripts/${f}`, `/obc/scripts/${f} (template)`);
  }

  private async loadEditorFile(path: string) {
    this.edStatusEl.textContent = "Loading…";
    const text = await this.runtime.readGuestFile(path);
    if (text === null) {
      this.edStatusEl.textContent = `New file (${path})`;
      this.edStatusEl.dataset.ok = "";
      return;
    }
    this.edText.value = text;
    this.edStatusEl.textContent = `Loaded ${path} (${text.length} B)`;
    this.edStatusEl.dataset.ok = "1";
  }

  private async saveEditorFile(runAfter: boolean) {
    let path = this.edPathInput.value.trim();
    if (!path.startsWith("/home/pilot/")) {
      path = `/home/pilot/${path.replace(/^.*\//, "") || "custom.sh"}`;
      this.edPathInput.value = path;
    }
    const res = await this.runtime.writeGuestFile(path, this.edText.value);
    this.edStatusEl.textContent = res.ok ? `✓ ${res.msg}` : `✕ ${res.msg}`;
    this.edStatusEl.dataset.ok = res.ok ? "1" : "0";
    if (res.ok) {
      void this.refreshEditorFiles();
      if (runAfter) {
        await this.runtime.runScript(path);
      }
    }
  }

  private async downloadFbPng() {
    const url = await this.runtime.captureFbDataUrl();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `obc-fb0-${Date.now()}.png`;
    a.click();
  }

  private focusActiveInput() {
    requestAnimationFrame(() => {
      if (this.el.hidden) return;
      if (!this.termWrap.hidden && this.xterm) {
        this.xterm.term.focus();
      } else if (!this.fbWrap.hidden) {
        this.fbCanvas.focus();
      } else {
        this.el.focus();
      }
    });
  }

  private refitXterm() {
    requestAnimationFrame(() => {
      if (!this.el.hidden && !this.termWrap.hidden) {
        try {
          this.xterm?.fit.fit();
        } catch {}
      }
    });
  }

  private async ensureXterm(): Promise<void> {
    if (this.xterm) return;
    if (this.xtermLoading) return this.xtermLoading;
    this.xtermLoading = (async () => {
      const [{ Terminal }, { FitAddon }, { ImageAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-image"),
      ]);
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.2,
        scrollback: 2000,
        theme: {
          background: "#041922",
          foreground: "#c6f7ff",
          cursor: "#62e6ff",
          cursorAccent: "#041922",
          selectionBackground: "rgba(98, 230, 255, 0.28)",
          black: "#0c161c",
          red: "#ff5a46",
          green: "#7dff9a",
          yellow: "#ffb347",
          blue: "#58b8ff",
          magenta: "#d58cff",
          cyan: "#62e6ff",
          white: "#c6f7ff",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      try {
        term.loadAddon(new ImageAddon());
      } catch {
        // ImageAddon is optional if canvas/webgl unsupported
      }
      term.open(this.termWrap);
      fit.fit();
      term.onData((data) => this.runtime.write(data));
      this.unsubOut = this.runtime.onOutput((bytes) => term.write(bytes));
      this.resizeObs = new ResizeObserver(() => {
        if (!this.el.hidden && !this.termWrap.hidden) {
          try {
            fit.fit();
          } catch {}
        }
      });
      this.resizeObs.observe(this.termWrap);
      this.xterm = { term, fit };
    })();
    return this.xtermLoading;
  }

  private syncUi() {
    const st = this.runtime.status();
    this.ledEl.dataset.phase = st.phase;
    this.el.dataset.theme = st.config.theme === "auto" ? "interstellar" : st.config.theme;

    const parts: string[] = [st.phase.toUpperCase(), st.distro.toUpperCase()];
    if (st.bootMs !== null) parts.push(`${st.bootMs}ms`);
    parts.push(st.memoryMiB >= 1024 && st.memoryMiB % 1024 === 0 ? `${st.memoryMiB / 1024}GiB` : `${st.memoryMiB}MiB`);
    if (st.config.jit) parts.push("JIT");
    if (st.netEnabled) parts.push("WISP");
    if (st.fbActive) parts.push(`FB0 ${st.fbWidth}×${st.fbHeight}${st.fbFps ? ` @${st.fbFps}Hz` : ""}`);
    this.metaEl.textContent = parts.join(" · ");
    if (this.quickDistroSel.value !== st.config.distro) this.quickDistroSel.value = st.config.distro;

    this.suspendBtn.textContent = st.phase === "suspended" || st.hasSnapshot ? "Resume" : "Suspend";
    this.suspendBtn.classList.toggle("on", st.phase === "suspended" || st.hasSnapshot);

    const effectiveMode: ObcViewMode = st.fbActive && st.viewMode === "term" ? "split" : st.viewMode;
    for (const [m, b] of this.modeBtns) {
      b.classList.toggle("on", m === effectiveMode);
    }
    this.termWrap.hidden = effectiveMode === "fb";
    this.fbWrap.hidden = effectiveMode === "term";
    this.fbWrap.classList.toggle("full", effectiveMode === "fb");
    if (this.fbCanvas.width !== st.config.fbWidth || this.fbCanvas.height !== st.config.fbHeight) {
      this.fbCanvas.width = st.config.fbWidth;
      this.fbCanvas.height = st.config.fbHeight;
      this.lastFbDrawRev = -1;
    }
    this.refitXterm();
  }

  private startFbRenderLoop() {
    if (this.fbRaf !== null) return;
    const tick = () => {
      if (this.el.hidden) {
        this.fbRaf = null;
        return;
      }
      if (!this.fbWrap.hidden) {
        const rev = this.runtime.displayRev;
        if (rev !== this.lastFbDrawRev) {
          this.lastFbDrawRev = rev;
          const cfg = this.runtime.getConfig();
          const baseTheme: ObcTheme = cfg.theme === "auto" ? "interstellar" : cfg.theme;
          drawObcSurface(this.fbCtx, this.runtime.drawSource(), 0, 0, this.fbCanvas.width, this.fbCanvas.height, baseTheme, {
            header: true,
            footer: true,
          });
        }
      }
      this.fbRaf = requestAnimationFrame(tick);
    };
    this.fbRaf = requestAnimationFrame(tick);
  }

  private stopFbRenderLoop() {
    if (this.fbRaf !== null) {
      cancelAnimationFrame(this.fbRaf);
      this.fbRaf = null;
    }
  }

  dispose() {
    this.stopFbRenderLoop();
    if (this.onWinKeyDown) window.removeEventListener("keydown", this.onWinKeyDown, true);
    if (this.onWinKeyUp) window.removeEventListener("keyup", this.onWinKeyUp, true);
    this.unsubOut?.();
    this.unsubState?.();
    this.resizeObs?.disconnect();
    this.xterm?.term.dispose();
    this.el.remove();
  }
}
