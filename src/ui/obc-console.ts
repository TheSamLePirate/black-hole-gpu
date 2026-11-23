// AAA In-Game Draggable & Resizable HUD Console Overlay for the Linux On-Board Computer (docs/PLAN-LINUX-OBC.md).
// Features:
//   - Draggable title bar + 8-way resize handles + Maximize/Restore + Dock Reset + persisted geometry
//   - Live SIGWINCH forwarding (`runtime.resize(cols, rows)`) on open & panel resize
//   - Lazily loaded @xterm/xterm + FitAddon + ImageAddon (Sixel / IIP graphics)
//   - Live /dev/fb0 canvas with interactive evdev pointer/wheel forwarding & PNG export
//   - Full AAA Linux Machine Manager (`ObcMachineManager`: Monitor, System/Unkernel, Disk/Snapshots, Network/Wisp, Toolchains, Game/Logs)
//   - Built-in Script Editor drawer for /home/pilot/* & /obc/scripts/* (Load, Save, Save & Run)
//   - Live VM Snapshot Suspend & Resume

import "@xterm/xterm/css/xterm.css";
import "./obc-console.css";
import { drawObcSurface } from "../obc/fb-renderer";
import { normalizeDistro, type ObcRuntime } from "../obc/runtime";
import { OBC_SCRIPTS } from "../obc/scripts-catalog";
import { TERMINAL_FULL_SANE_SEQ, TERMINAL_MOUSE_RESET_SEQ, TerminalMouseGuard } from "../obc/term-mouse";
import type { ObcTheme, ObcViewMode, ObcWindowBounds } from "../obc/types";
import { store } from "../util/storage";
import { ObcMachineManager } from "./obc-manager";

const WIN_STORAGE_KEY = "kerr.obc.win";
export const OBC_MIN_WIDTH = 560;
export const OBC_MIN_HEIGHT = 340;
const OBC_VIEW_MARGIN = 10;

interface XtermBundle {
  term: import("@xterm/xterm").Terminal;
  fit: import("@xterm/addon-fit").FitAddon;
}

/** Clamp a draggable/resizable OBC window cleanly inside the browser viewport. */
export function clampWindowBounds(b: ObcWindowBounds, vw: number, vh: number): ObcWindowBounds {
  const maxW = Math.max(OBC_MIN_WIDTH, vw - OBC_VIEW_MARGIN * 2);
  const maxH = Math.max(OBC_MIN_HEIGHT, vh - OBC_VIEW_MARGIN * 2);
  if (b.maximized) {
    return { left: OBC_VIEW_MARGIN, top: 44, width: maxW, height: Math.max(OBC_MIN_HEIGHT, vh - 56), maximized: true };
  }
  const width = Math.max(OBC_MIN_WIDTH, Math.min(maxW, Math.round(b.width)));
  const height = Math.max(OBC_MIN_HEIGHT, Math.min(maxH, Math.round(b.height)));
  const left = Math.max(OBC_VIEW_MARGIN, Math.min(vw - width - OBC_VIEW_MARGIN, Math.round(b.left)));
  const top = Math.max(OBC_VIEW_MARGIN, Math.min(vh - height - OBC_VIEW_MARGIN, Math.round(b.top)));
  return { left, top, width, height, maximized: false };
}

function loadSavedWindowBounds(): ObcWindowBounds | null {
  try {
    const raw = store.get(WIN_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<ObcWindowBounds>;
    if (typeof o.left === "number" && typeof o.top === "number" && typeof o.width === "number" && typeof o.height === "number") {
      return { left: o.left, top: o.top, width: o.width, height: o.height, maximized: Boolean(o.maximized) };
    }
  } catch {
    // ignore corrupt saved geometry
  }
  return null;
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

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export class ObcConsoleOverlay {
  readonly el: HTMLDivElement;
  private ledEl: HTMLSpanElement;
  private metaEl: HTMLSpanElement;
  private termWrap: HTMLDivElement;
  private fbWrap: HTMLDivElement;
  private fbCanvas: HTMLCanvasElement;
  private fbCtx: CanvasRenderingContext2D;
  private manager: ObcMachineManager;
  private editorDrawer: HTMLDivElement;
  private quickDistroSel: HTMLSelectElement;
  private suspendBtn: HTMLButtonElement;
  private optBtn: HTMLButtonElement;
  private edBtn: HTMLButtonElement;
  private maxBtn: HTMLButtonElement;
  private edFileSel: HTMLSelectElement;
  private edPathInput: HTMLInputElement;
  private edText: HTMLTextAreaElement;
  private edStatusEl: HTMLSpanElement;
  private modeBtns = new Map<ObcViewMode, HTMLButtonElement>();

  private winBounds: ObcWindowBounds | null = loadSavedWindowBounds();
  private preMaxBounds: ObcWindowBounds | null = null;
  private onWinResize: (() => void) | null = null;

  private xterm: XtermBundle | null = null;
  private xtermLoading: Promise<void> | null = null;
  private mouseGuard = new TerminalMouseGuard();
  private mouseDec = new TextDecoder();
  private unsubOut: (() => void) | null = null;
  private unsubState: (() => void) | null = null;
  private onWinKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private onWinKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private resizeObs: ResizeObserver | null = null;
  private fbRaf: number | null = null;
  private lastSyncedPhase = "";
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

    // ── Top bar (draggable handle + double-click to maximize) ──────────────────
    const bar = document.createElement("div");
    bar.className = "obc-bar";
    bar.dataset.testid = "obc-drag-bar";

    const title = document.createElement("div");
    title.className = "obc-title";
    const grip = document.createElement("span");
    grip.className = "obc-drag-grip";
    grip.textContent = "⋮⋮";
    grip.title = "Drag to move · Double-click to maximize";
    this.ledEl = document.createElement("span");
    this.ledEl.className = "obc-led";
    this.ledEl.dataset.phase = "off";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = "LINUX OBC · UNKERNEL AARCH64";
    this.metaEl = document.createElement("span");
    this.metaEl.className = "obc-meta";
    this.metaEl.textContent = "STANDBY";
    title.append(grip, this.ledEl, nameSpan, this.metaEl);

    const cfg = this.runtime.getConfig();

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
      this.manager.distroSel.value = d;
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

    this.optBtn = mkBtn("Manager", () => this.toggleManager(), {
      testid: "obc-options-toggle",
      title: "Full Linux Machine Manager: Monitor, Unkernel Hardware, Persistent Disk, Wisp, Toolchains, Game & Logs",
    });

    this.maxBtn = mkBtn("⛶", () => this.toggleMaximize(), {
      testid: "obc-maximize",
      title: "Maximize / Restore OBC window",
    });

    actions.append(
      mkBtn("Boot", () => void this.runtime.boot(), { testid: "obc-boot" }),
      this.suspendBtn,
      mkBtn("Reboot", () => void this.runtime.reboot(), { testid: "obc-reboot" }),
      this.edBtn,
      this.optBtn,
      mkBtn("PNG", () => void this.downloadFbPng(), { testid: "obc-png", title: "Export current /dev/fb0 frame as PNG" }),
      mkBtn("Stop", () => void this.runtime.stop(), { cls: "danger", testid: "obc-stop" }),
      mkBtn("⌖", () => this.resetWindowBounds(), { testid: "obc-dock-reset", title: "Reset window position & size" }),
      this.maxBtn,
      mkBtn("✕", () => this.close(), { testid: "obc-close", title: "Close (Ctrl+\\ or F11)" }),
    );
    bar.append(title, actions);
    this.wireDragBar(bar);

    // ── Quick avionics script bar (grouped: CLI · TUI · /dev/fb0 · PKG) ────────
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
        { testid: "obc-install-python", title: "Install Python 3 & pip (Alpine & Debian)" },
      ),
      mkBtn(
        "+Node",
        () => {
          void this.runtime.installToolchain("node");
          this.focusActiveInput();
        },
        { testid: "obc-install-node", title: "Install Node.js & npm (Alpine & Debian)" },
      ),
      mkBtn(
        "+Bun",
        () => {
          void this.runtime.installToolchain("bun");
          this.focusActiveInput();
        },
        { testid: "obc-install-bun", title: "Install Bun & bunx (Alpine & Debian)" },
      ),
      mkBtn(
        "+Rust",
        () => {
          void this.runtime.installToolchain("rust");
          this.focusActiveInput();
        },
        { testid: "obc-install-rust", title: "Install Rust (rustc + cargo) on Alpine or Debian" },
      ),
      mkBtn(
        "+Pi",
        () => {
          void this.runtime.installToolchain("pi");
          this.focusActiveInput();
        },
        { testid: "obc-install-pi", title: "Install @earendil-works/pi-coding-agent (pi) via npm" },
      ),
      mkBtn(
        "+Claude",
        () => {
          void this.runtime.installToolchain("claude");
          this.focusActiveInput();
        },
        { testid: "obc-install-claude", title: "Install Claude Code into ~/.local/bin" },
      ),
      mkBtn(
        "+All",
        () => {
          void this.runtime.installToolchain("all");
          this.focusActiveInput();
        },
        { testid: "obc-install-all", title: "Install Python, pip, Node, npm, Bun, Pi & Claude Code" },
      ),
    );

    // ── AAA Linux Machine Manager Drawer ───────────────────────────────────────
    this.manager = new ObcMachineManager(this.runtime, {
      onApplyVisual: () => {
        this.lastFbDrawRev = -1;
        this.applyVisualConfig();
      },
      onResetWindow: () => this.resetWindowBounds(),
      onResetTty: () => this.resetTerminalModes(),
      onCloseAfterApply: () => {
        this.optBtn.classList.remove("on");
        this.refitXterm();
      },
    });

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
    this.el.append(bar, subbar, this.manager.el, this.editorDrawer, body);
    this.attachResizeHandles();

    const isToggleKey = (e: KeyboardEvent) =>
      (e.code === "F11" && !e.metaKey && !e.ctrlKey && !e.altKey) ||
      (e.ctrlKey && !e.metaKey && !e.altKey && (e.code === "Backslash" || e.code === "Backquote"));

    const isDrawerInput = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      if (el.classList?.contains("xterm-helper-textarea")) return false;
      return Boolean(el.closest?.(".obc-drawer, .obc-bar") && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    };

    // Capture-phase window keyboard router while OBC console is open
    this.onWinKeyDown = (e: KeyboardEvent) => {
      if (!this.isOpen || isToggleKey(e)) return;
      if (isDrawerInput(e.target)) {
        e.stopPropagation();
        return;
      }
      const targetEl = e.target as HTMLElement | null;
      const inXterm = Boolean(targetEl?.classList?.contains("xterm-helper-textarea"));
      if (inXterm && !this.termWrap.hidden) {
        if (e.key === "Tab") e.preventDefault();
        return;
      }
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
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", this.onWinKeyDown, true);
    window.addEventListener("keyup", this.onWinKeyUp, true);

    this.onWinResize = () => {
      if (this.winBounds) {
        this.applyWindowBounds(this.winBounds, false);
        this.refitXterm();
      }
    };
    window.addEventListener("resize", this.onWinResize);

    this.el.addEventListener("keydown", (e) => {
      if (isToggleKey(e)) return;
      e.stopPropagation();
    });
    // Isolate pointer, mouse & wheel events inside the OBC window so moving/scrolling never spins or zooms the 3D camera behind it
    for (const evName of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "mousedown",
      "mousemove",
      "mouseup",
      "wheel",
      "contextmenu",
    ] as const) {
      this.el.addEventListener(evName, (e) => e.stopPropagation());
    }

    this.runtime.setConsoleController((open) => {
      if (open) this.show(false);
      else this.hide(false);
    });
    this.unsubState = this.runtime.onState(() => this.syncUi());
    this.applyVisualConfig();
    if (this.winBounds) this.applyWindowBounds(this.winBounds, false);
    this.syncUi();
  }

  // ── Draggable & 8-Way Resizable Window Engine ──────────────────────────────

  private currentRectBounds(): ObcWindowBounds {
    const r = this.el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      width: r.width || 1120,
      height: r.height || 600,
      maximized: Boolean(this.winBounds?.maximized),
    };
  }

  private applyWindowBounds(raw: ObcWindowBounds, persist = true) {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
    const vh = typeof window !== "undefined" ? window.innerHeight : 900;
    const b = clampWindowBounds(raw, vw, vh);
    this.winBounds = b;
    this.el.classList.add("custom-pos");
    this.el.style.left = `${b.left}px`;
    this.el.style.top = `${b.top}px`;
    this.el.style.width = `${b.width}px`;
    this.el.style.height = `${b.height}px`;
    this.maxBtn.classList.toggle("on", b.maximized);
    if (persist) {
      try {
        store.set(WIN_STORAGE_KEY, JSON.stringify(b));
      } catch {
        // ignore storage quota
      }
    }
  }

  resetWindowBounds() {
    this.winBounds = null;
    this.preMaxBounds = null;
    this.el.classList.remove("custom-pos");
    this.el.style.left = "";
    this.el.style.top = "";
    this.el.style.width = "";
    this.el.style.height = "";
    this.maxBtn.classList.remove("on");
    try {
      store.remove(WIN_STORAGE_KEY);
    } catch {}
    this.refitXterm();
  }

  private toggleMaximize() {
    if (this.winBounds?.maximized) {
      if (this.preMaxBounds) {
        this.applyWindowBounds({ ...this.preMaxBounds, maximized: false });
      } else {
        this.resetWindowBounds();
      }
    } else {
      this.preMaxBounds = this.currentRectBounds();
      this.applyWindowBounds({ ...this.preMaxBounds, maximized: true });
    }
    this.refitXterm();
  }

  private wireDragBar(bar: HTMLDivElement) {
    const isInteractive = (t: EventTarget | null) =>
      Boolean((t as HTMLElement | null)?.closest?.("button, select, input, textarea, a, label"));

    bar.addEventListener("dblclick", (e) => {
      if (isInteractive(e.target)) return;
      e.preventDefault();
      this.toggleMaximize();
    });

    bar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || isInteractive(e.target)) return;
      e.preventDefault();
      const start = this.currentRectBounds();
      if (start.maximized) return;
      const sx = e.clientX;
      const sy = e.clientY;
      this.el.classList.add("dragging");
      try {
        bar.setPointerCapture(e.pointerId);
      } catch {}

      const onMove = (ev: PointerEvent) => {
        this.applyWindowBounds(
          {
            left: start.left + (ev.clientX - sx),
            top: start.top + (ev.clientY - sy),
            width: start.width,
            height: start.height,
            maximized: false,
          },
          false,
        );
      };
      const onUp = () => {
        this.el.classList.remove("dragging");
        bar.removeEventListener("pointermove", onMove);
        bar.removeEventListener("pointerup", onUp);
        bar.removeEventListener("pointercancel", onUp);
        if (this.winBounds) this.applyWindowBounds(this.winBounds, true);
      };
      bar.addEventListener("pointermove", onMove);
      bar.addEventListener("pointerup", onUp);
      bar.addEventListener("pointercancel", onUp);
    });
  }

  private attachResizeHandles() {
    const dirs: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
    for (const dir of dirs) {
      const h = document.createElement("div");
      h.className = `obc-rz obc-rz-${dir}`;
      h.dataset.testid = `obc-resize-${dir}`;
      h.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const start = this.currentRectBounds();
        const sx = e.clientX;
        const sy = e.clientY;
        this.el.classList.add("resizing");
        try {
          h.setPointerCapture(e.pointerId);
        } catch {}

        const onMove = (ev: PointerEvent) => {
          const dx = ev.clientX - sx;
          const dy = ev.clientY - sy;
          let left = start.left;
          let top = start.top;
          let width = start.width;
          let height = start.height;

          if (dir.includes("e")) width = Math.max(OBC_MIN_WIDTH, start.width + dx);
          if (dir.includes("s")) height = Math.max(OBC_MIN_HEIGHT, start.height + dy);
          if (dir.includes("w")) {
            const nextW = Math.max(OBC_MIN_WIDTH, start.width - dx);
            left = start.left + (start.width - nextW);
            width = nextW;
          }
          if (dir.includes("n")) {
            const nextH = Math.max(OBC_MIN_HEIGHT, start.height - dy);
            top = start.top + (start.height - nextH);
            height = nextH;
          }
          this.applyWindowBounds({ left, top, width, height, maximized: false }, false);
        };

        const onUp = () => {
          this.el.classList.remove("resizing");
          h.removeEventListener("pointermove", onMove);
          h.removeEventListener("pointerup", onUp);
          h.removeEventListener("pointercancel", onUp);
          if (this.winBounds) this.applyWindowBounds(this.winBounds, true);
          this.refitXterm();
        };

        h.addEventListener("pointermove", onMove);
        h.addEventListener("pointerup", onUp);
        h.addEventListener("pointercancel", onUp);
      });
      this.el.append(h);
    }
  }

  private applyVisualConfig() {
    const cfg = this.runtime.getConfig();
    this.el.style.setProperty("--obc-opacity", String(cfg.panelOpacity));
    if (this.xterm && this.xterm.term.options.fontSize !== cfg.fontSize) {
      this.xterm.term.options.fontSize = cfg.fontSize;
      this.refitXterm();
    }
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
    if (this.winBounds) this.applyWindowBounds(this.winBounds, false);
    void this.ensureXterm().then(() => {
      this.fitAndResizeGuest();
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
    if (this.manager.isOpen) {
      this.manager.close();
      this.optBtn.classList.remove("on");
    }
    this.stopFbRenderLoop();
  }

  private toggleManager() {
    const next = !this.manager.isOpen;
    this.optBtn.classList.toggle("on", next);
    if (next) {
      this.editorDrawer.hidden = true;
      this.edBtn.classList.remove("on");
      this.manager.open();
    } else {
      this.manager.close();
    }
    this.refitXterm();
  }

  private toggleEditor() {
    const next = this.editorDrawer.hidden;
    this.editorDrawer.hidden = !next;
    this.edBtn.classList.toggle("on", next);
    if (next) {
      this.manager.close();
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

  private fitAndResizeGuest(force = false) {
    if (!this.xterm || this.el.hidden || this.termWrap.hidden) return;
    try {
      this.xterm.fit.fit();
      this.runtime.resize(this.xterm.term.cols, this.xterm.term.rows, force);
    } catch {}
  }

  private refitXterm(force = false) {
    requestAnimationFrame(() => this.fitAndResizeGuest(force));
  }

  resetTerminalModes() {
    this.mouseGuard.resetModes(true);
    this.xterm?.term.write(TERMINAL_FULL_SANE_SEQ);
    this.refitXterm();
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
      const cfg = this.runtime.getConfig();
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
        fontSize: cfg.fontSize,
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
      this.runtime.resize(term.cols, term.rows);
      term.onData((data) => {
        const filtered = this.mouseGuard.filterInput(data, {
          allowMouse: this.runtime.getConfig().termMouse,
          suppressAllMouse: this.el.classList.contains("dragging") || this.el.classList.contains("resizing"),
        });
        if (filtered) this.runtime.write(filtered);
      });
      this.unsubOut = this.runtime.onOutput((bytes) => {
        term.write(bytes);
        const text = this.mouseDec.decode(bytes, { stream: true });
        if (this.mouseGuard.observeGuestOutput(text)) {
          term.write(TERMINAL_MOUSE_RESET_SEQ);
        }
      });
      this.resizeObs = new ResizeObserver(() => {
        if (!this.el.hidden && !this.termWrap.hidden) {
          try {
            fit.fit();
            this.runtime.resize(term.cols, term.rows);
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
    this.applyVisualConfig();

    const parts: string[] = [st.phase.toUpperCase(), st.distro.toUpperCase()];
    if (st.bootMs !== null) parts.push(`${st.bootMs}ms`);
    parts.push(st.memoryMiB >= 1024 && st.memoryMiB % 1024 === 0 ? `${st.memoryMiB / 1024}GiB` : `${st.memoryMiB}MiB`);
    if (st.config.cpus > 1) parts.push(`${st.config.cpus}CPU`);
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
    const becameReady = st.phase === "ready" && this.lastSyncedPhase !== "ready";
    this.lastSyncedPhase = st.phase;
    this.refitXterm(becameReady);
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
    this.manager.dispose();
    if (this.onWinKeyDown) window.removeEventListener("keydown", this.onWinKeyDown, true);
    if (this.onWinKeyUp) window.removeEventListener("keyup", this.onWinKeyUp, true);
    if (this.onWinResize) window.removeEventListener("resize", this.onWinResize);
    this.unsubOut?.();
    this.unsubState?.();
    this.resizeObs?.disconnect();
    this.xterm?.term.dispose();
    this.el.remove();
  }
}
